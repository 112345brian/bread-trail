import { render, h } from 'preact';
import { ItemView, Menu, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import type {
  NavData, NavMode, NavActions,
  CardData, SortMode, ToolbarData, SortState,
} from './navigator/types';
import { NavDataBuilder } from './navigator/NavDataBuilder';
import type { NavBuildCtx } from './navigator/NavDataBuilder';
import { NavigatorApp } from './navigator/App';
import { getHomepageTargetForFile } from './homepageUtils';
import type { HomepageTarget } from './homepageUtils';
import { getParentPaths } from './bcGraph';
import { computeBcBrowserInit } from './navigator/browserInit';

export const NAVIGATOR_VIEW_TYPE = 'bread-trail-navigator';

// ── View ──────────────────────────────────────────────────────────────────────

export class NavigatorView extends ItemView {
  /** Raw content snippets (post-frontmatter lines) keyed by file path. */
  private snippetCache = new Map<string, string>();
  /** First image link found in each file, null if none. */
  private imageCache = new Map<string, string | null>();
  /** Last fully-computed NavData — rendered immediately on the next refresh so
   *  the panel never shows a blank flash while the async computation runs. */
  private navDataCache: NavData | null = null;
  private refreshTimer?: number;
  /** Whether the filter bar is visible. */
  private filterActive = false;
  /** Current filter string (empty = no filter). */
  private filterQuery = '';
  /** When false, cards show only title + metadata — no excerpts or images. */
  private previewExpanded: boolean;

  // Mode
  private mode: NavMode;

  // Browser state
  private browserStack: TFile[] = [];
  // 'bc' = breadcrumb hierarchy, 'files' = real folder structure
  private browserViewMode: 'bc' | 'files' = 'bc';
  // Folder path stack for file-system browser ('' = vault root)
  private folderStack: string[] = [];
  // When set, BC root view is scoped to this vault folder.
  private browserRootFolder: string | null = null;

  // Per-file cache for homepage target — avoids O(n) vault scan on every
  // toolbar render. Cleared at the start of each refresh cycle.
  private _homepageTargetCache: { path: string | null; result: HomepageTarget | null } | null = null;

  // Recent sub-mode: 'global' = all vault, 'local' = siblings of active note
  private recentViewMode: 'global' | 'local' = 'global';

  // Per-section independent sort states
  private sorts = new Map<string, SortState>();

  // Collapsed section IDs
  private collapsedSections = new Set<string>();

  // Follow mode: auto-navigate to the active file's BC parent when it changes
  private followMode = false;
  // When follow mode navigates, these are all the UP parents of the active file
  // (merged children view). Empty = normal browser mode.
  private followTargets: TFile[] = [];

  private dataBuilder!: NavDataBuilder;

  constructor(
    leaf: WorkspaceLeaf,
    private settings: BreadTrailSettings,
    private getBc: () => BreadcrumbsPlugin | null,
    private saveSettings: () => Promise<void>,
  ) {
    super(leaf);
    this.mode = settings.navigatorMode;
    this.previewExpanded = settings.navigatorPreviewExpanded;
    this.followMode = settings.navigatorFollowMode;
    const ctx: NavBuildCtx = {
      app: this.app,
      getSettings: () => this.settings,
      getBc: () => this.getBc(),
      sorts: this.sorts,
      collapsedSections: this.collapsedSections,
      snippetCache: this.snippetCache,
      imageCache: this.imageCache,
      getPreviewExpanded: () => this.previewExpanded,
      getBrowserStack: () => this.browserStack,
      getBrowserRootFolder: () => this.browserRootFolder,
      getFolderStack: () => this.folderStack,
      getFollowTargets: () => this.followTargets,
      getRecentViewMode: () => this.recentViewMode,
    };
    this.dataBuilder = new NavDataBuilder(ctx);
  }

  getViewType()    { return NAVIGATOR_VIEW_TYPE; }
  getDisplayText() { return 'Breadtrail'; }
  getIcon()        { return 'footprints'; }

  async onOpen() {
    // If the navigator was persisted in browser mode, seed the BC browser stack
    // so cold-start respects homeNote / navigatorBrowseStart.
    // IMPORTANT: sub-mode (browserViewMode) is NOT persisted and must always
    // reset to 'bc' on cold start — never call initBrowserStack() here because
    // it can switch to 'files' mode when homeNote is a folder path.
    if (this.mode === 'browser') {
      this.initBrowserStackBcOnly(this.app.workspace.getActiveFile(), this.getBc());
    }

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        if (this.followMode) this.followActiveFile();
        else this.scheduleRefresh();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on('changed', (changed) => {
        const cur = this.app.workspace.getActiveFile();
        if (cur && this.isNeighbor(changed, cur)) {
          this.snippetCache.delete(changed.path);
          this.imageCache.delete(changed.path);
          this.scheduleRefresh();
        }
      }),
    );
    await this.refresh();
  }

  async onClose() {
    render(null, this.contentEl);
  }

  updateSettings(s: BreadTrailSettings) {
    this.settings = s;
  }

  clearSnippetCache() {
    this.snippetCache.clear();
    this.imageCache.clear();
    void this.refresh();
  }

  // ── Public action entry points (for command palette) ──────────────────────

  invokeGoToActive()        { this.buildActions().goToActive(); }
  invokeToggleFollowMode()  { this.buildActions().toggleFollowMode(); }
  invokeToggleFilter()      { this.buildActions().toggleFilter(); }

  scheduleRefresh(delay = 80) {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    // Invalidate the homepage-target cache eagerly so any action that fires
    // between now and the deferred refresh (e.g. goToActive click) sees
    // fresh data rather than the result computed for the old settings.
    this._homepageTargetCache = null;
    this.refreshTimer = window.setTimeout(() => { void this.refresh(); }, delay);
  }

  // ── Render entry ───────────────────────────────────────────────────────────

  async refresh() {
    const actions = this.buildActions();

    // Paint the last-known data immediately (stale-while-revalidate).
    // This eliminates the blank-panel flash on tab switches and active-file changes
    // since all the real data (graph edges, metadata, snippets) is in-memory anyway.
    if (this.navDataCache) {
      render(
        h(NavigatorApp, { data: this.navDataCache, actions, app: this.app, component: this }),
        this.contentEl,
      );
    }

    let data: NavData;
    try {
      data = await this.computeNavData();
    } catch (err) {
      console.error('[bread-trail] refresh failed:', err);
      return;
    }
    this.navDataCache = data;

    render(
      h(NavigatorApp, { data, actions, app: this.app, component: this }),
      this.contentEl,
    );
    // After Preact flushes, scroll the active card into view
    window.requestAnimationFrame(() => {
      this.contentEl
        .querySelector<HTMLElement>('.bread-trail-nav-card.is-active')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  /** When follow mode is on: collect ALL `up` parents of the active file and
   *  switch the browser to show a merged view of their children. */
  private followActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) { this.scheduleRefresh(); return; }

    if (this.mode === 'context') {
      this.scheduleRefresh();
      return;
    }

    const bc = this.getBc();
    if (!bc) { this.scheduleRefresh(); return; }

    // Collect all UP parents of the active file
    const parents = getParentPaths(bc.graph, file.path)
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile);

    if (parents.length > 0) {
      // File-system view is a user-chosen sub-mode that shows vault folders,
      // not the BC hierarchy — follow mode doesn't apply there. Skip the
      // override entirely and just refresh so the toolbar stays current.
      if (this.mode === 'browser' && this.browserViewMode === 'files') {
        this.scheduleRefresh();
        return;
      }
      this.followTargets = parents;
      this.browserViewMode = 'bc';
      if (this.mode !== 'browser') this.applyMode('browser');
      else this.scheduleRefresh();
    } else {
      this.scheduleRefresh();
    }
  }

  // ── Data computation ───────────────────────────────────────────────────────

  /** Cached wrapper around getHomepageTargetForFile. The cache is keyed by
   *  active file path and cleared at the start of every refresh cycle, so the
   *  O(n) cssclasses scan only fires once per refresh even if multiple callers
   *  (toolbar, initBrowserStack, goToActive) need the result in the same tick. */
  private getCachedHomepageTarget(file: TFile | null): HomepageTarget | null {
    const path = file?.path ?? null;
    if (this._homepageTargetCache?.path === path) return this._homepageTargetCache.result;
    const result = getHomepageTargetForFile(file, this.app, this.settings);
    this._homepageTargetCache = { path, result };
    return result;
  }

  private async computeNavData(): Promise<NavData> {
    this._homepageTargetCache = null;
    const bc = this.getBc();
    const activeFile = this.app.workspace.getActiveFile();
    const toolbar = this.computeToolbarData(activeFile, bc);
    const layoutMode = this.settings.navigatorLayoutMode;
    const filterQuery = this.filterQuery;

    let raw: Omit<NavData, 'toolbar' | 'mode' | 'layoutMode' | 'filterQuery'>;

    if (this.mode === 'recent') {
      raw = await this.dataBuilder.computeRecentData(activeFile, bc);
    } else if (this.mode === 'favorites') {
      raw = await this.dataBuilder.computePinboardData(activeFile);
    } else if (this.mode === 'browser' && this.browserViewMode === 'files') {
      raw = await this.dataBuilder.computeFileBrowserData(activeFile);
    } else if (!bc) {
      raw = { sections: [], emptyMessage: 'Breadcrumbs plugin not detected.' };
    } else if (this.mode === 'browser') {
      raw = await this.dataBuilder.computeBrowserData(bc, activeFile, this.getBrowserSortCycle());
    } else {
      raw = await this.dataBuilder.computeContextData(bc, activeFile);
    }

    const base: NavData = { toolbar, mode: this.mode, layoutMode, filterQuery, ...raw };
    return filterQuery.trim() ? this.applyFilter(base) : base;
  }

  /** Filter all card lists in a NavData by the current query string. */
  private applyFilter(data: NavData): NavData {
    const q = data.filterQuery.trim().toLowerCase();
    if (!q) return data;
    const match = (c: CardData) => c.label.toLowerCase().includes(q);

    const filteredSections = data.sections
      .map((s) => ({
        ...s,
        cards: s.cards.filter(match),
        groups: s.groups?.map((g) => ({ ...g, cards: g.cards.filter(match) })).filter((g) => g.cards.length > 0),
      }))
      .filter((s) => (s.groups ? s.groups.length > 0 : s.cards.length > 0));

    const filteredFlatCards = data.flatCards?.filter(match);
    const filteredGroups = data.groups
      ?.map((g) => ({ ...g, cards: g.cards.filter(match) }))
      .filter((g) => g.cards.length > 0);
    const filteredBrowserItems = data.browserItems?.filter(
      (item) => item.kind === 'folder' || match(item.data),
    );

    const isEmpty =
      filteredSections.length === 0 &&
      (!filteredFlatCards || filteredFlatCards.length === 0) &&
      (!filteredGroups || filteredGroups.length === 0) &&
      (!filteredBrowserItems || !filteredBrowserItems.some((i) => i.kind === 'card'));

    return {
      ...data,
      sections: filteredSections,
      flatCards: filteredFlatCards,
      groups: filteredGroups,
      browserItems: filteredBrowserItems,
      emptyMessage: isEmpty ? `No notes matching "${data.filterQuery}"` : data.emptyMessage,
    };
  }

  private computeToolbarData(activeFile: TFile | null, bc: BreadcrumbsPlugin | null): ToolbarData {
    const vis = this.settings.navigatorToolbarVisible;
    const isBrowser = this.mode === 'browser';

    let browserTitle = '';
    let browserIsRoots = false;
    let browserCanGoBack = false;
    let browserSortMode: SortMode = 'alpha';
    let browserSortCycle: SortMode[] = [];

    if (isBrowser) {
      if (this.browserViewMode === 'files') {
        const currentPath = this.folderStack[this.folderStack.length - 1] ?? '';
        browserIsRoots = this.folderStack.length === 0;
        browserTitle = browserIsRoots ? 'Vault' : (currentPath.split('/').pop() ?? currentPath);
        browserCanGoBack = !browserIsRoots;
        // No sort button in file browser
        browserSortCycle = [];
      } else {
        const isRootsView = this.browserStack.length === 0;
        const currentFolder = this.browserStack[this.browserStack.length - 1];
        browserIsRoots = isRootsView && this.followTargets.length === 0;
        browserTitle = this.followTargets.length > 0
          ? this.followTargets.map((t) => this.getLabel(t)).join(', ')
          : isRootsView ? (this.browserRootFolder ?? 'Vault') : (currentFolder ? this.getLabel(currentFolder) : '');
        // Vault roots is always reachable as the implicit parent of every
        // parentless note, so the back button is enabled whenever we're not
        // already at the roots view.
        const canGoUp = !isRootsView;
        browserCanGoBack = canGoUp;
        const cycle = this.getBrowserSortCycle();
        const sort = this.dataBuilder.getSort('browser-child', cycle);
        browserSortMode = sort.mode;
        browserSortCycle = cycle;
      }
    }

    const atActive = isBrowser && this.isBrowserAtActiveNote(activeFile, bc);

    return {
      mode: this.mode,
      vis: {
        context: vis.context,
        browse: vis.browse,
        recent: vis.recent,
        favorites: vis.favorites,
        goToActive: vis.goToActive,
      },
      previewExpanded: this.previewExpanded,
      atActive,
      recentViewMode: this.recentViewMode,
      browserViewMode: this.browserViewMode,
      browserTitle,
      browserIsRoots,
      browserCanGoBack,
      browserSortMode,
      browserSortCycle,
      followMode: this.followMode,
      layoutMode: this.settings.navigatorLayoutMode,
      filterActive: this.filterActive,
    };
  }

  // ── Actions factory ────────────────────────────────────────────────────────

  private buildActions(): NavActions {
    return {
      openFile: (file, newTab) => {
        const leaf = newTab
          ? this.app.workspace.getLeaf('tab')
          : (this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf());
        void leaf.openFile(file);
      },

      drillIn: (file) => {
        this.followTargets = [];
        this.browserStack.push(file);
        void this.refresh();
      },

      setMode: (mode) => {
        if (mode === 'browser' && this.mode === 'browser') {
          // Pressing browse while already in browser toggles between file-system
          // and BC hierarchy views. The crosshair/goToActive button handles reset.
          this.browserViewMode = this.browserViewMode === 'bc' ? 'files' : 'bc';
          if (this.browserViewMode === 'files') {
            this.folderStack = [];
          } else {
            this.followTargets = [];
          }
          void this.refresh();
        } else if (mode === 'recent' && this.mode === 'recent') {
          // Pressing Recent while already in recent: return to global view.
          // Local (siblings) view is toggled via the more-options menu.
          this.recentViewMode = 'global';
          void this.refresh();
        } else {
          if (mode === 'browser') {
            const bc = this.getBc();
            const activeFile = this.app.workspace.getActiveFile();
            this.browserViewMode = 'bc';
            this.initBrowserStack(activeFile, bc);
          } else if (mode === 'recent') {
            this.recentViewMode = 'global';
          }
          this.applyMode(mode);
        }
      },

      toggleFileBrowser: () => {
        if (this.mode !== 'browser') return;
        this.browserViewMode = this.browserViewMode === 'bc' ? 'files' : 'bc';
        if (this.browserViewMode === 'files') {
          this.folderStack = [];
        } else {
          // Returning to BC view — discard any follow targets that accumulated
          // while the user was browsing the file system.
          this.followTargets = [];
        }
        void this.refresh();
      },

      toggleRecentLocal: () => {
        if (this.mode !== 'recent') return;
        this.recentViewMode = this.recentViewMode === 'global' ? 'local' : 'global';
        void this.refresh();
      },

      goToActive: () => {
        const bc = this.getBc();
        const file = this.app.workspace.getActiveFile();
        // Hoist so isBrowserAtActiveNote and initBrowserStack share one result
        const homepageTarget = this.getCachedHomepageTarget(file);
        const atActive = this.mode === 'browser' && this.isBrowserAtActiveNote(file, bc, homepageTarget);
        if (atActive || homepageTarget) {
          this.initBrowserStack(file, bc, homepageTarget);
        } else if (file && bc) {
          this.browserRootFolder = null;
          this.browserStack = [this.getBrowserContainerForActiveFile(file, bc)];
        }
        if (this.mode !== 'browser') this.applyMode('browser');
        else void this.refresh();
      },

      togglePreview: () => {
        this.previewExpanded = !this.previewExpanded;
        this.settings.navigatorPreviewExpanded = this.previewExpanded;
        void this.saveSettings();
        void this.refresh();
      },

      cycleSort: (sectionId) => {
        this.cycleSortById(sectionId);
      },

      toggleCollapse: (sectionId) => {
        if (this.collapsedSections.has(sectionId)) {
          this.collapsedSections.delete(sectionId);
        } else {
          this.collapsedSections.add(sectionId);
        }
        void this.refresh();
      },

      browserBack: (e: MouseEvent) => {
        const bc = this.getBc();
        if (this.browserViewMode === 'files') {
          this.folderStack.pop();
          void this.refresh();
          return;
        }

        const currentFolder = this.browserStack[this.browserStack.length - 1];

        // If we have a known navigation history, just pop it
        if (this.browserStack.length > 1) {
          this.browserStack.pop();
          void this.refresh();
          return;
        }

        // Going up from a single-item stack to roots
        if ((this.browserRootFolder !== null || this.settings.navigatorBrowseStart === 'roots') && this.browserStack.length === 1) {
          this.browserStack = [];
          void this.refresh();
          return;
        }

        if (bc && currentFolder) {
          const parents = this.dataBuilder.getAllParentFiles(currentFolder, bc);
          if (parents.length === 0) {
            // No parents — root note, go to vault roots
            this.browserStack = [];
            void this.refresh();
          } else if (parents.length === 1) {
            // Single parent — navigate into it (show its children)
            this.browserStack[0] = parents[0]!;
            this.followTargets = [];
            void this.refresh();
          } else {
            // Multiple parents — show the merged children of all parents so the
            // user sees the current note in context with siblings from every hierarchy.
            // Re-uses the followTargets mechanism (same as follow mode).
            this.followTargets = parents;
            this.browserStack = [];
            void this.refresh();
          }
        } else {
          this.browserStack = [];
          void this.refresh();
        }
      },

      browserCycleSort: () => {
        this.cycleSortById('browser-child');
      },

      showContextMenu: (file, e) => {
        const menu = new Menu();
        this.app.workspace.trigger('file-menu', menu, file, 'bread-trail-navigator', this.leaf);
        this.addBreadbakeMenuItem(menu, file);
        menu.showAtMouseEvent(e);
      },

      navigateFolder: (path) => {
        this.folderStack.push(path);
        void this.refresh();
      },

      toggleFollowMode: () => {
        this.followMode = !this.followMode;
        this.settings.navigatorFollowMode = this.followMode;
        void this.saveSettings();
        if (this.followMode) this.followActiveFile();
        else { this.followTargets = []; void this.refresh(); }
      },

      setLayoutMode: (mode) => {
        this.settings.navigatorLayoutMode = mode;
        void this.saveSettings();
        void this.refresh();
      },

      setBrowserSortMode: (mode) => {
        const cycle = this.getBrowserSortCycle();
        const reordered = [mode, ...cycle.filter((m) => m !== mode)];
        this.sorts.set('browser-child', { mode, cycle: reordered });
        void this.refresh();
      },

      createNote: () => {
        void this.tryCreateNote('');
      },

      createChildNote: () => {
        const activeFile = this.app.workspace.getActiveFile();
        const upLink = activeFile ? `"[[${activeFile.basename}]]"` : '';
        void this.tryCreateNote(upLink ? `---\nup: ${upLink}\n---\n\n` : '');
      },

      toggleFilter: () => {
        this.filterActive = !this.filterActive;
        if (!this.filterActive) this.filterQuery = '';
        void this.refresh();
      },

      setFilter: (query: string) => {
        this.filterQuery = query;
        this.scheduleRefresh(16);
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async tryCreateNote(initialContent: string): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const folderPath = activeFile?.parent?.path ?? '';
    const baseName = 'Untitled';

    const attempt = async (name: string): Promise<void> => {
      const path = folderPath ? `${folderPath}/${name}.md` : `${name}.md`;
      try {
        const newFile = await this.app.vault.create(path, initialContent);
        await (this.app.workspace.getLeaf('tab')).openFile(newFile);
      } catch {
        let i = 1;
        while (i < 100) {
          const p = folderPath ? `${folderPath}/${name} ${i}.md` : `${name} ${i}.md`;
          try {
            const newFile = await this.app.vault.create(p, initialContent);
            await (this.app.workspace.getLeaf('tab')).openFile(newFile);
            return;
          } catch { i++; }
        }
      }
    };

    await attempt(baseName);
  }

  private applyMode(mode: NavMode) {
    this.mode = mode;
    this.settings.navigatorMode = mode;
    void this.saveSettings();
    void this.refresh();
  }

  private getBrowserSortCycle(): SortMode[] {
    const cycle: SortMode[] = ['alpha', 'alpha-desc', 'sequence', 'mtime', 'ctime'];
    if (this.settings.navigatorSortField) cycle.push('field');
    return cycle;
  }

  private isBrowserAtActiveNote(
    activeFile: TFile | null,
    bc: BreadcrumbsPlugin | null,
    homepageTarget = this.getCachedHomepageTarget(activeFile),
  ): boolean {
    if (!activeFile || this.browserViewMode === 'files') return false;
    if (homepageTarget?.kind === 'folder') {
      return this.browserStack.length === 0 && this.browserRootFolder === homepageTarget.path;
    }
    if (homepageTarget?.kind === 'file') {
      const currentTop = this.browserStack[this.browserStack.length - 1];
      return currentTop?.path === homepageTarget.file.path;
    }
    const currentTop = this.browserStack[this.browserStack.length - 1];
    if (!currentTop) return false;
    const target = this.getBrowserContainerForActiveFile(activeFile, bc);
    return currentTop.path === target.path;
  }

  private getBrowserContainerForActiveFile(activeFile: TFile, bc: BreadcrumbsPlugin | null): TFile {
    return (bc ? this.dataBuilder.getFirstParentFile(activeFile, bc) : null) ?? activeFile;
  }

  /**
   * Cold-start-safe initialiser: seeds `browserStack` and `browserRootFolder`
   * for BC hierarchy mode. Never touches `browserViewMode` — sub-mode is not
   * persisted and must always reset to 'bc' on cold start.
   */
  private initBrowserStackBcOnly(activeFile: TFile | null, bc: BreadcrumbsPlugin | null) {
    const state = computeBcBrowserInit({
      homeNote: this.settings.homeNote,
      browseStart: this.settings.navigatorBrowseStart,
      resolveByPath: (p) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) return { kind: 'file', path: f.path };
        if (f instanceof TFolder) return { kind: 'folder', path: f.path };
        return null;
      },
      resolveByBasename: (basename) => {
        const matches = this.app.vault.getMarkdownFiles().filter((x) => x.basename === basename);
        return matches.length === 1 ? (matches[0]!.path) : null;
      },
      getParentPath: (p) => {
        if (!bc) return null;
        const parents = getParentPaths(bc.graph, p);
        return parents.length > 0 ? (parents[0]!) : null;
      },
      // Pass null when bc unavailable — falls through to empty-stack fallback
      activePath: (activeFile && bc) ? activeFile.path : null,
    });
    this.browserRootFolder = state.browserRootFolder;
    this.browserStack = state.browserStack
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile);
  }

  private initBrowserStack(
    activeFile: TFile | null,
    bc: BreadcrumbsPlugin | null,
    homepageTarget = this.getCachedHomepageTarget(activeFile),
  ) {
    if (homepageTarget?.kind === 'folder') {
      this.browserViewMode = 'bc';
      this.browserRootFolder = homepageTarget.path;
      this.browserStack = [];
      return;
    }
    if (homepageTarget?.kind === 'file') {
      this.browserViewMode = 'bc';
      this.browserRootFolder = null;
      this.browserStack = [homepageTarget.file];
      return;
    }

    this.browserRootFolder = null;
    // Unified home path takes top priority — accepts a folder OR a note
    const homePath = this.settings.homeNote;
    if (homePath) {
      const resolved = this.app.vault.getAbstractFileByPath(homePath) ??
        this.app.vault.getAbstractFileByPath(homePath.replace(/\/?$/, '')) ??
        null;
      if (resolved instanceof TFolder) {
        // Folder home: BC browser scoped to this folder (shows parentless notes within it)
        this.browserViewMode = 'bc';
        this.browserRootFolder = resolved.path === '/' || resolved.path === '' ? null : resolved.path;
        this.browserStack = [];
        return;
      }
      if (resolved instanceof TFile) {
        // Note home: BC browser starting at that note
        this.browserStack = [resolved];
        return;
      }
      // Fallback: try basename match for notes (only if unambiguous)
      const byName = this.app.vault.getMarkdownFiles().filter((x) => x.basename === homePath);
      if (byName.length === 1) { this.browserStack = [byName[0]!]; return; }
    }
    if (this.settings.navigatorBrowseStart === 'roots') {
      this.browserStack = [];
      return;
    }
    if (activeFile && bc) {
      this.browserStack = [this.getBrowserContainerForActiveFile(activeFile, bc)];
    }
  }

  private isNeighbor(candidate: TFile, current: TFile): boolean {
    if (candidate.path === current.path) return true;
    const bc = this.getBc();
    if (!bc) return false;
    for (const e of bc.graph.get_outgoing_edges(current.path).to_array()) {
      if ((e.target_path?.(bc.graph) ?? e.target) === candidate.path) return true;
    }
    for (const e of bc.graph.get_incoming_edges(current.path).to_array()) {
      if ((e.source_path?.(bc.graph) ?? e.source) === candidate.path) return true;
    }
    return false;
  }

  private getLabel(file: TFile): string {
    return file.basename;
  }

  private cycleSortById(sectionId: string) {
    const s = this.sorts.get(sectionId);
    if (!s) return;
    const idx = s.cycle.indexOf(s.mode);
    s.mode = s.cycle[(idx + 1) % s.cycle.length] ?? s.cycle[0] ?? 'alpha';
    void this.refresh();
  }

  /** Add a Bake item to a menu if the Breadbake plugin is loaded. */
  private addBreadbakeMenuItem(menu: Menu, file: TFile): void {
    const plugins = (this.app as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
    const breadbake = plugins?.plugins?.['breadbake'];
    if (!breadbake) return;

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle('Bake note')
        .setIcon('flame')
        .onClick(async () => {
          const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
          await leaf.openFile(file);
          (this.app as { commands?: { executeCommandById(id: string): void } })
            .commands?.executeCommandById('breadbake:bake-active-file');
        });
    });
  }
}
