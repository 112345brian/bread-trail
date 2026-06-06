/**
 * Floating navigator panel.
 *
 * One instance is created per markdown leaf per configured side (left/right).
 * The panel is an absolutely-positioned `div` injected into `.view-content`
 * (which has `position: relative` in Obsidian). CSS handles hover expand/collapse
 * entirely — no JS mouse polling needed.
 *
 * Lifecycle:
 *   1. `new FloatingNavPanel(...)` — create (no DOM yet)
 *   2. `attach()` — inject into the view's DOM
 *   3. `refresh()` — rebuild content (call on file change / graph update)
 *   4. `detach()` — remove from DOM
 */

import { App, MarkdownView, TFile, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import { formatDateValue } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type ChainRelation = 'previous' | 'current' | 'next';

interface ChainNote {
  file: TFile;
  relation: ChainRelation;
}

interface Neighborhood {
  parents: TFile[];
  chains: Array<{ path: string; notes: ChainNote[] }>;
  children: TFile[];
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
    private readonly onPin: () => void,
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
    const inner = this.container.createDiv('bt-float-inner');

    // Toolbar (pin button)
    const toolbar = inner.createDiv('bt-float-toolbar');
    const pinBtn = toolbar.createEl('button', {
      cls: 'bt-float-pin-btn',
      attr: { 'aria-label': 'Open in sidebar' },
    });
    setIcon(pinBtn, this.side === 'left' ? 'panel-left-open' : 'panel-right-open');
    pinBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onPin(); });

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
      this.renderSection(inner, 'Parents', 'arrow-up', parents, file, metaProps);
    }
    for (const { path: chainPath, notes } of chains) {
      this.renderChain(inner, chainPath || 'Chain', notes, file, metaProps);
    }
    if (children.length > 0) {
      children.sort((a, b) => a.basename.localeCompare(b.basename));
      this.renderSection(inner, 'Children', 'arrow-down', children, file, metaProps);
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

    const add = (path: string | undefined, arr: TFile[]) => {
      if (!path || seen.has(path)) return;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return;
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
    // Incoming next.* → source is our prev
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    // Outgoing prev.* → target is our prev
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
    // Outgoing next.* → target is our next
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== nextType) continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) return f;
    }
    // Incoming prev.* → source is our next
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

    const chain: ChainNote[] = [];
    before.forEach((f) => chain.push({ file: f, relation: 'previous' }));
    chain.push({ file, relation: 'current' });
    after.forEach((f) => chain.push({ file: f, relation: 'next' }));
    return chain;
  }

  // ── DOM rendering ──────────────────────────────────────────────────────────

  private renderSection(
    parent: HTMLElement,
    label: string,
    icon: string,
    files: TFile[],
    activeFile: TFile,
    metaProps: string[],
  ): void {
    const section = parent.createDiv('bt-float-section');
    const header = section.createDiv('bt-float-section-header');
    const iconEl = header.createSpan('bt-float-section-icon');
    setIcon(iconEl, icon);
    header.createSpan({ text: label, cls: 'bt-float-section-label' });
    for (const file of files) {
      this.renderRow(section, file, file.path === activeFile.path, null, metaProps);
    }
  }

  private renderChain(
    parent: HTMLElement,
    label: string,
    notes: ChainNote[],
    activeFile: TFile,
    metaProps: string[],
  ): void {
    const section = parent.createDiv('bt-float-section');
    const header = section.createDiv('bt-float-section-header');
    const iconEl = header.createSpan('bt-float-section-icon');
    setIcon(iconEl, 'list-ordered');
    header.createSpan({ text: label, cls: 'bt-float-section-label' });
    for (const { file, relation } of notes) {
      this.renderRow(section, file, file.path === activeFile.path, relation, metaProps);
    }
  }

  private renderRow(
    parent: HTMLElement,
    file: TFile,
    isActive: boolean,
    relation: ChainRelation | null,
    metaProps: string[],
  ): void {
    const row = parent.createDiv('bt-float-row');
    if (isActive) row.addClass('is-active');
    if (relation) row.dataset['relation'] = relation;

    row.createSpan({ text: file.basename, cls: 'bt-float-row-title' });

    // Show the first matching meta property (keeping the float compact)
    if (metaProps.length > 0) {
      const fm: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm) {
        for (const prop of metaProps) {
          const val = typeof fm === 'object' && !Array.isArray(fm) ? (fm as Record<string, unknown>)[prop] : undefined;
          if (val == null) continue;
          const raw = typeof val === 'number' || typeof val === 'string' ? val : '';
          if (!raw) continue;
          row.createSpan({ text: formatDateValue(raw), cls: 'bt-float-row-meta' });
          break;
        }
      }
    }

    row.addEventListener('click', (e) => {
      const newTab = e.ctrlKey || e.metaKey;
      const leaf = newTab ? this.app.workspace.getLeaf('tab') : this.view.leaf;
      void leaf.openFile(file);
    });
  }
}
