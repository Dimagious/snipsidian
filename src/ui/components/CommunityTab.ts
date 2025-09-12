// CommunityTab.ts
import { App } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { PackageBrowser } from "./community/PackageBrowser";
import { PackageSubmissionSection } from "./community/PackageSubmissionSection";
import { EspansoSection } from "./community/EspansoSection";

export class CommunityTab {
  private packageBrowser: PackageBrowser;
  private packageSubmission: PackageSubmissionSection;
  private espansoSection: EspansoSection;

  constructor(private app: App, private plugin: SnipSidianPlugin) {
    this.packageBrowser = new PackageBrowser(app, plugin);
    this.packageSubmission = new PackageSubmissionSection(app, plugin);
    this.espansoSection = new EspansoSection(app, plugin);
  }

  async render(root: HTMLElement) {
    root.empty();
    root.addClass("snipsy-compact");

    await this.packageBrowser.render(root);
    this.packageSubmission.render(root);
    this.espansoSection.render(root);
  }

}
