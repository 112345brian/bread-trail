import { App, MarkdownPostProcessorContext, MarkdownRenderChild, Modal, Notice, Plugin, TFile, setIcon } from 'obsidian';
import { OutlineModal } from './OutlineModal';
import { BreadcrumbQuickSwitcher } from './QuickSwitcher';
import { GraphSwitcher } from './GraphSwitcher';
import { Validator } from './Validator';
import { ValidationModal } from './ValidationModal';
import { SequenceModal, SequenceAllModal } from './SequenceModal';
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
    plugins?: {
      breadcrumbs?: BreadcrumbsPlugin;
    };
  };
}

interface AppWithSettings extends App {
  setting: {
    openTabById(id: string): void;
  };
}

function getBreadcrumbs(app: App): BreadcrumbsPlugin | null {
  const bc = (app as AppWithPlugins).plugins?.plugins?.breadcrumbs;
  return bc?.graph ? bc : null;
}

class BreadcrumbsMissingModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('Breadcrumbs plugin required');

    contentEl.createEl('p', {
      text: 'Bread trail requires the breadcrumbs plugin to work.',
    });

    contentEl.createEl('p', {
      text: 'Install it from community plugins:',
      cls: 'mod-muted',
    });

    const steps = contentEl.createEl('ol');
    steps.createEl('li', { text: 'Open settings → community plugins' });
    steps.createEl('li', { text: 'Search for "breadcrumbs"' });
    steps.createEl('li', { text: 'Install and enable it' });
    steps.createEl('li', { text: 'Reload bread trail' });

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
    titleEl.setText('Bread trail');

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
  private autoSeqDebounce = new Map<string, ReturnType<typeof setTimeout>>();

  async onload() {
    this.settings = normalizeSettings((await this.loadData()) as Partial<BreadTrailSettings> | null ?? {});
    addSettingTab(this);

    // Check for Breadcrumbs on startup
    this.app.workspace.onLayoutReady(() => {
      this.bc = getBreadcrumbs(this.app);
      if (!this.bc) {
        if (this.settings.showStartupNotice) {
          new Notice('Bread trail: Breadcrumbs plugin not found.');
        }
        new BreadcrumbsMissingModal(this.app).open();
        return;
      }
      if (this.settings.showStartupNotice) {
        new Notice('Bread trail loaded — breadcrumbs detected.');
      }
    });

    this.addCommand({
      id: 'show-trail',
      name: 'Show trail for current note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        if (!this.bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new TrailModal(this.app, file, this.bc).open();
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

        if (!this.bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new OutlineModal(this.app, file, this.bc).open();
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

        if (!this.bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new BreadcrumbQuickSwitcher(this.app, file, this.bc, this.settings).open();
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

        if (!this.bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new BreadcrumbQuickSwitcher(this.app, file, this.bc, this.settings, true).open();
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

        if (!this.bc) { new BreadcrumbsMissingModal(this.app).open(); return true; }
        new SequenceModal(this.app, file, this.bc).open();
        return true;
      },
    });

    this.addCommand({
      id: 'sequence-all',
      name: 'Sequence all configured parents',
      callback: () => {
        if (!this.bc) { new BreadcrumbsMissingModal(this.app).open(); return; }
        new SequenceAllModal(this.app, this.bc).open();
      },
    });

    // Auto-sequencing: re-run whenever a file changes and its parent(s) have mode: auto
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (!this.bc) return;
        this.handleAutoSequence(file);
      }),
    );

    this.addCommand({
      id: 'graph-switch',
      name: 'Show breadcrumb graph switcher',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (checking) return !!file && file.extension === 'md';
        if (!file) return false;

        if (!this.bc) {
          new BreadcrumbsMissingModal(this.app).open();
          return true;
        }

        new GraphSwitcher(this.app, file, this.bc, this.settings).open();
        return true;
      },
    });
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
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        this.autoSeqDebounce.delete(parent.path);
        try {
          const sequencer = new Sequencer(this.app, bc);
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
