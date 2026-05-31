import { App, Modal, TFile, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';

interface TreeNode {
  file: TFile;
  children: TreeNode[];
  depth: number;
}

export class OutlineModal extends Modal {
  private bc: BreadcrumbsPlugin;
  private rootFile: TFile;
  private contentContainer!: HTMLElement;
  private graphUpdateHandler: () => void;

  constructor(app: App, file: TFile, bc: BreadcrumbsPlugin) {
    super(app);
    this.rootFile = file;
    this.bc = bc;
    this.graphUpdateHandler = () => this.refresh();
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('Breadcrumb Outline');

    contentEl.createEl('p', {
      text: `Root: ${this.rootFile.basename}`,
      cls: 'mod-muted bread-trail-root-label',
    });

    this.contentContainer = contentEl.createDiv('bread-trail-outline');
    this.refresh();

    // Subscribe to BC graph updates for live refresh
    this.bc.events.on('graph-update', this.graphUpdateHandler);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private refresh() {
    this.contentContainer.empty();
    const tree = this.buildTree(this.rootFile, 0, new Set());
    this.renderTree(tree);
  }

  private buildTree(file: TFile, depth: number, visited: Set<string>): TreeNode {
    if (visited.has(file.path)) {
      return { file, children: [], depth };
    }
    visited.add(file.path);

    const outgoing = this.bc.graph.get_outgoing_edges(file.path).to_array();
    const children: TreeNode[] = [];

    for (const edge of outgoing) {
      const targetPath = edge.target_path?.(this.bc.graph) ?? edge.target;
      const childFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (childFile instanceof TFile && childFile.extension === 'md') {
        children.push(this.buildTree(childFile, depth + 1, visited));
      }
    }

    return { file, children, depth };
  }

  private renderTree(node: TreeNode) {
    const nodeEl = this.contentContainer.createDiv('bread-trail-node');
    nodeEl.style.paddingLeft = `${node.depth * 20}px`;

    const icon = nodeEl.createSpan('bread-trail-node-icon');
    if (node.children.length > 0) {
      setIcon(icon, 'chevron-down');
    } else {
      setIcon(icon, 'file');
    }

    const nameEl = nodeEl.createSpan('bread-trail-node-name');
    nameEl.setText(node.file.basename);
    nameEl.setAttribute('data-path', node.file.path);

    // Click to open file
    nameEl.addEventListener('click', () => {
      this.app.workspace.getLeaf('tab').openFile(node.file);
    });

    // Render children
    for (const child of node.children) {
      this.renderTree(child);
    }
  }
}
