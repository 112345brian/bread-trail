import { App, Modal, Notice, Plugin, TFile } from 'obsidian';
import { OutlineModal } from './OutlineModal';

export interface BreadcrumbsPlugin {
  graph: {
    get_outgoing_edges(path: string): { to_array(): any[] };
    get_incoming_edges(path: string): { to_array(): any[] };
    target_path?(edge: any): string;
  };
  settings: {
    edge_fields: string[];
  };
  events: {
    on(event: string, cb: () => void): void;
  };
}

function getBreadcrumbs(app: App): BreadcrumbsPlugin | null {
  const bc = (app as any).plugins?.plugins?.breadcrumbs;
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
      text: 'Bread Trail requires the Breadcrumbs plugin to work.',
    });

    contentEl.createEl('p', {
      text: 'Install it from Community Plugins:',
      cls: 'mod-muted',
    });

    const steps = contentEl.createEl('ol');
    steps.createEl('li', { text: 'Open Settings → Community Plugins' });
    steps.createEl('li', { text: 'Search for "breadcrumbs"' });
    steps.createEl('li', { text: 'Install and enable it' });
    steps.createEl('li', { text: 'Reload Bread Trail' });

    const btnContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    btnContainer.createEl('button', { text: 'Open Community Plugins', cls: 'mod-cta' })
      .addEventListener('click', () => {
        (this.app as any).setting.openTabById('community-plugins');
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
    titleEl.setText('Bread Trail');

    contentEl.createEl('p', {
      text: `Viewing: ${this.file.basename}`,
      cls: 'mod-muted',
    });

    const outgoing = this.bc.graph.get_outgoing_edges(this.file.path).to_array();
    const incoming = this.bc.graph.get_incoming_edges(this.file.path).to_array();

    if (incoming.length > 0) {
      contentEl.createEl('h3', { text: '↑ Parents' });
      const list = contentEl.createEl('ul');
      incoming.forEach((edge: any) => {
        const sourcePath = edge.source_path?.(this.bc.graph) ?? edge.source;
        list.createEl('li', { text: sourcePath });
      });
    }

    if (outgoing.length > 0) {
      contentEl.createEl('h3', { text: '↓ Children' });
      const list = contentEl.createEl('ul');
      outgoing.forEach((edge: any) => {
        const targetPath = edge.target_path?.(this.bc.graph) ?? edge.target;
        list.createEl('li', { text: targetPath });
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

  async onload() {
    // Check for Breadcrumbs on startup
    this.app.workspace.onLayoutReady(() => {
      this.bc = getBreadcrumbs(this.app);
      if (!this.bc) {
        new Notice('Bread Trail: Breadcrumbs plugin not found.');
        new BreadcrumbsMissingModal(this.app).open();
        return;
      }
      new Notice('Bread Trail loaded — Breadcrumbs detected.');
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
  }
}
