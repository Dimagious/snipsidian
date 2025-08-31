// presets.ts
export const DEFAULT_SNIPPETS: Record<string, string> = {
    // Text abbreviations
    brb: "be right back",
    omw: "on my way",
    ty: "thank you",
    imo: "in my opinion",

    // Markdown helpers
    code: "```$|\n```",
    todo: "- [ ] $|",
    bullet: "- $|",
    quote: "> $|",

    // Headings
    h1: "# $|",
    h2: "## $|",
    h3: "### $|",

    // Date/time placeholders (for users with Templater/Dataview or own snippets)
    today: "{{date:YYYY-MM-DD}}",
    now: "{{time:HH:mm}}",
};
