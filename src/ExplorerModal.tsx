import { App, Modal, Menu, TFile, setIcon } from 'obsidian';
import { render, h } from 'preact';
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import { shouldIncludeVaultRoot } from './homepageRoots';

// ── BC graph helpers (self-contained so we don't depend on NavigatorView) ─────

/** Mirror of NavigatorView.isExcluded — keeps the modal consistent with the sidebar. */
function isExcluded(file: TFile, app: App, settings: BreadTrailSettings): boolean {
  const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
  const bt = fm && typeof fm === 'object' && !Array.isArray(fm)
    ? (fm as Record<string, unknown>)['bread-trail']
    : undefined;
  if (typeof bt === 'object' && bt !== null && (bt as Record<string, unknown>)['hidden'] === true) return true;
  if (settings.navigatorExcludeFiles.includes(file.path)) return true;
  for (const folder of settings.navigatorExcludeFolders) {
    const prefix = folder.endsWith('/') ? folder : folder + '/';
    if (file.path.startsWith(prefix)) return true;
  }
  if (settings.navigatorExcludeFrontmatter.length > 0) {
    const frontmatter = fm && typeof fm === 'object' && !Array.isArray(fm) ? fm as Record<string, unknown> : {};
    for (const pattern of settings.navigatorExcludeFrontmatter) {
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
  return false;
}

function getChildren(file: TFile, bc: BreadcrumbsPlugin, app: App, settings: BreadTrailSettings): TFile[] {
  const seen = new Set<string>([file.path]);
  const children: TFile[] = [];
  const add = (path: string | undefined) => {
    if (!path || seen.has(path)) return;
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    if (isExcluded(f, app, settings)) return;
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

function hasParent(file: TFile, bc: BreadcrumbsPlugin): boolean {
  return bc.graph.get_outgoing_edges(file.path).to_array().some((e) => e.edge_type?.toLowerCase() === 'up') ||
    bc.graph.get_incoming_edges(file.path).to_array().some((e) => e.edge_type?.toLowerCase() === 'down');
}

function getVaultRoots(bc: BreadcrumbsPlugin, app: App, settings: BreadTrailSettings, rootFolder = ''): TFile[] {
  const roots: TFile[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (shouldIncludeVaultRoot({
      path: file.path,
      hasChildren: hasChildren(file, bc),
      hasParent: hasParent(file, bc),
      excluded: isExcluded(file, app, settings),
    }, rootFolder)) roots.push(file);
  }
  return roots.sort((a, b) => a.basename.localeCompare(b.basename));
}


function isFavorite(
  file: TFile,
  app: App,
  bc: BreadcrumbsPlugin,
  pinnedPaths: Set<string>,
  parentNotePath: string,
): boolean {
  if (pinnedPaths.has(file.path)) return true;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter as unknown;
  const btFm = fm && typeof fm === 'object' && !Array.isArray(fm)
    ? (fm as Record<string, unknown>)['bread-trail']
    : undefined;
  if (typeof btFm === 'object' && btFm !== null && (btFm as Record<string, unknown>)['favorite'] === true) return true;
  if (!parentNotePath) return false;
  for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'up') continue;
    const p = e.target_path?.(bc.graph) ?? e.target;
    if (p === parentNotePath) return true;
  }
  for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'down') continue;
    const p = e.source_path?.(bc.graph) ?? e.source;
    if (p === parentNotePath) return true;
  }
  return false;
}

function getFavorites(
  app: App, bc: BreadcrumbsPlugin, pinnedPaths: string[], parentNotePath: string,
): TFile[] {
  const pinned = new Set(pinnedPaths);
  return app.vault.getMarkdownFiles()
    .filter((f) => isFavorite(f, app, bc, pinned, parentNotePath))
    .sort((a, b) => {
      const ai = pinnedPaths.indexOf(a.path);
      const bi = pinnedPaths.indexOf(b.path);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.basename.localeCompare(b.basename);
    });
}

function getRecents(app: App, count: number, settings: BreadTrailSettings): TFile[] {
  const sortField = settings.navigatorRecentSortField;
  let files = app.vault.getMarkdownFiles().filter((f) => !isExcluded(f, app, settings));
  if (sortField) {
    files.sort((a, b) => {
      const getFm = (f: TFile) => {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        const val = fm ? (fm as Record<string, unknown>)[sortField] : undefined;
        return typeof val === 'string' ? val : typeof val === 'number' ? String(val) : '';
      };
      const fa = getFm(a);
      const fb = getFm(b);
      if (!fa && !fb) return b.stat.mtime - a.stat.mtime;
      if (!fa) return 1;
      if (!fb) return -1;
      return fb.localeCompare(fa);
    });
  } else {
    files.sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  return files.slice(0, count);
}

type ExplorerSortMode = 'alpha' | 'alpha-desc' | 'date-modified' | 'date-created';

// ── Tile component ────────────────────────────────────────────────────────────

interface TileProps {
  file: TFile;
  isFolder: boolean;
  isActive: boolean;
  label: string;
  onTap: () => void;
  /** Folder tiles only: long-press (500 ms hold) opens the note itself. */
  onLongPress?: () => void;
  /** When true, double-tap opens the note directly instead of requiring a long-press. */
  doubleTapToOpen?: boolean;
  /** Optional metadata subtitle shown below the label. */
  meta?: string;
}

function Tile({ file, isFolder, isActive, label, onTap, onLongPress, doubleTapToOpen, meta }: TileProps) {
  const longPressTimer = useRef<number | null>(null);
  const singleTapTimer = useRef<number | null>(null);
  const didLongPress   = useRef(false);
  const lastTapAt      = useRef<number>(0);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handleTouchStart = () => {
    if (!onLongPress) return;
    didLongPress.current = false;
    longPressTimer.current = window.setTimeout(() => {
      didLongPress.current = true;
      onLongPress();
    }, 500);
  };

  const handleClick = () => {
    if (didLongPress.current) return; // long-press already handled — suppress click

    // Double-tap mode: folder tiles use double-tap to open, single-tap to drill in.
    // Non-folder tiles always open immediately.
    if (doubleTapToOpen && onLongPress) {
      const now = Date.now();
      const gap = now - lastTapAt.current;
      lastTapAt.current = now;

      if (gap < 300) {
        // Second tap within window → open the note directly
        if (singleTapTimer.current !== null) {
          window.clearTimeout(singleTapTimer.current);
          singleTapTimer.current = null;
        }
        onLongPress();
      } else {
        // First tap — wait to see if a second follows before drilling in
        if (singleTapTimer.current !== null) window.clearTimeout(singleTapTimer.current);
        singleTapTimer.current = window.setTimeout(() => {
          singleTapTimer.current = null;
          onTap();
        }, 300);
      }
      return;
    }

    onTap();
  };

  return (
    <button
      class={`bt-explorer-tile${isFolder ? ' is-folder' : ''}${isActive ? ' is-active' : ''}`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      title={file.basename}
    >
      <div class="bt-explorer-tile-icon">
        <span ref={(el: HTMLSpanElement | null) => {
          if (el) setIcon(el, isFolder ? 'folder-open' : 'file-text');
        }} />
      </div>
      <span class="bt-explorer-tile-label">{label}</span>
      {meta && <span class="bt-explorer-tile-meta">{meta}</span>}
    </button>
  );
}

// ── Main grid component ───────────────────────────────────────────────────────

interface GridProps {
  app: App;
  bc: BreadcrumbsPlugin;
  settings: BreadTrailSettings;
  activeFile: TFile | null;
  tileMinWidth: number;
  startMode: 'active-parent' | 'home' | 'roots';
  homeNote: string;
  showFavorites: boolean;
  showRecents: boolean;
  recentsCount: number;
  favoritePaths: string[];
  favoritesParentNote: string;
  onOpen: (file: TFile) => void;
  onTitleChange?: (title: string) => void;
  doubleTapToOpen: boolean;
  rootFolder?: string;
  /** When provided, overrides startMode — the stack starts at this file (null = vault roots). */
  startFile?: TFile | null;
}

function ExplorerGrid({ app, bc, settings, activeFile, tileMinWidth, startMode, homeNote, showFavorites, showRecents, recentsCount, favoritePaths, favoritesParentNote, onOpen, onTitleChange, doubleTapToOpen, rootFolder, startFile }: GridProps) {
  const [localTileWidth, setLocalTileWidth] = useState(tileMinWidth);
  const [sortMode, setSortMode] = useState<ExplorerSortMode>('alpha');

  const openMenu = useCallback((e: MouseEvent) => {
    const menu = new Menu();
    const sizes = [
      { label: 'Large', width: 130, icon: 'layout-grid' },
      { label: 'Medium', width: 100, icon: 'grip' },
      { label: 'Small', width: 72, icon: 'table-2' },
    ] as const;
    for (const { label, width, icon } of sizes) {
      menu.addItem((item) => item.setSection('view').setTitle(label).setIcon(icon)
        .setChecked(localTileWidth === width).onClick(() => setLocalTileWidth(width)));
    }
    const sorts = [
      { mode: 'alpha' as const, label: 'A → Z', icon: 'arrow-up-a-z' },
      { mode: 'alpha-desc' as const, label: 'Z → A', icon: 'arrow-down-a-z' },
      { mode: 'date-modified' as const, label: 'Date modified', icon: 'clock' },
      { mode: 'date-created' as const, label: 'Date created', icon: 'calendar-plus' },
    ];
    for (const { mode, label, icon } of sorts) {
      menu.addItem((item) => item.setSection('sort').setTitle(label).setIcon(icon)
        .setChecked(sortMode === mode).onClick(() => setSortMode(mode)));
    }
    menu.showAtMouseEvent(e);
  }, [localTileWidth, sortMode]);

  const [stack, setStack] = useState<TFile[]>(() => {
    // Gesture override: a specific file was requested directly
    if (startFile !== undefined) return startFile ? [startFile] : [];

    if (startMode === 'roots') return [];

    if (startMode === 'home' && homeNote) {
      const f = app.vault.getAbstractFileByPath(homeNote) ??
                app.vault.getAbstractFileByPath(homeNote + '.md');
      if (f instanceof TFile) return [f];
      // fallback: try basename match
      const match = app.vault.getMarkdownFiles().find((x) => x.basename === homeNote || x.path === homeNote);
      if (match) return [match];
    }

    // 'active-parent' (default): start at the parent of the active note
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
  const rawItems: TFile[] = current ? getChildren(current, bc, app, settings) : getVaultRoots(bc, app, settings, rootFolder);
  const items = [...rawItems].sort((a, b) => {
    switch (sortMode) {
      case 'alpha-desc':    return b.basename.localeCompare(a.basename);
      case 'date-modified': return b.stat.mtime - a.stat.mtime;
      case 'date-created':  return b.stat.ctime - a.stat.ctime;
      default:              return a.basename.localeCompare(b.basename);
    }
  });

  // Keep the modal title in sync with the current navigation level
  useEffect(() => {
    const title = current ? current.basename : app.vault.getName();
    onTitleChange?.(title);
  }, [current, onTitleChange]);

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
      {/* Toolbar: breadcrumbs (left) + menu button (right) */}
      <div class="bt-explorer-toolbar">
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
                {f.basename}
              </button>
            </>
          ))}
        </div>
        <button class="bt-explorer-crumb-btn bt-explorer-crumb-menu"
          onClick={openMenu} aria-label="Options">
          <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'more-horizontal'); }} />
        </button>
      </div>

      {/* Scrollable content area: main grid + home sections */}
      <div class="bt-explorer-scroll-area">
      {/* Main tile grid */}
      {items.length === 0 ? (
        <p class="bt-explorer-empty">Nothing here.</p>
      ) : (
        <div class="bt-explorer-grid"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${localTileWidth}px, 1fr))` }}
        >
          {items.map((file) => {
            const isFolder = hasChildren(file, bc);
            return (
              <Tile
                key={file.path}
                file={file}
                isFolder={isFolder}
                isActive={file.path === activeFile?.path}
                label={file.basename}
                onTap={() => isFolder ? drillIn(file) : onOpen(file)}
                onLongPress={isFolder ? () => onOpen(file) : undefined}
                doubleTapToOpen={doubleTapToOpen}
              />
            );
          })}
        </div>
      )}

      {/* Home-level extras: Favorites + Recents (only when at the top level) */}
      {/* Home-level extras: Favorites + Recents */}
      {current === null && (() => {
        const favFiles = showFavorites ? getFavorites(app, bc, favoritePaths, favoritesParentNote) : [];
        const recentFiles = showRecents ? getRecents(app, recentsCount, settings) : [];
        if (favFiles.length === 0 && recentFiles.length === 0) return null;
        const favMetaProps = settings.navigatorFavoritesMetaProperties;
        const getFavMeta = (file: TFile): string | undefined => {
          if (!favMetaProps.length) return undefined;
          const fm = app.metadataCache.getFileCache(file)?.frontmatter;
          if (!fm) return undefined;
          const parts = favMetaProps
            .map((k) => {
              const v = (fm as Record<string, unknown>)[k];
              return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
            })
            .filter(Boolean);
          return parts.length ? parts.join(' · ') : undefined;
        };
        return (
          <>
            {favFiles.length > 0 && (
              <div class="bt-explorer-home-section">
                <div class="bt-explorer-section-header">
                  <span class="bt-explorer-section-icon"
                    ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'star'); }} />
                  <span>Favorites</span>
                </div>
                <div class="bt-explorer-grid"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${localTileWidth}px, 1fr))` }}
                >
                  {favFiles.map((file) => {
                    const isFolder = hasChildren(file, bc);
                    return (
                      <Tile
                        key={file.path}
                        file={file}
                        isFolder={isFolder}
                        isActive={file.path === activeFile?.path}
                        label={file.basename}
                        onTap={() => isFolder ? drillIn(file) : onOpen(file)}
                        onLongPress={isFolder ? () => onOpen(file) : undefined}
                        doubleTapToOpen={doubleTapToOpen}
                        meta={getFavMeta(file)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {recentFiles.length > 0 && (
              <div class="bt-explorer-home-section">
                <div class="bt-explorer-section-header">
                  <span class="bt-explorer-section-icon"
                    ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'clock'); }} />
                  <span>Recent</span>
                </div>
                <div class="bt-explorer-grid"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${localTileWidth}px, 1fr))` }}
                >
                  {recentFiles.map((file) => (
                    <Tile
                      key={file.path}
                      file={file}
                      isFolder={false}
                      isActive={file.path === activeFile?.path}
                      label={file.basename}
                      onTap={() => onOpen(file)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}
      </div>{/* end bt-explorer-scroll-area */}
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export class ExplorerModal extends Modal {
  private bc: BreadcrumbsPlugin;
  private settings: BreadTrailSettings;
  private tileMinWidth: number;
  private startMode: 'active-parent' | 'home' | 'roots';
  private homeNote: string;
  private showFavorites: boolean;
  private showRecents: boolean;
  private recentsCount: number;
  private favoritePaths: string[];
  private favoritesParentNote: string;
  private doubleTapToOpen: boolean;
  private rootFolder?: string;
  private startFile?: TFile | null;
  private onClosed?: () => void;

  constructor(
    app: App,
    bc: BreadcrumbsPlugin,
    tileMinWidth: number,
    startMode: 'active-parent' | 'home' | 'roots',
    homeNote: string,
    showFavorites: boolean,
    showRecents: boolean,
    recentsCount: number,
    favoritePaths: string[],
    favoritesParentNote: string,
    doubleTapToOpen: boolean,
    settings: BreadTrailSettings,
    onClosed?: () => void,
    startFile?: TFile | null,
    rootFolder?: string,
  ) {
    super(app);
    this.bc = bc;
    this.settings = settings;
    this.tileMinWidth = tileMinWidth;
    this.startMode = startMode;
    this.homeNote = homeNote;
    this.showFavorites = showFavorites;
    this.showRecents = showRecents;
    this.recentsCount = recentsCount;
    this.favoritePaths = favoritePaths;
    this.favoritesParentNote = favoritesParentNote;
    this.doubleTapToOpen = doubleTapToOpen;
    this.onClosed = onClosed;
    this.startFile = startFile;
    this.rootFolder = rootFolder;
    this.modalEl.addClass('bt-explorer-modal');
  }

  onOpen() {
    const { contentEl } = this;
    const activeFile = this.app.workspace.getActiveFile();

    render(
      h(ExplorerGrid, {
        app: this.app,
        bc: this.bc,
        settings: this.settings,
        activeFile,
        tileMinWidth: this.tileMinWidth,
        onOpen: (file: TFile) => {
          const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
          void leaf.openFile(file);
          this.close();
        },
        startMode: this.startMode,
        homeNote: this.homeNote,
        showFavorites: this.showFavorites,
        showRecents: this.showRecents,
        recentsCount: this.recentsCount,
        favoritePaths: this.favoritePaths,
        favoritesParentNote: this.favoritesParentNote,
        doubleTapToOpen: this.doubleTapToOpen,
        rootFolder: this.rootFolder,
        startFile: this.startFile,
        onTitleChange: (title: string) => this.setTitle(title),
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
