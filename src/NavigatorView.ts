import { render, h } from 'preact';
import { ItemView, Menu, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import type {
  NavData, NavMode, NavRelation, NavActions,
  CardData, SectionData, GroupData, BrowserItem,
  SortMode, ToolbarData,
} from './navigator/types';
import { NavigatorApp } from './navigator/App';
import { extractContentSnippet, extractFirstImageLink, formatDateValue, startsWithBaseTransclusion } from './utils';

export const NAVIGATOR_VIEW_TYPE = 'bread-trail-navigator';

// ── Internal types ────────────────────────────────────────────────────────────

interface SortState {
  mode: SortMode;
  cycle: SortMode[];
}

interface NavNote {
  file: TFile;
  relation: NavRelation;
  seqPos?: number;
  seqTotal?: number;
}

// ── View ──────────────────────────────────────────────────────────────────────

export class NavigatorView extends ItemView {
  /** Raw content snippets (post-frontmatter lines) keyed by file path. */
  private snippetCache = new Map<string, string>();
  /** First image link found in each file, null if none. */
  private imageCache = new Map<string, string | null>();
  private refreshTimer?: number;
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

  // Recent sub-mode: 'global' = all vault, 'local' = siblings of active note
  private recentViewMode: 'global' | 'local' = 'global';

  // Per-section independent sort states
  private sorts = new Map<string, SortState>();

  // Collapsed section IDs
  private collapsedSections = new Set<string>();

  // Track the last context-mode file so we can reset child sort when it changes
  private lastContextFilePath: string | null = null;

  // Follow mode: auto-navigate to the active file's BC parent when it changes
  private followMode = false;
  // When follow mode navigates, these are all the UP parents of the active file
  // (merged children view). Empty = normal browser mode.
  private followTargets: TFile[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private settings: BreadTrailSettings,
    private getBc: () => BreadcrumbsPlugin | null,
    private saveSettings: () => Promise<void>,
  ) {
    super(leaf);
    this.mode = settings.navigatorMode;
    this.previewExpanded = settings.navigatorPreviewExpanded;
  }

  getViewType()    { return NAVIGATOR_VIEW_TYPE; }
  getDisplayText() { return 'BreadTrail'; }
  getIcon()        { return 'footprints'; }

  async onOpen() {
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

  scheduleRefresh(delay = 80) {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { void this.refresh(); }, delay);
  }

  // ── Render entry ───────────────────────────────────────────────────────────

  async refresh() {
    const data = await this.computeNavData();
    const actions = this.buildActions();
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
    const seen = new Set<string>([file.path]);
    const parents: TFile[] = [];
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'up') continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) { seen.add(path); parents.push(f); }
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'down') continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) { seen.add(path); parents.push(f); }
    }

    if (parents.length > 0) {
      this.followTargets = parents;
      this.browserViewMode = 'bc';
      if (this.mode !== 'browser') this.applyMode('browser');
      else this.scheduleRefresh();
    } else {
      this.scheduleRefresh();
    }
  }

  // ── Data computation ───────────────────────────────────────────────────────

  private async computeNavData(): Promise<NavData> {
    const bc = this.getBc();
    const activeFile = this.app.workspace.getActiveFile();
    const toolbar = this.computeToolbarData(activeFile, bc);

    if (this.mode === 'recent') {
      const content = await this.computeRecentData(activeFile, bc);
      return { toolbar, mode: this.mode, ...content };
    }
    if (this.mode === 'favorites') {
      const content = await this.computeFavoritesData(activeFile);
      return { toolbar, mode: this.mode, ...content };
    }
    if (!bc) {
      return { toolbar, mode: this.mode, sections: [], emptyMessage: 'Breadcrumbs plugin not detected.' };
    }
    if (this.mode === 'browser') {
      if (this.browserViewMode === 'files') {
        const content = await this.computeFileBrowserData(activeFile);
        return { toolbar, mode: this.mode, ...content };
      } else {
        const content = await this.computeBrowserData(bc, activeFile);
        return { toolbar, mode: this.mode, ...content };
      }
    }
    // context mode
    const content = await this.computeContextData(bc, activeFile);
    return { toolbar, mode: this.mode, ...content };
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
          : isRootsView ? 'Vault' : (currentFolder ? this.getLabel(currentFolder) : '');
        const canGoUp = !isRootsView && (
          this.browserStack.length > 1 ||
          (currentFolder != null && bc != null && this.getFirstParentFile(currentFolder, bc) != null) ||
          this.settings.navigatorBrowseStart === 'roots'
        );
        browserCanGoBack = canGoUp;
        const cycle = this.getBrowserSortCycle();
        const sort = this.getSort('browser-child', cycle);
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
        reset: vis.reset,
        preview: vis.preview,
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
    };
  }

  private async computeContextData(
    bc: BreadcrumbsPlugin, activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'emptyMessage'>> {
    if (!activeFile || activeFile.extension !== 'md') {
      return { sections: [], emptyMessage: 'Open a note to see its context.' };
    }

    const { parents, chains, children } = this.buildNeighborhood(activeFile, bc);
    if (parents.length === 0 && chains.length === 0 && children.length === 0) {
      return { sections: [], emptyMessage: 'No breadcrumb relationships found.' };
    }

    // Reset child/parent sort when active file changes
    if (activeFile.path !== this.lastContextFilePath) {
      this.lastContextFilePath = activeFile.path;
      this.sorts.delete('child');
      this.sorts.delete('parent');
    }

    const sections: SectionData[] = [];

    if (parents.length > 0) {
      const sort = this.getSort('parent', ['alpha', 'alpha-desc', 'mtime', 'ctime']);
      const cards = await Promise.all(
        this.sortNotes(parents, sort).map((n) => this.buildCardData(n, activeFile, { hasDrillIn: true })),
      );
      sections.push({
        id: 'parent', label: 'Parents', icon: 'arrow-up', cards,
        isCollapsed: this.collapsedSections.has('parent'),
        sortMode: sort.mode, sortCycle: sort.cycle, isChain: false,
      });
    }

    for (const { path: chainPath, notes: chain } of chains) {
      const sectionId = `chain-${chainPath || 'default'}`;
      const total = chain[0]?.seqTotal ?? chain.length;
      const label = chainPath ? `Chain (${chainPath})  ·  ${total}` : `Chain  ·  ${total}`;
      const cards = await Promise.all(
        chain.map((n) => this.buildCardData(n, activeFile, { hasDrillIn: false })),
      );
      sections.push({
        id: sectionId, label, icon: 'list-ordered', cards,
        isCollapsed: this.collapsedSections.has(sectionId),
        sortMode: 'sequence', sortCycle: [], isChain: true,
      });
    }

    if (children.length > 0) {
      const cycle: SortMode[] = ['sequence', 'alpha', 'alpha-desc', 'mtime', 'ctime'];
      if (this.settings.navigatorSortField) cycle.push('field');
      const override = this.getChildSortOverride(activeFile);
      if (override) this.applyChildSortOverride('child', override, cycle);
      const sort = this.getSort('child', cycle);
      const sorted = this.sortNotes(children, sort);
      const groupBy = this.getChildGroupBy(activeFile);

      let cards: CardData[] = [];
      let groups: GroupData[] | undefined;

      if (groupBy) {
        groups = await Promise.all(
          this.groupNotes(sorted, groupBy).map(async ([groupLabel, groupNotes]) => ({
            label: groupLabel,
            cards: await Promise.all(
              groupNotes.map((n) => this.buildCardData(n, activeFile, { hasDrillIn: true })),
            ),
          })),
        );
      } else {
        cards = await Promise.all(
          sorted.map((n) => this.buildCardData(n, activeFile, { hasDrillIn: true })),
        );
      }

      sections.push({
        id: 'child', label: 'Children', icon: 'arrow-down', cards, groups,
        isCollapsed: this.collapsedSections.has('child'),
        sortMode: sort.mode, sortCycle: sort.cycle, isChain: false,
      });
    }

    return { sections };
  }

  private async computeBrowserData(
    bc: BreadcrumbsPlugin, activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'flatCards' | 'groups' | 'emptyMessage'>> {
    const cycle = this.getBrowserSortCycle();

    // Follow mode: show merged children of all UP parents of the active file
    if (this.followTargets.length > 0) {
      const seen = new Set<string>(this.followTargets.map((t) => t.path));
      const children: NavNote[] = [];
      for (const target of this.followTargets) {
        for (const e of bc.graph.get_outgoing_edges(target.path).to_array()) {
          if (e.edge_type?.toLowerCase() !== 'down') continue;
          const path = e.target_path?.(bc.graph) ?? e.target;
          if (!path || seen.has(path)) continue;
          const f = this.app.vault.getAbstractFileByPath(path);
          if (!(f instanceof TFile) || this.isExcluded(f)) continue;
          seen.add(path);
          children.push({ file: f, relation: 'child' });
        }
        for (const e of bc.graph.get_incoming_edges(target.path).to_array()) {
          if (e.edge_type?.toLowerCase() !== 'up') continue;
          const path = e.source_path?.(bc.graph) ?? e.source;
          if (!path || seen.has(path)) continue;
          const f = this.app.vault.getAbstractFileByPath(path);
          if (!(f instanceof TFile) || this.isExcluded(f)) continue;
          seen.add(path);
          children.push({ file: f, relation: 'child' });
        }
      }
      if (children.length === 0) return { sections: [], emptyMessage: 'No siblings found.' };
      const sort = this.getSort('browser-child', cycle);
      const flatCards = await Promise.all(
        this.sortNotes(children, sort).map((n) =>
          this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) }),
        ),
      );
      return { sections: [], flatCards };
    }

    // Roots view — stack is empty
    if (this.browserStack.length === 0) {
      const sort = this.getSort('browser-child', cycle);
      const roots = this.getVaultRoots(bc);
      if (roots.length === 0) {
        return { sections: [], emptyMessage: 'No top-level notes found. Add BC parent/child relationships to get started.' };
      }
      const notes: NavNote[] = roots.map((f) => ({ file: f, relation: 'child' as NavRelation }));
      const flatCards = await Promise.all(
        this.sortNotes(notes, sort).map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
      );
      return { sections: [], flatCards };
    }

    // Folder view
    const folder = this.browserStack[this.browserStack.length - 1]!;
    const children = this.getFolderChildren(folder, bc);
    if (children.length === 0) {
      return { sections: [], emptyMessage: 'Nothing here.' };
    }

    const override = this.getChildSortOverride(folder);
    if (override) this.applyChildSortOverride('browser-child', override, cycle);
    const sort = this.getSort('browser-child', cycle);
    const sorted = this.sortNotes(children, sort);
    const groupBy = this.getChildGroupBy(folder);

    if (groupBy) {
      const groups = await Promise.all(
        this.groupNotes(sorted, groupBy).map(async ([groupLabel, groupNotes]) => ({
          label: groupLabel,
          cards: await Promise.all(
            groupNotes.map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
          ),
        })),
      );
      return { sections: [], groups };
    }

    const flatCards = await Promise.all(
      sorted.map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
    );
    return { sections: [], flatCards };
  }

  private async computeFileBrowserData(
    activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'browserItems' | 'emptyMessage'>> {
    const currentPath = this.folderStack[this.folderStack.length - 1] ?? '';
    const folder = currentPath
      ? this.app.vault.getAbstractFileByPath(currentPath)
      : this.app.vault.getRoot();

    if (!(folder instanceof TFolder)) {
      return { sections: [], emptyMessage: 'Folder not found.' };
    }

    const children = [...folder.children].sort((a, b) => {
      const aIsFolder = a instanceof TFolder;
      const bIsFolder = b instanceof TFolder;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    if (children.length === 0) {
      return { sections: [], emptyMessage: 'Empty folder.' };
    }

    const browserItems: BrowserItem[] = [];
    for (const child of children) {
      if (child instanceof TFolder) {
        browserItems.push({ kind: 'folder', name: child.name, path: child.path });
      } else if (child instanceof TFile && child.extension === 'md') {
        const note: NavNote = { file: child, relation: 'child' };
        const cardData = await this.buildCardData(note, activeFile, { hasDrillIn: false });
        browserItems.push({ kind: 'card', data: cardData });
      }
    }

    return { sections: [], browserItems };
  }

  private async computeRecentData(
    activeFile: TFile | null, bc: BreadcrumbsPlugin | null,
  ): Promise<Pick<NavData, 'sections' | 'flatCards' | 'emptyMessage'>> {
    const sortField = this.settings.navigatorRecentSortField;
    const limit = this.settings.navigatorRecentLimit;

    let files = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));

    if (this.recentViewMode === 'local' && activeFile && bc) {
      const siblingPaths = this.getSiblingPaths(activeFile, bc);
      if (siblingPaths.size > 0) {
        files = files.filter((f) => siblingPaths.has(f.path));
      } else {
        return { sections: [], emptyMessage: 'No siblings found for the active note.' };
      }
    }

    if (sortField) {
      files.sort((a, b) => {
        const fa = this.getFmString(a, sortField) ?? '';
        const fb = this.getFmString(b, sortField) ?? '';
        if (!fa && !fb) return b.stat.mtime - a.stat.mtime;
        if (!fa) return 1;
        if (!fb) return -1;
        return fb.localeCompare(fa);
      });
    } else {
      files.sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    const shown = files.slice(0, limit);
    if (shown.length === 0) {
      return { sections: [], emptyMessage: 'No notes found.' };
    }

    const metaProps = this.settings.navigatorRecentMetaProperties;
    const flatCards = await Promise.all(
      shown.map((file) => this.buildCardData(
        { file, relation: 'child' },
        activeFile,
        { hasDrillIn: false, metaProps, autoTimestamp: true, sortField },
      )),
    );
    return { sections: [], flatCards };
  }

  private async computeFavoritesData(
    activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'flatCards' | 'emptyMessage'>> {
    const pinnedPaths = new Set(this.settings.navigatorFavorites);

    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      if (pinnedPaths.has(f.path)) return true;
      const bt = this.getBreadTrailFm(f);
      return bt?.['favorite'] === true;
    });

    files.sort((a, b) => {
      const aIdx = this.settings.navigatorFavorites.indexOf(a.path);
      const bIdx = this.settings.navigatorFavorites.indexOf(b.path);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.basename.localeCompare(b.basename);
    });

    if (files.length === 0) {
      return {
        sections: [],
        emptyMessage: 'No favorites yet. Add bread-trail.favorite: true to a note, or pin paths in settings.',
      };
    }

    const metaProps = this.settings.navigatorFavoritesMetaProperties;
    const flatCards = await Promise.all(
      files.map((file) => this.buildCardData({ file, relation: 'child' }, activeFile, { hasDrillIn: false, metaProps })),
    );
    return { sections: [], flatCards };
  }

  // ── Card data builder ──────────────────────────────────────────────────────

  private async buildCardData(
    note: NavNote,
    activeFile: TFile | null,
    options: {
      hasDrillIn: boolean;
      metaProps?: string[];
      autoTimestamp?: boolean;
      sortField?: string;
    },
  ): Promise<CardData> {
    const {
      hasDrillIn,
      metaProps = this.settings.navigatorMetaProperties,
      autoTimestamp,
      sortField,
    } = options;

    const meta: string[] = [];
    if (autoTimestamp && metaProps.length === 0) {
      const raw = sortField ? this.getFmString(note.file, sortField) : null;
      meta.push(raw ? formatDateValue(raw) : formatDateValue(note.file.stat.mtime));
    } else {
      for (const prop of metaProps) {
        const val = this.getFmString(note.file, prop);
        if (val) meta.push(formatDateValue(val));
      }
    }

    let snippet: string | undefined;
    let imageUrl: string | undefined;

    // bread-trail.no-preview: true — skip snippet/image for this specific note
    const noPreview = this.getBreadTrailFm(note.file)?.['no-preview'] === true;

    if (this.previewExpanded && !noPreview) {
      if (!this.snippetCache.has(note.file.path)) {
        try {
          const content = await this.app.vault.cachedRead(note.file);
          // Skip preview for notes that open with a Base or Dataview transclusion
          const skipBases = this.settings.navigatorSkipPreviewForBases
            && startsWithBaseTransclusion(content);
          this.snippetCache.set(note.file.path, skipBases ? '' : extractContentSnippet(content, this.settings.navigatorPreviewLines));
          this.imageCache.set(note.file.path, skipBases ? null : extractFirstImageLink(content));
        } catch {
          this.snippetCache.set(note.file.path, '');
          this.imageCache.set(note.file.path, null);
        }
      }
      const snippetText = this.snippetCache.get(note.file.path) ?? '';
      const imageLink = this.imageCache.get(note.file.path);
      if (imageLink && !snippetText.includes(imageLink)) {
        const imageFile = this.app.metadataCache.getFirstLinkpathDest(imageLink, note.file.path);
        if (imageFile instanceof TFile) {
          imageUrl = this.app.vault.getResourcePath(imageFile);
        }
      }
      if (snippetText) snippet = snippetText;
    }

    return {
      file: note.file,
      relation: note.relation,
      seqPos: note.seqPos,
      label: this.getLabel(note.file),
      meta,
      isActive: activeFile?.path === note.file.path,
      hasDrillIn,
      snippet,
      imageUrl,
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
          // Toggle bc ↔ files
          this.browserViewMode = this.browserViewMode === 'bc' ? 'files' : 'bc';
          if (this.browserViewMode === 'files') this.folderStack = [];
          void this.refresh();
        } else if (mode === 'recent' && this.mode === 'recent') {
          // Toggle global ↔ local
          this.recentViewMode = this.recentViewMode === 'global' ? 'local' : 'global';
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

      goToActive: () => {
        const bc = this.getBc();
        const file = this.app.workspace.getActiveFile();
        const atActive = this.mode === 'browser' && this.isBrowserAtActiveNote(file, bc);
        if (atActive) {
          this.initBrowserStack(file, bc);
        } else {
          if (file && bc) {
            const parent = this.getFirstParentFile(file, bc);
            this.browserStack = [parent ?? file];
          }
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

      browserBack: () => {
        const bc = this.getBc();
        if (this.browserViewMode === 'files') {
          this.folderStack.pop();
        } else {
          const currentFolder = this.browserStack[this.browserStack.length - 1];
          if (this.settings.navigatorBrowseStart === 'roots' && this.browserStack.length === 1) {
            this.browserStack = [];
          } else if (this.browserStack.length > 1) {
            this.browserStack.pop();
          } else if (bc && currentFolder) {
            const parent = this.getFirstParentFile(currentFolder, bc);
            if (parent) this.browserStack[0] = parent;
          }
        }
        void this.refresh();
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
        if (this.followMode) this.followActiveFile();
        else { this.followTargets = []; void this.refresh(); }
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

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

  private isBrowserAtActiveNote(activeFile: TFile | null, bc: BreadcrumbsPlugin | null): boolean {
    if (!activeFile || this.browserViewMode === 'files') return false;
    const currentTop = this.browserStack[this.browserStack.length - 1];
    if (!currentTop) return false;
    const target = (bc ? this.getFirstParentFile(activeFile, bc) : null) ?? activeFile;
    return currentTop.path === target.path;
  }

  private initBrowserStack(activeFile: TFile | null, bc: BreadcrumbsPlugin | null) {
    const start = this.settings.navigatorBrowseStart;
    if (start === 'roots') {
      this.browserStack = [];
      return;
    }
    if (start === 'note') {
      const notePath = this.settings.navigatorBrowseStartNote;
      if (notePath) {
        const f = this.app.vault.getAbstractFileByPath(notePath);
        if (f instanceof TFile) { this.browserStack = [f]; return; }
      }
    }
    if (activeFile && bc) {
      const parent = this.getFirstParentFile(activeFile, bc);
      this.browserStack = [parent ?? activeFile];
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
    const prop = this.settings.graphLabelProperty;
    if (!prop) return file.basename;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return file.basename;
    const val: unknown = fm[prop];
    if (Array.isArray(val)) {
      const first = val.find((v): v is string => typeof v === 'string' && v.trim().length > 0);
      return first?.trim() ?? file.basename;
    }
    if (typeof val === 'string' && val.trim()) return val.trim();
    return file.basename;
  }

  private getSort(sectionId: string, defaultCycle: SortMode[]): SortState {
    if (!this.sorts.has(sectionId)) {
      this.sorts.set(sectionId, { mode: defaultCycle[0] ?? 'alpha', cycle: defaultCycle });
    }
    return this.sorts.get(sectionId)!;
  }

  private cycleSortById(sectionId: string) {
    const s = this.sorts.get(sectionId);
    if (!s) return;
    const idx = s.cycle.indexOf(s.mode);
    s.mode = s.cycle[(idx + 1) % s.cycle.length] ?? s.cycle[0] ?? 'alpha';
    void this.refresh();
  }

  private sortNotes(notes: NavNote[], sort: SortState): NavNote[] {
    const field = this.settings.navigatorSortField;
    const sorted = [...notes];
    if (sort.mode === 'alpha') {
      sorted.sort((a, b) => this.getLabel(a.file).localeCompare(this.getLabel(b.file)));
    } else if (sort.mode === 'alpha-desc') {
      sorted.sort((a, b) => this.getLabel(b.file).localeCompare(this.getLabel(a.file)));
    } else if (sort.mode === 'field' && field) {
      sorted.sort((a, b) => {
        const fa = this.getFmString(a.file, field);
        const fb = this.getFmString(b.file, field);
        if (!fa && !fb) return 0;
        if (!fa) return 1;
        if (!fb) return -1;
        return fa.localeCompare(fb);
      });
    } else if (sort.mode === 'mtime') {
      sorted.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
    } else if (sort.mode === 'ctime') {
      sorted.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
    }
    // 'sequence' → leave in existing order
    return sorted;
  }

  private getFmString(file: TFile, key: string): string | null {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    const val: unknown = fm[key];
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val) && val.length > 0) return String(val[0]);
    return null;
  }

  // ── bread-trail frontmatter helpers ───────────────────────────────────────

  private getBreadTrailFm(file: TFile): Record<string, unknown> | null {
    const fm: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    const nested = typeof fm === 'object' && !Array.isArray(fm)
      ? (fm as Record<string, unknown>)['bread-trail']
      : undefined;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return null;
  }

  private parseSortMode(raw: unknown): SortMode | null {
    if (typeof raw !== 'string') return null;
    const MAP: Record<string, SortMode> = {
      sequence: 'sequence', chain: 'sequence',
      alpha: 'alpha', 'a-z': 'alpha', alphabetical: 'alpha',
      'alpha-desc': 'alpha-desc', 'z-a': 'alpha-desc',
      field: 'field',
      mtime: 'mtime', 'date-modified': 'mtime', modified: 'mtime',
      ctime: 'ctime', 'date-created': 'ctime', created: 'ctime',
    };
    return MAP[raw.toLowerCase()] ?? null;
  }

  private getChildSortOverride(file: TFile): SortMode | null {
    const bt = this.getBreadTrailFm(file);
    return this.parseSortMode(bt?.['sort'] ?? bt?.['children-sort'] ?? null);
  }

  private applyChildSortOverride(sectionId: string, override: SortMode, cycle: SortMode[]) {
    if (!this.sorts.has(sectionId)) {
      const reordered = [override, ...cycle.filter((m) => m !== override)];
      this.sorts.set(sectionId, { mode: override, cycle: reordered });
    }
  }

  private getChildGroupBy(file: TFile): string | null {
    const bt = this.getBreadTrailFm(file);
    const val = bt?.['group-by'];
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  }

  private normalizeGroupValue(val: string): string {
    return val.replace(/^\[\[(.+?)(?:\|[^\]]+)?\]\]$/, '$1').trim();
  }

  private groupNotes(notes: NavNote[], field: string): [string, NavNote[]][] {
    const NONE = '—';
    const normalize = this.settings.navigatorGroupByNormalizeLinks;
    const groups = new Map<string, NavNote[]>();
    for (const note of notes) {
      const raw = this.getFmString(note.file, field)?.trim() || NONE;
      const val = (normalize && raw !== NONE) ? this.normalizeGroupValue(raw) || raw : raw;
      if (!groups.has(val)) groups.set(val, []);
      groups.get(val)!.push(note);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === NONE) return 1;
      if (b === NONE) return -1;
      return a.localeCompare(b);
    });
  }

  // ── Chain traversal ────────────────────────────────────────────────────────

  private getChainPaths(file: TFile, bc: BreadcrumbsPlugin): string[] {
    const paths = new Set<string>();
    const checkEdgeType = (t: string | undefined) => {
      const lower = t?.toLowerCase() ?? '';
      if (lower === 'next' || lower === 'prev') {
        paths.add('');
      } else if (lower.startsWith('next.') || lower.startsWith('prev.')) {
        paths.add(lower.split('.').slice(1).join('.'));
      }
    };
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) checkEdgeType(e.edge_type);
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) checkEdgeType(e.edge_type);
    return [...paths].sort();
  }

  private findPrevForPath(file: TFile, bc: BreadcrumbsPlugin, chainPath: string, seen: Set<string>): TFile | null {
    const nextType = chainPath ? `next.${chainPath}` : 'next';
    const prevType = chainPath ? `prev.${chainPath}` : 'prev';
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== prevType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  private findNextForPath(file: TFile, bc: BreadcrumbsPlugin, chainPath: string, seen: Set<string>): TFile | null {
    const nextType = chainPath ? `next.${chainPath}` : 'next';
    const prevType = chainPath ? `prev.${chainPath}` : 'prev';
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== prevType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  private findNextAny(file: TFile, bc: BreadcrumbsPlugin, withinPaths: Set<string>, seen: Set<string>): TFile | null {
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      const t = e.edge_type?.toLowerCase() ?? '';
      if (t !== 'next' && !t.startsWith('next.')) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path) || !withinPaths.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      const t = e.edge_type?.toLowerCase() ?? '';
      if (t !== 'prev' && !t.startsWith('prev.')) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path) || !withinPaths.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  private buildChainForPath(file: TFile, bc: BreadcrumbsPlugin, chainPath: string): NavNote[] {
    const before: TFile[] = [];
    const seenBack = new Set<string>([file.path]);
    let cur = file;
    while (true) {
      const prev = this.findPrevForPath(cur, bc, chainPath, seenBack);
      if (!prev) break;
      seenBack.add(prev.path);
      before.push(prev);
      cur = prev;
    }
    before.reverse();

    const after: TFile[] = [];
    const seenFwd = new Set<string>([...seenBack]);
    cur = file;
    while (true) {
      const next = this.findNextForPath(cur, bc, chainPath, seenFwd);
      if (!next) break;
      seenFwd.add(next.path);
      after.push(next);
      cur = next;
    }

    if (before.length === 0 && after.length === 0) return [];

    const total = before.length + 1 + after.length;
    const currentPos = before.length + 1;
    const chain: NavNote[] = [];
    before.forEach((f, i) => chain.push({ file: f, relation: 'previous', seqPos: i + 1, seqTotal: total }));
    chain.push({ file, relation: 'current', seqPos: currentPos, seqTotal: total });
    after.forEach((f, i) => chain.push({ file: f, relation: 'next', seqPos: currentPos + i + 1, seqTotal: total }));
    return chain;
  }

  // ── Neighborhood builder ───────────────────────────────────────────────────

  private buildNeighborhood(file: TFile, bc: BreadcrumbsPlugin): {
    parents: NavNote[];
    chains: Array<{ path: string; notes: NavNote[] }>;
    children: NavNote[];
  } {
    const chainPaths = this.getChainPaths(file, bc);
    const chains: Array<{ path: string; notes: NavNote[] }> = [];
    const chainFilePaths = new Set<string>();

    for (const chainPath of chainPaths) {
      const notes = this.buildChainForPath(file, bc, chainPath);
      if (notes.length > 0) {
        chains.push({ path: chainPath, notes });
        notes.forEach((n) => chainFilePaths.add(n.file.path));
      }
    }

    const seen = new Set<string>([file.path, ...chainFilePaths]);
    const parents: NavNote[] = [];
    const children: NavNote[] = [];

    const add = (path: string | undefined, arr: NavNote[], relation: NavRelation) => {
      if (!path || seen.has(path)) return;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return;
      if (this.isExcluded(f)) return;
      seen.add(path);
      arr.push({ file: f, relation });
    };

    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      const path = e.target_path?.(bc.graph) ?? e.target;
      const type = e.edge_type?.toLowerCase();
      if (type === 'up')   add(path, parents, 'parent');
      if (type === 'down') add(path, children, 'child');
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      const path = e.source_path?.(bc.graph) ?? e.source;
      const type = e.edge_type?.toLowerCase();
      if (type === 'up')   add(path, children, 'child');
      if (type === 'down') add(path, parents, 'parent');
    }

    return { parents, chains, children };
  }

  private getFolderChildren(folder: TFile, bc: BreadcrumbsPlugin): NavNote[] {
    const children: NavNote[] = [];
    const seen = new Set<string>([folder.path]);

    const add = (path: string | undefined) => {
      if (!path || seen.has(path)) return;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return;
      if (this.isExcluded(f)) return;
      seen.add(path);
      children.push({ file: f, relation: 'child' });
    };

    for (const e of bc.graph.get_outgoing_edges(folder.path).to_array()) {
      if (e.edge_type?.toLowerCase() === 'down') add(e.target_path?.(bc.graph) ?? e.target);
    }
    for (const e of bc.graph.get_incoming_edges(folder.path).to_array()) {
      if (e.edge_type?.toLowerCase() === 'up') add(e.source_path?.(bc.graph) ?? e.source);
    }

    this.assignSeqPositions(children, bc);
    return children;
  }

  private assignSeqPositions(children: NavNote[], bc: BreadcrumbsPlugin) {
    if (children.length === 0) return;
    const paths = new Set(children.map((c) => c.file.path));

    const hasPrevInList = (f: TFile): boolean => {
      for (const e of bc.graph.get_incoming_edges(f.path).to_array()) {
        const t = e.edge_type?.toLowerCase() ?? '';
        if (t !== 'next' && !t.startsWith('next.')) continue;
        const p = e.source_path?.(bc.graph) ?? e.source;
        if (p && paths.has(p)) return true;
      }
      for (const e of bc.graph.get_outgoing_edges(f.path).to_array()) {
        const t = e.edge_type?.toLowerCase() ?? '';
        if (t !== 'prev' && !t.startsWith('prev.')) continue;
        const p = e.target_path?.(bc.graph) ?? e.target;
        if (p && paths.has(p)) return true;
      }
      return false;
    };

    const start = children.find((c) => !hasPrevInList(c.file));
    if (!start) return;

    const ordered: TFile[] = [];
    const seen = new Set<string>();
    let cur: TFile = start.file;
    while (!seen.has(cur.path) && paths.has(cur.path)) {
      seen.add(cur.path);
      ordered.push(cur);
      const nxt = this.findNextAny(cur, bc, paths, seen);
      if (!nxt) break;
      cur = nxt;
    }

    if (ordered.length < 2) return;

    const total = ordered.length;
    ordered.forEach((f, i) => {
      const note = children.find((c) => c.file.path === f.path);
      if (note) { note.seqPos = i + 1; note.seqTotal = total; }
    });
  }

  private isExcluded(file: TFile): boolean {
    const bt = this.getBreadTrailFm(file);
    if (bt?.['hidden'] === true) return true;
    if (this.settings.navigatorExcludeFiles.includes(file.path)) return true;
    for (const folder of this.settings.navigatorExcludeFolders) {
      const prefix = folder.endsWith('/') ? folder : folder + '/';
      if (file.path.startsWith(prefix)) return true;
    }
    if (this.settings.navigatorExcludeFrontmatter.length > 0) {
      const fm: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm) {
        for (const pattern of this.settings.navigatorExcludeFrontmatter) {
          const frontmatter = typeof fm === 'object' && !Array.isArray(fm) ? fm as Record<string, unknown> : {};
          const colonIdx = pattern.indexOf(':');
          if (colonIdx === -1) {
            const val = frontmatter[pattern];
            if (val !== undefined && val !== null && val !== false && val !== '' && val !== 0) return true;
          } else {
            const key = pattern.slice(0, colonIdx).trim();
            const expected = pattern.slice(colonIdx + 1).trim();
            const val = frontmatter[key];
            if ((typeof val === 'string' || typeof val === 'number') && String(val).trim() === expected) return true;
          }
        }
      }
    }
    return false;
  }

  private hasChildren(file: TFile, bc: BreadcrumbsPlugin): boolean {
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() === 'down') return true;
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() === 'up') return true;
    }
    return false;
  }

  private getVaultRoots(bc: BreadcrumbsPlugin): TFile[] {
    const roots: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isExcluded(file)) continue;
      if (!this.hasChildren(file, bc)) continue;
      const hasParent =
        bc.graph.get_outgoing_edges(file.path).to_array().some((e) => e.edge_type?.toLowerCase() === 'up') ||
        bc.graph.get_incoming_edges(file.path).to_array().some((e) => e.edge_type?.toLowerCase() === 'down');
      if (!hasParent) roots.push(file);
    }
    return roots.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  private getFirstParentFile(file: TFile, bc: BreadcrumbsPlugin): TFile | null {
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'up') continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'down') continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  private getSiblingPaths(file: TFile, bc: BreadcrumbsPlugin): Set<string> {
    const parentPaths = new Set<string>();
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'up') continue;
      const p = e.target_path?.(bc.graph) ?? e.target;
      if (p) parentPaths.add(p);
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'down') continue;
      const p = e.source_path?.(bc.graph) ?? e.source;
      if (p) parentPaths.add(p);
    }

    const siblings = new Set<string>();
    for (const parentPath of parentPaths) {
      for (const e of bc.graph.get_outgoing_edges(parentPath).to_array()) {
        if (e.edge_type?.toLowerCase() !== 'down') continue;
        const cp = e.target_path?.(bc.graph) ?? e.target;
        if (cp) siblings.add(cp);
      }
      for (const e of bc.graph.get_incoming_edges(parentPath).to_array()) {
        if (e.edge_type?.toLowerCase() !== 'up') continue;
        const cp = e.source_path?.(bc.graph) ?? e.source;
        if (cp) siblings.add(cp);
      }
    }
    return siblings;
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
