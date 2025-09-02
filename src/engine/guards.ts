import type { ExpandContext } from "./types";

/** Minimal logic: do not expand in code contexts */
export function shouldExpandHere(ctx: ExpandContext): boolean {
    if (ctx.isInFrontmatter) return false;
    if (ctx.isInCode) return false;
    if (ctx.isInMath) return false;
    return true;
}
