import { App, Notice, Modal } from "obsidian";
import type SnipSidianPlugin from "../../../main";
import { loadAllCommunityPackages } from "../../../services/community-packages";
import { PackagePreviewModal } from "../Modals";
import { joinKey } from "../../../services/utils";

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

export class PackageBrowser {
  private packages: PackageItem[] = [];
  private filteredPackages: PackageItem[] = [];
  private searchQuery = "";
  private currentSort: { column: string; direction: 'asc' | 'desc' } | null = null;
  private currentPage = 1;
  private itemsPerPage = 10;

  constructor(
    private app: App,
    private plugin: SnipSidianPlugin
  ) {}

  async render(root: HTMLElement): Promise<void> {
    const section = root.createDiv({ cls: "snipsy-section snipsy-community-browse-section" });
    
    const headerRow = section.createDiv({ cls: "section-header-row" });
    const titleContainer = headerRow.createDiv({ cls: "section-title-container" });
    titleContainer.createEl("h3", { text: "Browse community packages", cls: "section-title" });
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
      this.renderPackages(section);
    };

    const refreshBtn = searchContainer.createEl("button", {
      text: "🔄 Refresh",
      cls: "refresh-btn",
      title: "Refresh community packages from GitHub"
    });
    refreshBtn.onclick = async () => {
      try {
        // Clear cache and reload packages
        if (this.plugin.settings.communityPackages?.cache) {
          this.plugin.settings.communityPackages.cache.lastUpdated = 0;
          await this.plugin.saveSettings();
        }
        
        this.packages = await loadAllCommunityPackages(this.app, this.plugin);
        this.packages.sort((a, b) => a.label.localeCompare(b.label));
        this.filterPackages();
        this.renderPackages(section);
        new Notice("✅ Community packages refreshed!");
      } catch (error) {
        new Notice(`❌ Failed to refresh packages: ${error}`);
      }
    };

    try {
      // Load all community packages (built-in + dynamic)
      this.packages = await loadAllCommunityPackages(this.app, this.plugin);
      this.packages.sort((a, b) => a.label.localeCompare(b.label));
      this.filteredPackages = this.packages;
      this.renderPackages(section);
    } catch {
      const errorContainer = section.createDiv({ cls: "packages-container" });
      errorContainer.createEl("p", {
        text: "Community packages are temporarily unavailable. This could be due to:",
        cls: "error-message",
      });
      
      const reasonsList = errorContainer.createEl("ul", { cls: "error-reasons" });
      reasonsList.createEl("li", { text: "No internet connection" });
      reasonsList.createEl("li", { text: "GitHub API is temporarily unavailable" });
      reasonsList.createEl("li", { text: "Community repository is not set up yet" });
      
      errorContainer.createEl("p", {
        text: "Try clicking the Refresh button above, or check back later.",
        cls: "error-hint",
      });
    }
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
      labelLink.onclick = (e) => {
        e.preventDefault();
        this.showPackageDetails(pkg);
      };

      const actionsCell = row.createEl("td", { cls: "package-actions-cell" });
      
      // Check if package is already installed
      const isInstalled = this.isPackageInstalled(pkg);
      
      if (isInstalled) {
        const installedBtn = actionsCell.createEl("button", { text: "Installed", cls: "install-btn installed" });
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
        
        modal.onConfirm = async () => {
            await this.performInstallation(pkg);
        };
        modal.open();
      } else {
        // No conflicts, install directly
        void this.performInstallation(pkg);
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
    
    // If package has no snippets, it's not installed
    if (packageTriggers.length === 0) {
      return false;
    }
    
    // Check if at least 80% of package snippets are installed in the group
    const installedTriggers = packageTriggers.filter(trigger => {
      const groupedKey = joinKey(packageGroup, trigger);
      return this.plugin.settings.snippets[groupedKey] === pkg.snippets![trigger];
    });
    
    const isInstalled = installedTriggers.length >= packageTriggers.length * 0.8;
    
    return isInstalled;
  }

  private sortPackages(column: "label") {
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
      const aValue = a.label.toLowerCase();
      const bValue = b.label.toLowerCase();

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
        'Package': 'label'
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
      infoSection.createEl("span", { text: " ✓ Verified", cls: "verified-badge" });
    }
    
    if (pkg.description) {
      infoSection.createEl("p", { text: pkg.description, cls: "package-description" });
    }
    
    const meta = infoSection.createDiv({ cls: "package-meta" });
    
    meta.createEl("div", { text: `Author: ${pkg.author || "Unknown"}` });
    meta.createEl("div", { text: `Version: ${pkg.version || "1.0.0"}` });
    
    if (pkg.tags && pkg.tags.length > 0) {
      const tagsContainer = infoSection.createDiv({ cls: "package-tags" });
      tagsContainer.createEl("div", { text: "Tags:", cls: "package-tags-label" });
      const tagsList = tagsContainer.createDiv({ cls: "package-tags-list" });
      
      pkg.tags.forEach(tag => {
        tagsList.createEl("span", { text: tag });
      });
    }
    
    // Add snippets section
    if (pkg.snippets && Object.keys(pkg.snippets).length > 0) {
      const snippetsContainer = infoSection.createDiv({ cls: "package-snippets" });
      snippetsContainer.createEl("div", { 
        text: `Snippets (${Object.keys(pkg.snippets).length}):`,
        cls: "snippets-label"
      });
      
      const snippetsList = snippetsContainer.createDiv({ cls: "snippets-list" });
      
      Object.entries(pkg.snippets).forEach(([trigger, replacement]) => {
        const snippetRow = snippetsList.createDiv({ cls: "snippet-row" });
        
        const triggerEl = snippetRow.createDiv({ cls: "snippet-trigger" });
        triggerEl.createEl("span", { text: trigger });
        
        const arrowEl = snippetRow.createDiv({ cls: "snippet-arrow" });
        arrowEl.createEl("span", { text: "→" });
        
        const replacementEl = snippetRow.createDiv({ cls: "snippet-replacement" });
        replacementEl.createEl("span", { text: replacement });
        replacementEl.title = replacement; // Show full text on hover
      });
    }
    
    const buttonContainer = content.createDiv({ cls: "modal-button-container" });
    
    const isInstalled = this.isPackageInstalled(pkg);
    const installBtn = buttonContainer.createEl("button", { 
      text: isInstalled ? "Already installed" : "Install package", 
      cls: isInstalled ? "install-btn installed" : "install-btn"
    });
    
    if (isInstalled) {
      installBtn.disabled = true;
    } else {
      installBtn.onclick = () => {
        modal.close();
        this.installPackage(pkg);
      };
    }
    
    const closeBtn = buttonContainer.createEl("button", { text: "Close" });
    closeBtn.onclick = () => modal.close();
    
    modal.open();
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
    
    pages.forEach((page) => {
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
