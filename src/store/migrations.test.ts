import { describe, it, expect } from "vitest";
import { isTextSnippetsData, runMigrations, textSnippetsExpansion } from "./migrations";

describe("store/migrations", () => {
    it("returns input unchanged when no migrations", () => {
        const obj = { a: 1 };
        expect(runMigrations(obj)).toEqual(obj);
    });
});

describe("store/migrations: Text Snippets shape (B-254)", () => {
    it("detects a snippets_file string", () => {
        expect(isTextSnippetsData({ snippets_file: "a : b" })).toBe(true);
        expect(isTextSnippetsData({ snippets_file: "" })).toBe(true);
    });

    it("detects a snippets list (also an empty one)", () => {
        expect(isTextSnippetsData({ snippets: ["a : b"] })).toBe(true);
        expect(isTextSnippetsData({ snippets: [] })).toBe(true);
    });

    // Regression: B-254 — an array used to be taken as the Snipsy map
    // ({ "0": ..., "1": ... }).
    it("does not take a Snipsy settings object for Text Snippets data", () => {
        expect(isTextSnippetsData({ snippets: { todo: "- [ ]" } })).toBe(false);
        expect(isTextSnippetsData({ snippets: {}, expansion: { onTab: true } })).toBe(false);
    });

    // Regression: a Snipsy map with a stray `snippets_file` was taken for Text
    // Snippets and a whole Snipsy library was wiped into the backup.
    it("a Snipsy map with a stray snippets_file is still Snipsy data", () => {
        expect(isTextSnippetsData({ snippets: { todo: "- [ ]" }, snippets_file: "" })).toBe(false);
        expect(isTextSnippetsData({ snippets: {}, snippets_file: "a : b" })).toBe(false);
    });

    it("snippets_file with a null or missing snippets is still Text Snippets data", () => {
        expect(isTextSnippetsData({ snippets: null, snippets_file: "a : b" })).toBe(true);
        expect(isTextSnippetsData({ snippets_file: "a : b" })).toBe(true);
    });

    it("rejects non-objects, wrong types and files with neither key", () => {
        expect(isTextSnippetsData(null)).toBe(false);
        expect(isTextSnippetsData(undefined)).toBe(false);
        expect(isTextSnippetsData("snippets_file")).toBe(false);
        expect(isTextSnippetsData([])).toBe(false);
        expect(isTextSnippetsData({ snippets_file: 5 })).toBe(false);
        expect(isTextSnippetsData({ useTab: true })).toBe(false);
    });

    it("maps useTab (default on) and useSpace (default off)", () => {
        expect(textSnippetsExpansion({})).toEqual({ onType: false, onTab: true });
        expect(textSnippetsExpansion({ useTab: true, useSpace: false })).toEqual({ onType: false, onTab: true });
        expect(textSnippetsExpansion({ useTab: false, useSpace: true })).toEqual({ onType: true, onTab: false });
        expect(textSnippetsExpansion({ useTab: false, useSpace: false })).toEqual({ onType: false, onTab: false });
    });

    it("maps only an explicit true/false, not truthy or falsy look-alikes", () => {
        expect(textSnippetsExpansion({ useSpace: "true", useTab: 0 })).toEqual({ onType: false, onTab: true });
        expect(textSnippetsExpansion({ useTab: null })).toEqual({ onType: false, onTab: true });
    });
});
