import { defineObsidianConfig } from "obsidian-plugin-dev-kit/e2e";

// The overview video is recorded by e2e/video.spec.ts with page.screencast. The kit's defaults (video and trace kept on
// failure) start a screencast of their own at 800x450, and a second one joins it at that size, so they are off here.
export default defineObsidianConfig({
    reporter: "line",
    use: { trace: "off", video: "off", screenshot: "off" },
});
