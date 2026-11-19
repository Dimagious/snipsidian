/**
 * ADR-0008, Patterns page: the line shown under a rule the runtime guard switched off for the session.
 * The engine's reason (`RuleHealth.switchedOff`) is a log line; the page words it for a person. Two kinds exist: a
 * rule that was slow on several keystrokes, and one whose first runs took too long (V8 compile cost). The engine
 * text is matched by its start; `pattern-health.test.ts` drives the real guard to keep the two in step.
 */
export const PAUSED_FLAIR = "Paused";

export function pausedLine(engineReason: string): string {
    return engineReason.startsWith("Switched off: too expensive to compile")
        ? "Turned off for this session: it took too long to compile."
        : "Turned off for this session: it was too slow.";
}
