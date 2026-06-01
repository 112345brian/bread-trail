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
  sequencePosition?: number;
  sequenceLength?: number;
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
  private horizontalOrientation = false;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private panOffset = { x: 0, y: 0 };
  private centerTimeout?: ReturnType<typeof setTimeout>;
  private zoomLevel = 1;
  private filterText = '';
  private filterTimeout?: ReturnType<typeof setTimeout>;
  private visibleEdgeTypes = new Set<string>();
  private allEdgeTypes = new Set<string>();

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

    const controlsRow = this.contentEl.createDiv('bread-trail-graph-controls');
    controlsRow.createEl('p', {
      text: 'Arrows/WASD: navigate • Enter: explore • 2×Enter: open • Shift+Enter: flip • Home: recenter • Ctrl+scroll: zoom • Type to filter',
      cls: 'mod-muted bread-trail-graph-help',
    });

    this.render();

    // Center on the current node after DOM renders and layout completes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.centerSelectedNode();
      });
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
    let viewport: HTMLElement;

    if (!this.stageEl) {
      const stageEl = this.contentEl.createDiv('bread-trail-graph-stage');
      this.stageEl = stageEl;
      viewport = stageEl.createDiv('bread-trail-graph-viewport');
      this.edgeLayerEl = viewport.createSvg('svg', { cls: 'bread-trail-graph-edges' });
      this.registerMouseHandlers(stageEl, viewport);
    } else {
      viewport = this.stageEl.querySelector('.bread-trail-graph-viewport') as HTMLElement;
    }

    this.nodes = this.buildNodes();

    // Clear and re-render
    this.edgeLayerEl!.empty();
    viewport.querySelectorAll('.bread-trail-graph-node').forEach((el) => el.remove());
    this.nodeElements.clear();

    this.renderEdges(this.edgeLayerEl!);
    this.renderNodes(viewport);

    if (!this.contentEl.querySelector('.bread-trail-graph-legend')) {
      this.renderLegend();
    }

    if (!this.contentEl.querySelector('.bread-trail-edge-filter')) {
      this.renderEdgeFilter();
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

    this.assignSequencePositions(nodes);
    this.collectEdgeTypes(nodes);
    this.layoutNodes(nodes);
    return nodes;
  }

  private collectEdgeTypes(nodes: GraphNode[]) {
    // Collect all unique edge types from the graph
    this.allEdgeTypes.clear();
    for (const node of nodes) {
      if (node.edgeType) {
        this.allEdgeTypes.add(node.edgeType);
      }
    }

    // Initialize visible types to all types if not set
    if (this.visibleEdgeTypes.size === 0) {
      this.visibleEdgeTypes = new Set(this.allEdgeTypes);
    }
  }

  private assignSequencePositions(nodes: GraphNode[]) {
    const previous = nodes.filter((node) => node.relation === 'previous');
    const next = nodes.filter((node) => node.relation === 'next');
    const current = nodes.find((node) => node.relation === 'current');

    const totalLength = previous.length + 1 + next.length;
    const currentPosition = previous.length + 1;

    if (current) {
      current.sequencePosition = currentPosition;
      current.sequenceLength = totalLength;
    }

    // Previous nodes: reverse order (furthest is 1, closest is previous.length)
    previous.forEach((node) => {
      node.sequencePosition = currentPosition - node.depth;
      node.sequenceLength = totalLength;
    });

    // Next nodes: forward order (first is currentPosition + 1, etc.)
    next.forEach((node) => {
      node.sequencePosition = currentPosition + node.depth;
      node.sequenceLength = totalLength;
    });
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

    // Viewport-relative spacing: ~25% of stage width for sequence gaps (generous for long titles)
    const stageWidth = this.stageEl ? this.stageEl.getBoundingClientRect().width : 1400;
    const sequenceGap = Math.max(stageWidth * 0.25, 300);

    if (this.horizontalOrientation) {
      // Horizontal: parents left, children right, prev/next vertical
      this.layoutHierarchy(parents, -1, true);
      this.layoutHierarchy(children, 1, true);
      previous.forEach((node) => {
        node.x = CENTER_X;
        node.y = CENTER_Y - node.depth * VERTICAL_GAP;
      });
      next.forEach((node) => {
        node.x = CENTER_X;
        node.y = CENTER_Y + node.depth * VERTICAL_GAP;
      });
      this.layoutSequenceChildren(sequenceChildren, nodes, true);
      this.layoutRow(siblings, CENTER_Y + VERTICAL_GAP, CENTER_X, true);
      this.layoutRow(related, CENTER_Y + VERTICAL_GAP * 2, CENTER_X, true);
    } else {
      // Vertical: parents up, children down, prev/next horizontal
      previous.forEach((node) => {
        node.x = CENTER_X - node.depth * sequenceGap;
        node.y = CENTER_Y;
      });
      next.forEach((node) => {
        node.x = CENTER_X + node.depth * sequenceGap;
        node.y = CENTER_Y;
      });
      this.layoutHierarchy(parents, -1, false);
      this.layoutHierarchy(children, 1, false);
      this.layoutSequenceChildren(sequenceChildren, nodes, false);
      this.layoutRow(siblings, CENTER_Y + VERTICAL_GAP, CENTER_X, false);
      this.layoutRow(related, CENTER_Y + VERTICAL_GAP * 2, CENTER_X, false);
    }
  }

  private layoutSequenceChildren(nodes: GraphNode[], allNodes: GraphNode[], horizontal: boolean) {
    const parentsByPath = new Map(allNodes.map((node) => [node.file.path, node]));
    const sourcePaths = new Set(nodes.map((node) => node.sourcePath));

    for (const sourcePath of sourcePaths) {
      const parent = parentsByPath.get(sourcePath);
      if (!parent) continue;
      const children = nodes.filter((node) => node.sourcePath === sourcePath);
      if (horizontal) {
        // Horizontal: sequence children go to the right of their parent
        this.layoutRow(children, parent.y, parent.x + HORIZONTAL_GAP, true);
      } else {
        // Vertical: sequence children go below their parent
        this.layoutRow(children, parent.y + VERTICAL_GAP, parent.x, false);
      }
    }
  }

  private layoutHierarchy(nodes: GraphNode[], direction: -1 | 1, horizontal: boolean) {
    const depths = new Set(nodes.map((node) => node.depth));
    for (const depth of depths) {
      const row = nodes.filter((node) => node.depth === depth);
      if (horizontal) {
        // Horizontal mode: hierarchy goes left/right, spread nodes vertically
        this.layoutRow(row, CENTER_Y, CENTER_X + direction * depth * HORIZONTAL_GAP, true);
      } else {
        // Vertical mode: hierarchy goes up/down, spread nodes horizontally
        this.layoutRow(row, CENTER_Y + direction * depth * VERTICAL_GAP, CENTER_X, false);
      }
    }
  }

  private layoutRow(nodes: GraphNode[], y: number, centerX: number, horizontal: boolean) {
    if (nodes.length === 0) return;

    let sorted: GraphNode[];
    if (this.settings.graphNodeSortOrder === 'importance') {
      // Sort by descendant count (nodes with more descendants toward center)
      const descendantCounts = new Map<string, number>();
      for (const node of nodes) {
        descendantCounts.set(node.file.path, this.countDescendants(node.file));
      }
      sorted = [...nodes].sort((a, b) => {
        const countDiff = (descendantCounts.get(b.file.path) ?? 0) - (descendantCounts.get(a.file.path) ?? 0);
        // Break ties alphabetically
        return countDiff !== 0 ? countDiff : a.file.basename.localeCompare(b.file.basename);
      });
    } else {
      // Sort alphabetically for readability when many nodes
      sorted = [...nodes].sort((a, b) => a.file.basename.localeCompare(b.file.basename));
    }

    // Use viewport-relative spacing: aim for 25% of stage width per node (generous)
    const stageWidth = this.stageEl ? this.stageEl.getBoundingClientRect().width : 1400;
    const idealGap = stageWidth * 0.25;

    // Get actual node max-width from CSS for minimum safe gap
    const computedStyle = this.stageEl ? getComputedStyle(this.stageEl) : getComputedStyle(document.documentElement);
    const nodeMaxWidth = parseInt(computedStyle.getPropertyValue('--node-max-width') || '260', 10);
    const minGap = nodeMaxWidth * 1.15; // 15% padding

    // Use ideal gap but never go below minimum safe gap
    const gap = Math.max(minGap, idealGap);

    if (horizontal) {
      // Horizontal orientation: stack vertically (vary Y)
      sorted.forEach((node, index) => {
        node.x = centerX;
        node.y = y + (index - (sorted.length - 1) / 2) * VERTICAL_GAP;
      });
    } else {
      // Vertical orientation: stack horizontally (vary X)
      sorted.forEach((node, index) => {
        node.x = centerX + (index - (sorted.length - 1) / 2) * gap;
        node.y = y;
      });
    }
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
      const classes = [`bread-trail-graph-node`, `bread-trail-graph-node-${node.relation}`];
      // Mark root node (the one we're exploring from) distinctly
      if (node.file.path === this.rootFile.path) {
        classes.push('bread-trail-graph-node-root');
      }
      const nodeEl = stageEl.createEl('button', {
        cls: classes.join(' '),
      });
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;
      const label = this.getLabel(node.file);
      nodeEl.setAttribute('aria-label', `${this.capitalize(node.relation)}: ${label}`);
      setIcon(nodeEl.createSpan('bread-trail-graph-node-icon'), this.getIcon(node.relation));
      nodeEl.createSpan({ text: label, cls: 'bread-trail-graph-node-label' });

      // Show sequence position for prev/next/current nodes
      if ((node.relation === 'previous' || node.relation === 'next' || node.relation === 'current') && node.sequencePosition && node.sequenceLength) {
        const posEl = nodeEl.createSpan({
          text: `${node.sequencePosition}/${node.sequenceLength}`,
          cls: 'bread-trail-graph-node-depth bread-trail-graph-node-sequence-number'
        });
      } else if (node.depth > 1) {
        // Show depth for hierarchical nodes
        nodeEl.createSpan({ text: String(node.depth), cls: 'bread-trail-graph-node-depth' });
      }
      nodeEl.addEventListener('click', () => {
        if (this.settings.graphSingleClickOpens) {
          // Single click opens immediately
          this.confirmed = true;
          this.close();
          void this.app.workspace.getLeaf('tab').openFile(node.file);
        } else if (this.selectedPath === node.file.path) {
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

  private renderEdgeFilter() {
    if (this.allEdgeTypes.size === 0) return;

    const filterContainer = this.contentEl.createDiv('bread-trail-edge-filter');
    filterContainer.createEl('span', { text: 'Edge types:', cls: 'bread-trail-edge-filter-label' });

    const checkboxContainer = filterContainer.createDiv('bread-trail-edge-filter-checkboxes');

    // Sort edge types alphabetically
    const sortedTypes = Array.from(this.allEdgeTypes).sort();

    for (const edgeType of sortedTypes) {
      const label = checkboxContainer.createEl('label', { cls: 'bread-trail-edge-filter-item' });

      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.visibleEdgeTypes.has(edgeType);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.visibleEdgeTypes.add(edgeType);
        } else {
          this.visibleEdgeTypes.delete(edgeType);
        }
        this.applyEdgeTypeFilter();
      });

      label.createSpan({ text: edgeType, cls: 'bread-trail-edge-filter-text' });
    }

    // "All" / "None" buttons
    const buttonsDiv = filterContainer.createDiv('bread-trail-edge-filter-buttons');

    const allBtn = buttonsDiv.createEl('button', { text: 'All', cls: 'bread-trail-edge-filter-btn' });
    allBtn.addEventListener('click', () => {
      this.visibleEdgeTypes = new Set(this.allEdgeTypes);
      checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        (cb as HTMLInputElement).checked = true;
      });
      this.applyEdgeTypeFilter();
    });

    const noneBtn = buttonsDiv.createEl('button', { text: 'None', cls: 'bread-trail-edge-filter-btn' });
    noneBtn.addEventListener('click', () => {
      this.visibleEdgeTypes.clear();
      checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        (cb as HTMLInputElement).checked = false;
      });
      this.applyEdgeTypeFilter();
    });
  }

  private applyEdgeTypeFilter() {
    // Hide nodes whose edge type is not visible
    for (const [path, el] of this.nodeElements) {
      const node = this.nodes.find((n) => n.file.path === path);
      if (!node || node.relation === 'current') continue;

      if (this.visibleEdgeTypes.has(node.edgeType) || !node.edgeType) {
        el.removeClass('bread-trail-graph-node-hidden-edge');
      } else {
        el.addClass('bread-trail-graph-node-hidden-edge');
      }
    }

    // Re-render edges to hide those from filtered nodes
    this.updateEdgesForSelection();
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
    this.scope.register(['Shift'], 'Enter', () => this.toggleOrientation());
    this.scope.register([], 'Home', () => this.recenter());
    this.scope.register([], 'Escape', () => {
      if (this.filterText) {
        this.clearFilter();
        return false;
      }
      return true; // Let escape close modal if no filter active
    });

    // Type to filter
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.addToFilter(e.key);
        e.preventDefault();
      } else if (e.key === 'Backspace' && this.filterText) {
        this.removeFromFilter();
        e.preventDefault();
      }
    });
  }

  private recenter(): false {
    if (this.centerTimeout) clearTimeout(this.centerTimeout);
    this.centerSelectedNode();
    return false;
  }

  private toggleOrientation(): false {
    this.horizontalOrientation = !this.horizontalOrientation;
    this.render();
    requestAnimationFrame(() => { this.centerSelectedNode(); });
    return false;
  }

  private moveSelection(direction: 'up' | 'down' | 'left' | 'right'): false {
    const current = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!current) return false;

    const next = this.nodes
      .filter((node) => node.file.path !== current.file.path && this.isInDirection(current, node, direction))
      .map((node) => ({ node, score: this.getDirectionalDistance(current, node, direction) }))
      .sort((left, right) => left.score - right.score)[0]?.node;
    if (next) {
      // Cancel debounce and immediately center when using arrow keys
      if (this.centerTimeout) clearTimeout(this.centerTimeout);
      this.selectNode(next.file.path, true);
      this.centerSelectedNode();
    }
    return false;
  }

  private selectNode(path: string, skipCenter = false) {
    this.nodeElements.get(this.selectedPath)?.removeClass('is-selected');
    this.selectedPath = path;
    this.nodeElements.get(path)?.addClass('is-selected');
    this.updateEdgesForSelection();
    this.updateNodeFading();
    if (!skipCenter) {
      this.centerSelectedNodeDebounced();
    }
  }

  private updateNodeFading() {
    // Get connected node paths
    const selectedNode = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!selectedNode) return;

    const connected = new Set<string>([this.selectedPath]);
    for (const node of this.nodes) {
      // Only consider nodes whose edge type is visible
      if (node.edgeType && !this.visibleEdgeTypes.has(node.edgeType)) continue;

      if (node.sourcePath === this.selectedPath || selectedNode.sourcePath === node.file.path) {
        connected.add(node.file.path);
      }
    }

    // Fade non-connected nodes
    for (const [path, el] of this.nodeElements) {
      if (connected.has(path)) {
        el.removeClass('bread-trail-graph-node-faded');
      } else {
        el.addClass('bread-trail-graph-node-faded');
      }
    }
  }

  private updateEdgesForSelection() {
    if (!this.edgeLayerEl) return;

    // Clear existing edges
    this.edgeLayerEl.empty();

    const nodesByPath = new Map(this.nodes.map((node) => [node.file.path, node]));
    const selectedNode = nodesByPath.get(this.selectedPath);
    if (!selectedNode) return;

    // Only render edges connected to the selected node
    for (const node of this.nodes) {
      if (node.file.path === this.selectedPath) continue;

      // Skip if this node's edge type is filtered out
      if (node.edgeType && !this.visibleEdgeTypes.has(node.edgeType)) continue;

      // Check if this node is connected to the selected node
      // Node is connected if:
      // 1. Its edge comes FROM the selected node (node.sourcePath === this.selectedPath)
      // 2. Its edge goes TO the selected node (selected node's sourcePath === node.file.path)
      const isOutgoing = node.sourcePath === this.selectedPath;
      const isIncoming = selectedNode.sourcePath === node.file.path;

      if (isOutgoing || isIncoming) {
        const source = nodesByPath.get(node.sourcePath);
        const target = node;
        if (!source) continue;

        const line = this.edgeLayerEl.createSvg('line');
        line.setAttribute('x1', String(source.x));
        line.setAttribute('y1', String(source.y));
        line.setAttribute('x2', String(target.x));
        line.setAttribute('y2', String(target.y));
        line.addClass(`bread-trail-graph-edge-${node.relation}`);
      }
    }
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

  private centerSelectedNodeDebounced() {
    // Debounce centering by 500ms to avoid jarring animation when clicking rapidly
    if (this.centerTimeout) clearTimeout(this.centerTimeout);
    this.centerTimeout = setTimeout(() => {
      this.centerSelectedNode();
    }, 500);
  }

  private centerSelectedNode() {
    const selected = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!selected || !this.stageEl) return;

    const stageRect = this.stageEl.getBoundingClientRect();
    const centerX = stageRect.width / 2;
    const centerY = stageRect.height / 2;

    const viewport = this.stageEl.querySelector('.bread-trail-graph-viewport') as HTMLElement;
    if (viewport) {
      this.panOffset = { x: centerX - selected.x, y: centerY - selected.y };
      viewport.style.transform = `translate(${this.panOffset.x}px, ${this.panOffset.y}px)`;
    }
  }

  private registerMouseHandlers(stageEl: HTMLElement, viewport: HTMLElement) {
    stageEl.addEventListener('mousedown', (e) => {
      if (e.target !== stageEl && e.target !== viewport && !(e.target as HTMLElement).closest('.bread-trail-graph-edges')) {
        return; // Don't pan if clicking on a node
      }
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.panOffset.x, y: e.clientY - this.panOffset.y };
      stageEl.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panOffset = {
        x: e.clientX - this.dragStart.x,
        y: e.clientY - this.dragStart.y,
      };
      viewport.style.transform = `translate(${this.panOffset.x}px, ${this.panOffset.y}px)`;
    });

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        if (this.stageEl) this.stageEl.style.cursor = '';
      }
    });

    // Scroll wheel zoom
    stageEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const delta = -e.deltaY / 1000;
      this.zoomLevel = Math.max(0.5, Math.min(2, this.zoomLevel + delta));

      viewport.style.transformOrigin = '0 0';
      viewport.style.transform = `translate(${this.panOffset.x}px, ${this.panOffset.y}px) scale(${this.zoomLevel})`;
    });
  }

  private addToFilter(char: string) {
    this.filterText += char.toLowerCase();
    this.applyFilter();
  }

  private removeFromFilter() {
    this.filterText = this.filterText.slice(0, -1);
    this.applyFilter();
  }

  private clearFilter() {
    this.filterText = '';
    this.applyFilter();
  }

  private applyFilter() {
    if (this.filterTimeout) clearTimeout(this.filterTimeout);

    // Show filter text
    let filterEl = this.contentEl.querySelector('.bread-trail-filter-indicator') as HTMLElement;
    if (!filterEl) {
      filterEl = this.contentEl.createDiv('bread-trail-filter-indicator');
    }

    if (this.filterText) {
      filterEl.setText(`Filter: ${this.filterText}`);
      filterEl.style.display = 'block';
    } else {
      filterEl.style.display = 'none';
    }

    // Highlight matching nodes
    for (const [path, el] of this.nodeElements) {
      const node = this.nodes.find((n) => n.file.path === path);
      if (!node) continue;

      const label = this.getLabel(node.file).toLowerCase();
      if (!this.filterText || label.includes(this.filterText)) {
        el.removeClass('bread-trail-graph-node-filtered');
      } else {
        el.addClass('bread-trail-graph-node-filtered');
      }
    }

    // Clear filter after 3 seconds of no typing
    this.filterTimeout = setTimeout(() => {
      this.clearFilter();
    }, 3000);
  }

  private countDescendants(file: TFile): number {
    const visited = new Set<string>();
    const queue = [file.path];
    let count = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const outgoing = this.bc.graph.get_outgoing_edges(current).to_array();
      for (const edge of outgoing) {
        const targetPath = edge.target_path?.(this.bc.graph) ?? edge.target;
        if (targetPath && !visited.has(targetPath)) {
          queue.push(targetPath);
          count++;
        }
      }
    }

    return count;
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
