import { App, FuzzySuggestModal, TFile, setIcon, FuzzyMatch } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';

interface BCItem {
  file: TFile;
  relation: Relation;
  edgeType: string;
  depth: number;
}

type Relation = 'parent' | 'child' | 'sibling' | 'related';
type Direction = 'incoming' | 'outgoing';

export class BreadcrumbQuickSwitcher extends FuzzySuggestModal<BCItem> {
  private bc: BreadcrumbsPlugin;
  private rootFile: TFile;
  private items: BCItem[] = [];

  constructor(app: App, file: TFile, bc: BreadcrumbsPlugin) {
    super(app);
    this.rootFile = file;
    this.bc = bc;
    this.setPlaceholder('Search parents, children, siblings, and related notes...');
    this.buildItems();
  }

  private buildItems() {
    const seen = new Set<string>([this.rootFile.path]);
    const directNeighbors = this.getNeighbors(this.rootFile);
    const parents = directNeighbors.filter((item) => item.relation === 'parent');

    this.addHierarchy('parent', seen);
    this.addHierarchy('child', seen);

    for (const item of directNeighbors) {
      if (item.relation === 'related') {
        this.addItem(item, seen);
      }
    }

    for (const parent of parents) {
      for (const item of this.getNeighbors(parent.file)) {
        if (item.relation === 'child') {
          this.addItem({ ...item, relation: 'sibling' }, seen);
        }
      }
    }
  }

  private addHierarchy(relation: 'parent' | 'child', seen: Set<string>) {
    const visited = new Set<string>([this.rootFile.path]);
    const queue: { file: TFile; depth: number }[] = [{ file: this.rootFile, depth: 0 }];

    for (const current of queue) {
      for (const item of this.getNeighbors(current.file)) {
        if (item.relation !== relation || visited.has(item.file.path)) continue;
        const depth = current.depth + 1;
        visited.add(item.file.path);
        queue.push({ file: item.file, depth });
        this.addItem({ ...item, depth }, seen);
      }
    }
  }

  private addItem(item: BCItem, seen: Set<string>) {
    if (seen.has(item.file.path)) return;
    this.items.push(item);
    seen.add(item.file.path);
  }

  private getNeighbors(file: TFile): BCItem[] {
    const incoming = this.bc.graph.get_incoming_edges(file.path).to_array();
    const outgoing = this.bc.graph.get_outgoing_edges(file.path).to_array();

    return [
      ...incoming.map((edge) => this.toItem(edge.source_path?.(this.bc.graph) ?? edge.source, edge.edge_type, 'incoming')),
      ...outgoing.map((edge) => this.toItem(edge.target_path?.(this.bc.graph) ?? edge.target, edge.edge_type, 'outgoing')),
    ].filter((item): item is BCItem => item !== null);
  }

  private toItem(path: string | undefined, edgeType: string | undefined, direction: Direction): BCItem | null {
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') return null;

    return {
      file,
      relation: this.getRelation(edgeType, direction),
      edgeType: edgeType ?? 'unknown edge',
      depth: 1,
    };
  }

  private getRelation(edgeType: string | undefined, direction: Direction): Relation {
    if (edgeType === 'up') return direction === 'outgoing' ? 'parent' : 'child';
    if (edgeType === 'down') return direction === 'outgoing' ? 'child' : 'parent';
    return 'related';
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

    const iconEl = el.createSpan('bread-trail-switcher-icons');
    if (item.relation === 'parent' || item.relation === 'child') {
      const icon = item.relation === 'parent' ? 'arrow-up' : 'arrow-down';
      for (let index = 0; index < item.depth; index++) {
        setIcon(iconEl.createSpan('bread-trail-switcher-icon'), icon);
      }
    } else {
      setIcon(iconEl.createSpan('bread-trail-switcher-icon'), item.relation === 'sibling' ? 'minus' : 'link');
    }

    const nameEl = el.createSpan('bread-trail-switcher-name');
    nameEl.setText(item.file.basename);

    const metaEl = el.createSpan('bread-trail-switcher-meta');
    const depthLabel = item.depth > 1 ? ` · ${item.depth} levels` : '';
    metaEl.setText(`${this.capitalize(item.relation)}${depthLabel} via ${item.edgeType}`);
  }

  onChooseItem(item: BCItem, _evt: MouseEvent | KeyboardEvent) {
    void this.app.workspace.getLeaf('tab').openFile(item.file);
  }

  private capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
