/**
 * Common types for package data structures
 */

export interface PackageData {
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  category?: string;
  tags?: string[] | string;
  license?: string;
  homepage?: string;
  readme?: string;
  snippets?: Record<string, string> | Array<{ trigger: string; replace: string; description?: string; keywords?: string[] }>;
  kind?: string;
  [key: string]: unknown; // Allow additional fields
}

export interface EspansoMatch {
  trigger?: string;
  triggers?: string[];
  replace?: string;
  replace_text?: string;
  output?: string;
}

export interface EspansoDocument {
  matches?: EspansoMatch[];
  [key: string]: unknown;
}

export type RawSettingsData = Record<string, unknown>;

