What 28 releases of an Obsidian plugin taught me about indie OSS
I built Snipsy because I was typing - [ ] fifty times a day and getting annoyed about it.
That's a true sentence and also a misleading one. The text expander I built for Obsidian is a one-week problem, technically. The actual project, the part that took nine months and 28 releases, was figuring out how to keep a thing alive after you've shipped the first version. I knew none of this when I started.
Nine months later, Snipsy sits at almost 1000 downloads in the Obsidian community plugins catalog. Small numbers, by absolute standards. But it's published, it's maintained, and people actually use it. Which, judging by the graveyard of half-shipped opensource projects on GitHub, is the rarer outcome.
Here's what the 28 releases taught me. Not in the heroic-lessons-from-the-journey sense. More like: things I wish someone had told me at release one.
![todo + space expands to a Markdown task](../screens/articles/hero-todo.mp4)
The dominant tool hadn't shipped in four years
I want to start with the original mistake, because it set up everything else.
When I first looked for a text expander for Obsidian, there was already a leader. Stable plugin, decent download numbers, well-known. I tried it. It mostly worked, except for one thing: it expanded my triggers inside code blocks. If I tried to document the `todo` command in a fenced block, the plugin replaced `todo ` with `- [ ] ` mid-code, breaking the example.
I checked the GitHub repo. Last commit: four years ago. Issues open: many. PRs ignored.
My first reaction was "this can't be right, I must be missing something." I read other people's plugin reviews, dug through issues, considered forking. Eventually I accepted the obvious thing: in a niche this small, "leader" doesn't always mean "active." Sometimes it just means "first."
Here's the part I didn't expect. When I sat down to fix the code-block bug in my own plugin, it took about fifty lines. Three small pure functions — one for fenced code, one for inline backticks, one for YAML frontmatter. Each one walks the document up from the cursor, counts the delimiters it cares about, and answers a yes-or-no question: is the cursor inside?
The only piece with any real subtlety is fenced code: you have to remember which delimiter opened the fence (backtick triple vs tilde triple) so you don't close one fence with the other. Get that wrong and expansion silently fires inside code blocks again, and nobody can tell you why.
Four years. That's how long the most-used text expander in the Obsidian community had been shipping with this bug — not because the fix is hard, but because nobody was paying attention to the repo anymore.
The lesson that took me nine months to actually internalize: most niche tool categories have abandoned leaders. Not because the maintainers are bad people. Just because attention is finite, and niches don't pay back the maintenance cost for most people. If you find a tool category where the top result hasn't shipped in years, that's not a crowded market. That's an empty one.
> The bar to clear isn't "be excellent." The bar is "ship the obvious fix nobody got around to."
Documentation is positioning, not description
Most opensource projects document what they do. Smart projects document when they're the wrong choice.
It took me about four releases to figure this out. Early Snipsy README was a feature list: hotstrings, custom snippets, multi-line expansion, community packs. The kind of README you write when you're proud of what you built.
The problem with that README is that it answered the wrong question. People landing on the page weren't asking "what does this do?" They were asking "is this for me?" And a feature list doesn't answer that.
So I added a section called "When Snipsy is NOT the right tool." It lists three alternatives:

If you need JavaScript templating, use Templater
If you need system-wide expansion (any app, not just Obsidian), use Espanso
If you want a search-based picker without auto-expansion, use Snippets Manager

I expected this section to lose me users. It did the opposite. People who needed Templater would land on my page, read that section, leave satisfied, and not file confused issues later. People who stayed actually wanted what Snipsy does.
Positioning is who you say no to. The README is the first place to declare it.
Saying "no" to features is a maintenance strategy
Around release five, feature requests started arriving. The most common one: "Can you add JavaScript templating? It would be powerful."
Yes, it would. Templater already does it well. And the moment I add JavaScript templating to Snipsy, three things happen at once:

The scope doubles. Now I'm maintaining a templating engine.
The bug surface explodes. Templating bugs are nasty.
The positioning collapses. "Use Templater if you need scripting" stops being true.

So I said no. Politely, with reasoning, and with a link to Templater. Then again. Then again.
The first ten or so feature requests were hard to decline. I felt the pull every time: someone wanted a thing, I had the skills, why wouldn't I just add it? But every "yes" to scope creep is a "no" to the project's long-term survival. Most indie opensource doesn't die from lack of users. It dies because the maintainer said yes too many times and burned out.
I now have a rough rule:
> If a feature would make Snipsy more like Templater, the answer is no.

Templater is a great tool. There is no reason for Snipsy to become a worse version of it.
CI does the work you'd otherwise skip
This one's less philosophical and more practical.
If I had to point at one thing that kept Snipsy alive across 28 releases, it's the CI setup. Specifically: tag-driven releases with build provenance, automated tests, and dependency scanning.
Here's a snippet from the release workflow:

```yaml
- name: Build
  run: npm run build

- name: Generate attestation
  uses: actions/attest-build-provenance@v1
  with:
    subject-path: 'main.js'
```

Nothing exotic. But the effect is: I push a tag, and within minutes there's a signed release in the Obsidian community catalog with attested artifacts. Zero manual steps.
This matters more than it sounds. The first time I shipped a release manually, it took me 40 minutes and I forgot to update the version in two files. By release ten, I would have given up if every release still cost me 40 minutes. CI makes the maintenance cost asymptotically approach zero, which is the only way a side project survives.
For corporate teams, CI is hygiene. For indie projects, CI is the difference between "this plugin is maintained" and "the maintainer got tired."
The best feature I shipped, I stole from Espanso
I built Snipsy thinking the core feature was the snippet engine. Turns out I was wrong. The core feature was something I copied from a neighboring ecosystem.
Espanso is the dominant system-wide text expander — the one you reach for when you want expansion to work in any app, not just the editor you're in. It also has something Obsidian plugins almost never have: a packages ecosystem. Espanso users share `package.yml` files publicly, and the community has been growing that catalog for years now. Every text-expansion plugin I tried in Obsidian treated snippets as something you configure from a blank settings page.
So I ported the Espanso pattern into Obsidian — not the implementation, the idea. Snipsy ships with a Packages tab and ten curated packs maintained as YAML files in the repo: Markdown Essentials, Daily Journal, GTD, Code Review, and so on. One click installs a pack. Within thirty seconds of installing the plugin, you have working snippets without touching settings.
![Opening the Packages tab, installing Markdown Essentials, then expanding `tbl3` into a Markdown table](../screens/articles/packages-table.mp4)
The packs themselves are open source. Anyone can submit a new pack as a pull request to the Snipsy repo — no marketplace, no review queue, no monetization. This sounds trivial but it's the load-bearing piece: monetization would have killed it. Nobody contributes a fifty-line YAML file to a marketplace. They contribute it to a free community catalog that has their handle in the credits.
One small UX decision made the whole thing work: import preview. When you install a pack, Snipsy shows you a diff before anything touches your settings — added rows in green, conflicting triggers highlighted in red, an explicit prompt for each collision. Without that modal, users would never install a second pack — they'd be afraid the new one would silently overwrite their custom triggers. With it, installing five packs in a row feels safe.
I added the Packages tab in release 12. Downloads roughly doubled in the following month. The first-thirty-seconds experience went from "configure everything from scratch" to "pick a pack, start typing."
> Look sideways.

Beating the current leader head-on is rarely the most interesting opportunity in a niche. The higher-leverage move is usually to bridge what a neighboring ecosystem has solved that yours hasn't.
What I'd do differently
Three things, if I were starting Snipsy today.
First, I'd add a CHANGELOG from release one. I started writing proper changelog entries around release eight, which means the first seven releases have garbage notes that look like "fixes and improvements." When someone asks "what changed in version 0.5?" I have no good answer. Changelog discipline is cheap on day one and expensive to retrofit.
Second, I'd publish to the community catalog earlier. I sat on Snipsy in a private repo for about two months because I wanted it to be "ready." It wasn't ready when I published, either. It was just less embarrassing. Published-and-imperfect beats private-and-polishing every time, because feedback is the only signal that matters.
Third, I'd write the "when NOT to use this" section before the "what this does" section. Positioning before feature listing. I figured this out by accident; I'd do it on purpose now.
The bigger pattern
If I zoom out, the through-line across all of this is: indie OSS rewards constraint, not ambition. The temptation, on every release, is to add more. The discipline is to add less, document better, and ship boring infrastructure that keeps you from burning out.
Snipsy isn't a remarkable plugin. Text expansion is a solved problem. But solved problems with abandoned leaders are exactly where indie projects have the most leverage, if you're willing to keep the scope small and the maintenance sustainable.
If you maintain a niche tool — Obsidian plugin, VS Code extension, browser extension, whatever — has anyone tried the "when NOT to use this" section in their own README? I'm curious if it changed who showed up to your issue tracker.
{% github Dimagious/snipsidian %}