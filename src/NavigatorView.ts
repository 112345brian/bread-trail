import { ItemView, MarkdownRenderer, TFile, TFolder, WorkspaceLeaf, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import { extractContentSnippet, extractFirstImageLink, formatDateValue } from './utils';

export const NAVIGATOR_VIEW_TYPE = 'bread-trail-navigator';

// ── Sort types ────────────────────────────────────────────────────────────────

type SortMode = 'sequence' | 'alpha' | 'alpha-desc' | 'field' | 'mtime' | 'ctime';

interface SortState {
  mode: SortMode;
  cycle: SortMode[];
}

const SORT_ICON: Record<SortMode, string> = {
  sequence:     'list-ordered',
  alpha:        'arrow-up-a-z',
  'alpha-desc': 'arrow-down-z-a',
  field:        'arrow-up-narrow-wide',
  mtime:        'clock',
  ctime:        'calendar',
};

/** Human-readable label shown in the sort button aria-label. */
const SORT_LABEL: Record<SortMode, string> = {
  sequence:     'Sequence order',
  alpha:        'A → Z',
  'alpha-desc': 'Z → A',
  field:        'By field',
  mtime:        'Date modified',
  ctime:        'Date created',
};

// ── Nav note types ────────────────────────────────────────────────────────────

type NavRelation = 'parent' | 'previous' | 'current' | 'next' | 'child';

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
  private mode: 'context' | 'browser' | 'recent' | 'favorites';

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

  // Collapsed section IDs (chains are expanded by default; user can collapse)
  private collapsedSections = new Set<string>();

  // Track the last context-mode file so we can reset child sort when it changes
  private lastContextFilePath: string | null = null;

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
  getDisplayText() { return 'Bread trail'; }
  getIcon()        { return 'footprints'; }

  async onOpen() {
    this.contentEl.addClass('bread-trail-nav');

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.scheduleRefresh();
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

  updateSettings(s: BreadTrailSettings) {
    this.settings = s;
  }

  scheduleRefresh(delay = 80) {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { void this.refresh(); }, delay);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  private cycleSort(sectionId: string) {
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

  // ── bread-trail frontmatter helpers ────────────────────────────────────────

  /** Return the value of a `bread-trail` frontmatter object on a file, or null. */
  private getBreadTrailFm(file: TFile): Record<string, unknown> | null {
    const fm: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;
    // Support both nested object `bread-trail: { … }` and flat `bread-trail-*` keys
    const nested = typeof fm === 'object' && !Array.isArray(fm) ? (fm as Record<string, unknown>)['bread-trail'] : undefined;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return null;
  }

  /** Parse a sort mode string from frontmatter into a SortMode, or null. */
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

  /** Return the sort override for how THIS FILE's children should be displayed, or null. */
  private getChildSortOverride(file: TFile): SortMode | null {
    const bt = this.getBreadTrailFm(file);
    return this.parseSortMode(bt?.['sort'] ?? bt?.['children-sort'] ?? null);
  }

  /** Apply a sort override as the initial state for a section if not already set. */
  private applyChildSortOverride(sectionId: string, override: SortMode, cycle: SortMode[]) {
    if (!this.sorts.has(sectionId)) {
      const reordered = [override, ...cycle.filter((m) => m !== override)];
      this.sorts.set(sectionId, { mode: override, cycle: reordered });
    }
  }

  /** Return the frontmatter field to group children by, or null. */
  private getChildGroupBy(file: TFile): string | null {
    const bt = this.getBreadTrailFm(file);
    const val = bt?.['group-by'];
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  }

  /** Strip [[wikilink]] syntax from a value, leaving just the link target.
   *  [[index|Alias]] → index,  [[index]] → index,  index → index */
  private normalizeGroupValue(val: string): string {
    return val.replace(/^\[\[(.+?)(?:\|[^\]]+)?\]\]$/, '$1').trim();
  }

  /** Group notes by the value of a frontmatter field.
   *  Returns [groupValue, notes] pairs sorted alphabetically; ungrouped notes last. */
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

  /** Return all distinct chain path suffixes the file participates in.
   *  e.g. edges `next.journal` and `next.moments` → ['journal', 'moments']
   *  Bare `next`/`prev` edges → [''] */
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

  /** Find the previous note in a specific named chain. */
  private findPrevForPath(
    file: TFile,
    bc: BreadcrumbsPlugin,
    chainPath: string,
    seen: Set<string>,
  ): TFile | null {
    const nextType = chainPath ? `next.${chainPath}` : 'next';
    const prevType = chainPath ? `prev.${chainPath}` : 'prev';

    // Incoming `next.*` edge → source is our prev
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    // Outgoing `prev.*` edge → target is our prev
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== prevType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  /** Find the next note in a specific named chain. */
  private findNextForPath(
    file: TFile,
    bc: BreadcrumbsPlugin,
    chainPath: string,
    seen: Set<string>,
  ): TFile | null {
    const nextType = chainPath ? `next.${chainPath}` : 'next';
    const prevType = chainPath ? `prev.${chainPath}` : 'prev';

    // Outgoing `next.*` edge → target is our next
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    // Incoming `prev.*` edge → source is our next
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== prevType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    return null;
  }

  /** Find next via any next.* or next edge — used for browser seq detection. */
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

  /** Build the full chain for a specific chain path. Returns [] if file has no neighbors in that chain. */
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
    // Collect all chains this file belongs to
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

  /** Children of a given folder note for browser mode. */
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

  /** For a flat child list, detect any prev/next ordering and assign seqPos. */
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

  /** Returns true if this file should be hidden from parents/children sections. */
  private isExcluded(file: TFile): boolean {
    // bread-trail.hidden: true in frontmatter
    const bt = this.getBreadTrailFm(file);
    if (bt?.['hidden'] === true) return true;

    // Exact file path
    if (this.settings.navigatorExcludeFiles.includes(file.path)) return true;

    // Folder prefix — normalize folder patterns to not require trailing slash
    for (const folder of this.settings.navigatorExcludeFolders) {
      const prefix = folder.endsWith('/') ? folder : folder + '/';
      if (file.path.startsWith(prefix)) return true;
    }

    // Frontmatter patterns from settings
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

  /** All notes with BC children but no BC parents — the top of the hierarchy. */
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

  /** Return the first BC parent of a file (up edge), or null. */
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

  // ── Render entry ───────────────────────────────────────────────────────────

  async refresh() {
    this.contentEl.empty();

    const bc = this.getBc();
    const activeFile = this.app.workspace.getActiveFile();

    this.renderToolbar(activeFile, bc);

    if (this.mode === 'recent') {
      await this.renderRecent(activeFile, bc);
      return;
    }

    if (this.mode === 'favorites') {
      await this.renderFavorites(activeFile);
      return;
    }

    if (!bc) {
      this.renderEmpty('Breadcrumbs plugin not detected.');
      return;
    }

    if (this.mode === 'browser') {
      if (this.browserViewMode === 'files') {
        await this.renderFileBrowser(activeFile);
      } else {
        await this.renderBrowser(bc, activeFile);
      }
    } else {
      await this.renderContext(bc, activeFile);
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────

  private renderToolbar(activeFile: TFile | null, bc: BreadcrumbsPlugin | null) {
    const bar = this.contentEl.createDiv('bread-trail-nav-toolbar');
    const vis = this.settings.navigatorToolbarVisible;

    // ── Mode group ────────────────────────────────────────────
    const modeGroup = bar.createDiv('bread-trail-nav-mode-group');

    const mkModeBtn = (icon: string, label: string, active: boolean, onClick: () => void) => {
      const btn = modeGroup.createEl('button', { cls: 'bread-trail-nav-mode-btn' });
      setIcon(btn, icon);
      btn.setAttribute('aria-label', label);
      if (active) btn.addClass('is-active');
      btn.addEventListener('click', onClick);
      return btn;
    };

    if (vis.context) mkModeBtn('git-branch', 'Context', this.mode === 'context', () => this.setMode('context'));
    if (vis.browse) {
      // Icon changes when in file-system sub-mode
      const browseIcon = this.mode === 'browser' && this.browserViewMode === 'files' ? 'hard-drive' : 'folder-open';
      mkModeBtn(browseIcon, this.browserViewMode === 'files' ? 'Browse (file system)' : 'Browse', this.mode === 'browser', () => {
        if (this.mode !== 'browser') {
          this.browserViewMode = 'bc';
          this.initBrowserStack(activeFile, bc);
          this.setMode('browser');
        } else {
          // Already in browser — toggle between bc and file system
          this.browserViewMode = this.browserViewMode === 'bc' ? 'files' : 'bc';
          if (this.browserViewMode === 'files') this.folderStack = [];
          void this.refresh();
        }
      });
    }
    if (vis.recent) {
      const recentIcon = this.mode === 'recent' && this.recentViewMode === 'local' ? 'users' : 'clock';
      const recentLabel = this.mode === 'recent' && this.recentViewMode === 'local' ? 'Recent (siblings only)' : 'Recent';
      mkModeBtn(recentIcon, recentLabel, this.mode === 'recent', () => {
        if (this.mode !== 'recent') {
          this.recentViewMode = 'global';
          this.setMode('recent');
        } else {
          // Already in recent — toggle global ↔ local
          this.recentViewMode = this.recentViewMode === 'global' ? 'local' : 'global';
          void this.refresh();
        }
      });
    }
    if (vis.favorites) mkModeBtn('star', 'Favorites', this.mode === 'favorites', () => this.setMode('favorites'));

    // ── Action buttons (right side) ───────────────────────────
    const mkActionBtn = (icon: string, label: string, onClick: () => void) => {
      const btn = bar.createEl('button', { cls: 'bread-trail-nav-action-btn' });
      setIcon(btn, icon);
      btn.setAttribute('aria-label', label);
      btn.addEventListener('click', onClick);
      return btn;
    };

    // Go to active note — navigates browser to the active note's location
    if (vis.goToActive) {
      mkActionBtn('crosshair', 'Go to active note', () => {
        const file = this.app.workspace.getActiveFile();
        if (file && bc) {
          const parent = this.getFirstParentFile(file, bc);
          this.browserStack = [parent ?? file];
        }
        if (this.mode !== 'browser') this.setMode('browser');
        else void this.refresh();
      });
    }

    // Reset browser — reinitialises the stack to the configured start
    if (vis.reset) {
      mkActionBtn('rotate-ccw', 'Reset browser to start', () => {
        const file = this.app.workspace.getActiveFile();
        this.initBrowserStack(file, bc);
        if (this.mode !== 'browser') this.setMode('browser');
        else void this.refresh();
      });
    }

    // Preview expand/collapse toggle
    if (vis.preview) {
      const previewBtn = bar.createEl('button', { cls: 'bread-trail-nav-action-btn' });
      setIcon(previewBtn, this.previewExpanded ? 'eye' : 'eye-off');
      previewBtn.setAttribute('aria-label', this.previewExpanded ? 'Hide previews' : 'Show previews');
      previewBtn.addEventListener('click', () => {
        this.previewExpanded = !this.previewExpanded;
        this.settings.navigatorPreviewExpanded = this.previewExpanded;
        void this.saveSettings();
        void this.refresh();
      });
    }

    // Browser navigation row: back + folder title + sort
    if (this.mode === 'browser') {
      const nav = bar.createDiv('bread-trail-nav-browser-nav');

      if (this.browserViewMode === 'files') {
        // ── File-system nav row ──────────────────────────────────
        const currentPath = this.folderStack[this.folderStack.length - 1] ?? '';
        const isRoot = this.folderStack.length === 0;
        const backBtn = nav.createEl('button', { cls: 'bread-trail-nav-back-btn' });
        setIcon(backBtn.createSpan(), 'arrow-left');
        if (isRoot) backBtn.disabled = true;
        backBtn.addEventListener('click', () => { this.folderStack.pop(); void this.refresh(); });

        const folderName = isRoot ? 'Vault' : (currentPath.split('/').pop() ?? currentPath);
        nav.createSpan({
          text: folderName,
          cls: 'bread-trail-nav-browser-title' + (isRoot ? ' is-roots' : ''),
        });

      } else {
        // ── BC hierarchy nav row ─────────────────────────────────
        const currentFolder = this.browserStack[this.browserStack.length - 1];
        const isRootsView = this.browserStack.length === 0;

        const canGoUp = !isRootsView && (
          this.browserStack.length > 1 ||
          (currentFolder != null && bc != null && this.getFirstParentFile(currentFolder, bc) != null) ||
          this.settings.navigatorBrowseStart === 'roots'
        );
        const backBtn = nav.createEl('button', { cls: 'bread-trail-nav-back-btn' });
        setIcon(backBtn.createSpan(), 'arrow-left');
        if (!canGoUp) backBtn.disabled = true;
        backBtn.addEventListener('click', () => {
          if (this.settings.navigatorBrowseStart === 'roots' && this.browserStack.length === 1) {
            this.browserStack = [];
          } else if (this.browserStack.length > 1) {
            this.browserStack.pop();
          } else if (bc && currentFolder) {
            const parent = this.getFirstParentFile(currentFolder, bc);
            if (parent) this.browserStack[0] = parent;
          }
          void this.refresh();
        });

        nav.createSpan({
          text: isRootsView ? 'Vault' : (currentFolder ? this.getLabel(currentFolder) : ''),
          cls: 'bread-trail-nav-browser-title' + (isRootsView ? ' is-roots' : ''),
        });

        // Sort button (BC mode only — file mode is always alpha)
        const cycle: SortMode[] = ['alpha', 'alpha-desc', 'sequence'];
        if (this.settings.navigatorSortField) cycle.push('field');
        const sort = this.getSort('browser-child', cycle);
        const sortBtn = nav.createEl('button', { cls: 'bread-trail-nav-sort-btn bread-trail-nav-browser-sort' });
        setIcon(sortBtn, SORT_ICON[sort.mode]);
        sortBtn.setAttribute('aria-label', SORT_LABEL[sort.mode]);
        sortBtn.addEventListener('click', () => this.cycleSort('browser-child'));
      }
    }
  }

  private initBrowserStack(activeFile: TFile | null, bc: BreadcrumbsPlugin | null) {
    const start = this.settings.navigatorBrowseStart;
    if (start === 'roots') {
      this.browserStack = []; // empty = vault roots view
      return;
    }
    if (start === 'note') {
      const notePath = this.settings.navigatorBrowseStartNote;
      if (notePath) {
        const f = this.app.vault.getAbstractFileByPath(notePath);
        if (f instanceof TFile) { this.browserStack = [f]; return; }
      }
    }
    // 'active' (default): start at parent of active note
    if (activeFile && bc) {
      const parent = this.getFirstParentFile(activeFile, bc);
      this.browserStack = [parent ?? activeFile];
    }
  }

  private setMode(mode: 'context' | 'browser' | 'recent' | 'favorites') {
    this.mode = mode;
    this.settings.navigatorMode = mode;
    void this.saveSettings();
    void this.refresh();
  }

  // ── Context mode ───────────────────────────────────────────────────────────

  private async renderContext(bc: BreadcrumbsPlugin, activeFile: TFile | null) {
    if (!activeFile || activeFile.extension !== 'md') {
      this.renderEmpty('Open a note to see its context.');
      return;
    }

    const { parents, chains, children } = this.buildNeighborhood(activeFile, bc);
    if (parents.length === 0 && chains.length === 0 && children.length === 0) {
      this.renderEmpty('No breadcrumb relationships found.');
      return;
    }

    // When the active file changes, reset child/parent sort so per-note
    // overrides take effect on the new file.
    if (activeFile.path !== this.lastContextFilePath) {
      this.lastContextFilePath = activeFile.path;
      this.sorts.delete('child');
      this.sorts.delete('parent');
    }

    if (parents.length > 0) {
      const sort = this.getSort('parent', ['alpha', 'alpha-desc', 'mtime', 'ctime']);
      await this.renderSection('parent', 'Parents', 'arrow-up', this.sortNotes(parents, sort), sort, activeFile);
    }

    for (const { path: chainPath, notes: chain } of chains) {
      const sectionId = `chain-${chainPath || 'default'}`;
      const total = chain[0]?.seqTotal ?? chain.length;
      const label = chainPath
        ? `Chain (${chainPath})  ·  ${total}`
        : `Chain  ·  ${total}`;
      await this.renderSection(sectionId, label, 'list-ordered', chain, null, activeFile, true /* collapsible */);
    }

    if (children.length > 0) {
      const cycle: SortMode[] = ['sequence', 'alpha', 'alpha-desc', 'mtime', 'ctime'];
      if (this.settings.navigatorSortField) cycle.push('field');
      // Apply per-note override from active file's bread-trail.sort frontmatter
      const override = this.getChildSortOverride(activeFile);
      if (override) this.applyChildSortOverride('child', override, cycle);
      const sort = this.getSort('child', cycle);
      const groupBy = this.getChildGroupBy(activeFile);
      await this.renderSection('child', 'Children', 'arrow-down', this.sortNotes(children, sort), sort, activeFile, false, groupBy);
    }
  }

  // ── Browser mode ───────────────────────────────────────────────────────────

  private async renderBrowser(bc: BreadcrumbsPlugin, activeFile: TFile | null) {
    const cycle: SortMode[] = ['alpha', 'alpha-desc', 'sequence', 'mtime', 'ctime'];
    if (this.settings.navigatorSortField) cycle.push('field');

    // Roots view — stack is empty, show all vault-level parent notes
    if (this.browserStack.length === 0) {
      const sort = this.getSort('browser-child', cycle);
      const roots = this.getVaultRoots(bc);
      if (roots.length === 0) {
        this.renderEmpty('No top-level notes found. Add BC parent/child relationships to get started.');
        return;
      }
      const notes: NavNote[] = roots.map((f) => ({ file: f, relation: 'child' }));
      for (const note of this.sortNotes(notes, sort)) {
        const drillIn = (f: TFile) => { this.browserStack.push(f); void this.refresh(); };
        await this.renderCard(this.contentEl, note, activeFile, drillIn);
      }
      return;
    }

    // Normal folder view — show children of current stack top
    const folder = this.browserStack[this.browserStack.length - 1]!;
    const children = this.getFolderChildren(folder, bc);
    if (children.length === 0) {
      this.renderEmpty('Nothing here.');
      return;
    }

    // Apply per-note sort override from the folder note's bread-trail.sort frontmatter
    const sectionId = `browser-child`;
    const override = this.getChildSortOverride(folder);
    if (override) this.applyChildSortOverride(sectionId, override, cycle);
    const sort = this.getSort(sectionId, cycle);
    const sorted = this.sortNotes(children, sort);

    const groupBy = this.getChildGroupBy(folder);
    const drillInFor = (note: NavNote) => {
      const hasKids = this.hasChildren(note.file, bc);
      return hasKids ? (f: TFile) => { this.browserStack.push(f); void this.refresh(); } : null;
    };

    if (groupBy) {
      for (const [groupValue, groupNotes] of this.groupNotes(sorted, groupBy)) {
        const groupEl = this.contentEl.createDiv('bread-trail-nav-group');
        groupEl.createDiv('bread-trail-nav-group-header').createSpan({
          text: groupValue,
          cls: 'bread-trail-nav-group-label',
        });
        for (const note of groupNotes) {
          await this.renderCard(groupEl, note, activeFile, drillInFor(note));
        }
      }
    } else {
      for (const note of sorted) {
        await this.renderCard(this.contentEl, note, activeFile, drillInFor(note));
      }
    }
  }

  // ── File-system browser ────────────────────────────────────────────────────

  private async renderFileBrowser(activeFile: TFile | null) {
    const currentPath = this.folderStack[this.folderStack.length - 1] ?? '';
    const folder = currentPath
      ? this.app.vault.getAbstractFileByPath(currentPath)
      : this.app.vault.getRoot();

    if (!(folder instanceof TFolder)) {
      this.renderEmpty('Folder not found.');
      return;
    }

    const children = [...folder.children].sort((a, b) => {
      // Folders first, then files, each group alphabetical
      const aIsFolder = a instanceof TFolder;
      const bIsFolder = b instanceof TFolder;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    if (children.length === 0) {
      this.renderEmpty('Empty folder.');
      return;
    }

    for (const child of children) {
      if (child instanceof TFolder) {
        this.renderFolderRow(child);
      } else if (child instanceof TFile && child.extension === 'md') {
        const note: NavNote = { file: child, relation: 'child' };
        await this.renderCard(this.contentEl, note, activeFile, null);
      }
    }
  }

  private renderFolderRow(folder: TFolder) {
    const row = this.contentEl.createDiv('bread-trail-nav-folder-row');

    const iconEl = row.createSpan('bread-trail-nav-folder-icon');
    setIcon(iconEl, 'folder');

    row.createSpan({ text: folder.name, cls: 'bread-trail-nav-folder-name' });

    row.addEventListener('click', () => {
      this.folderStack.push(folder.path);
      void this.refresh();
    });
  }

  // ── Recent mode ────────────────────────────────────────────────────────────

  private async renderRecent(activeFile: TFile | null, bc: BreadcrumbsPlugin | null) {
    const sortField = this.settings.navigatorRecentSortField;
    const limit = this.settings.navigatorRecentLimit;

    let files = this.app.vault.getMarkdownFiles()
      .filter((f) => !this.isExcluded(f));

    // Local mode: restrict to siblings (children of the active note's parents)
    if (this.recentViewMode === 'local' && activeFile && bc) {
      const siblingPaths = this.getSiblingPaths(activeFile, bc);
      if (siblingPaths.size > 0) {
        files = files.filter((f) => siblingPaths.has(f.path));
      } else {
        this.renderEmpty('No siblings found for the active note.');
        return;
      }
    }

    // Sort by frontmatter field if configured, otherwise by file mtime (newest first)
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
      this.renderEmpty('No notes found.');
      return;
    }

    const metaProps = this.settings.navigatorRecentMetaProperties;
    for (const file of shown) {
      const note: NavNote = { file, relation: 'child' };
      await this.renderCard(this.contentEl, note, activeFile, null, metaProps, file);
    }
  }

  /** Return the set of file paths that are siblings of `file` in the BC graph
   *  (i.e. other children of file's direct parents). Includes the file itself. */
  private getSiblingPaths(file: TFile, bc: BreadcrumbsPlugin): Set<string> {
    const parentPaths = new Set<string>();

    // Collect parents via outgoing 'up' edges and incoming 'down' edges
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
      // Children via outgoing 'down' from parent
      for (const e of bc.graph.get_outgoing_edges(parentPath).to_array()) {
        if (e.edge_type?.toLowerCase() !== 'down') continue;
        const cp = e.target_path?.(bc.graph) ?? e.target;
        if (cp) siblings.add(cp);
      }
      // Children via incoming 'up' to parent
      for (const e of bc.graph.get_incoming_edges(parentPath).to_array()) {
        if (e.edge_type?.toLowerCase() !== 'up') continue;
        const cp = e.source_path?.(bc.graph) ?? e.source;
        if (cp) siblings.add(cp);
      }
    }

    return siblings;
  }

  // ── Favorites mode ─────────────────────────────────────────────────────────

  private async renderFavorites(activeFile: TFile | null) {
    const pinnedPaths = new Set(this.settings.navigatorFavorites);

    // Collect all markdown files that are either pinned or have bread-trail.favorite: true
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      if (pinnedPaths.has(f.path)) return true;
      const bt = this.getBreadTrailFm(f);
      return bt?.['favorite'] === true;
    });

    // Sort: pinned first (in settings order), then frontmatter favorites alphabetically
    files.sort((a, b) => {
      const aIdx = this.settings.navigatorFavorites.indexOf(a.path);
      const bIdx = this.settings.navigatorFavorites.indexOf(b.path);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.basename.localeCompare(b.basename);
    });

    if (files.length === 0) {
      this.renderEmpty('No favorites yet. Add bread-trail.favorite: true to a note, or pin paths in settings.');
      return;
    }

    const metaProps = this.settings.navigatorFavoritesMetaProperties;
    for (const file of files) {
      const note: NavNote = { file, relation: 'child' };
      await this.renderCard(this.contentEl, note, activeFile, null, metaProps);
    }
  }

  // ── Section rendering ──────────────────────────────────────────────────────

  private renderEmpty(text: string) {
    this.contentEl.createEl('p', { text, cls: 'bread-trail-nav-empty' });
  }

  private renderSectionHeader(
    section: HTMLElement,
    label: string,
    icon: string,
    sort: SortState | null,
    sectionId: string,
    collapsible: boolean,
  ) {
    const header = section.createDiv('bread-trail-nav-section-header');

    if (collapsible) {
      const collapsed = this.collapsedSections.has(sectionId);
      const collapseBtn = header.createSpan('bread-trail-nav-collapse-btn');
      setIcon(collapseBtn, collapsed ? 'chevron-right' : 'chevron-down');
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');

      header.addEventListener('click', () => {
        if (this.collapsedSections.has(sectionId)) {
          this.collapsedSections.delete(sectionId);
        } else {
          this.collapsedSections.add(sectionId);
        }
        void this.refresh();
      });
      header.addClass('is-clickable');
    }

    const iconEl = header.createSpan('bread-trail-nav-section-icon');
    setIcon(iconEl, icon);
    header.createSpan({ text: label, cls: 'bread-trail-nav-section-label' });

    if (sort) {
      const sortBtn = header.createEl('button', { cls: 'bread-trail-nav-sort-btn' });
      setIcon(sortBtn, SORT_ICON[sort.mode]);
      sortBtn.setAttribute('aria-label', SORT_LABEL[sort.mode]);
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cycleSort(sectionId);
      });
    }
  }

  private async renderSection(
    sectionId: string,
    label: string,
    icon: string,
    notes: NavNote[],
    sort: SortState | null,
    activeFile: TFile | null,
    collapsible = false,
    groupBy: string | null = null,
  ) {
    const bc = this.getBc();
    const isChain = sectionId.startsWith('chain');
    const section = this.contentEl.createDiv(`bread-trail-nav-section bread-trail-nav-section-${sectionId}`);
    this.renderSectionHeader(section, label, icon, sort, sectionId, collapsible);

    if (collapsible && this.collapsedSections.has(sectionId)) return;

    const drillInFor = (note: NavNote) => {
      const hasKids = bc ? this.hasChildren(note.file, bc) : false;
      return hasKids && !isChain
        ? (f: TFile) => { this.browserStack.push(f); this.setMode('browser'); }
        : null;
    };

    if (groupBy) {
      for (const [groupValue, groupNotes] of this.groupNotes(notes, groupBy)) {
        const groupEl = section.createDiv('bread-trail-nav-group');
        groupEl.createDiv('bread-trail-nav-group-header').createSpan({
          text: groupValue,
          cls: 'bread-trail-nav-group-label',
        });
        for (const note of groupNotes) {
          await this.renderCard(groupEl, note, activeFile, drillInFor(note));
        }
      }
    } else {
      for (const note of notes) {
        await this.renderCard(section, note, activeFile, drillInFor(note));
      }
    }
  }

  // ── Card rendering ─────────────────────────────────────────────────────────

  /**
   * @param onDrillIn  If provided, a `›` chevron button appears; clicking it calls this.
   *                   Clicking the card body always opens the file.
   */
  private async renderCard(
    parent: HTMLElement,
    note: NavNote,
    activeFile: TFile | null,
    onDrillIn: ((file: TFile) => void) | null,
    metaPropsOverride?: string[],
    recentFile?: TFile,   // when set, auto-renders the modification time/date
  ) {
    const isCurrent = note.relation === 'current';
    const isActive = activeFile?.path === note.file.path;

    const card = parent.createDiv(
      `bread-trail-nav-card bread-trail-nav-card-${note.relation}` +
      (isCurrent || isActive ? ' is-current' : '') +
      (onDrillIn ? ' has-children' : ''),
    );

    // Title row
    const titleRow = card.createDiv('bread-trail-nav-card-title-row');
    if (note.seqPos !== undefined) {
      titleRow.createSpan({ text: String(note.seqPos), cls: 'bread-trail-nav-card-pos' });
    }
    titleRow.createSpan({ text: this.getLabel(note.file), cls: 'bread-trail-nav-card-title' });

    // Chevron — its own button, separate from the card click
    if (onDrillIn) {
      const chevron = titleRow.createEl('button', { cls: 'bread-trail-nav-card-chevron' });
      setIcon(chevron, 'chevron-right');
      chevron.setAttribute('aria-label', 'Browse children');
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        onDrillIn(note.file);
      });
    }

    // Frontmatter meta rows + optional auto timestamp for recent view
    const metaProps = metaPropsOverride ?? this.settings.navigatorMetaProperties;
    const hasAnyMeta = metaProps.length > 0 || recentFile !== undefined;
    if (hasAnyMeta) {
      const metaEl = card.createDiv('bread-trail-nav-card-meta');

      // Recent view: show the sort value only when the user hasn't configured their own meta props
      if (recentFile && metaProps.length === 0) {
        const sortField = this.settings.navigatorRecentSortField;
        let timeLabel: string;
        if (sortField) {
          const raw = this.getFmString(recentFile, sortField);
          timeLabel = raw ? formatDateValue(raw) : formatDateValue(recentFile.stat.mtime);
        } else {
          timeLabel = formatDateValue(recentFile.stat.mtime);
        }
        const row = metaEl.createDiv('bread-trail-nav-card-meta-row bread-trail-nav-card-meta-row-time');
        row.createSpan({ text: timeLabel, cls: 'bread-trail-nav-card-meta-val bread-trail-nav-card-meta-time' });
      }

      // Configured meta props — value only, no key label
      if (metaProps.length > 0) {
        for (const prop of metaProps) {
          const val = this.getFmString(note.file, prop);
          if (!val) continue;
          const row = metaEl.createDiv('bread-trail-nav-card-meta-row');
          row.createSpan({ text: formatDateValue(val), cls: 'bread-trail-nav-card-meta-val' });
        }
      }
    }

    // Excerpt + image — only when preview is expanded
    if (this.previewExpanded) {
      // Populate caches on first visit
      if (!this.snippetCache.has(note.file.path)) {
        try {
          const content = await this.app.vault.cachedRead(note.file);
          this.snippetCache.set(note.file.path, extractContentSnippet(content, 12));
          this.imageCache.set(note.file.path, extractFirstImageLink(content));
        } catch {
          this.snippetCache.set(note.file.path, '');
          this.imageCache.set(note.file.path, null);
        }
      }

      // Thumbnail — only when the image isn't already inside the rendered snippet
      const snippet = this.snippetCache.get(note.file.path) ?? '';
      const imageLink = this.imageCache.get(note.file.path);
      if (imageLink && !snippet.includes(imageLink)) {
        const imageFile = this.app.metadataCache.getFirstLinkpathDest(imageLink, note.file.path);
        if (imageFile instanceof TFile) {
          const img = card.createEl('img', { cls: 'bread-trail-nav-card-image' });
          img.src = this.app.vault.getResourcePath(imageFile);
          img.alt = imageFile.basename;
          img.loading = 'lazy';
        }
      }

      // Rendered markdown snippet — handles tables, lists, inline images, etc.
      if (snippet) {
        const excerptEl = card.createDiv('bread-trail-nav-card-excerpt');
        await MarkdownRenderer.render(this.app, snippet, excerptEl, note.file.path, this);
      }
    }

    // Tap card → always open the file (unless this IS the current note)
    if (!isCurrent) {
      card.addEventListener('click', () => {
        void this.app.workspace.getLeaf().openFile(note.file);
      });
    }
  }
}
