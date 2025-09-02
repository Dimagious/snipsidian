/** Symbols that are considered delimiters for triggering hotstrings */
export const DEFAULT_DELIMITERS = [
    " ", "\t", "\n",
    ".", ",", "!", "?", ";", ":",
    "(", ")", "[", "]", "{", "}",
    "\"", "'", "-", "\\", "/", "|"
];

export function isSeparator(ch: string): boolean {
    return /[\s.,!?;:()\[\]{}"'\-\\/|]/.test(ch);
}
