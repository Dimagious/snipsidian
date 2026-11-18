// src/adapters/field-session.ts
import {
    EditorSelection,
    StateEffect,
    StateField,
    Prec,
    type EditorState,
    type Extension,
    type Transaction,
    type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import type { Editor } from "obsidian";
import type { FieldStops } from "../engine/types";

/**
 * B-243: field sessions (Tab stops).
 *
 * A snippet with two or more `$N` fields inserts its text WITHOUT any marker
 * and then opens a session: this state field remembers where each field is
 * (document ranges mapped through every edit), which one is current and where
 * the final stop is. Nothing is ever written into the note; ending a session
 * leaves nothing behind.
 *
 * ## Pinned rules
 *
 * - `stops` are in VISIT order (ascending number, ties by position, decided
 *   by the engine); `current` indexes into it.
 * - Tab = next field, Shift+Tab = previous (stays on the first), Tab from the
 *   last field moves to `final` and ends the session. The keys act ONLY while
 *   a session is open: every command returns `false` otherwise, so list
 *   indent, Latex Suite or Completr keep Tab. Escape ends the session and
 *   returns `false`, so it still does whatever it did before (Vim, closing a
 *   popup).
 * - Typing inside the current field grows it (`from` keeps its place, `to`
 *   moves). Other fields shift with the text; fields at the same position
 *   keep their DOCUMENT order (`docOrder`), so `$2$1` works like `$1$2`.
 * - A change that lies entirely inside the current field counts as typing
 *   whatever its user event is (an auto-paired `(`, `[` or `"` may be
 *   dispatched without an `input` event).
 * - The session ends when: the selection leaves every field (click, arrows)
 *   or becomes multi-cursor, an undo/redo happens, a change that is not user
 *   input and not inside the current field (another expansion, sync, another
 *   plugin) touches a field, or the view's state is
 *   replaced (a new state has a new, empty field). A new expansion with
 *   fields replaces the session.
 */

export interface FieldRange {
    from: number;
    to: number;
}

export interface FieldSession {
    /** Fields in visit order. */
    stops: FieldRange[];
    /** Index into `stops`. */
    current: number;
    /** Where the last Tab lands. */
    final: number;
    /** Document order of each field in `stops` (ties at one position are
     *  broken by it). Absent = the stops are in document order already. */
    docOrder?: number[];
}

export const startFieldSessionEffect = StateEffect.define<FieldSession>();
export const endFieldSessionEffect = StateEffect.define<null>();
/** Carries the index of the field a Tab/Shift+Tab moved to (equal-position
 *  fields cannot be told apart from the selection alone). */
export const moveFieldEffect = StateEffect.define<number>();

const FIELD_CLASS = "snipsy-field";
const FIELD_CURRENT_CLASS = "snipsy-field-current";
const EMPTY_CLASS = "snipsy-field-empty";

function contains(range: FieldRange, pos: number): boolean {
    return pos >= range.from && pos <= range.to;
}

/** True when a change overlaps or touches any field. */
function touchesStops(tr: Transaction, stops: FieldRange[]): boolean {
    let hit = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
        for (const s of stops) if (fromA <= s.to && toA >= s.from) hit = true;
    });
    return hit;
}

/** True when every changed range lies inside `range` (ends included). */
function insideField(tr: Transaction, range: FieldRange | undefined): boolean {
    if (!range) return false;
    let inside = true;
    tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA < range.from || toA > range.to) inside = false;
    });
    return inside;
}

function mapSession(tr: Transaction, value: FieldSession): { stops: FieldRange[]; final: number } {
    const cur = value.stops[value.current];
    const docIndex = (i: number): number => value.docOrder?.[i] ?? i;
    const stops = value.stops.map((s, i) => {
        if (i === value.current || !cur) {
            return { from: tr.changes.mapPos(s.from, -1), to: tr.changes.mapPos(s.to, 1) };
        }
        // Equal positions: the field earlier in the DOCUMENT stays before the text typed.
        const before = s.to <= cur.from && (s.from < cur.from || docIndex(i) < docIndex(value.current));
        const assoc = before ? -1 : 1;
        return { from: tr.changes.mapPos(s.from, assoc), to: tr.changes.mapPos(s.to, assoc) };
    });
    const finalBefore = cur !== undefined && value.final < cur.from;
    return { stops, final: tr.changes.mapPos(value.final, finalBefore ? -1 : 1) };
}

export const fieldSessionField = StateField.define<FieldSession | null>({
    create: () => null,
    update(value, tr) {
        // Effects first, last one wins: a new expansion replaces the session,
        // an explicit end drops it.
        let next = value;
        let moved: number | undefined;
        for (const effect of tr.effects) {
            if (effect.is(startFieldSessionEffect)) next = effect.value;
            else if (effect.is(endFieldSessionEffect)) next = null;
            else if (effect.is(moveFieldEffect)) moved = effect.value;
        }
        if (next !== value) return next;
        if (!value) return value;
        if (!tr.docChanged && !tr.selection && moved === undefined) return value;

        let { stops, final } = value;
        if (tr.docChanged) {
            if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return null;
            const userEdit =
                tr.isUserEvent("input") || tr.isUserEvent("delete") || insideField(tr, stops[value.current]);
            if (!userEdit && touchesStops(tr, stops)) return null;
            ({ stops, final } = mapSession(tr, value));
        }

        const selection = tr.newSelection;
        if (selection.ranges.length > 1) return null;
        const { anchor, head } = selection.main;
        const inside = (r: FieldRange | undefined): boolean =>
            r !== undefined && contains(r, anchor) && contains(r, head);
        let current = moved ?? value.current;
        if (!inside(stops[current])) {
            // The selection moved on its own (click, arrows): follow it, or end.
            if (moved !== undefined) return null;
            current = stops.findIndex((r) => inside(r));
            if (current < 0) return null;
        }
        if (!tr.docChanged && current === value.current) return value;
        return { ...value, stops, current, final };
    },
    provide: (field) =>
        EditorView.decorations.from(field, (session) => fieldDecorations(session)),
});

class EmptyFieldWidget extends WidgetType {
    constructor(private readonly current: boolean) {
        super();
    }

    eq(other: EmptyFieldWidget): boolean {
        return other.current === this.current;
    }

    toDOM(): HTMLElement {
        // The global helper makes a DETACHED element (CM6 inserts it itself).
        return createSpan({
            cls: this.current ? `${EMPTY_CLASS} ${FIELD_CURRENT_CLASS}` : EMPTY_CLASS,
            attr: { "aria-hidden": "true" },
        });
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/** Marks for filled fields, a small placeholder for empty ones. */
export function fieldDecorations(session: FieldSession | null): DecorationSet {
    if (!session) return Decoration.none;
    const ranges = session.stops.map((stop, i) => {
        const current = i === session.current;
        if (stop.to > stop.from) {
            const cls = current ? `${FIELD_CLASS} ${FIELD_CURRENT_CLASS}` : FIELD_CLASS;
            return Decoration.mark({ class: cls }).range(stop.from, stop.to);
        }
        return Decoration.widget({ widget: new EmptyFieldWidget(current), side: 1 }).range(stop.from);
    });
    return Decoration.set(ranges, true);
}

/** The part of `EditorView` the commands need (testable without a DOM). */
export interface FieldCommandView {
    readonly state: EditorState;
    readonly composing: boolean;
    dispatch(spec: TransactionSpec): void;
}

/** True while a field session is open in `state`. */
export function hasFieldSession(state: EditorState): boolean {
    return (state.field(fieldSessionField, false) ?? null) !== null;
}

/**
 * Opens a session over `stops` (document offsets) and puts the caret in the
 * first field. Refuses (returns `false`) when the extension is not installed
 * in this view or an offset no longer fits the document (the note changed
 * while the snippet was resolved).
 */
export function startFieldSession(
    view: Pick<FieldCommandView, "state" | "dispatch">,
    stops: FieldStops,
): boolean {
    if (view.state.field(fieldSessionField, false) === undefined) return false;
    const first = stops.fields[0];
    if (first === undefined) return false;
    const length = view.state.doc.length;
    if (stops.final < 0 || stops.final > length) return false;
    if (stops.fields.some((o) => o < 0 || o > length)) return false;
    view.dispatch({
        selection: { anchor: first },
        effects: startFieldSessionEffect.of({
            stops: stops.fields.map((o) => ({ from: o, to: o })),
            current: 0,
            final: stops.final,
            docOrder: stops.docOrder,
        }),
        scrollIntoView: true,
    });
    return true;
}

/**
 * B-243: opens a field session in the CodeMirror view behind `editor`.
 * Quietly does nothing when the editor has no CM6 view (legacy editor) or the
 * view lacks the field extension: the caret stays where the insert put it.
 */
export function startFieldSessionInEditor(editor: Editor, stops: FieldStops | undefined): boolean {
    const view = editor.cm;
    if (!view || !stops) return false;
    return startFieldSession(view, stops);
}

function openSession(view: FieldCommandView): FieldSession | null {
    if (view.composing || view.state.readOnly) return null;
    return view.state.field(fieldSessionField, false) ?? null;
}

function goTo(view: FieldCommandView, index: number, session: FieldSession): void {
    const stop = session.stops[index];
    if (!stop) return;
    view.dispatch({
        selection: EditorSelection.single(stop.from, stop.to),
        effects: moveFieldEffect.of(index),
        scrollIntoView: true,
    });
}

/** Tab: next field; from the last field to the final stop, ending the session. */
export function nextField(view: FieldCommandView): boolean {
    const session = openSession(view);
    if (!session) return false;
    if (session.current >= session.stops.length - 1) {
        view.dispatch({
            selection: { anchor: session.final },
            effects: endFieldSessionEffect.of(null),
            scrollIntoView: true,
        });
        return true;
    }
    goTo(view, session.current + 1, session);
    return true;
}

/** Shift+Tab: previous field; on the first field it stays there. */
export function previousField(view: FieldCommandView): boolean {
    const session = openSession(view);
    if (!session) return false;
    goTo(view, Math.max(0, session.current - 1), session);
    return true;
}

/**
 * Escape: ends the session but does NOT consume the key (returns `false`), so
 * Escape keeps whatever else it does (Vim normal mode, closing a popup).
 */
export function escapeFieldSession(view: FieldCommandView): boolean {
    if (!hasFieldSession(view.state)) return false;
    view.dispatch({ effects: endFieldSessionEffect.of(null) });
    return false;
}

/**
 * The CM6 extension: state field, decorations and the keymap. `Prec.highest`
 * costs nothing outside a session (every command returns `false` then) and
 * guarantees the keys are honoured inside one.
 */
export function buildFieldSessionExtension(
    /** B-255: what Tab does when no session is open (e.g. expand the trigger
     *  before the caret). Returns `true` only when it took the key; `false`
     *  lets Tab through (indent, other plugins). Never consulted in a session. */
    onTabOutsideSession?: (view: EditorView) => boolean,
): Extension {
    return [
        fieldSessionField,
        Prec.highest(
            keymap.of([
                { key: "Tab", run: (view) => nextField(view) || (onTabOutsideSession?.(view) ?? false) },
                { key: "Shift-Tab", run: (view) => previousField(view) },
                { key: "Escape", run: (view) => escapeFieldSession(view) },
            ]),
        ),
    ];
}
