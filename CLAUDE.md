# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dependency-free static website: an illustrated field guide to data structures and algorithms where every page runs the real algorithm on the user's input, one step at a time, with narration. Plain HTML + CSS + vanilla JavaScript (ES5-style, IIFEs, `"use strict"`). There is no package.json, no build step, no test suite, and no linter.

## Development

- Serve locally: `python3 -m http.server` from the repo root (or open the `.html` files directly — everything is relative paths; the only external resource is Google Fonts).
- Verification is manual: open the changed page in a browser, load an input, and play/step/scrub through the frames.
- Deployed via `.github/workflows/pages.yml` (GitHub Pages, no build step — the whole repo root is uploaded as-is on every push to `main`).

## Architecture

Everything is **frame-based playback**: page logic produces an array of plain-object frames (immutable snapshots), and a shared engine owns all playback (play/pause/step/back/reset, speed + scrub sliders, stats row, narration line, scrolling log, keyboard shortcuts ←/→/space). Pages never manipulate playback state themselves.

There are four page types, wired to shared files in `shared/`:

| Page type | Files | Engine |
|---|---|---|
| Algorithm visualizer (sorts, searches) | `bubble-sort-visualizer.html`, `binary-search-visualizer.html`, … | `shared/engine.js` → `Viz.init(cfg)` |
| Data-structure visualizer | `stack-visualizer.html`, `avl-tree-visualizer.html`, … | `shared/ds-engine.js` → `VizDS.init(cfg)` + `shared/ds-render.js` |
| Data-structure notes page | `stack.html`, `avl-tree.html`, … | `shared/ds-engine.js` → `VizDS.loopDemo(cfg)` + `shared/ds-render.js` |
| Concept/foundation page | `big-o.html`, … | none required; optionally `VizDS.loopDemo(cfg)` with a fully custom `renderExtra` (no `DSRender` call needed — see big-o.html's growth-rate bars) |

- **Algorithm pages** run once, start to finish: `build(array, target)` executes the whole algorithm up front and returns the complete frame list. The engine also owns input parsing, the random-array button, `needsTarget` (search target field), `sortRequired` (pre-sort input), and `validateValue` filtering. Frame shape: `{array, roles, narr, phase, code, codeLine, <statKeys>}` — `roles` is parallel to `array`, holding space-separated cell class strings.
- **Data-structure pages** persist: the structure lives across operations (Insert, then Delete, then Search each act on what the last op left behind). Each op's `run(state)` returns `{frames, state}` (or `{error}`); the engine appends the new frames to one ever-growing timeline and auto-plays into them. Scrubbing back revisits earlier operations — nothing is discarded — so `run` must **copy state, never mutate it** (see `items.slice()` in existing pages). Frame shape: `{struct, narr, phase, code, codeLine, <statKeys>}` where `struct` is whatever the page's chosen `DSRender` function expects.
- **Notes pages** pair with each DS visualizer (`<name>.html` ↔ `<name>-visualizer.html`): prose + complexity table (`.notes-table`), a non-interactive looping demo (`VizDS.loopDemo`), and a `.cta` link to the visualizer. Sorts/searches have no notes page, only the visualizer.
- **Concept pages** teach a prerequisite (Big-O, pointers, recursion…) rather than an operation: masthead + notes panel(s) + an optional small illustrative demo, no insert/delete-style controls, no `.cta` (there's no visualizer to open). Cross-link to the DS/algorithm pages that depend on the concept; get their own `.algo-card` in index.html's "Foundations" section.
- Every stats row automatically gets a `phase` entry; `statLabels` adds page-specific counters (comparisons, swaps, etc.) that frames carry as top-level keys.
- **`code`/`codeLine`** (optional, any frame on any engine): `code` is a page-defined array of C source lines (e.g. `var PUSH_CODE=[...]`, referenced by variable, never copied per frame); `codeLine` is an index into it, or `[start,end]` to highlight a block. Renders into `#codeHost` as a line-numbered panel with the active line(s) highlighted — see the "The Code" panel on stack.html/stack-visualizer.html/bubble-sort-visualizer.html. Omit on frames where no line applies (a pure "start"/"done" summary); the panel just keeps its last state. One focused function per operation (`void push(Stack *s, int val)`), not a whole file — and every frame that mutates the structure should carry narration + `codeLine` + the visual role change (e.g. `landed`) together, so the three reinforce the same moment instead of code being a bolted-on fourth layer.

The header comments of `shared/engine.js`, `shared/ds-engine.js`, and `shared/ds-render.js` are the authoritative config/contract docs — read them before touching a page.

Every page also loads `shared/motion.js`, a fourth shared file that is independent of the playback engines: it toggles a `.scrolled` class on the sticky masthead and fades/staggers `.panel`/`.algo-card` elements into view as they scroll into the viewport (see its header comment for the FOUC-safe approach). It's pure progressive enhancement — no page depends on it for correctness.

**The one exception:** `merge-sort-visualizer.html` is fully self-contained (its own inline CSS and engine, no `shared/` references). It is the original page the shared theme and engine were extracted from. Don't refactor it to the shared files unless asked; conversely, don't copy it as a template for new pages — copy a page that already uses `shared/`. Its inline `<style>`/`<script>` mirror the motion conventions below by hand (sticky masthead listener, `--ease`, view-transitions) since it can't load `shared/motion.js` — keep the two in sync if you change one.

### DSRender renderers (`shared/ds-render.js`)

Declarative full-redraw renderers (no DOM diffing — structures are small):
- `slots(host, cells)` — fixed-slot row with pointer badges (TOP/FRONT/REAR/HEAD…): stack, queue, circular queue, deque, hash-table bucket row.
- `sequence(host, struct)` — linked boxes with arrows (`dir:'h'|'v'`, `double`, `nullEnd`): linked lists, hash collision chains.
- `tree(nodesHost, svgEl, root, opts)` — recursive boxes + SVG connectors: BST, AVL, binary heap.
- `graph(nodesHost, svgEl, struct, opts)` — nodes on a circle + SVG edges.

### Engine ↔ page DOM contract

The engines look up fixed element ids — pages just supply matching markup: `play`, `back`, `fwd`, `reset`, `speed`, `scrub`, `scrubLbl`, `statsHost`, `hint`, `narr`, `log`; algorithm pages additionally `input`, `load`, `rand`, `arrayHost`, and `target` when `needsTarget`. DS visualizers wire their operation buttons/fields through the `ops` config (`btn`, `enterOn`), and draw into page-specific hosts (e.g. `stackHost`, `treeNodes`/`treeLinks` inside `.treewrap`, `graphNodes`/`graphLinks` inside `.graphwrap`) via `renderExtra(frame, ctx)`. `codeHost` is optional on any page (both engines, plus `loopDemo`) — add a `.code-panel` div with that id to get the C code panel; omit it and `code`/`codeLine` on frames are simply never rendered.

## Conventions

- **Theme:** `shared/theme.css` defines the "archive" look. Palette tokens: `--paper`/`--ink` (background/text), `--stamp` (red, active/pointer A), `--plot` (blue, pointer B), `--seal` (green, done/found). Reuse tokens and existing classes; page-specific CSS is a small inline `<style>` block only when the shared theme doesn't cover it (see `index.html`, tree/graph pages).
- **Cell roles** are combinable class strings on `.cell`: `left`, `right`, `head`, `sorted`, `spent`, `pivot`, `dim`, `found`, `landed` (e.g. `"left head landed"`). `landed` triggers the drop-in animation. Include a `.legend` panel explaining the roles a page uses.
- **Narration teaches.** Every frame's `narr` is a full sentence saying what happened *and why* ("Out of order, so swap them."), in the same plain, second-person voice as existing pages. Phases are short kebab-case tags (`compare`, `pass-done`, `push-start`).
- **Page skeleton** is identical everywhere: masthead (with `masthead-nav` back-link, `eyebrow`, `h1`, `note`) → panels (controls, visual(s), "Running commentary") → footer with a takeaway. Copy the closest existing page rather than writing from scratch.
- **Motion:** all easing uses the `--ease` token (`cubic-bezier(.16,1,.3,1)`, an "ease-out-expo" feel) rather than bare durations. `shared/theme.css` declares `@view-transition{navigation:auto}`, which gives same-origin link navigation a native crossfade in supporting browsers — no JS, no-op elsewhere. `.masthead` is `position:sticky` and collapses (smaller `h1`, tighter padding, translucent blur) when `shared/motion.js` adds `.scrolled`. Scroll-reveal is opt-in via a `.js-reveal` class that `motion.js` adds to `<html>` only if it actually runs, so `.panel`/`.algo-card` elements are fully visible with no JS at all; never rely on `.js-reveal` state for anything but visual polish. Everything above respects `prefers-reduced-motion` (see the media query in each stylesheet) — extend that block, don't bypass it, if you add new animations.

### Adding a topic

- New sort/search: copy the nearest `*-visualizer.html`, rewrite `build()` and the legend/footer copy.
- New data structure: create both `<name>.html` (notes + loop demo) and `<name>-visualizer.html`, cross-linked via masthead-nav and the notes page's `.cta`.
- New concept page: copy `big-o.html`, rewrite the notes prose and (if one earns its place) the demo; no visualizer counterpart needed.
- Either way, add an `.algo-card` to the matching section of `index.html` and update that section's count in its `panel-head` `.sub` (e.g. "11 structures").
