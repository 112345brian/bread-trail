import { App, Modal, TFile, setIcon } from 'obsidian';
import { render, h } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';
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
  /** Folder tiles only: long-press (500 ms hold) opens the note itself. */
  onLongPress?: () => void;
}

function Tile({ file, isFolder, isActive, label, onTap, onLongPress }: TileProps) {
  const timerRef = useRef<number | null>(null);
  const didFire  = useRef(false);

  const cancelTimer = () => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const handleTouchStart = () => {
    if (!onLongPress) return;
    didFire.current = false;
    timerRef.current = window.setTimeout(() => {
      didFire.current = true;
      onLongPress();
    }, 500);
  };

  const handleClick = () => {
    if (didFire.current) return; // long-press already handled — suppress click
    onTap();
  };

  return (
    <button
      class={`bt-explorer-tile${isFolder ? ' is-folder' : ''}${isActive ? ' is-active' : ''}`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelTimer}
      onTouchMove={cancelTimer}
      title={file.basename}
    >
      <div class="bt-explorer-tile-icon">
        <span ref={(el: HTMLSpanElement | null) => {
          if (el) setIcon(el, isFolder ? 'folder-open' : 'file-text');
        }} />
      </div>
      <span class="bt-explorer-tile-label">{label}</span>
      {/* Subtle hint so users know folder notes can be opened */}
      {isFolder && onLongPress && (
        <span class="bt-explorer-tile-open-hint">hold to open</span>
      )}
    </button>
  );
}

// ── Main grid component ───────────────────────────────────────────────────────

interface GridProps {
  app: App;
  bc: BreadcrumbsPlugin;
  labelProp: string;
  activeFile: TFile | null;
  tileMinWidth: number;
  onOpen: (file: TFile) => void;
}

function ExplorerGrid({ app, bc, labelProp, activeFile, tileMinWidth, onOpen }: GridProps) {
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

  // Swipe right anywhere in the grid → go back one level
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onSwipeTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]; if (!t) return;
    swipeStart.current = { x: t.clientX, y: t.clientY };
  };
  const onSwipeTouchEnd = (e: TouchEvent) => {
    const s = swipeStart.current; if (!s) return;
    const t = e.changedTouches[0]; if (!t) { swipeStart.current = null; return; }
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    swipeStart.current = null;
    if (dx > 60 && Math.abs(dy) < 40 && stack.length > 0) goBack();
  };

  return (
    <div class="bt-explorer-root"
      onTouchStart={onSwipeTouchStart}
      onTouchEnd={onSwipeTouchEnd}
    >
      {/* Breadcrumb path — back button lives here so it's at the top on mobile,
          safely away from Android's bottom system-navigation zone */}
      <div class="bt-explorer-crumbs">
        {stack.length > 0 && (
          <button class="bt-explorer-crumb-btn bt-explorer-crumb-back" onClick={goBack}
            aria-label="Back">
            <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'arrow-left'); }} />
          </button>
        )}
        <button class="bt-explorer-crumb-btn" onClick={() => setStack([])} aria-label="Home">
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
        <div class="bt-explorer-grid"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileMinWidth}px, 1fr))` }}
        >
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
                onLongPress={isFolder ? () => onOpen(file) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export class ExplorerModal extends Modal {
  private bc: BreadcrumbsPlugin;
  private labelProp: string;
  private tileMinWidth: number;
  private onClosed?: () => void;

  constructor(app: App, bc: BreadcrumbsPlugin, labelProp: string, tileMinWidth: number, onClosed?: () => void) {
    super(app);
    this.bc = bc;
    this.labelProp = labelProp;
    this.tileMinWidth = tileMinWidth;
    this.onClosed = onClosed;
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
        tileMinWidth: this.tileMinWidth,
        onOpen: (file: TFile) => {
          const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
          void leaf.openFile(file);
          this.close();
        },
      }),
      contentEl,
    );

    // Swipe down anywhere in the modal to dismiss (mirrors swipe-up-to-open gesture)
    let startY = -1, startX = 0;
    const MIN_SWIPE_DOWN = 80;   // px downward
    const MAX_HORIZ      = 60;   // px horizontal drift allowed
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return;
      startY = t.clientY; startX = t.clientX;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (startY < 0) return;
      const t = e.changedTouches[0]; if (!t) { startY = -1; return; }
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      startY = -1;
      if (dy > MIN_SWIPE_DOWN && Math.abs(dx) < MAX_HORIZ) this.close();
    };
    this.modalEl.addEventListener('touchstart', onTouchStart, { passive: true });
    this.modalEl.addEventListener('touchend',   onTouchEnd,   { passive: true });
  }

  onClose() {
    render(null, this.contentEl);
    this.onClosed?.();
  }
}
