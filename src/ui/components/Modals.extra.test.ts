// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Stub `new Notice(msg)` so tests can assert toast copy.
const noticeCalls: string[] = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual("../../test/stubs/obsidian");
    return {
        ...actual,
        Notice: vi.fn().mockImplementation((msg: string) => {
            noticeCalls.push(msg);
        }),
    };
});

import { installObsidianDomHelpers } from "../../test/dom-polyfill";
import { makeMockApp } from "../../test/factories/plugin";
import {
    JSONModal,
    GroupPickerModal,
    TextPromptModal,
    AddSnippetModal,
    ConfirmModal,
} from "./Modals";
import type { App } from "obsidian";

beforeAll(() => {
    installObsidianDomHelpers();
});

let app: App;
beforeEach(() => {
    document.body.innerHTML = "";
    noticeCalls.length = 0;
    app = makeMockApp() as unknown as App;
});

// ---------- JSONModal ----------

describe("JSONModal", () => {
    it("renders title + textarea seeded with `text` + Apply / Close buttons", () => {
        const modal = new JSONModal(app, "{\"a\":1}", "Export");
        modal.open();
        expect(modal.titleEl.textContent).toBe("Export");
        const ta = modal.contentEl.querySelector("textarea") as HTMLTextAreaElement;
        expect(ta).toBeTruthy();
        expect(ta.value).toBe("{\"a\":1}");
        // aria-label inherits from title (B-085).
        expect(ta.getAttribute("aria-label")).toBe("Export");
        const buttons = Array.from(modal.contentEl.querySelectorAll("button"));
        expect(buttons.map((b) => b.textContent)).toEqual(["Apply", "Close"]);
    });

    it("Apply forwards the textarea value to onApply", () => {
        const onApply = vi.fn();
        const modal = new JSONModal(app, "old", "JSON");
        modal.onApply = onApply;
        modal.open();
        const ta = modal.contentEl.querySelector("textarea") as HTMLTextAreaElement;
        ta.value = "new content";
        const apply = Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Apply") as HTMLButtonElement;
        apply.click();
        expect(onApply).toHaveBeenCalledWith("new content");
    });

    it("Close does NOT call onApply (preserves the original text)", () => {
        const onApply = vi.fn();
        const modal = new JSONModal(app, "original", "JSON");
        modal.onApply = onApply;
        modal.open();
        const close = Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Close") as HTMLButtonElement;
        close.click();
        expect(onApply).not.toHaveBeenCalled();
    });
});

// ---------- ConfirmModal ----------

describe("ConfirmModal", () => {
    it("renders title + message + custom buttons", () => {
        const modal = new ConfirmModal(app, {
            title: "Delete?",
            message: "Are you sure?",
            confirmText: "Yes",
            cancelText: "No",
            onConfirm: vi.fn(),
        });
        modal.open();
        expect(modal.titleEl.textContent).toBe("Delete?");
        expect(modal.contentEl.textContent).toContain("Are you sure?");
        const buttons = Array.from(modal.contentEl.querySelectorAll("button"));
        expect(buttons.map((b) => b.textContent)).toEqual(["No", "Yes"]);
    });

    it("uses default 'Cancel' / 'Confirm' when confirmText/cancelText omitted", () => {
        const modal = new ConfirmModal(app, {
            title: "T",
            message: "M",
            onConfirm: vi.fn(),
        });
        modal.open();
        const buttons = Array.from(modal.contentEl.querySelectorAll("button"));
        expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Confirm"]);
    });

    it("Confirm button fires onConfirm", () => {
        const onConfirm = vi.fn();
        const modal = new ConfirmModal(app, { title: "T", message: "M", onConfirm });
        modal.open();
        const confirm = Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Confirm") as HTMLButtonElement;
        confirm.click();
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("Cancel does NOT fire onConfirm", () => {
        const onConfirm = vi.fn();
        const modal = new ConfirmModal(app, { title: "T", message: "M", onConfirm });
        modal.open();
        const cancel = Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Cancel") as HTMLButtonElement;
        cancel.click();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

// ---------- TextPromptModal (incl. B-051 formatHint) ----------

describe("TextPromptModal", () => {
    function getInput(modal: TextPromptModal): HTMLInputElement {
        return modal.contentEl.querySelector(
            "input[type='text']",
        ) as HTMLInputElement;
    }
    function getOkButton(modal: TextPromptModal): HTMLButtonElement {
        return Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent !== "Cancel") as HTMLButtonElement;
    }

    it("renders title + seeded input + Cancel/OK buttons", () => {
        const modal = new TextPromptModal(app, {
            title: "Rename:",
            initial: "old name",
            onSubmit: vi.fn(),
        });
        modal.open();
        expect(modal.titleEl.textContent).toBe("Rename:");
        expect(getInput(modal).value).toBe("old name");
    });

    it("OK forwards the trimmed value to onSubmit", () => {
        const onSubmit = vi.fn();
        const modal = new TextPromptModal(app, {
            title: "T",
            onSubmit,
        });
        modal.open();
        const input = getInput(modal);
        input.value = "  new value  ";
        input.dispatchEvent(new Event("input"));
        getOkButton(modal).click();
        expect(onSubmit).toHaveBeenCalledWith("new value");
    });

    it("rejects empty input with inline error", () => {
        const onSubmit = vi.fn();
        const modal = new TextPromptModal(app, { title: "T", onSubmit });
        modal.open();
        getOkButton(modal).click();
        expect(onSubmit).not.toHaveBeenCalled();
        const err = modal.contentEl.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("Value cannot be empty");
    });

    it("rejects when validate returns a message", () => {
        const onSubmit = vi.fn();
        const modal = new TextPromptModal(app, {
            title: "T",
            initial: "x",
            validate: (v) => (v.length < 3 ? "too short" : null),
            onSubmit,
        });
        modal.open();
        getOkButton(modal).click();
        expect(onSubmit).not.toHaveBeenCalled();
        const err = modal.contentEl.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("too short");
    });

    it("Enter in the input submits", () => {
        const onSubmit = vi.fn();
        const modal = new TextPromptModal(app, {
            title: "T",
            initial: "ok",
            onSubmit,
        });
        modal.open();
        const input = getInput(modal);
        input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        expect(onSubmit).toHaveBeenCalledWith("ok");
    });

    it("[B-051] shows live hint when formatHint returns a non-null string", () => {
        const modal = new TextPromptModal(app, {
            title: "Rename group",
            initial: "My Project 2024!",
            formatHint: (v) => {
                // Mimic the SnippetsTab use case: pretend the slugify
                // round-trip produces "My project 2024".
                if (!v) return null;
                const reconstructed = "My project 2024";
                return v === reconstructed ? null : `Will be saved as: ${reconstructed}`;
            },
            onSubmit: vi.fn(),
        });
        modal.open();
        const hint = modal.contentEl.querySelector(".snipsidian-prompt-hint");
        expect(hint?.textContent).toBe("Will be saved as: My project 2024");
    });

    it("[B-051] hides hint when formatHint returns null", () => {
        const modal = new TextPromptModal(app, {
            title: "T",
            initial: "matching",
            formatHint: () => null,
            onSubmit: vi.fn(),
        });
        modal.open();
        const hint = modal.contentEl.querySelector(".snipsidian-prompt-hint") as HTMLElement;
        expect(hint?.style.display).toBe("none");
    });

    it("[B-051] updates hint live as the user types", () => {
        const modal = new TextPromptModal(app, {
            title: "T",
            initial: "",
            formatHint: (v) => (v ? `Echo: ${v}` : null),
            onSubmit: vi.fn(),
        });
        modal.open();
        const input = getInput(modal);
        const hint = modal.contentEl.querySelector(
            ".snipsidian-prompt-hint",
        ) as HTMLElement;

        // Initially empty: no hint.
        expect(hint.style.display).toBe("none");

        // Type "abc".
        input.value = "abc";
        input.dispatchEvent(new Event("input"));
        expect(hint.textContent).toBe("Echo: abc");
        expect(hint.style.display).not.toBe("none");
    });
});

// ---------- AddSnippetModal ----------

describe("AddSnippetModal", () => {
    function getInputByPlaceholder(
        modal: AddSnippetModal,
        placeholder: string,
    ): HTMLInputElement | HTMLTextAreaElement {
        return modal.contentEl.querySelector(
            `input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`,
        ) as HTMLInputElement | HTMLTextAreaElement;
    }
    function getAddButton(modal: AddSnippetModal): HTMLButtonElement {
        return Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Add snippet") as HTMLButtonElement;
    }

    it("renders title + 3 fields + Add/Cancel buttons", () => {
        const modal = new AddSnippetModal(app);
        modal.open();
        expect(modal.titleEl.textContent).toBe("Add new snippet");
        expect(getInputByPlaceholder(modal, "Example: :hello")).toBeTruthy();
        expect(getInputByPlaceholder(modal, "Example: hello, world!")).toBeTruthy();
        expect(getInputByPlaceholder(modal, "Example: greetings")).toBeTruthy();
        const buttons = Array.from(modal.contentEl.querySelectorAll("button"));
        expect(buttons.map((b) => b.textContent)).toEqual(["Add snippet", "Cancel"]);
    });

    it("Add forwards trimmed trigger + replacement + trimmed group", () => {
        const onConfirm = vi.fn();
        const modal = new AddSnippetModal(app, onConfirm);
        modal.open();
        const triggerInput = getInputByPlaceholder(modal, "Example: :hello") as HTMLInputElement;
        const replacementInput = getInputByPlaceholder(modal, "Example: hello, world!") as HTMLTextAreaElement;
        const groupInput = getInputByPlaceholder(modal, "Example: greetings") as HTMLInputElement;

        triggerInput.value = "  brb  ";
        triggerInput.dispatchEvent(new Event("input"));
        replacementInput.value = "be right back";
        replacementInput.dispatchEvent(new Event("input"));
        groupInput.value = "  Work  ";
        groupInput.dispatchEvent(new Event("input"));

        getAddButton(modal).click();
        expect(onConfirm).toHaveBeenCalledWith({
            trigger: "brb",
            replacement: "be right back",
            group: "Work",
        });
    });

    it("rejects empty trigger or empty replacement with inline error", () => {
        const onConfirm = vi.fn();
        const modal = new AddSnippetModal(app, onConfirm);
        modal.open();
        // Both empty by default → click Add.
        getAddButton(modal).click();
        expect(onConfirm).not.toHaveBeenCalled();
        const err = modal.contentEl.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("required");
    });

    it("rejects group label that slugifies to empty", () => {
        const onConfirm = vi.fn();
        const modal = new AddSnippetModal(app, onConfirm);
        modal.open();
        (getInputByPlaceholder(modal, "Example: :hello") as HTMLInputElement).value = "brb";
        (getInputByPlaceholder(modal, "Example: :hello") as HTMLInputElement).dispatchEvent(new Event("input"));
        (getInputByPlaceholder(modal, "Example: hello, world!") as HTMLTextAreaElement).value = "be right back";
        (getInputByPlaceholder(modal, "Example: hello, world!") as HTMLTextAreaElement).dispatchEvent(new Event("input"));
        const groupInput = getInputByPlaceholder(modal, "Example: greetings") as HTMLInputElement;
        groupInput.value = "!!! ???";
        groupInput.dispatchEvent(new Event("input"));

        getAddButton(modal).click();
        expect(onConfirm).not.toHaveBeenCalled();
        const err = modal.contentEl.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("at least one letter or number");
    });

    it("Cancel does NOT fire onConfirm", () => {
        const onConfirm = vi.fn();
        const modal = new AddSnippetModal(app, onConfirm);
        modal.open();
        const cancel = Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Cancel") as HTMLButtonElement;
        cancel.click();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

// ---------- GroupPickerModal ----------

describe("GroupPickerModal", () => {
    function getSelect(modal: GroupPickerModal): HTMLSelectElement {
        return modal.contentEl.querySelector("select") as HTMLSelectElement;
    }
    function getMoveButton(modal: GroupPickerModal): HTMLButtonElement {
        return Array.from(modal.contentEl.querySelectorAll("button"))
            .find((b) => b.textContent === "Move") as HTMLButtonElement;
    }

    it("renders heading + select with all groups + Move/Cancel buttons", () => {
        const modal = new GroupPickerModal(app, {
            title: "Move to group:",
            groups: ["work", "personal"],
            allowUngrouped: true,
        });
        modal.open();
        expect(modal.titleEl.textContent).toBe("Move to group:");
        const select = getSelect(modal);
        // Ungrouped + 2 groups + "New group…"
        expect(select.options.length).toBe(4);
        expect(select.options[0].value).toBe("");                  // ungrouped
        expect(select.options[1].value).toBe("work");
        expect(select.options[2].value).toBe("personal");
        expect(select.options[3].value).toBe("__new__");
    });

    it("Move forwards the selected group key to onSubmit", () => {
        const onSubmit = vi.fn();
        const modal = new GroupPickerModal(app, {
            title: "T",
            groups: ["work", "personal"],
        });
        modal.onSubmit = onSubmit;
        modal.open();
        const select = getSelect(modal);
        select.value = "personal";
        getMoveButton(modal).click();
        expect(onSubmit).toHaveBeenCalledWith("personal");
    });

    it("'New group…' picker reveals an input and submits the slugified value", () => {
        const onSubmit = vi.fn();
        const modal = new GroupPickerModal(app, {
            title: "T",
            groups: ["work"],
        });
        modal.onSubmit = onSubmit;
        modal.open();

        const select = getSelect(modal);
        const newWrap = modal.contentEl.querySelector(
            ".snipsidian-newgroup-wrap",
        ) as HTMLElement;
        // Initially hidden.
        expect(newWrap.style.display).toBe("none");

        // Pick "New group…"
        select.value = "__new__";
        select.dispatchEvent(new Event("change"));
        expect(newWrap.style.display).not.toBe("none");

        // Type and Move.
        const input = newWrap.querySelector("input") as HTMLInputElement;
        input.value = "My Notes 2024!";
        getMoveButton(modal).click();
        // Slug "my-notes-2024" forwarded.
        expect(onSubmit).toHaveBeenCalledWith("my-notes-2024");
    });

    it("'New group…' with empty input shows inline error and does NOT submit", () => {
        const onSubmit = vi.fn();
        const modal = new GroupPickerModal(app, { title: "T", groups: [] });
        modal.onSubmit = onSubmit;
        modal.open();
        const select = getSelect(modal);
        select.value = "__new__";
        select.dispatchEvent(new Event("change"));
        getMoveButton(modal).click();
        expect(onSubmit).not.toHaveBeenCalled();
        const err = modal.contentEl.querySelector(".snipsidian-error");
        expect(err?.textContent).toContain("cannot be empty");
    });
});
