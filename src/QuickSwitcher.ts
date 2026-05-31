import { App, FuzzySuggestModal, TFile, setIcon, FuzzyMatch } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';

interface BCItem {
  file: TFile;
  relation: Relation;
  edgeType: string;
  depth: number;
  sequencePosition?: number;
  sequenceLength?: number;
}

type Relation = 'parent' | 'child' | 'previous' | 'next' | 'sibling' | 'related' | 'vault';
type Direction = 'incoming' | 'outgoing';

export class BreadcrumbQuickSwitcher extends FuzzySuggestModal<BCItem> {
  private bc: BreadcrumbsPlugin;
  private rootFile: TFile;
  private items: BCItem[] = [];

  constructor(
    app: App,
    file: TFile,
    bc: BreadcrumbsPlugin,
    private settings: BreadTrailSettings,
    private includeVaultFiles = false,
  ) {
    super(app);
    this.rootFile = file;
    this.bc = bc;
    this.setPlaceholder(includeVaultFiles ? 'Search notes with breadcrumb context...' : 'Search previous, next, parents, children, and related notes...');
    this.setInstructions([
      { command: 'Cmd ↑', purpose: 'open nearest parent' },
      { command: 'Cmd ↓', purpose: 'open nearest child' },
      { command: 'Cmd ←', purpose: 'open previous' },
      { command: 'Cmd →', purpose: 'open next' },
    ]);
    this.registerDirectionalHotkeys();
    this.buildItems();
  }

  private buildItems() {
    const seen = new Set<string>([this.rootFile.path]);
    const directNeighbors = this.getNeighbors(this.rootFile);
    const parents = directNeighbors.filter((item) => item.relation === 'parent');

    const previousSequence = this.getSequence('previous');
    const nextSequence = this.getSequence('next');
    this.addSequencePositions(previousSequence, nextSequence);
    const previous = previousSequence.slice(0, this.settings.previousDepth);
    const next = nextSequence.slice(0, this.settings.nextDepth);

    previous.reverse();
    for (const item of previous) {
      this.addItem(item, seen);
    }

    for (const item of next) {
      this.addItem(item, seen);
    }

    this.addHierarchy('parent', this.settings.parentDepth, seen);
    this.addHierarchy('child', this.settings.childDepth, seen);

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

    if (this.includeVaultFiles) {
      for (const file of this.app.vault.getMarkdownFiles()) {
        this.addItem({ file, relation: 'vault', edgeType: '', depth: 0 }, seen);
      }
    }
  }

  private addSequencePositions(previous: BCItem[], next: BCItem[]) {
    const sequenceLength = previous.length + 1 + next.length;
    const rootPosition = previous.length + 1;

    for (const item of previous) {
      item.sequencePosition = rootPosition - item.depth;
      item.sequenceLength = sequenceLength;
    }

    for (const item of next) {
      item.sequencePosition = rootPosition + item.depth;
      item.sequenceLength = sequenceLength;
    }
  }

  private getSequence(relation: 'previous' | 'next'): BCItem[] {
    const items: BCItem[] = [];
    const visited = new Set<string>([this.rootFile.path]);
    let current = this.rootFile;
    let depth = 0;

    while (true) {
      const item = this.getNeighbors(current).find((neighbor) => neighbor.relation === relation);
      if (!item || visited.has(item.file.path)) return items;
      depth += 1;
      visited.add(item.file.path);
      items.push({ ...item, depth });
      current = item.file;
    }

  }

  private addHierarchy(relation: 'parent' | 'child', maxDepth: number, seen: Set<string>) {
    const visited = new Set<string>([this.rootFile.path]);
    const queue: { file: TFile; depth: number }[] = [{ file: this.rootFile, depth: 0 }];

    for (const current of queue) {
      if (current.depth >= maxDepth) continue;
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
    const type = edgeType?.toLowerCase();
    if (type === 'up') return direction === 'outgoing' ? 'parent' : 'child';
    if (type === 'down') return direction === 'outgoing' ? 'child' : 'parent';
    if (type === 'next') return direction === 'outgoing' ? 'next' : 'previous';
    if (type === 'prev') return direction === 'outgoing' ? 'previous' : 'next';
    return 'related';
  }

  getItems(): BCItem[] {
    return this.items;
  }

  getSuggestions(query: string): FuzzyMatch<BCItem>[] {
    return super.getSuggestions(query)
      .map((match, fuzzyRank) => ({
        match,
        weightedRank: fuzzyRank + this.getDistancePenalty(match.item),
      }))
      .sort((left, right) => left.weightedRank - right.weightedRank)
      .map(({ match }) => match);
  }

  getItemText(item: BCItem): string {
    return item.file.basename;
  }

  renderSuggestion(match: FuzzyMatch<BCItem>, el: HTMLElement) {
    el.empty();
    el.addClass('bread-trail-switcher-item');

    const item = match.item;

    const iconEl = el.createSpan('bread-trail-switcher-icons');
    if (item.relation === 'parent' || item.relation === 'child' || item.relation === 'previous' || item.relation === 'next') {
      const icon = this.getDirectionalIcon(item.relation);
      for (let index = 0; index < item.depth; index++) {
        setIcon(iconEl.createSpan('bread-trail-switcher-icon'), icon);
      }
    } else {
      setIcon(iconEl.createSpan('bread-trail-switcher-icon'), this.getContextIcon(item.relation));
    }

    const nameEl = el.createSpan('bread-trail-switcher-name');
    nameEl.setText(item.file.basename);

    const metaEl = el.createSpan('bread-trail-switcher-meta');
    const sequenceLabel = item.sequencePosition && item.sequenceLength ? ` · ${item.sequencePosition}/${item.sequenceLength}` : '';
    const depthLabel = item.depth > 1 ? ` · ${item.depth} ${this.getDistanceUnit(item.relation)}` : '';
    const edgeLabel = item.edgeType ? ` via ${item.edgeType}` : '';
    metaEl.setText(`${this.capitalize(item.relation)}${sequenceLabel}${depthLabel}${edgeLabel}`);
  }

  onChooseItem(item: BCItem, _evt: MouseEvent | KeyboardEvent) {
    void this.app.workspace.getLeaf('tab').openFile(item.file);
  }

  private capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private getDirectionalIcon(relation: 'parent' | 'child' | 'previous' | 'next'): string {
    if (relation === 'parent') return 'arrow-up';
    if (relation === 'child') return 'arrow-down';
    if (relation === 'previous') return 'arrow-left';
    return 'arrow-right';
  }

  private getDistanceUnit(relation: Relation): string {
    return relation === 'previous' || relation === 'next' ? 'positions' : 'levels';
  }

  private getContextIcon(relation: Relation): string {
    if (relation === 'sibling') return 'minus';
    if (relation === 'vault') return 'file';
    return 'link';
  }

  private getDistancePenalty(item: BCItem): number {
    if (item.relation === 'parent' || item.relation === 'child' || item.relation === 'previous' || item.relation === 'next') {
      return Math.max(0, item.depth - 1) * 4;
    }
    return 0;
  }

  private registerDirectionalHotkeys() {
    this.scope.register(['Mod'], 'ArrowUp', () => this.openNearest('parent'));
    this.scope.register(['Mod'], 'ArrowDown', () => this.openNearest('child'));
    this.scope.register(['Mod'], 'ArrowLeft', () => this.openNearest('previous'));
    this.scope.register(['Mod'], 'ArrowRight', () => this.openNearest('next'));
  }

  private openNearest(relation: 'parent' | 'child' | 'previous' | 'next'): false {
    const item = this.getNeighbors(this.rootFile).find((neighbor) => neighbor.relation === relation);
    if (!item) return false;

    this.close();
    void this.app.workspace.getLeaf('tab').openFile(item.file);
    return false;
  }
}
