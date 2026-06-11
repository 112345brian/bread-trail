/**
 * NavDataBuilder — pure data-computation layer for the navigator sidebar.
 *
 * NavigatorView holds view state and handles lifecycle + actions.
 * NavDataBuilder holds no view state of its own; it reads everything via the
 * NavBuildCtx interface injected at construction time.  Because sorts, caches,
 * and collapsedSections are passed by reference, mutations made here are
 * reflected in NavigatorView without any explicit sync step.
 */

import { App, TFile, TFolder } from 'obsidian';
import type { CachedMetadata } from 'obsidian';
import type { BreadcrumbsPlugin } from '../main';
import type { BreadTrailSettings } from '../settings';
import type {
  NavNote, CardData, SectionData, GroupData, BrowserItem,
  NavData, SortMode, SortState,
} from './types';
import { isExcluded, formatDateValue, extractContentSnippet, extractFirstImageLink, startsWithBaseTransclusion } from '../utils';
import { shouldIncludeVaultRoot } from '../homepageRoots';
import { isDirectChild, getParentPaths, getChildPaths, hasParent as bcHasParent, hasChildren as bcHasChildren, getChainPathIds } from '../bcGraph';

export interface NavBuildCtx {
  app: App;
  getSettings: () => BreadTrailSettings;
  getBc: () => BreadcrumbsPlugin | null;
  /** Mutable by reference — builder initialises/reads sort state here. */
  sorts: Map<string, SortState>;
  /** Mutable by reference — builder reads collapsed state here. */
  collapsedSections: Set<string>;
  /** Mutable by reference — builder reads/writes content-preview cache. */
  snippetCache: Map<string, string>;
  /** Mutable by reference — builder reads/writes first-image cache. */
  imageCache: Map<string, string | null>;
  // Getters for view-owned state (always returns fresh value)
  getPreviewExpanded: () => boolean;
  getBrowserStack: () => TFile[];
  getBrowserRootFolder: () => string | null;
  getFolderStack: () => string[];
  getFollowTargets: () => TFile[];
  getRecentViewMode: () => 'global' | 'local';
}

export class NavDataBuilder {
  /** Tracks which file the context section was last computed for — used to
   *  reset child/parent sort state when the active file changes. */
  private lastContextFilePath: string | null = null;

  constructor(private readonly ctx: NavBuildCtx) {}

  // ── Per-mode entry points ──────────────────────────────────────────────────

  async computeContextData(
    bc: BreadcrumbsPlugin,
    activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'emptyMessage'>> {
    if (!activeFile || activeFile.extension !== 'md') {
      return { sections: [], emptyMessage: 'Open a note to see its context.' };
    }

    const { parents, chains, children } = this.buildNeighborhood(activeFile, bc);
    if (parents.length === 0 && chains.length === 0 && children.length === 0) {
      return { sections: [], emptyMessage: 'No breadcrumb relationships found.' };
    }

    if (activeFile.path !== this.lastContextFilePath) {
      this.lastContextFilePath = activeFile.path;
      this.ctx.sorts.delete('child');
      this.ctx.sorts.delete('parent');
    }

    const sections: SectionData[] = [];

    if (parents.length > 0) {
      const sort = this.getSort('parent', ['alpha', 'alpha-desc', 'mtime', 'ctime']);
      const cards = await Promise.all(
        this.sortNotes(parents, sort).map((n) => this.buildCardData(n, activeFile, { hasDrillIn: true })),
      );
      sections.push({
        id: 'parent', label: 'Parents', icon: 'arrow-up', cards,
        isCollapsed: this.ctx.collapsedSections.has('parent'),
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
        isCollapsed: this.ctx.collapsedSections.has(sectionId),
        sortMode: 'sequence', sortCycle: [], isChain: true,
      });
    }

    if (children.length > 0) {
      const settings = this.ctx.getSettings();
      const cycle: SortMode[] = ['sequence', 'alpha', 'alpha-desc', 'mtime', 'ctime'];
      if (settings.navigatorSortField) cycle.push('field');
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
        isCollapsed: this.ctx.collapsedSections.has('child'),
        sortMode: sort.mode, sortCycle: sort.cycle, isChain: false,
      });
    }

    const settings = this.ctx.getSettings();
    if (settings.navigatorShowSiblings && parents.length > 0) {
      const seen = new Set<string>([activeFile.path]);
      parents.forEach((p) => seen.add(p.file.path));
      children.forEach((c) => seen.add(c.file.path));

      const siblings: NavNote[] = [];
      for (const parent of parents) {
        for (const child of this.getFolderChildren(parent.file, bc)) {
          if (seen.has(child.file.path)) continue;
          seen.add(child.file.path);
          siblings.push(child);
        }
      }

      if (siblings.length > 0) {
        const sibSort = this.getSort('siblings', ['alpha', 'alpha-desc', 'mtime', 'ctime', 'sequence']);
        const sibCards = await Promise.all(
          this.sortNotes(siblings, sibSort).map((n) =>
            this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) }),
          ),
        );
        sections.push({
          id: 'siblings', label: 'Siblings', icon: 'users', cards: sibCards,
          isCollapsed: this.ctx.collapsedSections.has('siblings'),
          sortMode: sibSort.mode, sortCycle: sibSort.cycle, isChain: false,
        });
      }
    }

    return { sections };
  }

  async computeBrowserData(
    bc: BreadcrumbsPlugin,
    activeFile: TFile | null,
    cycle: SortMode[],
  ): Promise<Pick<NavData, 'sections' | 'flatCards' | 'groups' | 'emptyMessage'>> {
    const followTargets = this.ctx.getFollowTargets();
    if (followTargets.length > 0) {
      const seen = new Set<string>(followTargets.map((t) => t.path));
      const children: NavNote[] = [];
      for (const target of followTargets) {
        for (const p of getChildPaths(bc.graph, target.path)) {
          if (seen.has(p)) continue;
          const f = this.ctx.app.vault.getAbstractFileByPath(p);
          if (!(f instanceof TFile) || isExcluded(f, this.ctx.app, this.ctx.getSettings())) continue;
          seen.add(p);
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

    const browserStack = this.ctx.getBrowserStack();
    if (browserStack.length === 0) {
      return this.computeHomeData(bc, activeFile, cycle, this.ctx.getBrowserRootFolder());
    }

    const folder = browserStack[browserStack.length - 1]!;
    const children = this.getFolderChildren(folder, bc);
    if (children.length === 0) return { sections: [], emptyMessage: 'Nothing here.' };

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

  async computeHomeData(
    bc: BreadcrumbsPlugin,
    activeFile: TFile | null,
    cycle: SortMode[],
    rootFolder: string | null = null,
  ): Promise<Pick<NavData, 'sections' | 'flatCards' | 'emptyMessage'>> {
    const settings = this.ctx.getSettings();

    if (rootFolder) {
      const sort = this.getSort('browser-child', cycle);
      const roots = this.getVaultRoots(bc, rootFolder);
      if (roots.length === 0) {
        return { sections: [], emptyMessage: `No parentless notes found in ${rootFolder}.` };
      }
      const notes: NavNote[] = roots.map((f) => ({ file: f, relation: 'child' }));
      const flatCards = await Promise.all(
        this.sortNotes(notes, sort).map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
      );
      return { sections: [], flatCards };
    }

    const showFavs = settings.navigatorHomeShowFavorites;
    const showRecents = settings.navigatorHomeShowRecents;

    if (!showFavs && !showRecents) {
      const sort = this.getSort('browser-child', cycle);
      const roots = this.getVaultRoots(bc);
      if (roots.length === 0) {
        return { sections: [], emptyMessage: 'No top-level notes found. Add BC parent/child relationships to get started.' };
      }
      const notes: NavNote[] = roots.map((f) => ({ file: f, relation: 'child' }));
      const flatCards = await Promise.all(
        this.sortNotes(notes, sort).map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
      );
      return { sections: [], flatCards };
    }

    const sections: SectionData[] = [];

    const sort = this.getSort('browser-child', cycle);
    const roots = this.getVaultRoots(bc);
    if (roots.length > 0) {
      const notes: NavNote[] = roots.map((f) => ({ file: f, relation: 'child' }));
      const cards = await Promise.all(
        this.sortNotes(notes, sort).map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
      );
      sections.push({
        id: 'home-notes', label: 'Notes', icon: 'git-branch', cards,
        isCollapsed: this.ctx.collapsedSections.has('home-notes'),
        sortMode: sort.mode, sortCycle: [], isChain: false,
      });
    }

    if (showFavs) {
      const cards = await this.buildHomeFavoriteCards(activeFile, bc);
      if (cards.length > 0) {
        sections.push({
          id: 'home-favorites', label: 'Favorites', icon: 'star', cards,
          isCollapsed: this.ctx.collapsedSections.has('home-favorites'),
          sortMode: 'alpha', sortCycle: [], isChain: false,
        });
      }
    }

    if (showRecents) {
      const cards = await this.buildHomeRecentCards(activeFile);
      if (cards.length > 0) {
        sections.push({
          id: 'home-recent', label: 'Recent', icon: 'clock', cards,
          isCollapsed: this.ctx.collapsedSections.has('home-recent'),
          sortMode: 'mtime', sortCycle: [], isChain: false,
        });
      }
    }

    if (sections.length === 0) {
      return { sections: [], emptyMessage: 'No top-level notes found. Add BC parent/child relationships to get started.' };
    }
    return { sections };
  }

  async computeFileBrowserData(
    activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'browserItems' | 'emptyMessage'>> {
    const folderStack = this.ctx.getFolderStack();
    const currentPath = folderStack[folderStack.length - 1] ?? '';
    const folder = currentPath
      ? this.ctx.app.vault.getAbstractFileByPath(currentPath)
      : this.ctx.app.vault.getRoot();

    if (!(folder instanceof TFolder)) {
      return { sections: [], emptyMessage: 'Folder not found.' };
    }

    const children = [...folder.children].sort((a, b) => {
      const aIsFolder = a instanceof TFolder;
      const bIsFolder = b instanceof TFolder;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    if (children.length === 0) return { sections: [], emptyMessage: 'Empty folder.' };

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

  async computeRecentData(
    activeFile: TFile | null,
    bc: BreadcrumbsPlugin | null,
  ): Promise<Pick<NavData, 'sections' | 'flatCards' | 'emptyMessage'>> {
    const settings = this.ctx.getSettings();
    const sortField = settings.navigatorRecentSortField;
    const limit = settings.navigatorRecentLimit;

    let files = this.ctx.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f, this.ctx.app, settings));

    if (this.ctx.getRecentViewMode() === 'local' && activeFile && bc) {
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
    if (shown.length === 0) return { sections: [], emptyMessage: 'No notes found.' };

    const metaProps = settings.navigatorRecentMetaProperties;
    const flatCards = await Promise.all(
      shown.map((file) => this.buildCardData(
        { file, relation: 'child' },
        activeFile,
        { hasDrillIn: false, metaProps, autoTimestamp: true, sortField },
      )),
    );
    return { sections: [], flatCards };
  }

  async computePinboardData(
    activeFile: TFile | null,
  ): Promise<Pick<NavData, 'sections' | 'emptyMessage'>> {
    const settings = this.ctx.getSettings();
    const bc = this.ctx.getBc();
    const sections: SectionData[] = [];

    const DEFAULTS: Record<string, { label: string; icon: string }> = {
      favorites: { label: 'Favorites', icon: 'star'       },
      current:   { label: 'Current',   icon: 'folder-open' },
      recents:   { label: 'Recent',    icon: 'clock'       },
      roots:     { label: 'Notes',     icon: 'git-branch'  },
    };

    for (const sec of settings.navigatorPinboardSections) {
      if (!sec.enabled) continue;
      const def = DEFAULTS[sec.type] ?? { label: sec.type, icon: 'file' };

      switch (sec.type) {
        case 'favorites': {
          const cards = await this.buildPinboardFavoritesCards(activeFile, bc);
          if (cards.length > 0) {
            sections.push({
              id: 'pb-favorites', label: def.label, icon: def.icon, cards,
              isCollapsed: this.ctx.collapsedSections.has('pb-favorites'),
              sortMode: 'alpha', sortCycle: [], isChain: false,
            });
          }
          break;
        }
        case 'current': {
          const cards = await this.buildPinboardCurrentCards(activeFile, bc, sec.limit);
          if (cards.length > 0) {
            const sectionLabel = activeFile ? activeFile.basename : def.label;
            sections.push({
              id: 'pb-current', label: sectionLabel, icon: def.icon, cards,
              isCollapsed: this.ctx.collapsedSections.has('pb-current'),
              sortMode: 'sequence', sortCycle: [], isChain: false,
            });
          }
          break;
        }
        case 'recents': {
          const limit = sec.limit > 0 ? sec.limit : settings.navigatorHomeRecentsCount;
          const cards = await this.buildHomeRecentCards(activeFile, limit);
          if (cards.length > 0) {
            sections.push({
              id: 'pb-recents', label: def.label, icon: def.icon, cards,
              isCollapsed: this.ctx.collapsedSections.has('pb-recents'),
              sortMode: 'mtime', sortCycle: [], isChain: false,
            });
          }
          break;
        }
        case 'roots': {
          if (!bc) break;
          const cards = await this.buildPinboardRootsCards(activeFile, bc);
          if (cards.length > 0) {
            sections.push({
              id: 'pb-roots', label: def.label, icon: def.icon, cards,
              isCollapsed: this.ctx.collapsedSections.has('pb-roots'),
              sortMode: 'alpha', sortCycle: [], isChain: false,
            });
          }
          break;
        }
        case 'tag': {
          if (!sec.param) break;
          const tagCards = await this.buildPinboardTagCards(activeFile, sec.param, sec.limit);
          if (tagCards.length > 0) {
            const secId = `pb-tag-${sec.param}`;
            sections.push({
              id: secId, label: `#${sec.param}`, icon: 'tag', cards: tagCards,
              isCollapsed: this.ctx.collapsedSections.has(secId),
              sortMode: 'alpha', sortCycle: [], isChain: false,
            });
          }
          break;
        }
        case 'filter': {
          if (!sec.param) break;
          const filterCards = await this.buildPinboardFilterCards(activeFile, sec.param, sec.limit);
          if (filterCards.length > 0) {
            const secId = `pb-filter-${sec.param}`;
            sections.push({
              id: secId, label: sec.param, icon: 'filter', cards: filterCards,
              isCollapsed: this.ctx.collapsedSections.has(secId),
              sortMode: 'alpha', sortCycle: [], isChain: false,
            });
          }
          break;
        }
      }
    }

    if (sections.length === 0) {
      return { sections: [], emptyMessage: 'Nothing to show. Enable sections in Settings → Navigator → Pinboard.' };
    }
    return { sections };
  }

  // ── Sort helpers ───────────────────────────────────────────────────────────

  getSort(sectionId: string, defaultCycle: SortMode[]): SortState {
    if (!this.ctx.sorts.has(sectionId)) {
      this.ctx.sorts.set(sectionId, { mode: defaultCycle[0] ?? 'alpha', cycle: defaultCycle });
    }
    return this.ctx.sorts.get(sectionId)!;
  }

  sortNotes(notes: NavNote[], sort: SortState): NavNote[] {
    const field = this.ctx.getSettings().navigatorSortField;
    const sorted = [...notes];
    if (sort.mode === 'alpha') {
      sorted.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
    } else if (sort.mode === 'alpha-desc') {
      sorted.sort((a, b) => b.file.basename.localeCompare(a.file.basename));
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
    return sorted;
  }

  private applyChildSortOverride(sectionId: string, override: SortMode, cycle: SortMode[]) {
    if (!this.ctx.sorts.has(sectionId)) {
      const reordered = [override, ...cycle.filter((m) => m !== override)];
      this.ctx.sorts.set(sectionId, { mode: override, cycle: reordered });
    }
  }

  // ── Card builder ───────────────────────────────────────────────────────────

  async buildCardData(
    note: NavNote,
    activeFile: TFile | null,
    options: {
      hasDrillIn: boolean;
      metaProps?: string[];
      autoTimestamp?: boolean;
      sortField?: string;
    },
  ): Promise<CardData> {
    const settings = this.ctx.getSettings();
    const {
      hasDrillIn,
      metaProps = settings.navigatorMetaProperties,
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

    const noPreview = this.getBreadTrailFm(note.file)?.['no-preview'] === true;

    if (this.ctx.getPreviewExpanded() && !noPreview) {
      if (!this.ctx.snippetCache.has(note.file.path)) {
        try {
          const content = await this.ctx.app.vault.cachedRead(note.file);
          const skipBases = settings.navigatorSkipPreviewForBases
            && startsWithBaseTransclusion(content);
          this.ctx.snippetCache.set(note.file.path, skipBases ? '' : extractContentSnippet(content, settings.navigatorPreviewLines));
          this.ctx.imageCache.set(note.file.path, skipBases ? null : extractFirstImageLink(content));
        } catch {
          this.ctx.snippetCache.set(note.file.path, '');
          this.ctx.imageCache.set(note.file.path, null);
        }
      }
      const snippetText = this.ctx.snippetCache.get(note.file.path) ?? '';
      const imageLink = this.ctx.imageCache.get(note.file.path);
      if (imageLink && !snippetText.includes(imageLink)) {
        const imageFile = this.ctx.app.metadataCache.getFirstLinkpathDest(imageLink, note.file.path);
        if (imageFile instanceof TFile) {
          imageUrl = this.ctx.app.vault.getResourcePath(imageFile);
        }
      }
      if (snippetText) snippet = snippetText;
    }

    return {
      file: note.file,
      relation: note.relation,
      seqPos: note.seqPos,
      label: note.file.basename,
      meta,
      isActive: activeFile?.path === note.file.path,
      hasDrillIn,
      snippet,
      imageUrl,
    };
  }

  // ── Graph / file helpers ───────────────────────────────────────────────────

  hasChildren(file: TFile, bc: BreadcrumbsPlugin): boolean {
    return bcHasChildren(bc.graph, file.path);
  }

  getVaultRoots(bc: BreadcrumbsPlugin, rootFolder = ''): TFile[] {
    const folder = rootFolder.trim().replace(/^\/+|\/+$/g, '');
    const roots: TFile[] = [];
    const settings = this.ctx.getSettings();
    for (const file of this.ctx.app.vault.getMarkdownFiles()) {
      if (shouldIncludeVaultRoot({
        path: file.path,
        hasChildren: bcHasChildren(bc.graph, file.path),
        hasParent: bcHasParent(bc.graph, file.path),
        excluded: isExcluded(file, this.ctx.app, settings),
      }, folder)) roots.push(file);
    }
    return roots.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  getAllParentFiles(file: TFile, bc: BreadcrumbsPlugin, limit = 4): TFile[] {
    return getParentPaths(bc.graph, file.path)
      .slice(0, limit)
      .map((p) => this.ctx.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile);
  }

  getFirstParentFile(file: TFile, bc: BreadcrumbsPlugin): TFile | null {
    for (const p of getParentPaths(bc.graph, file.path)) {
      const f = this.ctx.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  getSiblingPaths(file: TFile, bc: BreadcrumbsPlugin): Set<string> {
    const siblings = new Set<string>();
    for (const parentPath of getParentPaths(bc.graph, file.path)) {
      for (const cp of getChildPaths(bc.graph, parentPath)) siblings.add(cp);
    }
    return siblings;
  }

  getFolderChildren(folder: TFile, bc: BreadcrumbsPlugin): NavNote[] {
    const settings = this.ctx.getSettings();
    const children: NavNote[] = getChildPaths(bc.graph, folder.path)
      .map((p) => this.ctx.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile && !isExcluded(f, this.ctx.app, settings))
      .map((f): NavNote => ({ file: f, relation: 'child' }));
    this.assignSeqPositions(children, bc);
    return children;
  }

  // ── Frontmatter helpers ────────────────────────────────────────────────────

  getFmString(file: TFile, key: string): string | null {
    const fm = this.ctx.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    const val: unknown = fm[key];
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val) && val.length > 0) return String(val[0]);
    return null;
  }

  getBreadTrailFm(file: TFile): Record<string, unknown> | null {
    const fm: unknown = this.ctx.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    const nested = typeof fm === 'object' && !Array.isArray(fm)
      ? (fm as Record<string, unknown>)['bread-trail']
      : undefined;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return null;
  }

  isFavorite(file: TFile, bc: BreadcrumbsPlugin | null): boolean {
    const settings = this.ctx.getSettings();
    if (settings.navigatorFavorites.includes(file.path)) return true;
    const bt = this.getBreadTrailFm(file);
    if (bt?.['favorite'] === true) return true;
    const parentPath = settings.navigatorFavoritesParentNote.trim();
    if (parentPath && bc) return isDirectChild(bc.graph, file.path, parentPath);
    return false;
  }

  fileHasTag(file: TFile, tag: string): boolean {
    const cache: CachedMetadata | null = this.ctx.app.metadataCache.getFileCache(file);
    if (!cache) return false;
    const normalised = tag.toLowerCase().replace(/^#/, '');
    if (cache.tags) {
      for (const { tag: t } of cache.tags) {
        const clean = t.replace(/^#/, '').toLowerCase();
        if (clean === normalised || clean.startsWith(normalised + '/')) return true;
      }
    }
    const frontmatter = cache.frontmatter as unknown;
    const fmTags = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
      ? (frontmatter as Record<string, unknown>)['tags']
      : undefined;
    const list: string[] = Array.isArray(fmTags)
      ? fmTags.filter((v): v is string => typeof v === 'string')
      : typeof fmTags === 'string' ? [fmTags] : [];
    for (const t of list) {
      const clean = t.replace(/^#/, '').toLowerCase();
      if (clean === normalised || clean.startsWith(normalised + '/')) return true;
    }
    return false;
  }

  fileMatchesPattern(file: TFile, pattern: string): boolean {
    const fm: unknown = this.ctx.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return false;
    const frontmatter = fm as Record<string, unknown>;
    const colonIdx = pattern.indexOf(':');
    if (colonIdx === -1) {
      const val = frontmatter[pattern];
      return val !== undefined && val !== null && val !== false && val !== '' && val !== 0;
    }
    const key = pattern.slice(0, colonIdx).trim();
    const expected = pattern.slice(colonIdx + 1).trim();
    const val = frontmatter[key];
    return (typeof val === 'string' || typeof val === 'number') && String(val).trim() === expected;
  }

  // ── Sort / grouping helpers ────────────────────────────────────────────────

  parseSortMode(raw: unknown): SortMode | null {
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

  getChildSortOverride(file: TFile): SortMode | null {
    const bt = this.getBreadTrailFm(file);
    return this.parseSortMode(bt?.['sort'] ?? bt?.['children-sort'] ?? null);
  }

  getChildGroupBy(file: TFile): string | null {
    const bt = this.getBreadTrailFm(file);
    const val = bt?.['group-by'];
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  }

  private normalizeGroupValue(val: string): string {
    return val.replace(/^\[\[(.+?)(?:\|[^\]]+)?\]\]$/, '$1').trim();
  }

  groupNotes(notes: NavNote[], field: string): [string, NavNote[]][] {
    const NONE = '—';
    const normalize = this.ctx.getSettings().navigatorGroupByNormalizeLinks;
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

  getChainPaths(file: TFile, bc: BreadcrumbsPlugin): string[] {
    return [...getChainPathIds(bc.graph, file.path)].sort();
  }

  buildNeighborhood(file: TFile, bc: BreadcrumbsPlugin): {
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
    const settings = this.ctx.getSettings();
    const toNote = (p: string, relation: NavNote['relation']): NavNote | null => {
      if (seen.has(p)) return null;
      const f = this.ctx.app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile) || isExcluded(f, this.ctx.app, settings)) return null;
      seen.add(p);
      return { file: f, relation };
    };
    const parents: NavNote[] = getParentPaths(bc.graph, file.path)
      .map((p) => toNote(p, 'parent')).filter((n): n is NavNote => n !== null);
    const children: NavNote[] = getChildPaths(bc.graph, file.path)
      .map((p) => toNote(p, 'child')).filter((n): n is NavNote => n !== null);

    return { parents, chains, children };
  }

  buildChainForPath(file: TFile, bc: BreadcrumbsPlugin, chainPath: string): NavNote[] {
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

  findPrevForPath(file: TFile, bc: BreadcrumbsPlugin, chainPath: string, seen: Set<string>): TFile | null {
    const nextType = chainPath ? `next.${chainPath}` : 'next';
    const prevType = chainPath ? `prev.${chainPath}` : 'prev';
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.ctx.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== prevType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.ctx.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  findNextForPath(file: TFile, bc: BreadcrumbsPlugin, chainPath: string, seen: Set<string>): TFile | null {
    const nextType = chainPath ? `next.${chainPath}` : 'next';
    const prevType = chainPath ? `prev.${chainPath}` : 'prev';
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.ctx.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== prevType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.ctx.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  findNextAny(file: TFile, bc: BreadcrumbsPlugin, withinPaths: Set<string>, seen: Set<string>): TFile | null {
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      const t = e.edge_type?.toLowerCase() ?? '';
      if (t !== 'next' && !t.startsWith('next.')) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path) || !withinPaths.has(path)) continue;
      const f = this.ctx.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      const t = e.edge_type?.toLowerCase() ?? '';
      if (t !== 'prev' && !t.startsWith('prev.')) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path) || !withinPaths.has(path)) continue;
      const f = this.ctx.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  assignSeqPositions(children: NavNote[], bc: BreadcrumbsPlugin): void {
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

  // ── Pinboard section builders ──────────────────────────────────────────────

  private async buildHomeFavoriteCards(activeFile: TFile | null, bc: BreadcrumbsPlugin | null): Promise<CardData[]> {
    const settings = this.ctx.getSettings();
    const files = this.ctx.app.vault.getMarkdownFiles()
      .filter((f) => !isExcluded(f, this.ctx.app, settings) && this.isFavorite(f, bc));

    files.sort((a, b) => {
      const aIdx = settings.navigatorFavorites.indexOf(a.path);
      const bIdx = settings.navigatorFavorites.indexOf(b.path);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.basename.localeCompare(b.basename);
    });

    const metaProps = settings.navigatorFavoritesMetaProperties;
    return Promise.all(
      files.map((f) => this.buildCardData({ file: f, relation: 'child' }, activeFile, { hasDrillIn: false, metaProps })),
    );
  }

  private async buildHomeRecentCards(activeFile: TFile | null, limitOverride?: number): Promise<CardData[]> {
    const settings = this.ctx.getSettings();
    const limit = limitOverride ?? settings.navigatorHomeRecentsCount;
    const sortField = settings.navigatorRecentSortField;

    let files = this.ctx.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f, this.ctx.app, settings));

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

    return Promise.all(
      files.slice(0, limit).map((f) =>
        this.buildCardData({ file: f, relation: 'child' }, activeFile, { hasDrillIn: false, autoTimestamp: true, sortField }),
      ),
    );
  }

  private async buildPinboardFavoritesCards(activeFile: TFile | null, bc: BreadcrumbsPlugin | null): Promise<CardData[]> {
    const settings = this.ctx.getSettings();
    const files = this.ctx.app.vault.getMarkdownFiles()
      .filter((f) => !isExcluded(f, this.ctx.app, settings) && this.isFavorite(f, bc));

    files.sort((a, b) => {
      const ai = settings.navigatorFavorites.indexOf(a.path);
      const bi = settings.navigatorFavorites.indexOf(b.path);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.basename.localeCompare(b.basename);
    });

    const metaProps = settings.navigatorFavoritesMetaProperties;
    return Promise.all(
      files.map((f) => this.buildCardData({ file: f, relation: 'child' }, activeFile, { hasDrillIn: false, metaProps })),
    );
  }

  private async buildPinboardCurrentCards(
    activeFile: TFile | null,
    bc: BreadcrumbsPlugin | null,
    limit: number,
  ): Promise<CardData[]> {
    if (!activeFile || !bc) return [];
    const children = this.getFolderChildren(activeFile, bc);
    if (children.length === 0) return [];

    const cycle: SortMode[] = ['sequence', 'alpha', 'alpha-desc', 'mtime', 'ctime'];
    const override = this.getChildSortOverride(activeFile);
    if (override) this.applyChildSortOverride('pb-current', override, cycle);
    const sort = this.getSort('pb-current', cycle);
    const sorted = this.sortNotes(children, sort);
    const limited = limit > 0 ? sorted.slice(0, limit) : sorted;

    return Promise.all(
      limited.map((n) => this.buildCardData(n, activeFile, { hasDrillIn: this.hasChildren(n.file, bc) })),
    );
  }

  private async buildPinboardRootsCards(activeFile: TFile | null, bc: BreadcrumbsPlugin): Promise<CardData[]> {
    const roots = this.getVaultRoots(bc);
    return Promise.all(
      roots.map((f) => this.buildCardData(
        { file: f, relation: 'child' },
        activeFile,
        { hasDrillIn: this.hasChildren(f, bc) },
      )),
    );
  }

  private async buildPinboardTagCards(activeFile: TFile | null, tag: string, limit: number): Promise<CardData[]> {
    const bc = this.ctx.getBc();
    const settings = this.ctx.getSettings();
    let files = this.ctx.app.vault.getMarkdownFiles()
      .filter((f) => !isExcluded(f, this.ctx.app, settings) && this.fileHasTag(f, tag));
    files.sort((a, b) => a.basename.localeCompare(b.basename));
    if (limit > 0) files = files.slice(0, limit);
    return Promise.all(
      files.map((f) => this.buildCardData(
        { file: f, relation: 'child' },
        activeFile,
        { hasDrillIn: bc ? this.hasChildren(f, bc) : false },
      )),
    );
  }

  private async buildPinboardFilterCards(activeFile: TFile | null, pattern: string, limit: number): Promise<CardData[]> {
    const bc = this.ctx.getBc();
    const settings = this.ctx.getSettings();
    let files = this.ctx.app.vault.getMarkdownFiles()
      .filter((f) => !isExcluded(f, this.ctx.app, settings) && this.fileMatchesPattern(f, pattern));
    files.sort((a, b) => a.basename.localeCompare(b.basename));
    if (limit > 0) files = files.slice(0, limit);
    return Promise.all(
      files.map((f) => this.buildCardData(
        { file: f, relation: 'child' },
        activeFile,
        { hasDrillIn: bc ? this.hasChildren(f, bc) : false },
      )),
    );
  }
}
