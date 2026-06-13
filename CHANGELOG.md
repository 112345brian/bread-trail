# Changelog

## [1.2.29] — 2026-06-13

- **Settings API (Obsidian 1.13+):** Convert `SettingsTab` to declarative `getSettingDefinitions()` — enables settings search and the new settings panel UI. Legacy `display()` kept as fallback for < 1.13.
- **Fix:** Exclusion fields (`Exclude folders`, `Exclude files`, `Exclude by frontmatter`) changed from textarea to single-line text controls — pressing Enter in a textarea was silently discarding entries since the split logic is comma-based.
- **Fix:** `render:` callbacks (Floating navigator, Pinboard) now use `group.listEl` as the container instead of `setting.settingEl.parentElement`, eliminating a DOM timing hazard where `parentElement` could be null.
- **Fix:** Numeric guards for `explorerTileMinWidth` (min 60) and `navigatorRecentLimit`/`navigatorHomeRecentsCount` (min 1) tightened to match the constraints in `normalizeSettings`.
- **Fix:** `getControlValue` now warns on unknown keys so definition typos surface immediately during development.
- **Fix:** Severity dropdown option order in legacy `display()` path corrected to `error, warning, off` for `missingReciprocal` and `crossHierarchy` rules — was inconsistent with the declarative path.
- **Deps:** `obsidian` package updated from 1.12.3 → 1.13.1.

## [1.2.28] — 2026-06-11

T7 — extract per-mode data computation to NavDataBuilder

## [1.2.27] — 2026-06-11

Default mobileAutoOpenSidebar to false

## [1.2.26] — 2026-06-11

Fix mobile edge strip and add auto-open sidebar toggle

## [1.2.25] — 2026-06-09

T3/T8/T9/T10 audit items — settings split, test coverage, cold-start extraction

## [1.2.24] — 2026-06-09

Repository audit: bcGraph adapter, CI, repo hygiene

## [1.2.23] — 2026-06-08

Correct multi-parent back navigation

## [1.2.22] — 2026-06-08

Multi-parent peer group view in BC browser

## [1.2.21] — 2026-06-08

Fix double-tap and long-press in tile explorer on mobile

## [1.2.20] — 2026-06-08

Fix folder homeNote always switching to file-system browser

## [1.2.19] — 2026-06-08

Fix browser cold-start regression from 1.2.18

## [1.2.18] — 2026-06-08

Behavioral audit fixes

## [1.2.14] — 2026-06-08

Vault roots as implicit parent of root-level notes

## [1.2.13] — 2026-06-07

Fix stale homepage cache after settings change

## [1.2.12] — 2026-06-07

Code-review fixes

## [1.2.11] — 2026-06-07

Codebase audit cleanup

## [1.2.10] — 2026-06-07

Miscellaneous fixes

## [1.2.9] — 2026-06-07

Miscellaneous fixes

## [1.2.8] — 2026-06-07

Miscellaneous fixes

## [1.2.7] — 2026-06-07

Remove pinboard custom label — section headers are always the default name

## [1.2.6] — 2026-06-07

Remove custom label property — always use file basename

## [1.2.5] — 2026-06-07

Fix: refresh navigator immediately when any setting is saved

## [1.2.4] — 2026-06-07

Home: accept folder path — switches to file-system browser at that folder

## [1.2.3] — 2026-06-07

Add unified home note — shared anchor for sidebar browser and explorer modal

## [1.2.2] — 2026-06-07

Grid: hide preview box when no image/snippet, compact card layout

## [1.2.1] — 2026-06-07

Fix mobile sidebar colors — use sidebar palette instead of primary/accent

## [1.2.0] — 2026-06-07

Fix strict TS errors in pinboard settings and filter bar ref callback

## [1.1.10] — 2026-06-06

Mobile auto-init, side setting, NN-style toolbar, pinch gesture

## [1.0.9] — 2026-06-06

Absolute-position toolbar on mobile — eliminates gap

## [1.0.8] — 2026-06-06

Remove gap between toolbar and Obsidian breadcrumb bar on mobile

## [1.0.7] — 2026-06-06

Remove toolbar padding-bottom on mobile

## [1.0.6] — 2026-06-06

Remove bottom padding from mobile toolbar

## [1.0.5] — 2026-06-06

Browser nav inline with action buttons on mobile

## [1.0.4] — 2026-06-06

Static toolbar height on mobile — no layout shift when switching modes

## [1.0.3] — 2026-06-06

Proper bottom tab bar for mobile navigator

## [1.0.2] — 2026-06-06

Mobile UX overhaul — gestures, tile explorer, toolbar

## [1.0.1] — 2026-06-06

Ribbon icon, mobile swipe-up gesture, mobile UI sizing

## [1.0.0] — 2026-06-05

BreadTrail rename, navigator overhaul, tile explorer, follow mode

## [0.5.0] — 2026-06-05

Render full prev/next chain in graph switcher and quick switcher

## [0.4.3] — 2026-06-05

Add global setting for sequence link write format

## [0.4.2] — 2026-06-05

Remove format config — auto-detect flat vs nested per note

## [0.4.1] — 2026-06-05

Support nested YAML form for sequence links

## [0.4.0] — 2026-06-05

Add auto-sequencing: link-children config, dry-run modal, auto mode

## [0.3.3] — 2026-06-05

Fix missing edges and reduce default child depth in graph switcher

## [0.3.2] — 2026-06-05

Remove selection-based node fading in graph switcher

## [0.3.1] — 2026-06-05

Fix graph node overlaps with post-layout collision resolution

## [0.3.0] — 2026-06-05

Cross-hierarchy sequence validation rule

## [0.2.9] — 2026-06-05

Smart rename fix when shared parent detected

## [0.2.8] — 2026-06-05

One-click fix for missing reciprocal links

## [0.2.7] — 2026-06-05

Fix validation modal not rendering list content

## [0.2.6] — 2026-06-05

Redesign validator with conflict-detection and configurable rules

## [0.2.5] — 2026-06-05

Frontmatter validator with inline warnings and vault report

## [0.2.4] — 2026-06-05

Named path tracks for sequence navigation

## [0.2.3] — 2026-06-02

Version bump

## [0.2.2] — 2026-06-01

Version bump

## [0.2.1] — 2026-06-01

Version bump

## [0.2.0] — 2026-06-01

Initial public release
