/**
 * Google Form integration for Snipsy feedback
 * Handles URL generation with pre-filled data for different feedback types
 */

import { App, Platform } from "obsidian";

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

// Entry IDs для Google Form подачи пакетов (точный маппинг)
export const packageFormEntryIdMap = {
  // Основные поля пакета
  PACKAGE_VERSION:  "entry.1719679935", // Package Version *
  PACKAGE_AUTHOR:   "entry.641771424",  // Package Author *
  PACKAGE_DESC:     "entry.1531686967", // Package Description *
  PACKAGE_CATEGORY: "entry.1689133292", // Package Category
  PACKAGE_TAGS:     "entry.314235282",  // Package Tags
  PACKAGE_YAML:     "entry.512769195",  // Package YAML Content *
  
  // Контактная информация
  SUBMITTER_NAME:   "entry.1973026725", // Your Name
  SUBMITTER_EMAIL:  "entry.1982205362", // Your Email
  
  // Системные метаданные
  META_PLUGIN:      "entry.1160159197", // Plugin Version
  META_OBSIDIAN:    "entry.647313749",  // Obsidian Version
  META_PLATFORM:    "entry.2070245010", // Platform
  META_OS:          "entry.1147288409", // Operating System
  META_LOCALE:      "entry.1550963990", // Locale
  META_THEME:       "entry.1804765708", // Theme
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

export interface PackageSubmissionData {
  name: string;
  version: string;
  author: string;
  description: string;
  category?: string;
  tags?: string[];
  license?: string;
  homepage?: string;
  readme?: string;
  yamlContent: string;
  submitterEmail?: string;
  submitterName?: string;
}

export interface PackageFormMeta extends FeedbackMeta {
  submitterName?: string;
  submitterEmail?: string;
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
 * Builds a Google Form URL for package submission with pre-filled data
 * @param baseUrl - The base Google Form URL for package submission
 * @param packageData - Package submission data
 * @param meta - Optional metadata to pre-fill
 * @returns Complete URL with pre-filled parameters
 */
export function buildPackageFormUrl(
  baseUrl: string, 
  packageData: PackageSubmissionData, 
  meta?: PackageFormMeta
): string {
  const u = new URL(baseUrl);
  
  // Fill package fields according to exact mapping
  u.searchParams.set(packageFormEntryIdMap.PACKAGE_VERSION, packageData.version || '1.0.0');
  u.searchParams.set(packageFormEntryIdMap.PACKAGE_AUTHOR, packageData.author || '');
  u.searchParams.set(packageFormEntryIdMap.PACKAGE_DESC, packageData.description || '');
  u.searchParams.set(packageFormEntryIdMap.PACKAGE_CATEGORY, packageData.category || 'General');
  u.searchParams.set(packageFormEntryIdMap.PACKAGE_TAGS, packageData.tags ? packageData.tags.join(', ') : '');
  u.searchParams.set(packageFormEntryIdMap.PACKAGE_YAML, packageData.yamlContent || '');
  
  // Contact information
  u.searchParams.set(packageFormEntryIdMap.SUBMITTER_NAME, packageData.submitterName || '');
  u.searchParams.set(packageFormEntryIdMap.SUBMITTER_EMAIL, packageData.submitterEmail || '');
  
  // Fill metadata (always fill system info)
  if (meta) {
    u.searchParams.set(packageFormEntryIdMap.META_PLUGIN, meta.plugin || '');
    u.searchParams.set(packageFormEntryIdMap.META_OBSIDIAN, meta.obsidian || '');
    u.searchParams.set(packageFormEntryIdMap.META_PLATFORM, meta.platform || '');
    u.searchParams.set(packageFormEntryIdMap.META_OS, meta.os || '');
    u.searchParams.set(packageFormEntryIdMap.META_LOCALE, meta.locale || '');
    u.searchParams.set(packageFormEntryIdMap.META_THEME, meta.theme || '');
  }
  
  return u.toString();
}

/**
 * Collects system metadata for feedback form
 * @param app - Obsidian App instance
 * @param pluginVersion - Plugin version from manifest
 * @returns Collected metadata object
 */
export function collectSystemMeta(app: App, pluginVersion: string): FeedbackMeta {
  // @ts-ignore Obsidian internal API - app.version exists at runtime but is not in type definitions
  const obsidianVersion = app.version || "Unknown";
  
  // Detect platform using Obsidian Platform API
  let platform: string;
  if (Platform.isMacOS) {
    platform = 'mac';
  } else if (Platform.isWin) {
    platform = 'windows';
  } else if (Platform.isLinux) {
    platform = 'linux';
  } else {
    platform = 'unknown';
  }
  
  // Detect OS using Obsidian Platform API
  const os = Platform.isMacOS ? 'Mac' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : 'Unknown';
  
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

/**
 * Collects system metadata for package submission form
 * @param app - Obsidian App instance
 * @param pluginVersion - Plugin version from manifest
 * @param submitterName - Optional submitter name
 * @param submitterEmail - Optional submitter email
 * @returns Collected metadata object for package form
 */
export function collectPackageFormMeta(
  app: App, 
  pluginVersion: string, 
  submitterName?: string, 
  submitterEmail?: string
): PackageFormMeta {
  const baseMeta = collectSystemMeta(app, pluginVersion);
  
  return {
    ...baseMeta,
    submitterName,
    submitterEmail
  };
}
