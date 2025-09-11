/**
 * Google Form integration for Snipsy feedback
 * Handles URL generation with pre-filled data for different feedback types
 */

export const entryIdMap = {
  // Основные поля формы
  TYPE:           "entry.1624430534", // What would you like to submit? (Bug report / Feature request / General feedback)
  TITLE:          "entry.851131975",  // Title
  DETAILS:        "entry.2007480685", // Details
  EMAIL:          "entry.180486862",  // Your email (optional)
  ATTACHMENT:     "entry.456767979",  // Screenshot or link (optional)

  // Метаданные (prefill из плагина)
  META_PLUGIN:    "entry.1375327143", // Plugin version
  META_OBSIDIAN:  "entry.1706844444", // Obsidian version
  META_PLATFORM:  "entry.1670495621", // Platform
  META_OS:        "entry.426605119",  // Operating system
  META_LOCALE:    "entry.1065739097", // Locale
  META_THEME:     "entry.217599650",  // Theme
} as const;

export type FeedbackType = "Bug report" | "Feature request" | "General feedback";

export interface FeedbackMeta {
  plugin: string;
  obsidian: string;
  platform: string;
  os: string;
  locale: string;
  theme?: string;
}

/**
 * Builds a Google Form URL with pre-filled data
 * @param baseUrl - The base Google Form URL
 * @param type - The type of feedback
 * @param meta - Optional metadata to pre-fill
 * @returns Complete URL with pre-filled parameters
 */
export function buildGoogleFormUrl(baseUrl: string, type: FeedbackType, meta?: FeedbackMeta): string {
  const u = new URL(baseUrl);
  u.searchParams.set(entryIdMap.TYPE, type);
  
  if (meta) {
    u.searchParams.set(entryIdMap.META_PLUGIN, meta.plugin);
    u.searchParams.set(entryIdMap.META_OBSIDIAN, meta.obsidian);
    u.searchParams.set(entryIdMap.META_PLATFORM, meta.platform);
    u.searchParams.set(entryIdMap.META_OS, meta.os);
    u.searchParams.set(entryIdMap.META_LOCALE, meta.locale);
    if (meta.theme) {
      u.searchParams.set(entryIdMap.META_THEME, meta.theme);
    }
  }
  
  return u.toString();
}

/**
 * Collects system metadata for feedback form
 * @param app - Obsidian App instance
 * @param pluginVersion - Plugin version from manifest
 * @returns Collected metadata object
 */
export function collectSystemMeta(app: any, pluginVersion: string): FeedbackMeta {
  // @ts-ignore - Obsidian API works correctly at runtime
  const obsidianVersion = app.version || "Unknown";
  
  // Detect platform
  const platform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 
                   navigator.platform.toLowerCase().includes('win') ? 'windows' : 
                   navigator.platform.toLowerCase().includes('linux') ? 'linux' : 'unknown';
  
  // Detect OS
  const os = navigator.platform;
  
  // Get locale
  const locale = navigator.language || 'en-US';
  
  // Try to get theme (this might not be available in all contexts)
  const theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  
  return {
    plugin: pluginVersion,
    obsidian: obsidianVersion,
    platform: platform,
    os: os,
    locale: locale,
    theme: theme
  };
}
