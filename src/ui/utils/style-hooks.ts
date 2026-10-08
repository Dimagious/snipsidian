/**
 * Class names that TypeScript adds to Obsidian-owned elements so
 * `src/styles/main.css` can target them without `:has()` (B-189, scorecard
 * `avoid-has`). The CSS selectors and these constants are one contract;
 * `src/styles/package-details-fade.test.ts` asserts `main.css` still uses them.
 */

/** A `.setting-item` row that hosts a textarea (stacked full-width layout). */
export const SETTING_TEXTAREA_CLASS = "snipsy-setting-textarea";

/** The `.modal` element hosting the snippet picker (compact title). */
export const PICKER_HOST_CLASS = "snipsy-picker-host";
