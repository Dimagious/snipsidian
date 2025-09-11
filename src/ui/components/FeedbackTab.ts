import { App, Setting } from "obsidian";
import type SnipSidianPlugin from "../../main";
import { buildGoogleFormUrl, collectSystemMeta, type FeedbackType } from "../../services/feedback-form";

export class FeedbackTab {
    constructor(
        private app: App,
        private plugin: SnipSidianPlugin
    ) {}

    render(root: HTMLElement) {
        const section = (title: string, hint?: string, specialClass?: string) => {
            const wrap = root.createDiv({ cls: `snipsy-section ${specialClass || ""}` });
            wrap.createEl("h3", { text: title });
            if (hint) wrap.createEl("p", { text: hint, cls: "snipsy-hint" });
            return wrap;
        };

        // Feedback section
        const feedbackSection = section("Feedback & Support", "Help us improve Snipsy by sharing your thoughts, reporting issues, or suggesting new features.", "snipsy-feedback-section");

        // Suggest Feature button
        new Setting(feedbackSection)
            .setName("Suggest a Feature")
            .setDesc("Have an idea for a new feature or improvement? Share your suggestions with us to help shape the future of Snipsy.")
            .addButton((btn) =>
                btn
                    .setButtonText("Suggest Feature")
                    .setCta()
                    .onClick(() => {
                        this.openFeedbackForm("Feature request");
                    })
            );

        // Report Bug button
        new Setting(feedbackSection)
            .setName("Report a Bug")
            .setDesc("Found something that's not working as expected? Report bugs to help us fix issues and improve the plugin's reliability.")
            .addButton((btn) =>
                btn
                    .setButtonText("Report Bug")
                    .setCta()
                    .onClick(() => {
                        this.openFeedbackForm("Bug report");
                    })
            );

        // General Feedback button
        new Setting(feedbackSection)
            .setName("General Feedback")
            .setDesc("Share your overall experience with Snipsy, provide general feedback, or get in touch with any other thoughts you might have.")
            .addButton((btn) =>
                btn
                    .setButtonText("Share Feedback")
                    .setCta()
                    .onClick(() => {
                        this.openFeedbackForm("General feedback");
                    })
            );

        // Support section
        const supportSection = section("Support & Resources", "Find additional help and resources for using Snipsy effectively.", "snipsy-support-section");

        new Setting(supportSection)
            .setName("Documentation")
            .setDesc("Read the comprehensive documentation and guides to get the most out of Snipsy.")
            .addButton((btn) =>
                btn
                    .setButtonText("View Docs")
                    .onClick(() => {
                        window.open("https://github.com/Dimagious/snipsidian#readme", "_blank");
                    })
            );

        new Setting(supportSection)
            .setName("GitHub Issues")
            .setDesc("Browse existing issues, feature requests, and discussions on our GitHub repository.")
            .addButton((btn) =>
                btn
                    .setButtonText("View Issues")
                    .onClick(() => {
                        window.open("https://github.com/Dimagious/snipsidian/issues", "_blank");
                    })
            );

        new Setting(supportSection)
            .setName("Community")
            .setDesc("Join the Obsidian community discussions and get help from other users.")
            .addButton((btn) =>
                btn
                    .setButtonText("Join Community")
                    .onClick(() => {
                        window.open("https://forum.obsidian.md/", "_blank");
                    })
            );
    }

    private openFeedbackForm(type: FeedbackType) {
        // Get system information for auto-filling
        const pluginVersion = this.plugin.manifest.version;
        const meta = collectSystemMeta(this.app, pluginVersion);
        
        // Create Google Form URL with pre-filled data
        const baseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSf4kFr5pme9C0CX02NOad_9STlia5-xZ2D-9C88u1mX32WqXw/viewform";
        const formUrl = buildGoogleFormUrl(baseUrl, type, meta);
        
        // Open in new tab
        window.open(formUrl, "_blank");
    }
}
