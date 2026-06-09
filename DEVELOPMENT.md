# BreadTrail — developer reference

Project-specific architecture notes, invariants, and gotchas. Read this before
touching the codebase; **code review won't catch most of what's written here**
because these are interaction bugs between distant systems, not diff-visible
mistakes.

---

## File map

| File | Lines | Purpose |
|------|-------|---------|
| `src/main.ts` | ~950 | Plugin lifecycle, all `addCommand` calls, header-breadcrumb injection, `openExplorerModal`, floating nav wiring |
| `src/settings.ts` | ~1270 | `BreadTrailSettings` interface, `DEFAULT_SETTINGS`, `normalizeSettings`, the settings UI tab |
| `src/NavigatorView.ts` | ~1870 | The sidebar panel — all navigator state lives here |
| `src/ExplorerModal.tsx` | ~615 | Tile grid modal (Preact); self-contained BC helpers |
| `src/navigator/types.ts` | ~115 | All shared TS types for the navigator (NavMode, NavActions, CardData, …) |
| `src/navigator/App.tsx` | ~220 | Root Preact component — renders toolbar + content area |
| `src/navigator/Toolbar.tsx` | ~170 | Toolbar component — mode buttons, action buttons, more-options menu |
| `src/navigator/Card.tsx` | ~80 | Card component (list layout) |
| `src/navigator/Section.tsx` | ~75 | Section component (context mode) |
| `src/homepageUtils.ts` | ~60 | `resolveHomepageFile`, `resolveHomepageTarget`, `getHomepageTargetForFile` |
| `src/homepageRoots.ts` | ~25 | `shouldIncludeVaultRoot` — pure logic, has a test file |
| `src/utils.ts` | ~150 | Content snippet extraction, date formatting, image link parsing |
| `src/FloatingNav.ts` | ~430 | Floating edge panels on desktop notes |
| `src/GraphSwitcher.ts` | ~1315 | BC graph switcher modal |
| `src/QuickSwitcher.ts` | ~260 | BC quick-switcher modal |
| `src/Sequencer.ts` | ~425 | Auto-sequencing logic |
| `src/SequenceModal.ts` | ~370 | Sequence UI modals |
| `src/Validator.ts` | ~315 | Vault-wide BC validation rules |
| `src/ValidationModal.ts` | ~125 | Validation report modal |

---

## Navigator mode state machine

### Modes and sub-modes

```
NavMode: 'context' | 'browser' | 'recent' | 'favorites'

browser sub-mode:  browserViewMode: 'bc' | 'files'   (default: 'bc')
recent sub-mode:   recentViewMode: 'global' | 'local'  (default: 'global')
```

`navigatorMode` is **persisted** to settings. Sub-mode state (`browserViewMode`,
`recentViewMode`) is **not persisted** — it resets to its default on every
plugin reload.

### The startup trap (critical)

Because `navigatorMode` persists but sub-mode state resets, the view can start
with e.g. `mode === 'browser'` and `browserViewMode === 'bc'`. If a mode button's
`onClick` handler toggles sub-mode when the mode is already active, the first tap
after a cold start fires the toggle unexpectedly:

```
// WRONG — do not do this:
if (mode === 'browser' && this.mode === 'browser') {
  this.browserViewMode = this.browserViewMode === 'bc' ? 'files' : 'bc'; // first tap = files!
}

// RIGHT — mode button = always primary sub-view:
if (mode === 'browser' && this.mode === 'browser') {
  this.browserViewMode = 'bc';
  this.initBrowserStack(activeFile, bc);
  void this.refresh();
}
```

**Invariant:** pressing a mode button must NEVER change sub-mode state to a
non-default value. Sub-mode toggles belong in the more-options (⋯) menu as
dedicated `NavActions` (see `toggleFileBrowser`, `toggleRecentLocal`).

### Mode persistence

`applyMode(mode)` sets `this.mode`, saves `settings.navigatorMode`, and refreshes.
The follow-mode boolean (`navigatorFollowMode`) is also persisted: set
`this.settings.navigatorFollowMode = this.followMode` before saving whenever it
changes.

### Cold-start browser initialization

`browserStack` is **not persisted** — it resets to `[]` on every plugin reload.
`onOpen()` handles this by calling `initBrowserStack(activeFile, bc)` when
`this.mode === 'browser'` starts up. Without this, a persisted `browser` mode
would always start at vault roots rather than `navigatorBrowseStart` / `homeNote`.

---

## Navigator state reference (NavigatorView fields)

```ts
mode: NavMode                          // persisted
browserViewMode: 'bc' | 'files'        // NOT persisted, defaults to 'bc'
browserStack: TFile[]                  // empty = vault roots view
browserRootFolder: string | null       // scopes BC roots to a folder
folderStack: string[]                  // file-system browser path stack
followMode: boolean                    // persisted as navigatorFollowMode
followTargets: TFile[]                 // set by followActiveFile(), reset on mode change
recentViewMode: 'global' | 'local'     // NOT persisted, defaults to 'global'
previewExpanded: boolean               // persisted as navigatorPreviewExpanded
filterActive: boolean                  // NOT persisted
filterQuery: string                    // NOT persisted
```

---

## BC graph query pattern

Always query **both** outgoing `up` edges and incoming `down` edges when looking
for parent/child relationships — users can express the same relationship from
either note:

```ts
// Finding UP parents of `file`:
for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
  if (e.edge_type?.toLowerCase() !== 'up') continue;
  const path = e.target_path?.(bc.graph) ?? e.target;
  // ...
}
for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
  if (e.edge_type?.toLowerCase() !== 'down') continue;
  const path = e.source_path?.(bc.graph) ?? e.source;
  // ...
}
```

Always use `target_path?.(bc.graph) ?? e.target` (and `source_path?.(bc.graph) ??
e.source`) — the `_path` method resolves aliases; falling back to the raw string
handles BC versions that don't implement it.

---

## Homepage system

Three settings interact to make the homepage work:

| Setting | Purpose |
|---------|---------|
| `homepageNote` | Path/basename of the "homepage" note. If blank, auto-detects `cssclasses: homepage` in frontmatter. |
| `homepageTarget` | What to show in the browser when the active note is the homepage — a folder path or note path. |
| `homeNote` | Default start note for the browser/explorer when no homepage applies. |

Resolution helpers live in `src/homepageUtils.ts`:

- `resolveHomepageFile(app, settings)` → the homepage `TFile` or `null`
- `resolveHomepageTarget(app, settings)` → `{ kind: 'folder', path } | { kind: 'file', file } | null`
- `getHomepageTargetForFile(file, app, settings)` → target if `file` is the homepage, else `null`

`resolveHomepageTarget` will return `null` for an unrecognized string rather than
fabricating a folder path. Basename lookups require exactly one match (filter +
`length === 1`), not `find()`, to avoid non-deterministic results when multiple
notes share a name.

### Cache (`_homepageTargetCache` in NavigatorView)

`getHomepageTargetForFile` does an O(n) vault scan on the cssclasses path. The
cache avoids repeating this within one refresh cycle.

**The cache must be cleared in two places:**
1. `scheduleRefresh()` — eagerly, so any action that fires during the 80 ms
   debounce window sees fresh data
2. `computeNavData()` — at the start of the async render, to cover direct
   `refresh()` callers that bypass `scheduleRefresh`

---

## Exclusion logic — single source of truth in `utils.ts`

The logic for deciding whether a note is hidden from all BreadTrail UI surfaces
lives in one place:

```
isExcluded(file: TFile, app: App, settings: BreadTrailSettings)  →  src/utils.ts
```

All three consumers import it from there:
- `NavigatorView.ts` — sidebar
- `ExplorerModal.tsx` — tile explorer
- `FloatingNav.ts` — floating edge panels

When adding or changing an exclusion rule, update **only `utils.ts`**. The rules
checked are: `bread-trail.hidden: true` in frontmatter, `navigatorExcludeFiles`
exact path, `navigatorExcludeFolders` prefix, `navigatorExcludeFrontmatter`
patterns.

---

## Settings: always touch three places

When adding a new setting:

1. **Interface** — add to `BreadTrailSettings` in `settings.ts`
2. **Default** — add to `DEFAULT_SETTINGS`
3. **Normalization** — add to `normalizeSettings()` with a safe type-guard

`normalizeSettings` is the single entry point for all loaded data. Use an IIFE
inside it for migration from renamed/removed keys:

```ts
myNewSetting: (() => {
  if (settings.myNewSetting === 'valid-value') return 'valid-value';
  // Migrate from old key
  const legacy = (settings as { oldKey?: unknown }).oldKey;
  if (legacy === 'roots') return 'roots';
  return 'active-parent'; // safe default
})(),
```

`saveData(this.settings)` serializes the typed struct, so old keys not present
in the interface are silently dropped on first save — migration only needs to
read the old key in `normalizeSettings`, not clean it up.

---

## ExplorerModal constructor — parameter order

The constructor takes positional parameters (not an options object). As of 1.2.15:

```ts
new ExplorerModal(
  app,
  bc,
  tileMinWidth,       // settings.explorerTileMinWidth
  startMode,          // 'active-parent' | 'home' | 'roots'
  homeNote,           // settings.homeNote
  showFavorites,      // settings.navigatorHomeShowFavorites
  showRecents,        // settings.navigatorHomeShowRecents
  recentsCount,       // settings.navigatorHomeRecentsCount
  favoritePaths,      // settings.navigatorFavorites
  favoritesParentNote,// settings.navigatorFavoritesParentNote
  doubleTapToOpen,    // settings.explorerDoubleTapToOpen
  settings,           // full BreadTrailSettings object (position 12)
  onClosed,           // optional callback
  startFile,          // optional TFile | null override
  rootFolder,         // optional string
)
```

The call site is `openExplorerModal()` in `main.ts`.

---

## GridView and groups

`App.tsx` renders navigator content based on which data field is populated:

| Field | Layout |
|-------|--------|
| `sections` | Context mode — collapsible sections with sort headers |
| `browserItems` | Browser mode — folder rows + note cards |
| `groups` | Group-by mode — labelled groups (in grid mode, each group keeps its label + its own GridView) |
| `flatCards` | Recent/Favorites — flat card list or GridView |

When in grid layout with `groups`, render each group separately with a header
div — do not flatten with `flatMap`. Flattening silently drops group labels.

---

## `getBcAncestorChain` (main.ts)

Returns the full ancestor chain from oldest ancestor to immediate parent,
ordered for `slice(-depth)` use. It walks upward iteratively (max 20 hops)
via the first available `up`/`down` parent at each level. It does **not**
return all ancestors in a tree — it picks one parent per level, producing a
single linear chain.

Usage: `ancestors.slice(-depth)` where `depth = settings.headerBreadcrumbsDepth`
(`0` = show all).

---

## Basename uniqueness guard

When resolving a note by basename (user-supplied name without path), always
`filter` and require `length === 1`, not `find`:

```ts
// WRONG — picks first match non-deterministically:
const file = app.vault.getMarkdownFiles().find(f => f.basename === name);

// RIGHT — only use if unambiguous:
const matches = app.vault.getMarkdownFiles().filter(f => f.basename === name);
if (matches.length === 1) return matches[0];
return null; // ambiguous or missing — don't guess
```

---

## Release process

```bash
npm run build                      # must pass clean
npm version patch                  # bumps package.json, runs version-bump.mjs (manifest + versions), tags commit
git push --follow-tags             # push commit + tag → CI creates the GitHub release automatically
```

**Rules:**
- Always use `npm version <patch|minor|major>` — never run `node version-bump.mjs` directly (it reads `npm_package_version` which only exists when invoked via npm).
- The GitHub release is created by the tag-triggered CI workflow. Do not create it manually — you'll get a conflict.
- The release attaches `main.js` and `manifest.json`. `styles.css` is not present in this repo (no separate stylesheet); `fail_on_unmatched_files: false` in the workflow handles this gracefully.

---

## What code review won't catch

Standard diff review (reading changed hunks + callers) misses:

- **Startup state traps** — persisted setting A interacts with non-persisted
  state B on cold start. The bug is in neither diff.
- **Stale cache timing** — cache cleared in deferred path but not in sync path
  that fires during the debounce window.
- **Duplicated logic diverging** — exclusion logic in NavigatorView vs
  ExplorerModal updated in one place but not the other.
- **Bidirectional BC edge coverage** — new graph query that checks only
  outgoing edges and misses the incoming-edge case.
- **Basename collisions** — `find()` on basename is non-deterministic in vaults
  with duplicate note names; not visible in a diff unless you're auditing all
  vault lookups.

For any of these, a behavioral audit ("what happens if the user has X setting
and Y state when Z fires?") is needed in addition to diff review.
