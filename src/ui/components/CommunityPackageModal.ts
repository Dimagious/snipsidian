import { App, Modal, Notice, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { loadCommunityPackages, type PackageItem } from "../../services/community-packages";
import { validatePackage } from "../../services/package-validator";

export class CommunityPackageModal extends Modal {
    private packages: PackageItem[] = [];
    private filteredPackages: PackageItem[] = [];
    private searchQuery = "";

    constructor(
        public app: App,
        private plugin: SnipSidianPlugin
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("snipsy-community-modal");

        // Header
        const header = contentEl.createDiv({ cls: "modal-header" });
        header.createEl("h2", { text: "Community Packages" });

        // Search
        const searchContainer = contentEl.createDiv({ cls: "search-container" });
        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search packages...",
            cls: "search-input"
        });
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.filterPackages();
            this.renderPackages();
        };

        // Load packages
        try {
            this.packages = await loadCommunityPackages();
            // Sort packages alphabetically by label
            this.packages.sort((a, b) => a.label.localeCompare(b.label));
            this.filteredPackages = this.packages;
            this.renderPackages();
        } catch (error) {
            contentEl.createEl("p", { 
                text: "Failed to load community packages. Please check your internet connection.",
                cls: "error-message"
            });
        }
    }

    private filterPackages() {
        if (!this.searchQuery) {
            this.filteredPackages = this.packages;
        } else {
            this.filteredPackages = this.packages.filter(pkg => 
                pkg.label.toLowerCase().includes(this.searchQuery) ||
                pkg.description?.toLowerCase().includes(this.searchQuery) ||
                pkg.tags?.some((tag: string) => tag.toLowerCase().includes(this.searchQuery))
            );
        }
    }

    private renderPackages() {
        const packagesContainer = this.contentEl.querySelector(".packages-container");
        if (packagesContainer) {
            packagesContainer.remove();
        }

        const container = this.contentEl.createDiv({ cls: "packages-container" });

        if (this.filteredPackages.length === 0) {
            container.createEl("p", { 
                text: this.searchQuery ? "No packages found matching your search." : "No community packages available yet.",
                cls: "no-packages"
            });
            return;
        }

        this.filteredPackages.forEach(pkg => {
            const packageEl = container.createDiv({ cls: "package-item" });
            
            // Package header
            const header = packageEl.createDiv({ cls: "package-header" });
            header.createEl("h3", { text: pkg.label, cls: "package-title" });
            
            if (pkg.verified) {
                header.createEl("span", { text: "✓", cls: "verified-badge", title: "Verified package" });
            }

            // Package info
            const info = packageEl.createDiv({ cls: "package-info" });
            if (pkg.description) {
                info.createEl("p", { text: pkg.description, cls: "package-description" });
            }
            
            const meta = info.createDiv({ cls: "package-meta" });
            meta.createEl("span", { text: `by ${pkg.author}`, cls: "package-author" });
            meta.createEl("span", { text: `v${pkg.version}`, cls: "package-version" });
            if (pkg.downloads) {
                meta.createEl("span", { text: `${pkg.downloads} downloads`, cls: "package-downloads" });
            }

            // Tags
            if (pkg.tags && pkg.tags.length > 0) {
                const tags = info.createDiv({ cls: "package-tags" });
                pkg.tags.forEach((tag: string) => {
                    tags.createEl("span", { text: tag, cls: "package-tag" });
                });
            }

            // Install button
            const installBtn = packageEl.createEl("button", {
                text: "Install Package",
                cls: "install-btn"
            });
            installBtn.onclick = () => this.installPackage(pkg);
        });
    }

    private async installPackage(pkg: PackageItem) {
        try {
            // For now, we'll show a notice since we don't have the actual package content
            // In the future, this would load the package YAML and install it
            new Notice(`Installing "${pkg.label}"... (Feature coming soon!)`);
            
            // TODO: Load package YAML content and install it
            // const packageContent = await loadPackageContent(pkg.id);
            // const validation = validatePackage(packageContent);
            // if (validation.isValid) {
            //     await this.installCommunityPackage(packageContent);
            //     new Notice(`Package "${pkg.label}" installed successfully!`);
            //     this.close();
            // } else {
            //     new Notice(`Package validation failed: ${validation.errors.join(', ')}`);
            // }
        } catch (error) {
            new Notice(`Failed to install package: ${error}`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
