# Bread Trail

An auxiliary plugin for [Breadcrumbs](https://github.com/SkepticMystic/breadcrumbs) that provides a rich navigation sidebar, floating edge panels, header breadcrumbs, and editing tools for your knowledge graph.

> **Requires** the [Breadcrumbs](https://github.com/SkepticMystic/breadcrumbs) plugin. Bread Trail detects it on startup and guides you through installation if it's missing.

---

## Navigator Sidebar

Open via the ribbon icon or **View → Bread Trail Navigator**. Four modes, switchable from the toolbar:

### Context mode (`git-branch`)
Shows the full neighborhood of the active note:

- **Parents** — notes that are BC parents of the current note
- **Sequence chains** — prev/next chains the note belongs to, with position badges (e.g. `3 / 7`)
- **Children** — notes that are BC children of the current note

Cards show configurable frontmatter metadata below the title. Ctrl/Cmd+click opens in a new tab.

### Browse mode (`folder-open`)
Hierarchical browser you can navigate independently of the active note:

- Click a note to drill into its children
- Back button walks up the hierarchy
- **Toggle** the browse icon again to switch between BC hierarchy and real vault folder structure (`hard-drive` icon)
- **Smart locate button** — shows `crosshair` when the browser isn't on the active note (click to jump there); flips to `rotate-ccw` when it already is (click to reset to configured start)
- Per-section sort cycling: alphabetical, reverse-alpha, sequence order, custom field, modified date, created date

### Recent mode (`clock`)
Shows recently opened notes vault-wide. Click the icon a second time to switch to **siblings-only** mode (`users` icon) — showing only notes that share a BC parent with the active note.

### Favorites mode (`star`)
Shows notes you've starred, combining two sources:
- Notes with `bread-trail: {favorite: true}` in frontmatter
- File paths pinned manually in Settings → Favorites view

---

## Floating Edge Panels

Hover-reveal panels that appear on the left and/or right edge of any open note. Enable per-side in Settings → Floating navigator.

- Collapses to a 6px accent strip; expands on hover to show the full context view (parents, chains, children) using the same card layout as the sidebar
- **Pin button** opens the navigator in the sidebar on that side
- Automatically hides when the sidebar navigator is already visible on that side

---

## Header Breadcrumbs

Enable in Settings → Floating navigator → **Header breadcrumbs**.

Replaces (or supplements) the file-path breadcrumb in note headers with a clickable BC ancestor chain: `Root › Grandparent › Parent`. Works even when "Show floating tab title bar" is disabled in Obsidian.

- Ctrl/Cmd+click opens ancestor in a new tab
- **Depth** slider (0 = all ancestors, 1–8 = show only the N closest ancestors)

---

## Graph Switcher

Visual graph navigation — open with the **Show breadcrumb graph switcher** command.

- Spatial layout of the active note's relationships
- Edge type filtering (toggle individual types with checkboxes)
- Type to filter/highlight nodes
- Keyboard navigation: arrows/WASD to move, Enter to explore, 2×Enter to open, Escape to cancel
- Zoom: `=` / `-` keys or Ctrl/Cmd+scroll
- Click-drag to pan
- Sequence position badges on prev/next nodes

---

## Quick Switcher

Fuzzy search through breadcrumb-related notes — **Quick switch to breadcrumb-related note** command.

- Shows parents, children, previous, next, siblings, and related notes grouped by relation
- Configurable traversal depth per relation type in settings
- Cmd+arrows for direct navigation (↑ parent, ↓ child, ← previous, → next)
- **Quick switch notes with breadcrumb context** variant searches the whole vault with relation metadata shown

---

## Breadcrumb Outline

Hierarchical tree of all descendants beneath the current note — **Show breadcrumb outline** command.

- Recursive traversal
- Click to navigate
- Drag-and-drop to reorder (writes `next` frontmatter field)

---

## Sequencing

Automatically number the children of a note into a prev/next chain.

- **Sequence children of current note** — manual, one-shot
- **Sequence all auto-configured notes** — runs across all notes with `bread-trail: {mode: auto}`
- **Remove stale sequence links** — cleans up orphaned prev/next fields
- **Auto-sequencing** — set `bread-trail: {mode: auto}` on a parent and its children are re-sequenced automatically whenever their frontmatter changes

---

## Validation

**Validate breadcrumbs** command opens a report of structural issues across your vault. Configurable rules:

| Rule | Description |
|---|---|
| Broken links | BC edges pointing to non-existent files |
| Missing reciprocal | One-way parent/child relationships |
| Require specificity | Edges that are too vague |
| Cross-hierarchy | Links that jump across unrelated branches |

Severity can be set to `off`, `warn`, or `error` per rule. Warning/error banners are also injected inline in affected notes.

---

## Frontmatter Reference

All Bread Trail per-note config lives under a `bread-trail` frontmatter key (nested object):

```yaml
bread-trail:
  hidden: true        # Hide this note from the navigator entirely
  favorite: true      # Pin to Favorites view
  mode: auto          # Auto-sequence children when frontmatter changes
  sort: alpha         # Per-note child sort override (alpha | alpha-desc | sequence | mtime | ctime)
```

---

## Settings Reference

### Labels & metadata
- **Graph label property** — frontmatter property used as display name (e.g. `aliases`). Leave blank to use filenames.
- **Navigator meta properties** — comma-separated list of frontmatter properties shown below card titles in Context mode.

### Display
- **Preview expanded** — show content excerpts and images on cards (toggleable from the toolbar too)

### Floating navigator
- **Left / Right edge panel** — hover-reveal panels per side
- **Header breadcrumbs** — replace note header file path with BC ancestor links
- **Breadcrumb depth** — how many ancestor levels to show (0 = all)

### Favorites view
- **Pinned notes** — file paths always shown in Favorites, one per line

### Recent view
- **Max recent notes** — how many entries to show

### Browse mode
- **Browse start** — where the browser initializes (`active` note, vault `roots`, or a specific `note`)

### Exclusions
- **Exclude folders** — folder prefixes hidden from the navigator
- **Exclude files** — specific file paths hidden from the navigator
- **Exclude frontmatter** — hide notes matching a frontmatter key/value pattern

### Sequencing
- **Auto-sequence** — enable automatic re-sequencing on metadata change
- **Sequence field** — frontmatter field written by the sequencer (default: `next`)

---

## Commands

| Command | Description |
|---|---|
| Show trail for current note | Quick modal showing parents/children |
| Show breadcrumb outline | Tree view with drag-drop reordering |
| Quick switch to breadcrumb-related note | Fuzzy search through related notes |
| Quick switch notes with breadcrumb context | Fuzzy search entire vault with BC context |
| Show breadcrumb graph switcher | Visual graph navigation |
| Sequence children of current note | Number children into a prev/next chain |
| Sequence all auto-configured notes | Bulk sequencing pass |
| Remove stale sequence links | Clean up orphaned prev/next fields |
| Validate breadcrumbs | Open structural issue report |

---

## Installation

### Via BRAT (recommended for beta testing)
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add `112345brian/bread-trail` as a beta plugin
3. Enable Bread Trail in Community Plugins

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/112345brian/bread-trail/releases)
2. Place them in `YourVault/.obsidian/plugins/bread-trail/`
3. Reload Obsidian and enable the plugin

---

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
npm run lint   # lint check
```

---

## Credits

Built by [112345brian](https://github.com/112345brian).  
Integrates with [Breadcrumbs](https://github.com/SkepticMystic/breadcrumbs) by SkepticMystic.  
Incorporates code from [Abstract Folder](https://github.com/RahmaniErfan/abstract-folder) by RahmaniErfan (GPL-3.0).

## License

GPL-3.0 — see [LICENSE](LICENSE)

---

## My Other Plugins

- [**Breadbake**](https://github.com/112345brian/breadbake) — Breadcrumbs graph configuration
- [**Citation Suite**](https://github.com/112345brian/bripey-citation-suite) — enhanced citation tools
- [**Inherit**](https://github.com/112345brian/inherit) — frontmatter property inheritance
- [**Properties First**](https://github.com/112345brian/obsidian-properties-first) — move properties above the inline title
- [**Return Headings**](https://github.com/112345brian/return-headings) — heading-return navigation markers

Install them all at once: [**bripeys-extremely-opinionated-plugin-suite**](https://github.com/112345brian/bripeys-extremely-opinionated-plugin-suite)
