import { App, Modal, Notice } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { loadAllCommunityPackages } from "../../../services/community-packages";
import { validatePackageForInstall } from "../../../services/package-validator";
import { PackagePreviewModal } from "../Modals";
import { joinKey } from "../../../store/keys";
import { buildPackageDiff, isPackageInstalled } from "../../../core/install-plan";
import { hasReplacementCollision } from "../../../store/snippets";

interface PackageItem {
    id?: string;
    label: string;
    description?: string;
    author?: string;
    version?: string;
    tags?: string[];
    verified?: boolean;
    snippets?: { [trigger: string]: string };
}

/**
 * Community package browser. Per the 1.1.0 redesign (HANDOFF §2d):
 * - List-of-rows layout (table replaced — tables waste columns at the
 *   600px settings width and force long descriptions to clip).
 * - Loading skeleton state on first fetch and on refresh.
 * - Empty + error states with retry.
 * - Install ALWAYS opens the preview modal, even when conflicts ===
 *   0. Old behavior silently installed in the no-conflict path; users
 *   complained they couldn't see what was about to land in their
 *   library (B-040).
 */
export class PackageBrowser {
    private packages: PackageItem[] = [];
    private filteredPackages: PackageItem[] = [];
    private searchQuery = "";
    private state: "loading" | "ready" | "error" = "loading";
    private section: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;

    constructor(
        private app: App,
        private plugin: SnipSidianPlugin,
    ) {}

    async render(root: HTMLElement): Promise<void> {
        this.section = root.createDiv({ cls: "snipsy-community-browse-section" });
        this.section.createEl("h3", {
            text: "Community packages",
            cls: "snipsy-tab-heading",
        });
        this.section.createEl("p", {
            text: "Curated snippet collections from the community.",
            cls: "snipsy-hint",
        });

        // Toolbar: search + refresh. Same toolbar pattern as Snippets tab.
        const toolbar = this.section.createDiv({ cls: "snipsy-snippet-toolbar" });

        const searchWrap = toolbar.createDiv({ cls: "snipsy-search" });
        const searchInput = searchWrap.createEl("input", {
            type: "text",
            attr: {
                placeholder: "Filter packages",
                "aria-label": "Filter community packages",
            },
        });
        searchInput.addEventListener("input", () => {
            this.searchQuery = searchInput.value.toLowerCase();
            this.filterPackages();
            this.renderList();
        });

        const refreshBtn = toolbar.createEl("button", {
            cls: "snippet-action",
            text: "Refresh",
            attr: { type: "button", "aria-label": "Refresh packages from GitHub" },
        });
        refreshBtn.addEventListener("click", () => {
            void this.refresh();
        });

        this.listEl = this.section.createDiv({ cls: "packages-list" });

        await this.load();
    }

    private async load() {
        if (!this.listEl) return;
        this.state = "loading";
        this.renderSkeleton();
        try {
            const items = await loadAllCommunityPackages(this.app, this.plugin);
            items.sort((a, b) => a.label.localeCompare(b.label));
            this.packages = items;
            this.filterPackages();
            this.state = "ready";
            this.renderList();
        } catch (err) {
            console.error("[snipsy] failed to load community packages", err);
            this.state = "error";
            this.renderError();
        }
    }

    private async refresh() {
        // Invalidate cache so the next load hits GitHub.
        if (this.plugin.settings.communityPackages?.cache) {
            this.plugin.settings.communityPackages.cache.lastUpdated = 0;
            await this.plugin.saveSettings();
        }
        await this.load();
        if (this.state === "ready") new Notice("Community packages refreshed");
    }

    private filterPackages() {
        if (!this.searchQuery) {
            this.filteredPackages = this.packages;
            return;
        }
        this.filteredPackages = this.packages.filter(
            (pkg) =>
                pkg.label.toLowerCase().includes(this.searchQuery) ||
                pkg.description?.toLowerCase().includes(this.searchQuery) ||
                pkg.tags?.some((tag) => tag.toLowerCase().includes(this.searchQuery)),
        );
    }

    private renderSkeleton() {
        if (!this.listEl) return;
        this.listEl.empty();
        for (let i = 0; i < 4; i++) {
            const row = this.listEl.createDiv({ cls: "package-row is-skeleton" });
            const meta = row.createDiv({ cls: "package-meta-block" });
            meta.createDiv({ cls: "snipsy-skeleton snipsy-skeleton-title" });
            meta.createDiv({ cls: "snipsy-skeleton snipsy-skeleton-line" });
            meta.createDiv({ cls: "snipsy-skeleton snipsy-skeleton-line is-short" });
            row.createDiv({ cls: "snipsy-skeleton snipsy-skeleton-button" });
        }
    }

    private renderError() {
        if (!this.listEl) return;
        this.listEl.empty();
        const empty = this.listEl.createDiv({ cls: "snipsy-empty" });
        empty.createEl("p", { text: "Couldn't reach the package index." });
        empty.createEl("p", { text: "Check your connection and try again." });
        const retry = empty.createEl("button", {
            cls: "snippet-action",
            text: "Try again",
            attr: { type: "button" },
        });
        retry.addEventListener("click", () => void this.refresh());
    }

    private renderList() {
        if (!this.listEl) return;
        this.listEl.empty();

        if (this.filteredPackages.length === 0) {
            const empty = this.listEl.createDiv({ cls: "snipsy-empty" });
            empty.createEl("p", {
                text: this.searchQuery
                    ? "No packages match your filter."
                    : "No community packages available yet.",
            });
            return;
        }

        for (const pkg of this.filteredPackages) {
            this.renderRow(pkg);
        }
    }

    private renderRow(pkg: PackageItem) {
        if (!this.listEl) return;
        const row = this.listEl.createDiv({ cls: "package-row" });
        row.setAttr("role", "button");
        row.setAttr("tabindex", "0");
        row.setAttr("aria-label", `View details for ${pkg.label}`);

        const meta = row.createDiv({ cls: "package-meta-block" });

        const nameLine = meta.createDiv({ cls: "package-name-line" });
        nameLine.createSpan({ cls: "package-name", text: pkg.label });
        if (pkg.verified) {
            nameLine.createSpan({ cls: "verified-badge", text: "Verified" });
        }

        if (pkg.description) {
            meta.createEl("p", { cls: "package-desc", text: pkg.description });
        }

        const submeta = meta.createDiv({ cls: "package-meta" });
        submeta.createSpan({ text: pkg.author ?? "Unknown" });
        submeta.createSpan({ text: `v${pkg.version ?? "1.0.0"}` });
        const count = Object.keys(pkg.snippets ?? {}).length;
        submeta.createSpan({
            text: `${count} snippet${count === 1 ? "" : "s"}`,
        });

        const actions = row.createDiv({ cls: "package-actions" });
        const installed = isPackageInstalled(
            pkg.snippets,
            pkg.label,
            this.plugin.settings.snippets,
        );
        const btn = actions.createEl("button", {
            text: installed ? "Installed" : "Install",
            cls: installed ? "snippet-action" : "snippet-action mod-cta",
            attr: { type: "button" },
        });
        if (installed) {
            btn.disabled = true;
        }
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!installed) this.installPackage(pkg);
        });

        const openDetails = () => this.showPackageDetails(pkg);
        row.addEventListener("click", openDetails);
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDetails();
            }
        });
    }

    private installPackage(pkg: PackageItem) {
        try {
            if (!pkg.snippets || Object.keys(pkg.snippets).length === 0) {
                new Notice(`Package "${pkg.label}" has no snippets to install.`);
                return;
            }

            // Re-validate at install time even though the submission flow
            // ran the same checks — content fetched from GitHub bypasses
            // that path (it's already-approved content). Catches
            // attacker-controlled triggers / replacements / size before
            // they land in settings.
            const v = validatePackageForInstall(pkg);
            if (!v.isValid) {
                const first = v.errors[0] ?? "Package failed install-time validation";
                const more = v.errors.length > 1 ? ` (and ${v.errors.length - 1} more)` : "";
                new Notice(`Cannot install "${pkg.label}": ${first}${more}`);
                console.error("[snipsy] install validation failed for", pkg.label, v.errors);
                return;
            }

            const packageGroup = pkg.label;
            const triggerCollisions = Object.entries(pkg.snippets).filter(
                ([trigger, replacement]) => {
                    const groupedKey = joinKey(packageGroup, trigger);
                    if (this.plugin.settings.snippets[groupedKey] !== undefined) return false;
                    return hasReplacementCollision(
                        this.plugin.settings,
                        trigger,
                        replacement,
                        groupedKey,
                    );
                },
            );

            if (triggerCollisions.length > 0) {
                const collisions = triggerCollisions.map(([trigger]) => trigger).join(", ");
                new Notice(
                    `Skipped install: trigger name collision with existing snippets (${collisions})`,
                );
                return;
            }

            // Always preview (HANDOFF §2d) — even with zero conflicts the
            // user should see the diff before the install happens.
            const diff = buildPackageDiff(
                pkg.snippets,
                packageGroup,
                this.plugin.settings.snippets,
            );
            const modal = new PackagePreviewModal(this.app, this.plugin, pkg.label, diff);
            modal.onConfirm = async (resolved) => {
                await this.applyResolvedInstallation(pkg, resolved);
            };
            modal.open();
        } catch (error) {
            new Notice(
                `Failed to install package: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async applyResolvedInstallation(
        pkg: PackageItem,
        resolved: Record<string, string>,
    ) {
        try {
            this.plugin.settings.snippets = resolved;
            await this.plugin.saveSettings();
            const installedCount = Object.keys(pkg.snippets || {}).length;
            new Notice(`Installed ${pkg.label} (${installedCount} snippets)`);
            this.renderList();
        } catch (error) {
            new Notice(
                `Failed to install package: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private showPackageDetails(pkg: PackageItem) {
        const modal = new Modal(this.app);
        modal.titleEl.setText(pkg.label);
        const content = modal.contentEl;
        content.empty();
        content.addClass("snipsidian-modal");

        if (pkg.verified) {
            content.createDiv({ cls: "verified-badge", text: "Verified" });
        }
        if (pkg.description) {
            content.createEl("p", { text: pkg.description, cls: "package-desc" });
        }

        const meta = content.createDiv({ cls: "package-meta" });
        meta.createSpan({ text: `Author: ${pkg.author ?? "Unknown"}` });
        meta.createSpan({ text: `Version: ${pkg.version ?? "1.0.0"}` });
        const snippetCount = Object.keys(pkg.snippets ?? {}).length;
        meta.createSpan({ text: `${snippetCount} snippet${snippetCount === 1 ? "" : "s"}` });

        if (pkg.tags && pkg.tags.length > 0) {
            const tagsContainer = content.createDiv({ cls: "package-tags" });
            for (const tag of pkg.tags) {
                tagsContainer.createSpan({ text: tag, cls: "package-tag" });
            }
        }

        if (pkg.snippets && snippetCount > 0) {
            const list = content.createDiv({ cls: "package-snippet-preview" });
            for (const [trigger, replacement] of Object.entries(pkg.snippets)) {
                const row = list.createDiv({ cls: "snippet-row" });
                row.createSpan({ cls: "snippet-trigger", text: trigger });
                row.createSpan({ cls: "arrow", text: "→" });
                row.createSpan({ cls: "snippet-replacement", text: replacement });
            }
        }

        const footer = content.createDiv({ cls: "modal-button-container" });
        const installed = isPackageInstalled(
            pkg.snippets,
            pkg.label,
            this.plugin.settings.snippets,
        );
        const installBtn = footer.createEl("button", {
            text: installed ? "Installed" : "Install",
            cls: installed ? "" : "mod-cta",
        });
        installBtn.disabled = installed;
        if (!installed) {
            installBtn.onclick = () => {
                modal.close();
                this.installPackage(pkg);
            };
        }
        footer.createEl("button", { text: "Close" }).onclick = () => modal.close();

        modal.open();
    }
}
