import { App, Modal, TFile, setIcon } from 'obsidian';
import { render, h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import type { BreadcrumbsPlugin } from './main';

// ── BC graph helpers (self-contained so we don't depend on NavigatorView) ─────

function getChildren(file: TFile, bc: BreadcrumbsPlugin, app: App): TFile[] {
  const seen = new Set<string>([file.path]);
  const children: TFile[] = [];
  const add = (path: string | undefined) => {
    if (!path || seen.has(path)) return;
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    seen.add(path);
    children.push(f);
  };
  for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
    if (e.edge_type?.toLowerCase() === 'down') add(e.target_path?.(bc.graph) ?? e.target);
  }
  for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
    if (e.edge_type?.toLowerCase() === 'up') add(e.source_path?.(bc.graph) ?? e.source);
  }
  return children.sort((a, b) => a.basename.localeCompare(b.basename));
}

function hasChildren(file: TFile, bc: BreadcrumbsPlugin): boolean {
  for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
    if (e.edge_type?.toLowerCase() === 'down') return true;
  }
  for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
    if (e.edge_type?.toLowerCase() === 'up') return true;
  }
  return false;
}

function getVaultRoots(bc: BreadcrumbsPlugin, app: App): TFile[] {
  const roots: TFile[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!hasChildren(file, bc)) continue;
    const hasParent =
      bc.graph.get_outgoing_edges(file.path).to_array().some((e) => e.edge_type?.toLowerCase() === 'up') ||
      bc.graph.get_incoming_edges(file.path).to_array().some((e) => e.edge_type?.toLowerCase() === 'down');
    if (!hasParent) roots.push(file);
  }
  return roots.sort((a, b) => a.basename.localeCompare(b.basename));
}

function getLabel(file: TFile, labelProp: string): string {
  if (!labelProp) return file.basename;
  const fm = (file as unknown as { cache?: { frontmatter?: Record<string, unknown> } }).cache?.frontmatter;
  const val: unknown = fm?.[labelProp];
  if (Array.isArray(val) && val.length > 0) return String(val[0]);
  if (typeof val === 'string' && val.trim()) return val.trim();
  return file.basename;
}

// ── Tile component ────────────────────────────────────────────────────────────

interface TileProps {
  file: TFile;
  isFolder: boolean;
  isActive: boolean;
  label: string;
  onTap: () => void;
}

function Tile({ file, isFolder, isActive, label, onTap }: TileProps) {
  return (
    <button
      class={`bt-explorer-tile${isFolder ? ' is-folder' : ''}${isActive ? ' is-active' : ''}`}
      onClick={onTap}
      title={file.basename}
    >
      <div class="bt-explorer-tile-icon">
        <span ref={(el: HTMLSpanElement | null) => {
          if (el) setIcon(el, isFolder ? 'folder-open' : 'file-text');
        }} />
      </div>
      <span class="bt-explorer-tile-label">{label}</span>
    </button>
  );
}

// ── Main grid component ───────────────────────────────────────────────────────

interface GridProps {
  app: App;
  bc: BreadcrumbsPlugin;
  labelProp: string;
  activeFile: TFile | null;
  onOpen: (file: TFile) => void;
}

function ExplorerGrid({ app, bc, labelProp, activeFile, onOpen }: GridProps) {
  const [stack, setStack] = useState<TFile[]>(() => {
    // Start at active file's parent, or vault roots
    if (activeFile) {
      for (const e of bc.graph.get_outgoing_edges(activeFile.path).to_array()) {
        if (e.edge_type?.toLowerCase() !== 'up') continue;
        const path = e.target_path?.(bc.graph) ?? e.target;
        if (!path) continue;
        const f = app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) return [f];
      }
    }
    return [];
  });

  const current = stack[stack.length - 1] ?? null;
  const items: TFile[] = current ? getChildren(current, bc, app) : getVaultRoots(bc, app);

  const drillIn = useCallback((file: TFile) => {
    setStack((s) => [...s, file]);
  }, []);

  const goBack = useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  const goToIndex = useCallback((idx: number) => {
    setStack((s) => s.slice(0, idx + 1));
  }, []);

  return (
    <div class="bt-explorer-root">
      {/* Breadcrumb path */}
      <div class="bt-explorer-crumbs">
        <button class="bt-explorer-crumb-btn" onClick={() => setStack([])}>
          <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'home'); }} />
        </button>
        {stack.map((f, i) => (
          <>
            <span class="bt-explorer-crumb-sep">›</span>
            <button key={f.path} class="bt-explorer-crumb-btn" onClick={() => goToIndex(i)}>
              {getLabel(f, labelProp)}
            </button>
          </>
        ))}
      </div>

      {/* Tile grid */}
      {items.length === 0 ? (
        <p class="bt-explorer-empty">Nothing here.</p>
      ) : (
        <div class="bt-explorer-grid">
          {items.map((file) => {
            const isFolder = hasChildren(file, bc);
            return (
              <Tile
                key={file.path}
                file={file}
                isFolder={isFolder}
                isActive={file.path === activeFile?.path}
                label={getLabel(file, labelProp)}
                onTap={() => isFolder ? drillIn(file) : onOpen(file)}
              />
            );
          })}
        </div>
      )}

      {/* Back button */}
      {stack.length > 0 && (
        <div class="bt-explorer-footer">
          <button class="bt-explorer-back-btn" onClick={goBack}>
            <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'arrow-left'); }} />
            Back
          </button>
        </div>
      )}
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export class ExplorerModal extends Modal {
  private bc: BreadcrumbsPlugin;
  private labelProp: string;

  constructor(app: App, bc: BreadcrumbsPlugin, labelProp: string) {
    super(app);
    this.bc = bc;
    this.labelProp = labelProp;
    this.modalEl.addClass('bt-explorer-modal');
  }

  onOpen() {
    const { contentEl } = this;
    const activeFile = this.app.workspace.getActiveFile();

    render(
      h(ExplorerGrid, {
        app: this.app,
        bc: this.bc,
        labelProp: this.labelProp,
        activeFile,
        onOpen: (file: TFile) => {
          const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
          void leaf.openFile(file);
          this.close();
        },
      }),
      contentEl,
    );
  }

  onClose() {
    render(null, this.contentEl);
  }
}
