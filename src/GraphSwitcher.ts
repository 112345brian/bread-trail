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

type Relation = 'current' | 'parent' | 'child' | 'previous' | 'next' | 'sibling' | 'sequence-child' | 'related';
type Direction = 'incoming' | 'outgoing';

const CENTER_X = 700;
const CENTER_Y = 390;
const HORIZONTAL_GAP = 190;
const VERTICAL_GAP = 120;

export class GraphSwitcher extends Modal {
  private nodes: GraphNode[] = [];
  private nodeElements = new Map<string, HTMLElement>();
  private selectedPath: string;
  private stageEl?: HTMLElement;
  private edgeLayerEl?: SVGSVGElement;
  private confirmed = false;
  private initialFile: TFile;
  private lastEnterPress = 0;
  private renderTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    app: App,
    private rootFile: TFile,
    private bc: BreadcrumbsPlugin,
    private settings: BreadTrailSettings,
  ) {
    super(app);
    this.selectedPath = rootFile.path;
    this.initialFile = rootFile;
    this.registerDirectionalHotkeys();
  }

  onOpen() {
    this.titleEl.setText('Breadcrumb graph switcher');
    this.contentEl.addClass('bread-trail-graph-modal');
    this.contentEl.createEl('p', {
      text: 'Arrow keys or WASD to navigate. Enter to explore selected note. Enter again to open it.',
      cls: 'mod-muted bread-trail-graph-help',
    });

    this.render();

    // Center on the current node after DOM renders
    requestAnimationFrame(() => {
      this.centerSelectedNode();
    });
  }

  onClose() {
    // If user escaped without confirming, return to initial file
    if (!this.confirmed) {
      const current = this.app.workspace.getActiveFile();
      if (current?.path !== this.initialFile.path) {
        void this.app.workspace.getLeaf('tab').openFile(this.initialFile);
      }
    }
  }

  private render() {
    if (!this.stageEl) {
      const stageEl = this.contentEl.createDiv('bread-trail-graph-stage');
      this.stageEl = stageEl;
      this.edgeLayerEl = stageEl.createSvg('svg', { cls: 'bread-trail-graph-edges' });
    }

    this.nodes = this.buildNodes();

    // Clear and re-render
    this.edgeLayerEl!.empty();
    this.stageEl!.querySelectorAll('.bread-trail-graph-node').forEach((el) => el.remove());
    this.nodeElements.clear();

    this.renderEdges(this.edgeLayerEl!);
    this.renderNodes(this.stageEl!);

    if (!this.contentEl.querySelector('.bread-trail-graph-legend')) {
      this.renderLegend();
    }
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
    this.addSequenceChildren(nodes, seen);

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

    if (!this.settings.showGraphSiblings) return;

    for (const parent of parents) {
      for (const item of this.getNeighbors(parent.file)) {
        if (item.relation !== 'child' || seen.has(item.file.path)) continue;
        nodes.push({ ...item, relation: 'sibling', sourcePath: parent.file.path, x: 0, y: 0 });
        seen.add(item.file.path);
      }
    }
  }

  private addSequenceChildren(nodes: GraphNode[], seen: Set<string>) {
    if (!this.settings.showSequenceChildren) return;

    const sequenceNodes = nodes.filter((node) => node.relation === 'previous' || node.relation === 'next');
    for (const sequenceNode of sequenceNodes) {
      for (const item of this.getNeighbors(sequenceNode.file)) {
        if (item.relation !== 'child' || seen.has(item.file.path)) continue;
        nodes.push({ ...item, relation: 'sequence-child', sourcePath: sequenceNode.file.path, x: 0, y: 0 });
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
    const sequenceChildren = nodes.filter((node) => node.relation === 'sequence-child');
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
    this.layoutSequenceChildren(sequenceChildren, nodes);
    this.layoutRow(siblings, CENTER_Y + VERTICAL_GAP, CENTER_X);
    this.layoutRow(related, CENTER_Y + VERTICAL_GAP * 2, CENTER_X);
  }

  private layoutSequenceChildren(nodes: GraphNode[], allNodes: GraphNode[]) {
    const parentsByPath = new Map(allNodes.map((node) => [node.file.path, node]));
    const sourcePaths = new Set(nodes.map((node) => node.sourcePath));

    for (const sourcePath of sourcePaths) {
      const parent = parentsByPath.get(sourcePath);
      if (!parent) continue;
      const children = nodes.filter((node) => node.sourcePath === sourcePath);
      this.layoutRow(children, CENTER_Y + VERTICAL_GAP, parent.x);
    }
  }

  private layoutHierarchy(nodes: GraphNode[], direction: -1 | 1) {
    const depths = new Set(nodes.map((node) => node.depth));
    for (const depth of depths) {
      const row = nodes.filter((node) => node.depth === depth);
      this.layoutRow(row, CENTER_Y + direction * depth * VERTICAL_GAP, CENTER_X);
    }
  }

  private layoutRow(nodes: GraphNode[], y: number, centerX: number) {
    if (nodes.length === 0) return;

    // Dynamic gap to prevent overflow — max 1200px total width
    const gap = Math.min(HORIZONTAL_GAP, 1200 / Math.max(nodes.length - 1, 1));

    nodes.forEach((node, index) => {
      node.x = centerX + (index - (nodes.length - 1) / 2) * gap;
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
        if (this.selectedPath === node.file.path) {
          // Double-click behavior: trigger enter
          void this.handleEnter();
        } else {
          this.selectNode(node.file.path);
        }
      });
      this.nodeElements.set(node.file.path, nodeEl);
    }
    this.selectNode(this.selectedPath);
  }

  private renderLegend() {
    const legendEl = this.contentEl.createDiv('bread-trail-graph-legend');
    legendEl.createSpan({ text: '↑ parent' });
    legendEl.createSpan({ text: '↓ child' });
    legendEl.createSpan({ text: '← previous' });
    legendEl.createSpan({ text: '→ next' });
    legendEl.createSpan({ text: '− sibling' });
    legendEl.createSpan({ text: '↓ sequence child' });
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
      edgeType: edgeType ?? 'unknown',
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
    if (relation === 'child' || relation === 'sequence-child') return 'arrow-down';
    if (relation === 'previous') return 'arrow-left';
    if (relation === 'next') return 'arrow-right';
    if (relation === 'sibling') return 'minus';
    if (relation === 'related') return 'link';
    return 'circle-dot';
  }

  private registerDirectionalHotkeys() {
    this.scope.register([], 'ArrowUp', () => this.moveSelection('up'));
    this.scope.register([], 'ArrowDown', () => this.moveSelection('down'));
    this.scope.register([], 'ArrowLeft', () => this.moveSelection('left'));
    this.scope.register([], 'ArrowRight', () => this.moveSelection('right'));
    this.scope.register([], 'w', () => this.moveSelection('up'));
    this.scope.register([], 's', () => this.moveSelection('down'));
    this.scope.register([], 'a', () => this.moveSelection('left'));
    this.scope.register([], 'd', () => this.moveSelection('right'));
    this.scope.register([], 'Enter', () => this.handleEnter());
  }

  private moveSelection(direction: 'up' | 'down' | 'left' | 'right'): false {
    const current = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!current) return false;

    const next = this.nodes
      .filter((node) => node.file.path !== current.file.path && this.isInDirection(current, node, direction))
      .map((node) => ({ node, score: this.getDirectionalDistance(current, node, direction) }))
      .sort((left, right) => left.score - right.score)[0]?.node;
    if (next) this.selectNode(next.file.path);
    return false;
  }

  private selectNode(path: string) {
    this.nodeElements.get(this.selectedPath)?.removeClass('is-selected');
    this.selectedPath = path;
    this.nodeElements.get(path)?.addClass('is-selected');
    this.centerSelectedNode();
  }

  private handleEnter(): false {
    const selected = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!selected) return false;

    const now = Date.now();
    const timeSinceLastEnter = now - this.lastEnterPress;

    // Double-tap detection: if Enter pressed within 500ms, open immediately
    if (timeSinceLastEnter < 500) {
      if (this.renderTimeout) {
        clearTimeout(this.renderTimeout);
        this.renderTimeout = undefined;
      }
      this.confirmed = true;
      this.close();
      void this.app.workspace.getLeaf('tab').openFile(selected.file);
      return false;
    }

    this.lastEnterPress = now;

    // First press: re-center graph around selected node
    if (selected.file.path !== this.rootFile.path) {
      // Debounce: wait 150ms before rendering in case of double-tap
      if (this.renderTimeout) clearTimeout(this.renderTimeout);
      this.renderTimeout = setTimeout(() => {
        this.rootFile = selected.file;
        this.render();
        requestAnimationFrame(() => {
          this.centerSelectedNode();
        });
        this.renderTimeout = undefined;
      }, 150);
      return false;
    }

    // Already centered: open immediately
    this.confirmed = true;
    this.close();
    void this.app.workspace.getLeaf('tab').openFile(selected.file);
    return false;
  }

  private isInDirection(current: GraphNode, candidate: GraphNode, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    if (direction === 'up') return candidate.y < current.y;
    if (direction === 'down') return candidate.y > current.y;
    if (direction === 'left') return candidate.x < current.x;
    return candidate.x > current.x;
  }

  private getDirectionalDistance(current: GraphNode, candidate: GraphNode, direction: 'up' | 'down' | 'left' | 'right'): number {
    const x = Math.abs(candidate.x - current.x);
    const y = Math.abs(candidate.y - current.y);
    return direction === 'up' || direction === 'down' ? y + x * 2 : x + y * 2;
  }

  private centerSelectedNode() {
    const selected = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!selected || !this.stageEl) return;

    this.stageEl.style.setProperty('--bread-trail-graph-pan-x', `${CENTER_X - selected.x}px`);
    this.stageEl.style.setProperty('--bread-trail-graph-pan-y', `${CENTER_Y - selected.y}px`);
  }

  private capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
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
