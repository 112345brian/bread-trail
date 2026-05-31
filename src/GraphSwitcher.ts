import { App, Modal, TFile, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';

interface GraphNode {
  file: TFile;
  relation: Relation;
  edgeType: string;
  depth: number;
  sourcePath: string;
  x: number;
  y: number;
}

type Relation = 'current' | 'parent' | 'child' | 'previous' | 'next' | 'sibling' | 'related';
type Direction = 'incoming' | 'outgoing';

const CENTER_X = 700;
const CENTER_Y = 390;
const HORIZONTAL_GAP = 190;
const VERTICAL_GAP = 120;

export class GraphSwitcher extends Modal {
  private nodes: GraphNode[] = [];

  constructor(
    app: App,
    private rootFile: TFile,
    private bc: BreadcrumbsPlugin,
    private settings: BreadTrailSettings,
  ) {
    super(app);
    this.registerDirectionalHotkeys();
  }

  onOpen() {
    this.titleEl.setText('Breadcrumb graph switcher');
    this.contentEl.addClass('bread-trail-graph-modal');
    this.contentEl.createEl('p', {
      text: 'Select a note to open it. Use cmd plus an arrow key to open the nearest note in that direction.',
      cls: 'mod-muted bread-trail-graph-help',
    });

    this.nodes = this.buildNodes();
    const viewportEl = this.contentEl.createDiv('bread-trail-graph-viewport');
    const stageEl = viewportEl.createDiv('bread-trail-graph-stage');
    const edgeLayer = stageEl.createSvg('svg', { cls: 'bread-trail-graph-edges' });
    this.renderEdges(edgeLayer);
    this.renderNodes(stageEl);
    this.renderLegend();
    window.setTimeout(() => this.centerViewport(viewportEl), 0);
  }

  private buildNodes(): GraphNode[] {
    const nodes: GraphNode[] = [{
      file: this.rootFile,
      relation: 'current',
      edgeType: '',
      depth: 0,
      sourcePath: this.rootFile.path,
      x: CENTER_X,
      y: CENTER_Y,
    }];
    const seen = new Set<string>([this.rootFile.path]);

    this.addSequence(nodes, seen, 'previous', this.settings.previousDepth);
    this.addSequence(nodes, seen, 'next', this.settings.nextDepth);
    this.addHierarchy(nodes, seen, 'parent', this.settings.parentDepth);
    this.addHierarchy(nodes, seen, 'child', this.settings.childDepth);
    this.addSecondaryNodes(nodes, seen);

    this.layoutNodes(nodes);
    return nodes;
  }

  private addSequence(nodes: GraphNode[], seen: Set<string>, relation: 'previous' | 'next', maxDepth: number) {
    let current = this.rootFile;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const item = this.getNeighbors(current).find((neighbor) => neighbor.relation === relation);
      if (!item || seen.has(item.file.path)) return;
      nodes.push({ ...item, depth, sourcePath: current.path, x: 0, y: 0 });
      seen.add(item.file.path);
      current = item.file;
    }
  }

  private addHierarchy(nodes: GraphNode[], seen: Set<string>, relation: 'parent' | 'child', maxDepth: number) {
    const visited = new Set<string>([this.rootFile.path]);
    const queue: { file: TFile; depth: number }[] = [{ file: this.rootFile, depth: 0 }];

    for (const current of queue) {
      if (current.depth >= maxDepth) continue;
      for (const item of this.getNeighbors(current.file)) {
        if (item.relation !== relation || visited.has(item.file.path)) continue;
        const depth = current.depth + 1;
        visited.add(item.file.path);
        queue.push({ file: item.file, depth });
        if (seen.has(item.file.path)) continue;
        nodes.push({ ...item, depth, sourcePath: current.file.path, x: 0, y: 0 });
        seen.add(item.file.path);
      }
    }
  }

  private addSecondaryNodes(nodes: GraphNode[], seen: Set<string>) {
    const directNeighbors = this.getNeighbors(this.rootFile);
    const parents = directNeighbors.filter((item) => item.relation === 'parent');

    for (const item of directNeighbors) {
      if (item.relation === 'related' && !seen.has(item.file.path)) {
        nodes.push({ ...item, sourcePath: this.rootFile.path, x: 0, y: 0 });
        seen.add(item.file.path);
      }
    }

    for (const parent of parents) {
      for (const item of this.getNeighbors(parent.file)) {
        if (item.relation !== 'child' || seen.has(item.file.path)) continue;
        nodes.push({ ...item, relation: 'sibling', sourcePath: this.rootFile.path, x: 0, y: 0 });
        seen.add(item.file.path);
      }
    }
  }

  private layoutNodes(nodes: GraphNode[]) {
    const previous = nodes.filter((node) => node.relation === 'previous');
    const next = nodes.filter((node) => node.relation === 'next');
    const parents = nodes.filter((node) => node.relation === 'parent');
    const children = nodes.filter((node) => node.relation === 'child');
    const siblings = nodes.filter((node) => node.relation === 'sibling');
    const related = nodes.filter((node) => node.relation === 'related');

    previous.forEach((node) => {
      node.x = CENTER_X - node.depth * HORIZONTAL_GAP;
      node.y = CENTER_Y;
    });
    next.forEach((node) => {
      node.x = CENTER_X + node.depth * HORIZONTAL_GAP;
      node.y = CENTER_Y;
    });
    this.layoutHierarchy(parents, -1);
    this.layoutHierarchy(children, 1);
    this.layoutRow(siblings, CENTER_Y + VERTICAL_GAP, CENTER_X);
    this.layoutRow(related, CENTER_Y + VERTICAL_GAP * 2, CENTER_X);
  }

  private layoutHierarchy(nodes: GraphNode[], direction: -1 | 1) {
    const depths = new Set(nodes.map((node) => node.depth));
    for (const depth of depths) {
      const row = nodes.filter((node) => node.depth === depth);
      this.layoutRow(row, CENTER_Y + direction * depth * VERTICAL_GAP, CENTER_X);
    }
  }

  private layoutRow(nodes: GraphNode[], y: number, centerX: number) {
    nodes.forEach((node, index) => {
      node.x = centerX + (index - (nodes.length - 1) / 2) * HORIZONTAL_GAP;
      node.y = y;
    });
  }

  private renderEdges(edgeLayer: SVGSVGElement) {
    const nodesByPath = new Map(this.nodes.map((node) => [node.file.path, node]));
    const root = nodesByPath.get(this.rootFile.path);
    if (!root) return;

    for (const node of this.nodes) {
      if (node.relation === 'current') continue;
      const source = nodesByPath.get(node.sourcePath) ?? root;
      const line = edgeLayer.createSvg('line');
      line.setAttribute('x1', String(source.x));
      line.setAttribute('y1', String(source.y));
      line.setAttribute('x2', String(node.x));
      line.setAttribute('y2', String(node.y));
      line.addClass(`bread-trail-graph-edge-${node.relation}`);
    }
  }

  private renderNodes(stageEl: HTMLElement) {
    for (const node of this.nodes) {
      const nodeEl = stageEl.createEl('button', {
        cls: `bread-trail-graph-node bread-trail-graph-node-${node.relation}`,
      });
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;
      const label = this.getLabel(node.file);
      nodeEl.setAttribute('aria-label', `${this.capitalize(node.relation)}: ${label}`);
      setIcon(nodeEl.createSpan('bread-trail-graph-node-icon'), this.getIcon(node.relation));
      nodeEl.createSpan({ text: label, cls: 'bread-trail-graph-node-label' });
      if (node.depth > 1) {
        nodeEl.createSpan({ text: String(node.depth), cls: 'bread-trail-graph-node-depth' });
      }
      nodeEl.addEventListener('click', () => {
        this.close();
        void this.app.workspace.getLeaf('tab').openFile(node.file);
      });
    }
  }

  private renderLegend() {
    const legendEl = this.contentEl.createDiv('bread-trail-graph-legend');
    legendEl.createSpan({ text: '↑ parent' });
    legendEl.createSpan({ text: '↓ child' });
    legendEl.createSpan({ text: '← previous' });
    legendEl.createSpan({ text: '→ next' });
    legendEl.createSpan({ text: '− sibling' });
    legendEl.createSpan({ text: '↗ related' });
  }

  private getNeighbors(file: TFile): GraphNode[] {
    const incoming = this.bc.graph.get_incoming_edges(file.path).to_array();
    const outgoing = this.bc.graph.get_outgoing_edges(file.path).to_array();

    return [
      ...incoming.map((edge) => this.toNode(edge.source_path?.(this.bc.graph) ?? edge.source, edge.edge_type, 'incoming')),
      ...outgoing.map((edge) => this.toNode(edge.target_path?.(this.bc.graph) ?? edge.target, edge.edge_type, 'outgoing')),
    ].filter((item): item is GraphNode => item !== null);
  }

  private toNode(path: string | undefined, edgeType: string | undefined, direction: Direction): GraphNode | null {
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') return null;

    return {
      file,
      relation: this.getRelation(edgeType, direction),
      edgeType: edgeType ?? 'unknown edge',
      depth: 1,
      sourcePath: this.rootFile.path,
      x: 0,
      y: 0,
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

  private getIcon(relation: Relation): string {
    if (relation === 'parent') return 'arrow-up';
    if (relation === 'child') return 'arrow-down';
    if (relation === 'previous') return 'arrow-left';
    if (relation === 'next') return 'arrow-right';
    if (relation === 'sibling') return 'minus';
    if (relation === 'related') return 'link';
    return 'circle-dot';
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

  private capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private centerViewport(viewportEl: HTMLElement) {
    viewportEl.scrollLeft = CENTER_X - viewportEl.clientWidth / 2;
    viewportEl.scrollTop = CENTER_Y - viewportEl.clientHeight / 2;
  }

  private getLabel(file: TFile): string {
    const property = this.settings.graphLabelProperty;
    if (!property) return file.basename;

    const cachedFrontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const frontmatter = typeof cachedFrontmatter === 'object' && cachedFrontmatter !== null
      ? cachedFrontmatter as Record<string, unknown>
      : undefined;
    const value = frontmatter?.[property];
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
      return first?.trim() ?? file.basename;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return file.basename;
  }
}
