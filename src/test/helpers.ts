/**
 * Small typed helpers shared by the test files.
 */

/**
 * `items[index]`, or a failure that names the index and the length. With
 * `noUncheckedIndexedAccess` a plain index read is `T | undefined`; this reads
 * better in a failing test than a `TypeError` on `undefined`.
 */
export function nth<T>(items: ArrayLike<T>, index: number): T {
    const item = items[index];
    if (item === undefined) {
        throw new Error(`Expected an element at index ${index}, the collection has ${items.length}`);
    }
    return item;
}

/**
 * The fastest of up to `samples` runs of `run` (milliseconds, `run` returns its own timing), for a complexity
 * check as an absolute bound at a size where the quadratic version takes seconds and the linear one milliseconds.
 * A minimum survives a preempted sample; it stops at the first sample under `bound`, and at the first one over
 * `hopeless` (a regression fails in one slow sample, not five).
 */
export function fastestOf(run: () => number, bound: number, hopeless: number, samples = 5): number {
    let best = Infinity;
    for (let i = 0; i < samples; i++) {
        best = Math.min(best, run());
        if (best < bound || best > hopeless) break;
    }
    return best;
}
