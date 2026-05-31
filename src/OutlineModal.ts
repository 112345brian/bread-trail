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
    titleEl.setText('Breadcrumb outline');

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
      if (!targetPath) continue;
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
    nodeEl.setAttribute('data-path', node.file.path);
    nodeEl.setAttribute('draggable', 'true');

    const icon = nodeEl.createSpan('bread-trail-node-icon');
    if (node.children.length > 0) {
      setIcon(icon, 'chevron-down');
    } else {
      setIcon(icon, 'file');
    }

    const nameEl = nodeEl.createSpan('bread-trail-node-name');
    nameEl.setText(node.file.basename);

    // Click to open file
    nameEl.addEventListener('click', () => {
      void this.app.workspace.getLeaf('tab').openFile(node.file);
    });

    // Drag-and-drop handlers
    nodeEl.addEventListener('dragstart', (e) => {
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', node.file.path);
      nodeEl.addClass('bread-trail-dragging');
    });

    nodeEl.addEventListener('dragend', () => {
      nodeEl.removeClass('bread-trail-dragging');
    });

    nodeEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      nodeEl.addClass('bread-trail-drop-target');
    });

    nodeEl.addEventListener('dragleave', () => {
      nodeEl.removeClass('bread-trail-drop-target');
    });

    nodeEl.addEventListener('drop', (e) => {
      e.preventDefault();
      nodeEl.removeClass('bread-trail-drop-target');

      const draggedPath = e.dataTransfer!.getData('text/plain');
      const targetPath = node.file.path;

      if (draggedPath === targetPath) return;

      void this.reorderFiles(draggedPath, targetPath).then(() => this.refresh());
    });

    // Render children
    for (const child of node.children) {
      this.renderTree(child);
    }
  }

  private async reorderFiles(draggedPath: string, targetPath: string) {
    const draggedFile = this.app.vault.getAbstractFileByPath(draggedPath);
    if (!(draggedFile instanceof TFile)) return;

    // Write `next: [[target]]` to the dragged file's frontmatter
    await this.app.fileManager.processFrontMatter(draggedFile, (fm: Record<string, unknown>) => {
      fm.next = `[[${targetPath.replace(/\.md$/, '')}]]`;
    });
  }
}
