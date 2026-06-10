/**
 * Pure browser-state initialization for the navigator sidebar.
 *
 * Extracted so the cold-start trap is unit-testable without Obsidian:
 *   - `initBrowserStackBcOnly` (cold-start) must NEVER change `browserViewMode`
 *   - A folder homeNote scopes the BC hierarchy, it does NOT switch to file-browser mode
 *
 * All functions work on path strings and receive injected resolver callbacks,
 * keeping them vault-independent. NavigatorView resolves paths → TFiles at the boundary.
 */

export type ResolvedEntry =
  | { kind: 'file';   path: string }
  | { kind: 'folder'; path: string };

export type BcBrowserState = {
  browserStack: string[];
  browserRootFolder: string | null;
};

/**
 * Compute the initial BC browser state for cold start (e.g. onOpen).
 *
 * Rules (highest priority first):
 * 1. homeNote resolves to a file       → show that file's children
 * 2. homeNote resolves to a folder     → scope BC hierarchy to that folder (roots view)
 * 3. homeNote matches a unique basename → same as case 1
 * 4. navigatorBrowseStart === 'roots'  → vault roots view
 * 5. active file exists                → show the active file's parent's children
 * 6. fallback                          → vault roots view
 *
 * NEVER sets browserViewMode — the caller is responsible for keeping
 * the persisted sub-mode unchanged on cold start.
 */
export function computeBcBrowserInit(opts: {
  homeNote: string;
  browseStart: 'active' | 'roots';
  resolveByPath: (path: string) => ResolvedEntry | null;
  resolveByBasename: (basename: string) => string | null;
  getParentPath: (filePath: string) => string | null;
  activePath: string | null;
}): BcBrowserState {
  const { homeNote, browseStart, resolveByPath, resolveByBasename, getParentPath, activePath } = opts;

  if (homeNote) {
    const resolved = resolveByPath(homeNote);
    if (resolved?.kind === 'file') {
      return { browserStack: [resolved.path], browserRootFolder: null };
    }
    if (resolved?.kind === 'folder') {
      const rootFolder = resolved.path === '/' || resolved.path === '' ? null : resolved.path;
      return { browserStack: [], browserRootFolder: rootFolder };
    }
    // Basename fallback — only when unambiguous
    const uniquePath = resolveByBasename(homeNote);
    if (uniquePath) {
      return { browserStack: [uniquePath], browserRootFolder: null };
    }
  }

  if (browseStart === 'roots') {
    return { browserStack: [], browserRootFolder: null };
  }

  if (activePath) {
    const container = getParentPath(activePath) ?? activePath;
    return { browserStack: [container], browserRootFolder: null };
  }

  return { browserStack: [], browserRootFolder: null };
}
