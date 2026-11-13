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
