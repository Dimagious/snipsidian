// delimiters.ts
export const DEFAULT_DELIMITERS = [
    " ", "\t", "\n",
    ".", ",", "!", "?", ";", ":",
    "(", ")", "[", "]", "{", "}", "\"", "'"
];

export function isSeparator(ch: string): boolean {
    // eslint-disable-next-line no-useless-escape -- \[ and \] are REQUIRED inside [] to match literal brackets
    return /[\s.,!?;:()\[\]{}"']/.test(ch);
}
