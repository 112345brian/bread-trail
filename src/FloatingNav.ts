/**
 * Floating navigator panel.
 *
 * One instance is created per markdown leaf per configured side (left/right).
 * The panel is an absolutely-positioned `div` injected into `.view-content`
 * (which has `position: relative` in Obsidian). CSS handles hover expand/collapse
 * entirely — no JS mouse polling needed.
 *
 * Cards use the same `.bread-trail-nav-card-*` CSS classes as NavigatorView so
 * the floating panel looks visually identical to the sidebar context mode.
 *
 * Lifecycle:
 *   1. `new FloatingNavPanel(...)` — create (no DOM yet)
 *   2. `attach()` — inject into the view's DOM
 *   3. `refresh()` — rebuild content (call on file change / graph update)
 *   4. `detach()` — remove from DOM
 */

import { App, MarkdownView, Menu, TFile, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import { formatDateValue, isExcluded } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type ChainRelation = 'previous' | 'current' | 'next';

interface ChainNote {
  file: TFile;
  relation: ChainRelation;
  seqPos: number;
  seqTotal: number;
}

interface Neighborhood {
  parents: TFile[];
  chains: Array<{ path: string; notes: ChainNote[] }>;
  children: TFile[];
}

interface FloatingNavActions {
  pinToSidebar(): void;
  openGraph(): void;
  openExplorer(): void;
  openQuickSwitcher(): void;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export class FloatingNavPanel {
  private readonly container: HTMLElement;

  constructor(
    private readonly view: MarkdownView,
    private readonly app: App,
    private readonly getSettings: () => BreadTrailSettings,
    private readonly getBc: () => BreadcrumbsPlugin | null,
    readonly side: 'left' | 'right',
    private readonly actions: FloatingNavActions,
  ) {
    this.container = activeDocument.createElement('div');
    this.container.className = `bt-float bt-float-${side}`;
  }

  attach(): void {
    // Inject before the editor/reading view element, inside .view-content.
    // .view-content already has position:relative in Obsidian, but we set it
    // explicitly to be safe (same strategy as obsidian-floating-toc-plugin).
    const anchor =
      this.view.containerEl.querySelector<HTMLElement>('.markdown-source-view') ??
      this.view.containerEl.querySelector<HTMLElement>('.markdown-reading-view') ??
      this.view.containerEl.querySelector<HTMLElement>('.view-content');

    const host = anchor?.parentElement ?? this.view.containerEl;

    if (anchor && anchor.parentElement === host) {
      anchor.insertAdjacentElement('beforebegin', this.container);
    } else {
      host.appendChild(this.container);
    }

    this.build();
  }

  detach(): void {
    this.container.remove();
  }

  refresh(): void {
    this.container.empty();
    this.build();
  }

  // ── Content building ───────────────────────────────────────────────────────

  private build(): void {
    const file = this.view.file;
    const bc = this.getBc();

    // Use `bread-trail-nav` so the existing card/button CSS resets apply here too
    const inner = this.container.createDiv('bt-float-inner bread-trail-nav');

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const toolbar = inner.createDiv('bt-float-toolbar');
    this.renderToolbarButton(toolbar, 'search', 'Quick switch related notes', () => this.actions.openQuickSwitcher());
    this.renderToolbarButton(toolbar, 'network', 'Open graph switcher', () => this.actions.openGraph());
    this.renderToolbarButton(toolbar, 'layout-grid', 'Open tile explorer', () => this.actions.openExplorer());
    this.renderToolbarButton(toolbar, this.side === 'left' ? 'panel-left-open' : 'panel-right-open', 'Pin to sidebar', () => this.actions.pinToSidebar());

    if (!file || file.extension !== 'md') {
      inner.createEl('p', { text: 'Open a note to see context.', cls: 'bt-float-empty' });
      return;
    }
    if (!bc) {
      inner.createEl('p', { text: 'Breadcrumbs not detected.', cls: 'bt-float-empty' });
      return;
    }

    const { parents, chains, children } = this.buildNeighborhood(file, bc);
    const settings = this.getSettings();
    const metaProps = settings.navigatorMetaProperties;

    if (parents.length === 0 && chains.length === 0 && children.length === 0) {
      inner.createEl('p', { text: 'No relationships.', cls: 'bt-float-empty' });
      return;
    }

    if (parents.length > 0) {
      this.renderSection(inner, 'Parents', 'arrow-up', parents, file, metaProps, null);
    }
    for (const { path: chainPath, notes } of chains) {
      this.renderChain(inner, chainPath || 'Chain', notes, file, metaProps);
    }
    if (children.length > 0) {
      children.sort((a, b) => a.basename.localeCompare(b.basename));
      this.renderSection(inner, 'Children', 'arrow-down', children, file, metaProps, null);
    }
  }

  // ── Neighborhood (mirrors NavigatorView.buildNeighborhood) ─────────────────

  private buildNeighborhood(file: TFile, bc: BreadcrumbsPlugin): Neighborhood {
    const chainPaths = this.getChainPaths(file, bc);
    const chains: Array<{ path: string; notes: ChainNote[] }> = [];
    const chainFilePaths = new Set<string>();

    for (const chainPath of chainPaths) {
      const notes = this.buildChainForPath(file, bc, chainPath);
      if (notes.length > 0) {
        chains.push({ path: chainPath, notes });
        notes.forEach((n) => chainFilePaths.add(n.file.path));
      }
    }

    const seen = new Set<string>([file.path, ...chainFilePaths]);
    const parents: TFile[] = [];
    const children: TFile[] = [];

    const settings = this.getSettings();
    const add = (path: string | undefined, arr: TFile[]) => {
      if (!path || seen.has(path)) return;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return;
      if (isExcluded(f, this.app, settings)) return;
      seen.add(path);
      arr.push(f);
    };

    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      const path = e.target_path?.(bc.graph) ?? e.target;
      const type = e.edge_type?.toLowerCase();
      if (type === 'up')   add(path, parents);
      if (type === 'down') add(path, children);
    }
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      const path = e.source_path?.(bc.graph) ?? e.source;
      const type = e.edge_type?.toLowerCase();
      if (type === 'up')   add(path, children);
      if (type === 'down') add(path, parents);
    }

    return { parents, chains, children };
  }

  private getChainPaths(file: TFile, bc: BreadcrumbsPlugin): string[] {
    const paths = new Set<string>();
    const check = (t: string | undefined) => {
      const lower = t?.toLowerCase() ?? '';
      if (lower === 'next' || lower === 'prev') {
        paths.add('');
      } else if (lower.startsWith('next.') || lower.startsWith('prev.')) {
        paths.add(lower.split('.').slice(1).join('.'));
      }
    };
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) check(e.edge_type);
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) check(e.edge_type);
    return [...paths].sort();
  }

  private findPrevForPath(
    file: TFile,
    bc: BreadcrumbsPlugin,
    chainPath: string,
    seen: Set<string>,
  ): TFile | null {
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

  private findNextForPath(
    file: TFile,
    bc: BreadcrumbsPlugin,
    chainPath: string,
    seen: Set<string>,
  ): TFile | null {
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

  private buildChainForPath(
    file: TFile,
    bc: BreadcrumbsPlugin,
    chainPath: string,
  ): ChainNote[] {
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
    const chain: ChainNote[] = [];
    before.forEach((f, i)  => chain.push({ file: f, relation: 'previous', seqPos: i + 1, seqTotal: total }));
    chain.push({ file, relation: 'current', seqPos: before.length + 1, seqTotal: total });
    after.forEach((f, i)   => chain.push({ file: f, relation: 'next',     seqPos: before.length + 2 + i, seqTotal: total }));
    return chain;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getLabel(file: TFile): string {
    return file.basename;
  }

  /** Read a frontmatter value as a string, handling arrays. */
  private getFmString(file: TFile, key: string): string | null {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as unknown;
    if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return null;
    const val = (fm as Record<string, unknown>)[key];
    if (val == null) return null;
    if (Array.isArray(val)) {
      const first = (val as unknown[])[0];
      return typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean'
        ? String(first)
        : null;
    }
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
    return null;
  }

  // ── DOM rendering ──────────────────────────────────────────────────────────

  private renderToolbarButton(toolbar: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const button = toolbar.createEl('button', {
      cls: 'bt-float-toolbar-btn',
      attr: { 'aria-label': label },
    });
    setIcon(button, icon);
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
  }

  private renderSection(
    parent: HTMLElement,
    label: string,
    icon: string,
    files: TFile[],
    activeFile: TFile,
    metaProps: string[],
    _sort: null,
  ): void {
    const section = parent.createDiv('bread-trail-nav-section bt-float-section');
    const header = section.createDiv('bread-trail-nav-section-header');
    const iconEl = header.createSpan('bread-trail-nav-section-icon');
    setIcon(iconEl, icon);
    header.createSpan({ text: label, cls: 'bread-trail-nav-section-label' });
    for (const file of files) {
      this.renderCard(section, file, 'child', undefined, undefined, file.path === activeFile.path, metaProps);
    }
  }

  private renderChain(
    parent: HTMLElement,
    label: string,
    notes: ChainNote[],
    activeFile: TFile,
    metaProps: string[],
  ): void {
    const total = notes[0]?.seqTotal ?? notes.length;
    const section = parent.createDiv('bread-trail-nav-section bt-float-section');
    const header = section.createDiv('bread-trail-nav-section-header');
    const iconEl = header.createSpan('bread-trail-nav-section-icon');
    setIcon(iconEl, 'list-ordered');
    header.createSpan({ text: `${label}  ·  ${total}`, cls: 'bread-trail-nav-section-label' });
    for (const { file, relation, seqPos } of notes) {
      this.renderCard(section, file, relation, seqPos, total, file.path === activeFile.path, metaProps);
    }
  }

  /**
   * Renders a card using the same `.bread-trail-nav-card-*` CSS classes as
   * NavigatorView so the floating panel looks identical to the sidebar.
   * No markdown preview is rendered (keeps the float lightweight).
   */
  private renderCard(
    parent: HTMLElement,
    file: TFile,
    relation: ChainRelation | 'child' | 'parent',
    seqPos: number | undefined,
    _seqTotal: number | undefined,
    isActive: boolean,
    metaProps: string[],
  ): void {
    const isCurrent = relation === 'current';
    const card = parent.createDiv(
      `bread-trail-nav-card bread-trail-nav-card-${relation}${isCurrent || isActive ? ' is-current' : ''}`,
    );

    // Title row
    const titleRow = card.createDiv('bread-trail-nav-card-title-row');
    if (seqPos !== undefined) {
      titleRow.createSpan({ text: String(seqPos), cls: 'bread-trail-nav-card-pos' });
    }
    titleRow.createSpan({ text: this.getLabel(file), cls: 'bread-trail-nav-card-title' });

    // Meta rows — all configured props, value-only (same as sidebar)
    if (metaProps.length > 0) {
      let hasAny = false;
      const metaEl = card.createDiv('bread-trail-nav-card-meta');
      for (const prop of metaProps) {
        const val = this.getFmString(file, prop);
        if (!val) continue;
        hasAny = true;
        const row = metaEl.createDiv('bread-trail-nav-card-meta-row');
        row.createSpan({ text: formatDateValue(val), cls: 'bread-trail-nav-card-meta-val' });
      }
      if (!hasAny) metaEl.remove();
    }

    card.addEventListener('click', (e) => {
      const newTab = e.ctrlKey || e.metaKey;
      const leaf = newTab ? this.app.workspace.getLeaf('tab') : this.view.leaf;
      void leaf.openFile(file);
    });

    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      this.app.workspace.trigger('file-menu', menu, file, 'bread-trail-float', this.view.leaf);
      this.addBreadbakeMenuItem(menu, file);
      menu.showAtMouseEvent(e);
    });
  }

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
          const leaf = this.app.workspace.getMostRecentLeaf() ?? this.view.leaf;
          await leaf.openFile(file);
          (this.app as { commands?: { executeCommandById(id: string): void } })
            .commands?.executeCommandById('breadbake:bake-active-file');
        });
    });
  }
}
