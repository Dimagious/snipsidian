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

/** A single entry in an Espanso match's `vars:` list. Only the
 *  fields Snipsy's importer inspects — `params` carries whatever
 *  else the var type defines (e.g. a `date` var's `format`). */
export interface EspansoVar {
  name?: string;
  type?: string;
  params?: { format?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface EspansoMatch {
  trigger?: string;
  triggers?: string[];
  /** Regex-trigger form — mutually exclusive with `trigger`/`triggers`
   *  in real Espanso packages. Not supported by Snipsy's engine
   *  (B-074, deferred); B-139 reports it as skipped rather than
   *  silently dropping it. */
  regex?: string;
  replace?: string;
  replace_text?: string;
  output?: string;
  /** Alternative content forms Snipsy can't render — reported as
   *  skipped (B-139) when present without a plain `replace`. */
  markdown?: string;
  html?: string;
  /** Interactive form match — out of scope ("no scripting, zero
   *  setup" contract). */
  form?: string;
  form_fields?: Record<string, unknown>;
  /** Image match — no text replacement makes sense. */
  image_path?: string;
  /** Case-propagation options — applying these correctly requires
   *  transforming the replacement based on how the trigger was
   *  typed; importing the raw `replace` text without that transform
   *  would silently change behavior, so these are a skip reason. */
  propagate_case?: boolean;
  uppercase_style?: string;
  /** Espanso variable substitutions. See `EspansoVar`. */
  vars?: EspansoVar[];
}

export interface EspansoDocument {
  matches?: EspansoMatch[];
  [key: string]: unknown;
}

export type RawSettingsData = Record<string, unknown>;

