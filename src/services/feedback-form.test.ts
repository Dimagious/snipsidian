import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGoogleFormUrl, collectSystemMeta, entryIdMap, type FeedbackType, type FeedbackMeta } from "./feedback-form";

describe("feedback-form", () => {
  const baseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSf4kFr5pme9C0CX02NOad_9STlia5-xZ2D-9C88u1mX32WqXw/viewform";
  
  beforeEach(() => {
    // Mock navigator object
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: 'MacIntel',
        language: 'en-US'
      },
      writable: true
    });
    
    // Mock document object
    Object.defineProperty(global, 'document', {
      value: {
        body: {
          classList: {
            contains: vi.fn().mockReturnValue(true)
          }
        }
      },
      writable: true
    });
  });

  describe("buildGoogleFormUrl", () => {
    it("should build URL with only type parameter", () => {
      const url = buildGoogleFormUrl(baseUrl, "Bug report");
      const urlObj = new URL(url);
      
      expect(urlObj.searchParams.get(entryIdMap.TYPE)).toBe("Bug report");
      expect(urlObj.searchParams.get(entryIdMap.META_PLUGIN)).toBeNull();
    });

    it("should build URL with type and metadata", () => {
      const meta: FeedbackMeta = {
        plugin: "0.4.4",
        obsidian: "1.6.7",
        platform: "mac",
        os: "MacIntel",
        locale: "en-US",
        theme: "dark"
      };
      
      const url = buildGoogleFormUrl(baseUrl, "Feature request", meta);
      const urlObj = new URL(url);
      
      expect(urlObj.searchParams.get(entryIdMap.TYPE)).toBe("Feature request");
      expect(urlObj.searchParams.get(entryIdMap.META_PLUGIN)).toBe("0.4.4");
      expect(urlObj.searchParams.get(entryIdMap.META_OBSIDIAN)).toBe("1.6.7");
      expect(urlObj.searchParams.get(entryIdMap.META_PLATFORM)).toBe("mac");
      expect(urlObj.searchParams.get(entryIdMap.META_OS)).toBe("MacIntel");
      expect(urlObj.searchParams.get(entryIdMap.META_LOCALE)).toBe("en-US");
      expect(urlObj.searchParams.get(entryIdMap.META_THEME)).toBe("dark");
    });

    it("should build URL without optional theme field", () => {
      const meta: FeedbackMeta = {
        plugin: "0.4.4",
        obsidian: "1.6.7",
        platform: "mac",
        os: "MacIntel",
        locale: "en-US"
        // theme is undefined
      };
      
      const url = buildGoogleFormUrl(baseUrl, "General feedback", meta);
      const urlObj = new URL(url);
      
      expect(urlObj.searchParams.get(entryIdMap.TYPE)).toBe("General feedback");
      expect(urlObj.searchParams.get(entryIdMap.META_THEME)).toBeNull();
    });

    it("should handle all feedback types", () => {
      const types: FeedbackType[] = ["Bug report", "Feature request", "General feedback"];
      
      types.forEach(type => {
        const url = buildGoogleFormUrl(baseUrl, type);
        const urlObj = new URL(url);
        expect(urlObj.searchParams.get(entryIdMap.TYPE)).toBe(type);
      });
    });

    it("should preserve existing URL parameters", () => {
      const urlWithParams = baseUrl + "?existing=param";
      const url = buildGoogleFormUrl(urlWithParams, "Bug report");
      const urlObj = new URL(url);
      
      expect(urlObj.searchParams.get("existing")).toBe("param");
      expect(urlObj.searchParams.get(entryIdMap.TYPE)).toBe("Bug report");
    });
  });

  describe("collectSystemMeta", () => {
    it("should collect system metadata correctly", () => {
      const mockApp = { version: "1.6.7" };
      const pluginVersion = "0.4.4";
      
      const meta = collectSystemMeta(mockApp, pluginVersion);
      
      expect(meta.plugin).toBe("0.4.4");
      expect(meta.obsidian).toBe("1.6.7");
      expect(meta.platform).toBe("mac");
      expect(meta.os).toBe("MacIntel");
      expect(meta.locale).toBe("en-US");
      expect(meta.theme).toBe("dark");
    });

    it("should handle missing app version", () => {
      const mockApp = {};
      const pluginVersion = "0.4.4";
      
      const meta = collectSystemMeta(mockApp, pluginVersion);
      
      expect(meta.obsidian).toBe("Unknown");
    });

    it("should detect different platforms", () => {
      const testCases = [
        { platform: 'Win32', expected: 'windows' },
        { platform: 'Linux x86_64', expected: 'linux' },
        { platform: 'MacIntel', expected: 'mac' },
        { platform: 'Unknown', expected: 'unknown' }
      ];
      
      testCases.forEach(({ platform, expected }) => {
        Object.defineProperty(global, 'navigator', {
          value: {
            platform: platform,
            language: 'en-US'
          },
          writable: true
        });
        
        const meta = collectSystemMeta({}, "0.4.4");
        expect(meta.platform).toBe(expected);
      });
    });

    it("should detect light theme", () => {
      Object.defineProperty(global, 'document', {
        value: {
          body: {
            classList: {
              contains: vi.fn().mockReturnValue(false)
            }
          }
        },
        writable: true
      });
      
      const meta = collectSystemMeta({}, "0.4.4");
      expect(meta.theme).toBe("light");
    });

    it("should handle missing language", () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          platform: 'MacIntel',
          language: undefined
        },
        writable: true
      });
      
      const meta = collectSystemMeta({}, "0.4.4");
      expect(meta.locale).toBe("en-US");
    });
  });

  describe("entryIdMap", () => {
    it("should have all required entry IDs", () => {
      expect(entryIdMap.TYPE).toBe("entry.1624430534");
      expect(entryIdMap.TITLE).toBe("entry.851131975");
      expect(entryIdMap.DETAILS).toBe("entry.2007480685");
      expect(entryIdMap.EMAIL).toBe("entry.180486862");
      expect(entryIdMap.ATTACHMENT).toBe("entry.456767979");
      expect(entryIdMap.META_PLUGIN).toBe("entry.1375327143");
      expect(entryIdMap.META_OBSIDIAN).toBe("entry.1706844444");
      expect(entryIdMap.META_PLATFORM).toBe("entry.1670495621");
      expect(entryIdMap.META_OS).toBe("entry.426605119");
      expect(entryIdMap.META_LOCALE).toBe("entry.1065739097");
      expect(entryIdMap.META_THEME).toBe("entry.217599650");
    });
  });
});
