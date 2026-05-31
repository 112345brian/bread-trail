import { App, Modal, Notice, Plugin, TFile } from 'obsidian';
import { OutlineModal } from './OutlineModal';
import { BreadcrumbQuickSwitcher } from './QuickSwitcher';
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

  async onload() {
    this.settings = normalizeSettings((await this.loadData()) as Partial<BreadTrailSettings> | null ?? {});
    addSettingTab(this);

    // Check for Breadcrumbs on startup
    this.app.workspace.onLayoutReady(() => {
      this.bc = getBreadcrumbs(this.app);
      if (!this.bc) {
        new Notice('Bread trail: Breadcrumbs plugin not found.');
        new BreadcrumbsMissingModal(this.app).open();
        return;
      }
      new Notice('Bread trail loaded — breadcrumbs detected.');
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
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
