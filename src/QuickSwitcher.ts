import { App, FuzzySuggestModal, TFile, setIcon, FuzzyMatch } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';

interface BCItem {
  file: TFile;
  relation: 'parent' | 'child' | 'sibling';
  edgeType: string;
}

export class BreadcrumbQuickSwitcher extends FuzzySuggestModal<BCItem> {
  private bc: BreadcrumbsPlugin;
  private rootFile: TFile;
  private items: BCItem[] = [];

  constructor(app: App, file: TFile, bc: BreadcrumbsPlugin) {
    super(app);
    this.rootFile = file;
    this.bc = bc;
    this.setPlaceholder('Search breadcrumb-related notes...');
    this.buildItems();
  }

  private buildItems() {
    const seen = new Set<string>();

    // Parents (incoming edges)
    const incoming = this.bc.graph.get_incoming_edges(this.rootFile.path).to_array();
    for (const edge of incoming) {
      const sourcePath = edge.source_path?.(this.bc.graph) ?? edge.source;
      if (!sourcePath || seen.has(sourcePath)) continue;
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (file instanceof TFile && file.extension === 'md') {
        this.items.push({ file, relation: 'parent', edgeType: edge.edge_type ?? 'unknown' });
        seen.add(sourcePath);
      }
    }

    // Children (outgoing edges)
    const outgoing = this.bc.graph.get_outgoing_edges(this.rootFile.path).to_array();
    for (const edge of outgoing) {
      const targetPath = edge.target_path?.(this.bc.graph) ?? edge.target;
      if (!targetPath || seen.has(targetPath)) continue;
      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (file instanceof TFile && file.extension === 'md') {
        this.items.push({ file, relation: 'child', edgeType: edge.edge_type ?? 'unknown' });
        seen.add(targetPath);
      }
    }

    // Siblings (same parent)
    for (const edge of incoming) {
      const parentPath = edge.source_path?.(this.bc.graph) ?? edge.source;
      if (!parentPath) continue;
      const parentOutgoing = this.bc.graph.get_outgoing_edges(parentPath).to_array();
      for (const siblingEdge of parentOutgoing) {
        const siblingPath = siblingEdge.target_path?.(this.bc.graph) ?? siblingEdge.target;
        if (!siblingPath || siblingPath === this.rootFile.path || seen.has(siblingPath)) continue;
        const file = this.app.vault.getAbstractFileByPath(siblingPath);
        if (file instanceof TFile && file.extension === 'md') {
          this.items.push({ file, relation: 'sibling', edgeType: siblingEdge.edge_type ?? 'unknown' });
          seen.add(siblingPath);
        }
      }
    }
  }

  getItems(): BCItem[] {
    return this.items;
  }

  getItemText(item: BCItem): string {
    return item.file.basename;
  }

  renderSuggestion(match: FuzzyMatch<BCItem>, el: HTMLElement) {
    el.empty();
    el.addClass('bread-trail-switcher-item');

    const item = match.item;

    const iconEl = el.createSpan('bread-trail-switcher-icon');
    const icon = item.relation === 'parent' ? 'arrow-up' : item.relation === 'child' ? 'arrow-down' : 'minus';
    setIcon(iconEl, icon);

    const nameEl = el.createSpan('bread-trail-switcher-name');
    nameEl.setText(item.file.basename);

    const metaEl = el.createSpan('bread-trail-switcher-meta');
    metaEl.setText(`${item.relation} · ${item.edgeType}`);
  }

  onChooseItem(item: BCItem, _evt: MouseEvent | KeyboardEvent) {
    void this.app.workspace.getLeaf('tab').openFile(item.file);
  }
}
