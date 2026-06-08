import { App, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, Modal, Notice, Platform, Plugin, TFile, setIcon } from 'obsidian';
import { OutlineModal } from './OutlineModal';
import { ExplorerModal } from './ExplorerModal';
import { BreadcrumbQuickSwitcher } from './QuickSwitcher';
import { GraphSwitcher } from './GraphSwitcher';
import { NavigatorView, NAVIGATOR_VIEW_TYPE } from './NavigatorView';
import { FloatingNavPanel } from './FloatingNav';
import { Validator } from './Validator';
import { ValidationModal } from './ValidationModal';
import { SequenceModal, SequenceAllModal, RemoveStaleModal } from './SequenceModal';
import { Sequencer, parseLinkChildrenConfig, findAllConfiguredParents } from './Sequencer';
import { addSettingTab, DEFAULT_SETTINGS, normalizeSettings } from './settings';
import type { BreadTrailSettings } from './settings';

export interface BreadcrumbEdge {
  source?: string;
  target?: string;
  edge_type?: string;
  source_path?(graph: BreadcrumbsGraph): string;
  target_path?(graph: BreadcrumbsGraph): string;
}

export interface BreadcrumbsGraph {
  get_outgoing_edges(path: string): { to_array(): BreadcrumbEdge[] };
  get_incoming_edges(path: string): { to_array(): BreadcrumbEdge[] };
}

export interface BreadcrumbsPlugin {
  graph: BreadcrumbsGraph;
  settings: {
    edge_fields: string[];
  };
  events: {
    on(event: string, cb: () => void): void;
  };
}

interface AppWithPlugins extends App {
  plugins?: {
    getPlugin?(id: string): unknown;
    plugins?: {
      [id: string]: unknown;
    };
  };
}

interface AppWithSettings extends App {
  setting: {
    openTabById(id: string): void;
  };
}

function getBreadcrumbs(app: App): BreadcrumbsPlugin | null {
  const plugins = (app as AppWithPlugins).plugins;
  const plugin = plugins?.getPlugin?.('breadcrumbs') ?? plugins?.plugins?.['breadcrumbs'];
  return isBreadcrumbsPlugin(plugin) ? plugin : null;
}

function isBreadcrumbsPlugin(plugin: unknown): plugin is BreadcrumbsPlugin {
  if (!plugin || typeof plugin !== 'object') return false;
  const candidate = plugin as Partial<BreadcrumbsPlugin>;
  const graph = candidate.graph;
  return !!graph
    && typeof graph.get_outgoing_edges === 'function'
    && typeof graph.get_incoming_edges === 'function';
}

class BreadcrumbsMissingModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('Breadcrumbs plugin required');

    contentEl.createEl('p', {
      text: 'BreadTrail requires the breadcrumbs plugin to work.',
    });

    contentEl.createEl('p', {
      text: 'Install it from community plugins:',
      cls: 'mod-muted',
    });

    const steps = contentEl.createEl('ol');
    steps.createEl('li', { text: 'Open settings → community plugins' });
    steps.createEl('li', { text: 'Search for "breadcrumbs"' });
    steps.createEl('li', { text: 'Install and enable it' });
    steps.createEl('li', { text: 'Reload BreadTrail' });

    const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    btnContainer.createEl('button', { text: 'Open community plugins', cls: 'mod-cta' })
      .addEventListener('click', () => {
        (this.app as AppWithSettings).setting.openTabById('community-plugins');
        this.close();
      });

    btnContainer.createEl('button', { text: 'Close' })
      .addEventListener('click', () => this.close());
  }
}

class TrailModal extends Modal {
  constructor(
    app: App,
    private file: TFile,
    private bc: BreadcrumbsPlugin
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('BreadTrail');

    contentEl.createEl('p', {
      text: `Viewing: ${this.file.basename}`,
      cls: 'mod-muted',
    });

    const outgoing = this.bc.graph.get_outgoing_edges(this.file.path).to_array();
    const incoming = this.bc.graph.get_incoming_edges(this.file.path).to_array();

    if (incoming.length > 0) {
      contentEl.createEl('h3', { text: '↑ parents' });
      const list = contentEl.createEl('ul');
      incoming.forEach((edge) => {
        const sourcePath = edge.source_path?.(this.bc.graph) ?? edge.source;
        if (sourcePath) {
          list.createEl('li', { text: sourcePath });
        }
      });
    }

    if (outgoing.length > 0) {
      contentEl.createEl('h3', { text: '↓ children' });
      const list = contentEl.createEl('ul');
      outgoing.forEach((edge) => {
        const targetPath = edge.target_path?.(this.bc.graph) ?? edge.target;
        if (targetPath) {
          list.createEl('li', { text: targetPath });
        }
      });
    }

    if (incoming.length === 0 && outgoing.length === 0) {
      contentEl.createEl('p', {
        text: 'No breadcrumb relationships found for this note.',
        cls: 'mod-muted',
      });
    }
  }
}

export default class BreadTrail extends Plugin {
  private bc: BreadcrumbsPlugin | null = null;
  settings: BreadTrailSettings = DEFAULT_SETTINGS;
  private autoSeqDebounce = new Map<string, number>();

  // Floating navigator panels — keyed by view, one entry per side
  private floatingPanels = new Map<MarkdownView, { left?: FloatingNavPanel; right?: FloatingNavPanel }>();
  private summonedFloatingPanel: { view: MarkdownView; panel: FloatingNavPanel } | null = null;
  private breadcrumbsGraphEventRegistered = false;
  /** Tracks the currently open ExplorerModal so we never spawn duplicates. */
  private activeExplorerModal: ExplorerModal | null = null;


  async onload() {
    this.settings = normalizeSettings((await this.loadData()) as Partial<BreadTrailSettings> | null ?? {});
    addSettingTab(this);

    // Register the sidebar navigator view
    this.registerView(
      NAVIGATOR_VIEW_TYPE,
      (leaf) => new NavigatorView(leaf, this.settings, () => this.ensureBreadcrumbs(), () => this.saveSettings()),
    );

    // Ribbon icon — opens the navigator sidebar
    this.addRibbonIcon('footprints', 'BreadTrail navigator', async () => {
      const side = Platform.isMobile ? this.settings.mobileNavigatorSide : 'right';
      await this.openNavigatorInSidebar(side);
    });

    // Check for Breadcrumbs on startup. Breadcrumbs can finish loading after
    // Bread Trail, so this path retries before showing the missing-plugin modal.
    this.app.workspace.onLayoutReady(async () => {
      this.checkBreadcrumbsOnStartup();
      // On mobile: auto-open the navigator so the user never has to manually
      // trigger it after the app starts. Side is user-configurable (default left).
      if (Platform.isMobile) {
        await this.openNavigatorInSidebar(this.settings.mobileNavigatorSide);
      }
    });

    this.addCommand({
      id: 'show-trail',
      name: 'Show trail for current note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        const bc = this.ensureBreadcrumbs();
        if (!bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new TrailModal(this.app, file, bc).open();
        return true;
      },
    });

    this.addCommand({
      id: 'show-outline',
      name: 'Show breadcrumb outline',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        const bc = this.ensureBreadcrumbs();
        if (!bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new OutlineModal(this.app, file, bc).open();
        return true;
      },
    });

    this.addCommand({
      id: 'quick-switch',
      name: 'Quick switch to breadcrumb-related note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        const bc = this.ensureBreadcrumbs();
        if (!bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new BreadcrumbQuickSwitcher(this.app, file, bc, this.settings).open();
        return true;
      },
    });

    this.addCommand({
      id: 'quick-switch-all-notes',
      name: 'Quick switch notes with breadcrumb context',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        const bc = this.ensureBreadcrumbs();
        if (!bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new BreadcrumbQuickSwitcher(this.app, file, bc, this.settings, true).open();
        return true;
      },
    });

    this.addCommand({
      id: 'validate',
      name: 'Validate breadcrumbs — show vault report',
      callback: () => {
        new ValidationModal(this.app, this.settings).open();
      },
    });

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.injectValidationWarning(el, ctx);
    });

    this.addCommand({
      id: 'sequence-children',
      name: 'Sequence children of current note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        const config = parseLinkChildrenConfig(this.app, file);
        if (!config) return false;
        if (checking) return true;

        const bc = this.ensureBreadcrumbs();
        if (!bc) { new BreadcrumbsMissingModal(this.app).open(); return true; }
        new SequenceModal(this.app, file, bc, this.settings).open();
        return true;
      },
    });

    this.addCommand({
      id: 'sequence-all',
      name: 'Sequence all configured parents',
      callback: () => {
        const bc = this.ensureBreadcrumbs();
        if (!bc) { new BreadcrumbsMissingModal(this.app).open(); return; }
        new SequenceAllModal(this.app, bc, this.settings).open();
      },
    });

    this.addCommand({
      id: 'remove-stale-global-links',
      name: 'Remove stale bare next/prev links — vault-wide cleanup',
      callback: () => {
        new RemoveStaleModal(this.app).open();
      },
    });

    this.addCommand({
      id: 'open-navigator',
      name: 'Open navigator sidebar',
      callback: async () => {
        const side = Platform.isMobile ? this.settings.mobileNavigatorSide : 'right';
        await this.openNavigatorInSidebar(side);
      },
    });

    this.addCommand({
      id: 'show-floating-table-of-contents',
      name: 'Show floating table of contents',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (checking) return !!file && file.extension === 'md';
        if (!view || !file) return false;

        const bc = this.ensureBreadcrumbs();
        if (!bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        this.showFloatingTableOfContents(view);
        return true;
      },
    });

    // Keep navigator in sync with active file and bc events
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.getNavigatorView()?.scheduleRefresh();
        // New leaves may have appeared; sync then refresh content
        this.syncFloatingNavPanels();
        this.refreshFloatingNavPanels();
        this.updateAllHeaderBreadcrumbs();
      }),
    );

    // Sidebar open/close changes whether floating panels should be visible
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.syncFloatingNavPanels();
      }),
    );

    // Metadata changes: refresh floating panels + trigger auto-sequencing
    this.registerEvent(
      this.app.metadataCache.on('changed', (changedFile) => {
        for (const [view, panels] of this.floatingPanels) {
          if (view.file?.path === changedFile.path) {
            panels.left?.refresh();
            panels.right?.refresh();
          }
        }
        if (this.summonedFloatingPanel?.view.file?.path === changedFile.path) {
          this.summonedFloatingPanel.panel.refresh();
        }
        if (this.ensureBreadcrumbs()) this.handleAutoSequence(changedFile);
      }),
    );

    this.addCommand({
      id: 'open-explorer',
      name: 'Open tile explorer',
      callback: () => this.openExplorerModal(),
    });

    this.addCommand({
      id: 'graph-switch',
      name: 'Show breadcrumb graph switcher',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        const bc = this.ensureBreadcrumbs();
        if (!bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new GraphSwitcher(this.app, file, bc, this.settings, () => this.saveSettings()).open();
        return true;
      },
    });

    if (Platform.isMobile) this.registerMobileTapZone();

  }

  /** Open the tile explorer modal. Guards against duplicate spawns — if one is
   *  already open the call is a no-op. */
  private openExplorerModal(startFile?: TFile | null): void {
    if (this.activeExplorerModal) return;
    const bc = this.ensureBreadcrumbs();
    if (!bc) { new BreadcrumbsMissingModal(this.app).open(); return; }
    // homeNote unifies the start for both sidebar and modal; fall back to per-modal setting
    const effectiveStartMode = (this.settings.homeNote && startFile === undefined)
      ? 'home' : this.settings.explorerStartMode;
    const effectiveHomeNote = this.settings.homeNote || this.settings.explorerHomeNote;
    const modal = new ExplorerModal(
      this.app, bc,
      this.settings.graphLabelProperty,
      this.settings.explorerTileMinWidth,
      effectiveStartMode,
      effectiveHomeNote,
      this.settings.navigatorHomeShowFavorites,
      this.settings.navigatorHomeShowRecents,
      this.settings.navigatorHomeRecentsCount,
      this.settings.navigatorFavorites,
      this.settings.navigatorFavoritesParentNote,
      this.settings.explorerDoubleTapToOpen,
      () => { this.activeExplorerModal = null; },
      startFile,
    );
    this.activeExplorerModal = modal;
    modal.open();
  }

  /** On mobile: two-finger gestures anywhere on screen navigate the tile explorer.
   *  Spread (expand) = go deeper into the active note's children.
   *  Pinch (contract) = go up to the active note's parent level.
   *  Neither conflicts with Obsidian's built-in single-finger gestures. */
  private registerMobileTapZone() {
    const MIN_GESTURE = 45;  // minimum px change to count as intentional

    let startDist = 0;
    let maxDist   = 0;
    let minDist   = 0;
    let active    = false;

    const fingerDist = (touches: TouchList) => {
      const a = touches[0]!, b = touches[1]!;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { active = false; return; }
      active    = true;
      startDist = fingerDist(e.touches);
      maxDist   = startDist;
      minDist   = startDist;
    };

    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 2) return;
      const d = fingerDist(e.touches);
      if (d > maxDist) maxDist = d;
      if (d < minDist) minDist = d;
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      if (!this.settings.mobileTapExplorer) return;

      const spread = maxDist - startDist;  // positive = fingers moved apart
      const pinch  = startDist - minDist;  // positive = fingers moved together

      if (Math.max(spread, pinch) < MIN_GESTURE) return;

      const action = spread >= pinch
        ? this.settings.explorerGestureExpand
        : this.settings.explorerGesturePinch;

      if (action === 'off') return;

      if (action === 'home') {
        // Open at the configured home note (no startFile override — uses homeNote)
        this.openExplorerModal();
      } else if (action === 'children') {
        // Open at the active note itself — shows its children
        this.openExplorerModal(this.app.workspace.getActiveFile());
      } else {
        // 'parent': open at the active note's BC parent — shows its siblings
        const activeFile = this.app.workspace.getActiveFile();
        const bc = this.ensureBreadcrumbs();
        let parent: TFile | null = null;
        if (activeFile && bc) {
          for (const e of bc.graph.get_outgoing_edges(activeFile.path).to_array()) {
            if (e.edge_type?.toLowerCase() !== 'up') continue;
            const path = e.target_path?.(bc.graph) ?? e.target;
            if (!path) continue;
            const f = this.app.vault.getAbstractFileByPath(path);
            if (f instanceof TFile) { parent = f; break; }
          }
        }
        // If no BC parent found, fall back to configured start mode
        this.openExplorerModal(parent ?? undefined);
      }
    };

    const opts = { passive: true } as const;
    document.addEventListener('touchstart',  onStart, opts);
    document.addEventListener('touchmove',   onMove,  opts);
    document.addEventListener('touchend',    onEnd,   opts);
    document.addEventListener('touchcancel', onEnd,   opts);
    this.register(() => {
      document.removeEventListener('touchstart',  onStart);
      document.removeEventListener('touchmove',   onMove);
      document.removeEventListener('touchend',    onEnd);
      document.removeEventListener('touchcancel', onEnd);
    });
  }

  onunload() {
    for (const panels of this.floatingPanels.values()) {
      panels.left?.detach();
      panels.right?.detach();
    }
    this.floatingPanels.clear();
    this.detachSummonedFloatingPanel();
    this.clearAllHeaderBreadcrumbs();
  }

  private injectValidationWarning(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    // Only run on the first section of a document
    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo && sectionInfo.lineStart !== 0) return;

    const filePath = ctx.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    // Skip if all rules are turned off
    const rules = this.settings.validationRules;
    const allOff = rules.requireSpecificity.severity === 'off'
      && rules.brokenLinks.severity === 'off'
      && rules.missingReciprocal.severity === 'off'
      && rules.crossHierarchy.severity === 'off';
    if (allOff) return;

    const violations = new Validator(this.app, this.settings).validateFile(file);
    if (violations.length === 0) return;

    const banner = el.createDiv('bread-trail-validation-banner');
    const child = new ValidationBanner(banner, violations, filePath);
    ctx.addChild(child);

    // Prepend so the banner appears before the section content
    el.prepend(banner);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private ensureBreadcrumbs(): BreadcrumbsPlugin | null {
    const prev = this.bc;
    this.bc = getBreadcrumbs(this.app);
    // Only run first-time setup when BC transitions from absent → present
    if (this.bc && !prev) this.handleBreadcrumbsReady(this.bc, false);
    return this.bc;
  }

  private checkBreadcrumbsOnStartup(attempt = 0): void {
    const bc = this.ensureBreadcrumbs();
    if (bc) {
      this.handleBreadcrumbsReady(bc, this.settings.showStartupNotice);
      return;
    }

    if (attempt < 10) {
      const timeout = window.setTimeout(() => this.checkBreadcrumbsOnStartup(attempt + 1), 500);
      this.register(() => window.clearTimeout(timeout));
      return;
    }

    new Notice('BreadTrail: Breadcrumbs plugin not found.');
    new BreadcrumbsMissingModal(this.app).open();
  }

  private handleBreadcrumbsReady(bc: BreadcrumbsPlugin, _showNotice: boolean): void {
    this.getNavigatorView()?.scheduleRefresh();
    this.updateAllHeaderBreadcrumbs();

    if (!this.breadcrumbsGraphEventRegistered) {
      try {
        bc.events.on('graph-update', () => {
          this.getNavigatorView()?.scheduleRefresh();
          this.refreshFloatingNavPanels();
          this.updateAllHeaderBreadcrumbs();
        });
        this.breadcrumbsGraphEventRegistered = true;
      } catch {
        // BC event API not available in this version — ignore
      }
    }

    this.syncFloatingNavPanels();
  }

  // ── Floating navigator panel management ────────────────────────────────────

  /** Returns true when the bread-trail navigator is visible in the given sidebar. */
  private isSidebarShowingNav(side: 'left' | 'right'): boolean {
    const split = side === 'left'
      ? this.app.workspace.leftSplit
      : this.app.workspace.rightSplit;
    if ((split as unknown as { collapsed?: boolean }).collapsed) return false;
    return this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE)
      .some((l) => l.getRoot() === split);
  }

  /** Add/remove floating panels to match current settings and sidebar state. */
  private syncFloatingNavPanels(): void {
    if (!this.app.workspace.layoutReady) return;

    const showLeft  = this.settings.floatingNavLeft  && !this.isSidebarShowingNav('left');
    const showRight = this.settings.floatingNavRight && !this.isSidebarShowingNav('right');

    // Collect currently visible markdown views
    const currentViews = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) currentViews.add(leaf.view);
    });

    // Detach panels for views that no longer exist
    for (const [view, panels] of this.floatingPanels) {
      if (!currentViews.has(view)) {
        panels.left?.detach();
        panels.right?.detach();
        this.floatingPanels.delete(view);
      }
    }
    if (this.summonedFloatingPanel && !currentViews.has(this.summonedFloatingPanel.view)) {
      this.detachSummonedFloatingPanel();
    }

    // Add/remove panels for each visible view
    for (const view of currentViews) {
      if (!this.floatingPanels.has(view)) this.floatingPanels.set(view, {});
      const panels = this.floatingPanels.get(view)!;

      if (showLeft && !panels.left) {
        panels.left = new FloatingNavPanel(view, this.app, () => this.settings, () => this.ensureBreadcrumbs(), 'left', () => {
          void this.openNavigatorInSidebar('left');
        });
        panels.left.attach();
      } else if (!showLeft && panels.left) {
        panels.left.detach();
        delete panels.left;
      }

      if (showRight && !panels.right) {
        panels.right = new FloatingNavPanel(view, this.app, () => this.settings, () => this.ensureBreadcrumbs(), 'right', () => {
          void this.openNavigatorInSidebar('right');
        });
        panels.right.attach();
      } else if (!showRight && panels.right) {
        panels.right.detach();
        delete panels.right;
      }
    }
  }

  /** Refresh content of all existing floating panels (file or graph changed). */
  private refreshFloatingNavPanels(): void {
    for (const panels of this.floatingPanels.values()) {
      panels.left?.refresh();
      panels.right?.refresh();
    }
    this.summonedFloatingPanel?.panel.refresh();
  }

  private showFloatingTableOfContents(view: MarkdownView): void {
    if (this.summonedFloatingPanel?.view === view) {
      this.summonedFloatingPanel.panel.refresh();
      return;
    }

    this.detachSummonedFloatingPanel();

    const side = this.settings.floatingNavLeft && !this.settings.floatingNavRight ? 'left' : 'right';
    const panel = new FloatingNavPanel(view, this.app, () => this.settings, () => this.ensureBreadcrumbs(), side, () => {
      this.detachSummonedFloatingPanel();
      void this.openNavigatorInSidebar(side);
    });
    panel.attach();
    this.summonedFloatingPanel = { view, panel };
  }

  private detachSummonedFloatingPanel(): void {
    this.summonedFloatingPanel?.panel.detach();
    this.summonedFloatingPanel = null;
  }

  /** Open (or reveal) the bread-trail navigator in the specified sidebar. */
  private async openNavigatorInSidebar(side: 'left' | 'right'): Promise<void> {
    // If a navigator already exists anywhere in the workspace, reveal it
    const existing = this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE);
    if (existing.length > 0 && existing[0]) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = side === 'left'
      ? this.app.workspace.getLeftLeaf(false)
      : this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: NAVIGATOR_VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  getNavigatorView(): NavigatorView | null {
    const leaves = this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE);
    const view = leaves[0]?.view;
    return view instanceof NavigatorView ? view : null;
  }

  // ── Header breadcrumb injection ────────────────────────────────────────────

  /**
   * Walk up the BC hierarchy from `file` via up/down edges, returning the
   * ancestor chain ordered from oldest → immediate parent (max 20 hops).
   */
  private getBcAncestorChain(file: TFile, bc: BreadcrumbsPlugin): TFile[] {
    const seen = new Set<string>([file.path]);
    const parents: TFile[] = [];

    // Collect all direct `up` parents (outgoing up edges from this file)
    for (const e of bc.graph.get_outgoing_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'up') continue;
      const path = e.target_path?.(bc.graph) ?? e.target;
      if (!path || seen.has(path)) continue;
      const found = this.app.vault.getAbstractFileByPath(path);
      if (found instanceof TFile) { seen.add(path); parents.push(found); }
    }

    // Also collect parents implied by incoming `down` edges (reciprocal links)
    for (const e of bc.graph.get_incoming_edges(file.path).to_array()) {
      if (e.edge_type?.toLowerCase() !== 'down') continue;
      const path = e.source_path?.(bc.graph) ?? e.source;
      if (!path || seen.has(path)) continue;
      const found = this.app.vault.getAbstractFileByPath(path);
      if (found instanceof TFile) { seen.add(path); parents.push(found); }
    }

    return parents;
  }

  private getBcLabel(file: TFile): string {
    const prop = this.settings.graphLabelProperty;
    if (!prop) return file.basename;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return file.basename;
    const val: unknown = fm[prop];
    if (Array.isArray(val) && val.length > 0) return String(val[0]);
    if (typeof val === 'string' && val.trim()) return val.trim();
    return file.basename;
  }

  /** Inject / refresh BC ancestor crumbs into the view header of every open markdown leaf. */
  updateAllHeaderBreadcrumbs(): void {
    if (!this.settings.headerBreadcrumbs) {
      this.clearAllHeaderBreadcrumbs();
      return;
    }
    const bc = this.bc ?? getBreadcrumbs(this.app);
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        this.updateHeaderBreadcrumb(leaf.view, bc);
      }
    });
  }

  private updateHeaderBreadcrumb(view: MarkdownView, bc: BreadcrumbsPlugin | null): void {
    // Remove any previously injected crumbs
    view.containerEl.querySelectorAll('.bt-header-crumbs').forEach((el) => el.remove());

    const file = view.file;
    if (!file || !bc) return;

    let ancestors = this.getBcAncestorChain(file, bc);
    if (ancestors.length === 0) return;
    const depth = this.settings.headerBreadcrumbsDepth;
    if (depth > 0) ancestors = ancestors.slice(-depth);

    const viewHeader = view.containerEl.querySelector<HTMLElement>('.view-header');
    if (!viewHeader) return;

    // Build the crumbs element
    const crumbsEl = activeDocument.createElement('div');
    crumbsEl.className = 'bt-header-crumbs';

    for (let i = 0; i < ancestors.length; i++) {
      const ancestor = ancestors[i]!;
      const crumb = crumbsEl.createEl('span', {
        cls: 'bt-header-crumb-item',
        text: this.getBcLabel(ancestor),
        attr: { 'aria-label': ancestor.path },
      });
      crumb.addEventListener('click', (e) => {
        const newTab = e.ctrlKey || e.metaKey;
        const leaf = newTab
          ? this.app.workspace.getLeaf('tab')
          : (this.app.workspace.getMostRecentLeaf() ?? view.leaf);
        void leaf.openFile(ancestor);
      });
      // Always add a trailing separator — the native title follows our crumbs
      crumbsEl.createSpan({ cls: 'bt-header-crumb-sep', text: '/' });
    }

    // Inject into the title container, before the note title — this is where
    // Obsidian renders the file path / BC breadcrumb ("TOC / Home" row)
    const titleContainer = viewHeader.querySelector<HTMLElement>('.view-header-title-container');
    const titleEl = titleContainer?.querySelector('.view-header-title');
    if (titleEl) {
      titleEl.insertAdjacentElement('beforebegin', crumbsEl);
    } else if (titleContainer) {
      titleContainer.prepend(crumbsEl);
    } else {
      viewHeader.appendChild(crumbsEl);
    }

    // Hide ALL children of the title container except the title itself and our crumbs —
    // the BC plugin renders multiple sibling elements (breadcrumb text, separators, etc.)
    if (titleContainer) {
      for (const child of Array.from(titleContainer.children)) {
        if (child.classList.contains('view-header-title') || child.classList.contains('bt-header-crumbs')) continue;
        (child as HTMLElement).dataset.btHidden = 'true';
        (child as HTMLElement).style.display = 'none';
      }
    }
  }

  private clearAllHeaderBreadcrumbs(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      leaf.view.containerEl.querySelectorAll('.bt-header-crumbs').forEach((el) => el.remove());
      // Restore any elements we hid
      leaf.view.containerEl.querySelectorAll<HTMLElement>('[data-bt-hidden]').forEach((el) => {
        el.style.display = '';
        delete el.dataset.btHidden;
      });
    });
  }

  /** Debounced auto-sequencer: fires 2s after the last metadata change on a file.
   *  Checks whether any parent of the changed file has mode: auto, and if so re-sequences. */
  private handleAutoSequence(changedFile: TFile) {
    if (!this.bc) return;

    // Collect parents of the changed file that have mode: auto
    const autoParents = findAllConfiguredParents(this.app).filter(({ config }) => config.mode === 'auto');
    if (autoParents.length === 0) return;

    // For each auto parent, check if changedFile is one of its children
    const bc = this.bc;
    for (const { file: parent, config } of autoParents) {
      const edges = bc.graph.get_outgoing_edges(parent.path).to_array();
      const isChild = edges.some((edge) => {
        const edgeType = edge.edge_type ?? '';
        if (edgeType !== 'down' && edgeType !== 'child') return false;
        const targetPath = edge.target_path?.(bc.graph) ?? edge.target;
        return targetPath === changedFile.path;
      });
      if (!isChild) continue;

      // Debounce per parent — wait 2s after last change before re-sequencing
      const existing = this.autoSeqDebounce.get(parent.path);
      if (existing) window.clearTimeout(existing);

      const timer = window.setTimeout(() => {
        void (async () => {
          this.autoSeqDebounce.delete(parent.path);
          try {
            const sequencer = new Sequencer(this.app, bc, this.settings);
            const plan = sequencer.plan(parent, config);
            const changed = plan.results.reduce(
              (sum, r) => sum + r.changes.filter((c) => c.kind !== 'no-change').length, 0,
            );
            if (changed === 0) return;
            await sequencer.apply(plan);
            new Notice(`Auto-sequenced "${parent.basename}" — ${changed} link${changed !== 1 ? 's' : ''} updated.`);
          } catch (err) {
            console.error('Bread Trail auto-sequence error:', err);
          }
        })();
      }, 2000);

      this.autoSeqDebounce.set(parent.path, timer);
    }
  }
}

/** Lifecycle-managed inline validation banner for reading mode. */
class ValidationBanner extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private violations: import('./Validator').ValidationViolation[],
    private filePath: string,
  ) {
    super(containerEl);
  }

  onload() {
    const hasError = this.violations.some((v) => v.severity === 'error');
    this.containerEl.addClass('no-export'); // hide from Obsidian PDF/HTML exports
    this.containerEl.addClass(hasError ? 'bread-trail-validation-banner-error' : 'bread-trail-validation-banner-warning');

    const headerEl = this.containerEl.createDiv('bread-trail-validation-banner-header');
    setIcon(headerEl.createSpan('bread-trail-validation-banner-icon'), hasError ? 'alert-circle' : 'alert-triangle');
    headerEl.createSpan({
      text: `Breadcrumb ${hasError ? 'error' : 'warning'}${this.violations.length > 1 ? 's' : ''} (${this.violations.length})`,
      cls: 'bread-trail-validation-banner-title',
    });

    const listEl = this.containerEl.createEl('ul', { cls: 'bread-trail-validation-banner-list' });
    for (const v of this.violations) {
      listEl.createEl('li', { text: v.message, cls: `bread-trail-validation-banner-item-${v.severity}` });
    }
  }
}
