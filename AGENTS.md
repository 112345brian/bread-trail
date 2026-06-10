# BreadTrail — Contributor Guide

> **Architecture, invariants, and gotchas are in [`DEVELOPMENT.md`](./DEVELOPMENT.md).**
> Read it before making changes — it documents patterns that code review won't catch.

## Quick start

```bash
npm install
npm run build    # type-check + bundle → main.js
npm test         # 17 unit tests (bcGraph + homepageRoots)
npm run lint     # ESLint with eslint-plugin-obsidianmd
```

## Dev loop

Copy `dev-config.json.example` → `dev-config.json` and set your vault path.
Then `npm run dev` watches for changes and copies `main.js` into your vault automatically.

## Release

```bash
npm run build
npm version patch          # bumps package.json/manifest.json/versions.json, commits, tags
git push --follow-tags     # CI picks up the tag and creates the GitHub release
```

Never run `node version-bump.mjs` directly — it requires `npm_package_version` to be set by npm.

## Project layout

| Path | Role |
|---|---|
| `src/main.ts` | Plugin lifecycle, commands, header breadcrumbs |
| `src/NavigatorView.ts` | Sidebar panel — all navigator state and actions |
| `src/bcGraph.ts` | Canonical BC graph adapter (single source of truth for edge queries) |
| `src/settings.ts` | Settings interface, defaults, `normalizeSettings` |
| `src/SettingsTab.ts` | Settings UI (`BreadTrailSettingTab`) |
| `src/navigator/` | Preact components for the sidebar |
| `src/ExplorerModal.tsx` | Tile-grid explorer modal |
| `src/FloatingNav.ts` | Hover edge panels |
| `src/GraphSwitcher.ts` | Visual graph modal |
| `src/Sequencer.ts` | prev/next chain auto-writing |
| `src/homepageRoots.ts` | Pure root-inclusion logic (tested) |
| `src/bcGraph.ts` | BC graph helpers (tested) |
| `src/utils.ts` | Shared helpers (`isExcluded`, etc.) |

## CI

Every push runs lint + `tsc -noEmit` + `npm test` via `.github/workflows/ci.yml`.
The tag-triggered `.github/workflows/release.yml` creates the GitHub release.
