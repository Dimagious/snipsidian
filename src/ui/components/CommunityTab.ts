// CommunityTab.ts
import { App, Modal, Notice, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { loadCommunityPackages, loadCommunityPackagesFromVault, processPackageSubmission } from "../../services/community-packages";

interface PackageItem {
  id?: string;
  label: string;
  description?: string;
  author?: string;
  version?: string;
  downloads?: number;
  tags?: string[];
  verified?: boolean;
  rating?: number;
  snippets?: { [trigger: string]: string };
}

import { validatePackage } from "../../services/package-validator";
import { espansoYamlToSnippets } from "../../packages/espanso";
import { diffIncoming, joinKey, splitKey } from "../../services/utils";
import { PackagePreviewModal } from "./Modals";
import * as yaml from "js-yaml";

export class CommunityTab {
  private packages: PackageItem[] = [];
  private filteredPackages: PackageItem[] = [];
  private searchQuery = "";
  private validationResult: any = null;
  private currentSort: { column: string; direction: 'asc' | 'desc' } | null = null;
  private userVotes: Map<string, 'like' | 'dislike'> = new Map();
  private currentPage = 1;
  private itemsPerPage = 10;

  constructor(private app: App, private plugin: SnipSidianPlugin) {}

  async render(root: HTMLElement) {
    root.empty();
    root.addClass("snipsy-compact");

    const section = (cls: string) => root.createDiv({ cls: `snipsy-section ${cls}` });

    const browseSection = section("snipsy-community-browse-section");
    const headerRow = browseSection.createDiv({ cls: "section-header-row" });
    const titleContainer = headerRow.createDiv({ cls: "section-title-container" });
    titleContainer.createEl("h3", { text: "Browse Community Packages", cls: "section-title" });
    titleContainer.createEl("p", { text: "Browse and install packages from the community.", cls: "section-description" });

    const searchContainer = headerRow.createDiv({ cls: "search-container" });
    const searchInput = searchContainer.createEl("input", {
      type: "text",
      placeholder: "Search packages…",
      cls: "search-input",
    });
    searchInput.oninput = (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.filterPackages();
      this.renderPackages(browseSection);
    };

    try {
      // Try to load packages from vault first, fallback to empty array
      this.packages = await loadCommunityPackagesFromVault(this.app);
      this.packages.sort((a, b) => a.label.localeCompare(b.label));
      this.filteredPackages = this.packages;
      this.renderPackages(browseSection);
    } catch {
      const errorContainer = browseSection.createDiv({ cls: "packages-container" });
      errorContainer.createEl("p", {
        text: "Failed to load community packages. Please check your internet connection.",
        cls: "error-message",
      });
    }

    const submitSection = section("snipsy-community-submit-section");
    submitSection.createEl("h3", { text: "Submit New Package", cls: "section-title" });

    const helpText = submitSection.createDiv({ cls: "help-text" });
    helpText.createEl("p", {
      text: "Have an idea or good collection? Share it with the community!",
    });
    const helpLink = helpText.createEl("a", {
      text: "Learn how to create packages",
      href: "https://github.com/Dimagious/snipsidian/wiki/Package-Creation",
      cls: "help-link",
    });
    helpLink.setAttribute("target", "_blank");
    helpLink.setAttribute("rel", "noopener noreferrer");

    const yamlRow = submitSection.createDiv({ cls: "yaml-input-row" });
    yamlRow.createEl("p", {
      text: "Paste your package YAML below. Make sure it follows the community package format with name, author, version, and snippets.",
      cls: "yaml-instruction",
    });
    const yamlContainer = yamlRow.createDiv({ cls: "yaml-container" });
    const yamlTextarea = yamlContainer.createEl("textarea", {
      placeholder: "Paste your community package YAML here…",
      cls: "yaml-textarea",
    }) as HTMLTextAreaElement;
    yamlTextarea.style.height = "200px";

    const validationContainer = submitSection.createDiv({ cls: "validation-container" });

    const buttonRow = submitSection.createDiv({ cls: "button-row" });
    const validateBtn = buttonRow.createEl("button", { text: "Validate Package", cls: "validate-btn" });
    validateBtn.onclick = () => this.validatePackage(yamlTextarea, validationContainer);

    const submitBtn = buttonRow.createEl("button", { text: "Submit Package", cls: "submit-btn" }) as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.onclick = () => this.submitPackage(yamlTextarea, submitBtn);

    const espansoSection = section("snipsy-espanso-section");
    espansoSection.createEl("h3", { text: "Install Espanso Package", cls: "section-title" });
    const espansoHelpText = espansoSection.createDiv({ cls: "help-text" });
    espansoHelpText.createEl("p", { text: "Paste packages from Espanso Hub." });
    const espansoLinkEl = espansoHelpText.createEl("p", { text: "Browse packages at ", cls: "snipsy-hint" });
    const espansoLink = espansoLinkEl.createEl("a", {
      text: "Espanso Hub",
      href: "https://hub.espanso.org/search",
      cls: "snipsy-link",
    });
    espansoLink.setAttribute("target", "_blank");
    espansoLink.setAttribute("rel", "noopener noreferrer");

    const espansoYamlRow = espansoSection.createDiv({ cls: "yaml-input-row" });
    espansoYamlRow.createEl("p", { text: "Paste YAML content from Espanso Hub or other Espanso sources", cls: "yaml-instruction" });
    const espansoYamlContainer = espansoYamlRow.createDiv({ cls: "yaml-container" });
    const espansoTextarea = espansoYamlContainer.createEl("textarea", {
      placeholder: "Paste Espanso YAML here…",
      cls: "yaml-textarea",
    }) as HTMLTextAreaElement;
    espansoTextarea.style.height = "120px";

    const espansoButtonRow = espansoSection.createDiv({ cls: "button-row" });
    const espansoInstallBtn = espansoButtonRow.createEl("button", { text: "Install Espanso Package", cls: "install-btn" });
    espansoInstallBtn.onclick = async () => {
      const yamlText = espansoTextarea.value;
      if (!yamlText?.trim()) {
        new Notice("Please paste Espanso YAML first");
        return;
      }
      try {
        const incoming = espansoYamlToSnippets(yamlText);
        const conflicts = diffIncoming(this.plugin.settings.snippets, incoming);
        if (conflicts.conflicts.length > 0) {
          const modal = new PackagePreviewModal(this.app, this.plugin, "Espanso Package", conflicts);
          modal.onConfirm = () => this.installFromYaml(yamlText);
          modal.open();
        } else {
          this.installFromYaml(yamlText);
        }
      } catch (err) {
        new Notice(`Failed to parse Espanso package: ${err}`);
      }
    };
  }

  private filterPackages() {
    if (!this.searchQuery) this.filteredPackages = this.packages;
    else {
      this.filteredPackages = this.packages.filter(
        (pkg) =>
          pkg.label.toLowerCase().includes(this.searchQuery) ||
          pkg.description?.toLowerCase().includes(this.searchQuery) ||
          pkg.tags?.some((tag) => tag.toLowerCase().includes(this.searchQuery))
      );
    }
    // Reset to first page when filtering
    this.currentPage = 1;
  }

  private renderPackages(container: HTMLElement) {
    const existing = container.querySelector(".packages-container");
    if (existing) existing.remove();

    const packagesContainer = container.createDiv({ cls: "packages-container" });

    if (this.filteredPackages.length === 0) {
      packagesContainer.createEl("p", {
        text: this.searchQuery ? "No packages found matching your search." : "No community packages available yet.",
        cls: "no-packages",
      });
      return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(this.filteredPackages.length / this.itemsPerPage);
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const currentPagePackages = this.filteredPackages.slice(startIndex, endIndex);

    const table = packagesContainer.createEl("table", { cls: "packages-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");

    const labelHeader = headerRow.createEl("th", { text: "Package", cls: "sortable" });
    labelHeader.onclick = () => this.sortPackages("label");
    
    const downloadsHeader = headerRow.createEl("th", { text: "Downloads", cls: "sortable" });
    downloadsHeader.onclick = () => this.sortPackages("downloads");

    const ratingHeader = headerRow.createEl("th", { text: "Rating", cls: "sortable" });
    ratingHeader.onclick = () => this.sortPackages("rating");
    
    headerRow.createEl("th", { text: "Actions" });

    const tbody = table.createEl("tbody");

    currentPagePackages.forEach((pkg) => {
      const row = tbody.createEl("tr", { cls: "package-row" });

      const labelCell = row.createEl("td", { cls: "package-label-cell" });
      const labelLink = labelCell.createEl("a", {
        text: pkg.label,
        cls: "package-label-link",
        href: "#",
      });
      if (pkg.verified) labelLink.createEl("span", { text: " ✓", cls: "verified-badge", title: "Verified package" });
      labelLink.onclick = (e) => {
        e.preventDefault();
        this.showPackageDetails(pkg);
      };

      row.createEl("td", { text: `${pkg.downloads || 0}`, cls: "package-downloads" });

      const ratingCell = row.createEl("td", { cls: "package-rating-cell" });
      const ratingContainer = ratingCell.createDiv({ cls: "rating-container" });
      const likeBtn = ratingContainer.createEl("button", { text: "👍", cls: "rating-btn like-btn", title: "Like this package" });
      likeBtn.onclick = () => this.ratePackage(pkg, "like");
      ratingContainer.createEl("span", { text: `${pkg.rating || 0}`, cls: "rating-value" });
      const dislikeBtn = ratingContainer.createEl("button", { text: "👎", cls: "rating-btn dislike-btn", title: "Dislike this package" });
      dislikeBtn.onclick = () => this.ratePackage(pkg, "dislike");

      const actionsCell = row.createEl("td", { cls: "package-actions-cell" });
      
      // Check if package is already installed
      const isInstalled = this.isPackageInstalled(pkg);
      
      if (isInstalled) {
        const installedBtn = actionsCell.createEl("button", { text: "✓ Installed", cls: "install-btn installed" });
        installedBtn.style.background = "var(--background-secondary)";
        installedBtn.style.color = "var(--text-muted)";
        installedBtn.style.cursor = "default";
        installedBtn.disabled = true;
      } else {
        const installBtn = actionsCell.createEl("button", { text: "Install", cls: "install-btn" });
        installBtn.onclick = () => this.installPackage(pkg);
      }
    });

    // Add pagination if there are multiple pages
    if (totalPages > 1) {
      this.renderPagination(packagesContainer, totalPages);
    }
  }

  private validatePackage(textarea: HTMLTextAreaElement, container: HTMLElement) {
    const yamlContent = textarea.value.trim();
    if (!yamlContent) {
      this.showValidationResult(container, { isValid: false, errors: ["Please paste package YAML first"], warnings: [] });
      return;
    }
    try {
      const packageData = yaml.load(yamlContent) as any;
      if (!packageData || typeof packageData !== "object") {
        this.showValidationResult(container, { isValid: false, errors: ["Invalid YAML format"], warnings: [] });
        return;
      }
      if (!packageData.name || !packageData.author || !packageData.version || !packageData.snippets) {
        this.showValidationResult(container, {
          isValid: false,
          errors: ["This doesn't look like a community package. Make sure it has name, author, version, and snippets fields."],
          warnings: [],
        });
        return;
      }
      const validation = validatePackage(packageData, { strictMode: false });
      this.validationResult = validation;
      this.showValidationResult(container, validation);
      const submitBtn = container.parentElement?.querySelector(".submit-btn") as HTMLButtonElement;
      if (submitBtn) submitBtn.disabled = !validation.isValid;
    } catch (error) {
      this.showValidationResult(container, { isValid: false, errors: [`Failed to parse YAML: ${error}`], warnings: [] });
    }
  }

  private showValidationResult(container: HTMLElement, validation: any) {
    container.empty();
    if (validation.isValid) {
      const successEl = container.createDiv({ cls: "validation-success" });
      successEl.createEl("div", { text: "✅ Package is valid!", cls: "validation-title" });
      if (validation.warnings.length > 0) {
        const warningsEl = successEl.createDiv({ cls: "validation-warnings" });
        warningsEl.createEl("div", { text: "Warnings:", cls: "warnings-title" });
        validation.warnings.forEach((w: string) => warningsEl.createEl("div", { text: `⚠️ ${w}`, cls: "warning-item" }));
      }
    } else {
      const errorEl = container.createDiv({ cls: "validation-error" });
      errorEl.createEl("div", { text: "❌ Validation failed:", cls: "validation-title" });
      validation.errors.forEach((e: string) => errorEl.createEl("div", { text: `• ${e}`, cls: "error-item" }));
    }
  }

  private async submitPackage(textarea: HTMLTextAreaElement, submitBtn: HTMLButtonElement) {
    if (!this.validationResult || !this.validationResult.isValid) {
      new Notice("Please validate the package first");
      return;
    }
    try {
      const yamlContent = textarea.value.trim();
      const packageData = yaml.load(yamlContent) as any;
      const packageId = this.generatePackageId(packageData.name);
      const fileName = `${packageId}.yml`;
      const result = await processPackageSubmission(packageData, `community-packages/pending/${fileName}`);
      if (result.success) {
        new Notice("🎉 Thank you for contributing to the community! Your package has been submitted for review.");
        textarea.value = "";
        submitBtn.disabled = true;
        this.validationResult = null;
        const validationContainer = submitBtn.parentElement?.parentElement?.querySelector(".validation-container");
        if (validationContainer) validationContainer.empty();
      } else {
        new Notice(`Failed to submit package: ${result.errors.join(", ")}`);
      }
    } catch (error) {
      new Notice(`Failed to submit package: ${error}`);
    }
  }

  private async installPackage(pkg: PackageItem) {
    try {
      if (!pkg.snippets || Object.keys(pkg.snippets).length === 0) {
        new Notice(`Package "${pkg.label}" has no snippets to install`);
        return;
      }

      // Check for conflicts with existing snippets
      const packageGroup = pkg.label;
      const conflicts = this.checkSnippetConflicts(pkg.snippets, packageGroup);
      
      if (conflicts.length > 0) {
        // Show conflict resolution modal
        const modal = new PackagePreviewModal(this.app, this.plugin, pkg.label, {
          added: [],
          conflicts: conflicts.map(conflict => ({
            key: joinKey(packageGroup, conflict),
            current: this.plugin.settings.snippets[joinKey(packageGroup, conflict)] || '',
            incoming: pkg.snippets![conflict] || ''
          }))
        });
        
        modal.onConfirm = () => this.performInstallation(pkg);
        modal.open();
      } else {
        // No conflicts, install directly
        this.performInstallation(pkg);
      }
    } catch (error) {
      new Notice(`Failed to install package: ${error}`);
    }
  }

  private checkSnippetConflicts(newSnippets: { [trigger: string]: string }, packageGroup: string): string[] {
    const conflicts: string[] = [];
    
    for (const trigger of Object.keys(newSnippets)) {
      const groupedKey = joinKey(packageGroup, trigger);
      
      // Check if trigger exists and has different replacement
      if (this.plugin.settings.snippets[groupedKey] && 
          this.plugin.settings.snippets[groupedKey] !== newSnippets[trigger]) {
        conflicts.push(trigger);
      }
    }
    
    return conflicts;
  }

  private async performInstallation(pkg: PackageItem) {
    try {
      if (!pkg.snippets) return;

      let installedCount = 0;
      const packageGroup = pkg.label; // Use package name as group name
      
      for (const [trigger, replacement] of Object.entries(pkg.snippets)) {
        // Create grouped key: "PackageName/trigger"
        const groupedKey = joinKey(packageGroup, trigger);
        
        // Store snippet with group info
        this.plugin.settings.snippets[groupedKey] = replacement;
        
        installedCount++;
      }

      await this.plugin.saveSettings();
      new Notice(`✅ Successfully installed "${pkg.label}" with ${installedCount} snippets in group "${packageGroup}"`);
      
      // Update package downloads count (simulate)
      pkg.downloads = (pkg.downloads || 0) + 1;
      
      // Re-render to update the "Installed" status
      const browseSection = document.querySelector(".snipsy-community-browse-section");
      if (browseSection) this.renderPackages(browseSection as HTMLElement);
      
    } catch (error) {
      new Notice(`❌ Failed to install package: ${error}`);
    }
  }

  private isPackageInstalled(pkg: PackageItem): boolean {
    if (!pkg.snippets) return false;
    
    const packageGroup = pkg.label;
    const packageTriggers = Object.keys(pkg.snippets);
    
    // Check if at least 80% of package snippets are installed in the group
    const installedTriggers = packageTriggers.filter(trigger => {
      const groupedKey = joinKey(packageGroup, trigger);
      return this.plugin.settings.snippets[groupedKey] === pkg.snippets![trigger];
    });
    
    return installedTriggers.length >= packageTriggers.length * 0.8;
  }

  private generatePackageId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  }

  private async installFromYaml(yamlStr: string) {
    try {
      const incoming = espansoYamlToSnippets(yamlStr);
      for (const [trigger, replacement] of Object.entries(incoming)) {
        this.plugin.settings.snippets[trigger] = replacement as string;
      }
      await this.plugin.saveSettings();
      new Notice(`Installed ${Object.keys(incoming).length} snippets from YAML`);
    } catch (err) {
      new Notice(`Failed to install from YAML: ${err}`);
    }
  }

  private sortPackages(column: "label" | "downloads" | "rating") {
    // Determine sort direction
    if (this.currentSort?.column === column) {
      this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort = { column, direction: 'asc' };
    }
    
    // Reset to first page when sorting
    this.currentPage = 1;

    // Sort the packages
    this.filteredPackages.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (column) {
        case "label":
          aValue = a.label.toLowerCase();
          bValue = b.label.toLowerCase();
          break;
        case "downloads":
          aValue = a.downloads || 0;
          bValue = b.downloads || 0;
          break;
        case "rating":
          aValue = a.rating || 0;
          bValue = b.rating || 0;
          break;
      }

      if (aValue < bValue) return this.currentSort!.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.currentSort!.direction === 'asc' ? 1 : -1;
      return 0;
    });

    // Update header classes and re-render
    this.updateSortHeaders();
    const browseSection = document.querySelector(".snipsy-community-browse-section");
    if (browseSection) this.renderPackages(browseSection as HTMLElement);
  }

  private updateSortHeaders() {
    const headers = document.querySelectorAll('.packages-table th.sortable');
    headers.forEach(header => {
      header.classList.remove('sort-asc', 'sort-desc');
      const text = header.textContent?.trim();
      const columnMap: { [key: string]: string } = {
        'Package': 'label',
        'Downloads': 'downloads', 
        'Rating': 'rating'
      };
      if (columnMap[text || ''] === this.currentSort?.column && this.currentSort) {
        header.classList.add(`sort-${this.currentSort.direction}`);
      }
    });
  }

  private showPackageDetails(pkg: PackageItem) {
    const modal = new Modal(this.app);
    modal.titleEl.setText(`Package Details: ${pkg.label}`);
    const content = modal.contentEl;
    content.empty();
    
    const infoSection = content.createDiv({ cls: "package-details-info" });
    infoSection.createEl("h3", { text: pkg.label });
    
    if (pkg.verified) {
      const verifiedBadge = infoSection.createEl("span", { text: " ✓ Verified", cls: "verified-badge" });
      verifiedBadge.style.marginLeft = "8px";
    }
    
    if (pkg.description) {
      infoSection.createEl("p", { text: pkg.description, cls: "package-description" });
    }
    
    const meta = infoSection.createDiv({ cls: "package-meta" });
    meta.style.display = "flex";
    meta.style.flexDirection = "column";
    meta.style.gap = "8px";
    meta.style.marginTop = "16px";
    
    meta.createEl("div", { text: `Author: ${pkg.author || "Unknown"}` });
    meta.createEl("div", { text: `Version: ${pkg.version || "1.0.0"}` });
    meta.createEl("div", { text: `Downloads: ${pkg.downloads || 0}` });
    meta.createEl("div", { text: `Rating: ${pkg.rating || 0} ${pkg.rating && pkg.rating > 0 ? '👍' : '👎'}` });
    
    if (pkg.tags && pkg.tags.length > 0) {
      const tagsContainer = infoSection.createDiv({ cls: "package-tags" });
      const tagsLabel = tagsContainer.createEl("div", { text: "Tags:" });
      tagsLabel.style.fontWeight = "600";
      tagsLabel.style.marginBottom = "4px";
      const tagsList = tagsContainer.createDiv();
      tagsList.style.display = "flex";
      tagsList.style.flexWrap = "wrap";
      tagsList.style.gap = "4px";
      
      pkg.tags.forEach(tag => {
        const tagEl = tagsList.createEl("span", { text: tag });
        tagEl.style.background = "var(--background-secondary)";
        tagEl.style.padding = "2px 6px";
        tagEl.style.borderRadius = "4px";
        tagEl.style.fontSize = "12px";
      });
    }
    
    // Add snippets section
    if (pkg.snippets && Object.keys(pkg.snippets).length > 0) {
      const snippetsContainer = infoSection.createDiv({ cls: "package-snippets" });
      const snippetsLabel = snippetsContainer.createEl("div", { 
        text: `Snippets (${Object.keys(pkg.snippets).length}):`
      });
      snippetsLabel.style.fontWeight = "600";
      snippetsLabel.style.marginBottom = "8px";
      snippetsLabel.style.marginTop = "16px";
      
      const snippetsList = snippetsContainer.createDiv({ cls: "snippets-list" });
      snippetsList.style.maxHeight = "200px";
      snippetsList.style.overflowY = "auto";
      snippetsList.style.border = "1px solid var(--background-modifier-border)";
      snippetsList.style.borderRadius = "6px";
      snippetsList.style.padding = "8px";
      snippetsList.style.background = "var(--background-secondary)";
      
      Object.entries(pkg.snippets).forEach(([trigger, replacement]) => {
        const snippetRow = snippetsList.createDiv({ cls: "snippet-row" });
        snippetRow.style.display = "flex";
        snippetRow.style.justifyContent = "space-between";
        snippetRow.style.alignItems = "center";
        snippetRow.style.padding = "4px 0";
        snippetRow.style.borderBottom = "1px solid var(--background-modifier-border)";
        snippetRow.style.fontSize = "13px";
        
        const triggerEl = snippetRow.createDiv({ cls: "snippet-trigger" });
        triggerEl.style.fontFamily = "var(--font-monospace)";
        triggerEl.style.background = "var(--background-primary)";
        triggerEl.style.padding = "2px 6px";
        triggerEl.style.borderRadius = "4px";
        triggerEl.style.border = "1px solid var(--background-modifier-border)";
        triggerEl.textContent = trigger;
        
        const arrowEl = snippetRow.createDiv({ cls: "snippet-arrow" });
        arrowEl.style.margin = "0 8px";
        arrowEl.style.color = "var(--text-muted)";
        arrowEl.textContent = "→";
        
        const replacementEl = snippetRow.createDiv({ cls: "snippet-replacement" });
        replacementEl.style.fontFamily = "var(--font-monospace)";
        replacementEl.style.background = "var(--background-primary)";
        replacementEl.style.padding = "2px 6px";
        replacementEl.style.borderRadius = "4px";
        replacementEl.style.border = "1px solid var(--background-modifier-border)";
        replacementEl.style.maxWidth = "200px";
        replacementEl.style.overflow = "hidden";
        replacementEl.style.textOverflow = "ellipsis";
        replacementEl.style.whiteSpace = "nowrap";
        replacementEl.textContent = replacement;
        replacementEl.title = replacement; // Show full text on hover
      });
    }
    
    const buttonContainer = content.createDiv({ cls: "modal-button-container" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "12px";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.marginTop = "24px";
    buttonContainer.style.paddingTop = "16px";
    buttonContainer.style.borderTop = "1px solid var(--background-modifier-border)";
    
    const isInstalled = this.isPackageInstalled(pkg);
    const installBtn = buttonContainer.createEl("button", { 
      text: isInstalled ? "✓ Already Installed" : "Install Package", 
      cls: "install-btn" 
    });
    
    if (isInstalled) {
      installBtn.style.background = "var(--background-secondary)";
      installBtn.style.color = "var(--text-muted)";
      installBtn.style.cursor = "default";
      installBtn.disabled = true;
    } else {
      installBtn.onclick = () => {
        modal.close();
        this.installPackage(pkg);
      };
    }
    
    const closeBtn = buttonContainer.createEl("button", { text: "Close" });
    closeBtn.style.background = "var(--background-secondary)";
    closeBtn.style.border = "1px solid var(--background-modifier-border)";
    closeBtn.style.padding = "8px 16px";
    closeBtn.style.borderRadius = "6px";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = () => modal.close();
    
    modal.open();
  }

  private ratePackage(pkg: PackageItem, action: "like" | "dislike") {
    const packageId = pkg.id || pkg.label;
    const currentVote = this.userVotes.get(packageId);
    
    // If user already voted the same way, don't allow double voting
    if (currentVote === action) {
      new Notice(`You already ${action === "like" ? "liked" : "disliked"} this package`);
      return;
    }
    
    // If user is changing their vote, adjust the rating accordingly
    if (currentVote) {
      // Remove previous vote
      pkg.rating = (pkg.rating || 0) - (currentVote === "like" ? 1 : -1);
    }
    
    // Add new vote
    pkg.rating = (pkg.rating || 0) + (action === "like" ? 1 : -1);
    
    // Store user's vote
    this.userVotes.set(packageId, action);
    
    // Re-render to update the display
    const browseSection = document.querySelector(".snipsy-community-browse-section");
    if (browseSection) this.renderPackages(browseSection as HTMLElement);
    
    new Notice(`${action === "like" ? "Liked" : "Disliked"} "${pkg.label}"`);
  }

  private renderPagination(container: HTMLElement, totalPages: number) {
    const paginationContainer = container.createDiv({ cls: "pagination-container" });
    
    // Show pagination info
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(this.currentPage * this.itemsPerPage, this.filteredPackages.length);
    const totalItems = this.filteredPackages.length;
    
    paginationContainer.createEl("span", {
      text: `Showing ${startItem}-${endItem} of ${totalItems} packages`,
      cls: "pagination-info"
    });

    // Previous button
    const prevBtn = paginationContainer.createEl("button", {
      text: "‹",
      cls: "pagination-btn"
    });
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.onclick = () => this.goToPage(this.currentPage - 1);

    // Page numbers with smart ellipsis
    const pages = this.generatePageNumbers(totalPages);
    
    pages.forEach((page, index) => {
      if (page === '...') {
        paginationContainer.createEl("span", {
          text: "...",
          cls: "pagination-ellipsis"
        });
      } else {
        const pageBtn = paginationContainer.createEl("button", {
          text: page.toString(),
          cls: `pagination-btn ${page === this.currentPage ? 'active' : ''}`
        });
        pageBtn.onclick = () => this.goToPage(page as number);
      }
    });

    // Next button
    const nextBtn = paginationContainer.createEl("button", {
      text: "›",
      cls: "pagination-btn"
    });
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.onclick = () => this.goToPage(this.currentPage + 1);
  }

  private generatePageNumbers(totalPages: number): (number | string)[] {
    const pages: (number | string)[] = [];
    const current = this.currentPage;
    
    // Always show first page
    pages.push(1);
    
    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 2; i <= totalPages - 1; i++) {
        pages.push(i);
      }
    } else {
      // Smart ellipsis logic
      if (current <= 4) {
        // Show: 1 2 3 4 5 ... last
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('...');
      } else if (current >= totalPages - 3) {
        // Show: 1 ... (last-4) (last-3) (last-2) (last-1) last
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages - 1; i++) {
          pages.push(i);
        }
      } else {
        // Show: 1 ... (current-1) current (current+1) ... last
        pages.push('...');
        pages.push(current - 1);
        pages.push(current);
        pages.push(current + 1);
        pages.push('...');
      }
    }
    
    // Always show last page (if more than 1 page)
    if (totalPages > 1) {
      pages.push(totalPages);
    }
    
    return pages;
  }

  private goToPage(page: number) {
    const totalPages = Math.ceil(this.filteredPackages.length / this.itemsPerPage);
    if (page >= 1 && page <= totalPages) {
      this.currentPage = page;
      const browseSection = document.querySelector(".snipsy-community-browse-section");
      if (browseSection) this.renderPackages(browseSection as HTMLElement);
    }
  }
}
