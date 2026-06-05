import { App, Component, MarkdownRenderer, Modal, TFile, setIcon } from 'obsidian';
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
  pathName?: string;
}

type Relation = 'current' | 'parent' | 'child' | 'previous' | 'next' | 'sibling' | 'sequence-child' | 'related';
type Direction = 'incoming' | 'outgoing';

const CENTER_X = 700;
const CENTER_Y = 390;
const HORIZONTAL_GAP = 190;
const VERTICAL_GAP = 120;
const TRACK_HEIGHT = 90;

const PATH_COLORS = [
  'var(--color-blue)',
  'var(--color-green)',
  'var(--color-orange)',
  'var(--color-red)',
  'var(--color-purple)',
  'var(--color-yellow)',
  'var(--color-cyan)',
  'var(--color-pink)',
];

export class GraphSwitcher extends Modal {
  private nodes: GraphNode[] = [];
  private nodeElements = new Map<string, HTMLElement>();
  private selectedPath: string;
  private stageEl?: HTMLElement;
  private edgeLayerEl?: SVGSVGElement;
  private graphPanelEl?: HTMLElement;
  private previewEl?: HTMLElement;
  private previewComponent = new Component();
  private confirmed = false;
  private initialFile: TFile;
  private lastEnterPress = 0;
  private renderTimeout?: number;
  private horizontalOrientation = false;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private panOffset = { x: 0, y: 0 };
  private centerTimeout?: number;
  private zoomLevel = 1;
  private filterText = '';
  private filterTimeout?: number;
  private visibleEdgeTypes = new Set<string>();
  private allEdgeTypes = new Set<string>();
  private activePathFilter: string | null = null;
  private allPaths = new Set<string>();
  private pathColorMap = new Map<string, string>();

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

    if (this.settings.graphShowPreview) {
      this.contentEl.addClass('has-preview');
      this.graphPanelEl = this.contentEl.createDiv('bread-trail-graph-panel');
      this.previewEl = this.contentEl.createDiv('bread-trail-graph-preview-pane');
    } else {
      this.graphPanelEl = this.contentEl.createDiv('bread-trail-graph-panel');
    }

    this.render();

    // Center on the current node after DOM renders and layout completes
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.centerSelectedNode();
      });
    });
  }

  onClose() {
    this.previewComponent.unload();
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
    const panel = this.graphPanelEl!;

    if (!this.stageEl) {
      const stageEl = panel.createDiv('bread-trail-graph-stage');
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

    this.renderNodes(viewport);

    // Update or create path selector
    this.renderPathSelector();

    if (!panel.querySelector('.bread-trail-graph-legend')) {
      this.renderLegend();
    }

    if (!panel.querySelector('.bread-trail-edge-filter')) {
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

    this.addSequenceWithPaths(nodes, seen, 'previous', this.settings.previousDepth);
    this.addSequenceWithPaths(nodes, seen, 'next', this.settings.nextDepth);
    this.addHierarchy(nodes, seen, 'parent', this.settings.parentDepth);
    this.addHierarchy(nodes, seen, 'child', this.settings.childDepth);
    this.addSecondaryNodes(nodes, seen);
    this.addSequenceChildren(nodes, seen);

    this.assignSequencePositions(nodes);
    this.collectEdgeTypes(nodes);
    this.layoutNodes(nodes);
    this.resolveOverlaps(nodes);
    return nodes;
  }

  /** Post-layout collision resolution: iteratively push overlapping nodes apart.
   *  Sequence nodes (previous/next) are constrained to horizontal pushes only
   *  so they stay on their Y track. The current (root) node is pinned. */
  private resolveOverlaps(nodes: GraphNode[]) {
    const MIN_SEP_X = 200;
    const MIN_SEP_Y = 60;

    const isSeq = (n: GraphNode) => n.relation === 'previous' || n.relation === 'next';
    const isPinned = (n: GraphNode) => n.relation === 'current';

    for (let pass = 0; pass < 25; pass++) {
      let moved = false;

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;

          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);

          if (dx >= MIN_SEP_X || dy >= MIN_SEP_Y) continue;

          moved = true;
          const overlapX = MIN_SEP_X - dx + 1;
          const overlapY = MIN_SEP_Y - dy + 1;
          // Sequence nodes must stay on their Y track → always push horizontally
          const pushHoriz = isSeq(a) || isSeq(b) || overlapX <= overlapY;

          if (pushHoriz) {
            const halfPush = overlapX / 2;
            const dirAB = a.x <= b.x ? 1 : -1;
            if (isPinned(a)) { b.x += dirAB * overlapX; }
            else if (isPinned(b)) { a.x -= dirAB * overlapX; }
            else { a.x -= dirAB * halfPush; b.x += dirAB * halfPush; }
          } else {
            const halfPush = overlapY / 2;
            const dirAB = a.y <= b.y ? 1 : -1;
            if (isPinned(a)) { b.y += dirAB * overlapY; }
            else if (isPinned(b)) { a.y -= dirAB * overlapY; }
            else { a.y -= dirAB * halfPush; b.y += dirAB * halfPush; }
          }
        }
      }
      if (!moved) break;
    }
  }

  private collectEdgeTypes(nodes: GraphNode[]) {
    this.allEdgeTypes.clear();
    this.allPaths.clear();

    for (const node of nodes) {
      if (node.edgeType) this.allEdgeTypes.add(node.edgeType);
      if (node.pathName) this.allPaths.add(node.pathName);
    }

    // Initialize visible types to all types if not set
    if (this.visibleEdgeTypes.size === 0) {
      this.visibleEdgeTypes = new Set(this.allEdgeTypes);
    }

    // Build path color map
    this.pathColorMap.clear();
    const sortedPaths = Array.from(this.allPaths).sort();
    sortedPaths.forEach((name, i) => {
      const saved = this.settings.pathColors[name];
      this.pathColorMap.set(name, saved ?? PATH_COLORS[i % PATH_COLORS.length] ?? 'var(--color-blue)');
    });
  }

  private assignSequencePositions(nodes: GraphNode[]) {
    const current = nodes.find((node) => node.relation === 'current');

    // Group by path name (undefined = unnamed/default track)
    const pathNames = new Set<string | undefined>();
    for (const node of nodes) {
      if (node.relation === 'previous' || node.relation === 'next') {
        pathNames.add(node.pathName);
      }
    }

    for (const pathName of pathNames) {
      const previous = nodes.filter((n) => n.relation === 'previous' && n.pathName === pathName);
      const next = nodes.filter((n) => n.relation === 'next' && n.pathName === pathName);
      const totalLength = previous.length + 1 + next.length;
      const currentPosition = previous.length + 1;

      // Only show sequence position on current node when there's a single unnamed track
      if (current && pathNames.size === 1 && pathName === undefined) {
        current.sequencePosition = currentPosition;
        current.sequenceLength = totalLength;
      }

      previous.forEach((node) => {
        node.sequencePosition = currentPosition - node.depth;
        node.sequenceLength = totalLength;
      });
      next.forEach((node) => {
        node.sequencePosition = currentPosition + node.depth;
        node.sequenceLength = totalLength;
      });
    }
  }

  /** Look up the sub-path name (the part after the dot) for an edge from sourceFile to targetFile.
   *  e.g. `next.path-1: [[Target]]` → returns `"path-1"` when frontmatterKey is `"next"`.
   *  Returns `undefined` if the edge uses a plain key (no sub-path) or is not found. */
  private getPathNameForEdge(sourceFile: TFile, targetFile: TFile, frontmatterKey: string): string | undefined {
    const cache = this.app.metadataCache.getFileCache(sourceFile);
    if (!cache?.frontmatterLinks) return undefined;
    for (const link of cache.frontmatterLinks) {
      const parts = link.key.split('.');
      if (parts.length < 2 || parts[0] !== frontmatterKey) continue;
      const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, sourceFile.path);
      if (resolved?.path === targetFile.path) return parts.slice(1).join('.');
    }
    return undefined;
  }

  private addSequenceWithPaths(
    nodes: GraphNode[], seen: Set<string>,
    relation: 'previous' | 'next', maxDepth: number,
  ) {
    const immediateNeighbors = this.getNeighbors(this.rootFile)
      .filter((n) => n.relation === relation && !seen.has(n.file.path));

    for (const neighbor of immediateNeighbors) {
      // Determine path name for this starting edge
      let pathName: string | undefined;
      if (relation === 'next') {
        // rootFile has `next[.path-X]: [[neighbor]]`
        pathName = this.getPathNameForEdge(this.rootFile, neighbor.file, 'next');
      } else {
        // neighbor has `next[.path-X]: [[rootFile]]`
        pathName = this.getPathNameForEdge(neighbor.file, this.rootFile, 'next')
          ?? this.getPathNameForEdge(this.rootFile, neighbor.file, 'prev');
      }

      let prevFile = this.rootFile;
      let cur = neighbor;

      for (let depth = 1; depth <= maxDepth; depth++) {
        if (seen.has(cur.file.path)) break;
        nodes.push({ ...cur, depth, sourcePath: prevFile.path, pathName, x: 0, y: 0 });
        seen.add(cur.file.path);

        // Find the next node in this same path chain
        const chainNeighbors = this.getNeighbors(cur.file)
          .filter((n) => n.relation === relation && !seen.has(n.file.path));

        const nextInChain = chainNeighbors.find((n) => {
          let p: string | undefined;
          if (relation === 'next') {
            p = this.getPathNameForEdge(cur.file, n.file, 'next');
          } else {
            p = this.getPathNameForEdge(n.file, cur.file, 'next')
              ?? this.getPathNameForEdge(cur.file, n.file, 'prev');
          }
          return p === pathName;
        });

        if (!nextInChain) break;
        prevFile = cur.file;
        cur = nextInChain;
      }
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

  /** Compute per-path track Y positions, centering all tracks around CENTER_Y. */
  private computeTrackLayout(pathNames: Array<string | undefined>): {
    trackYMap: Map<string | undefined, number>;
    topTrackY: number;
    bottomTrackY: number;
  } {
    const trackYMap = new Map<string | undefined, number>();
    if (pathNames.length === 0) {
      return { trackYMap, topTrackY: CENTER_Y, bottomTrackY: CENTER_Y };
    }
    pathNames.forEach((name, i) => {
      trackYMap.set(name, CENTER_Y + (i - (pathNames.length - 1) / 2) * TRACK_HEIGHT);
    });
    const topTrackY = trackYMap.get(pathNames[0]) ?? CENTER_Y;
    const bottomTrackY = trackYMap.get(pathNames[pathNames.length - 1]) ?? CENTER_Y;
    return { trackYMap, topTrackY, bottomTrackY };
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
      const maxParentDepth = parents.length > 0 ? Math.max(...parents.map((n) => n.depth)) : 0;
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
      const siblingsRowOffsetH = (maxParentDepth + 1) * VERTICAL_GAP;
      this.layoutRow(siblings, CENTER_Y + siblingsRowOffsetH, CENTER_X, true);
      this.layoutRow(related, CENTER_Y + siblingsRowOffsetH + VERTICAL_GAP, CENTER_X, true);
    } else {
      // Vertical: parents up, children down, prev/next horizontal

      // Collect all path names for sequence nodes (undefined = no sub-path)
      const pathSet = new Set<string | undefined>();
      for (const n of [...previous, ...next]) pathSet.add(n.pathName);
      const allPathNames = Array.from(pathSet).sort((a, b) => {
        if (a === undefined && b === undefined) return 0;
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        return a.localeCompare(b);
      });

      const { trackYMap, topTrackY, bottomTrackY } = this.computeTrackLayout(allPathNames);

      // Layout sequence nodes on their tracks
      previous.forEach((node) => {
        node.x = CENTER_X - node.depth * sequenceGap;
        node.y = trackYMap.get(node.pathName) ?? CENTER_Y;
      });
      next.forEach((node) => {
        node.x = CENTER_X + node.depth * sequenceGap;
        node.y = trackYMap.get(node.pathName) ?? CENTER_Y;
      });

      // Layout hierarchy starting just outside the sequence track bounds
      const parentBaseY = topTrackY - VERTICAL_GAP;
      const childBaseY = bottomTrackY + VERTICAL_GAP;
      this.layoutHierarchy(parents, -1, false, parentBaseY);
      this.layoutHierarchy(children, 1, false, childBaseY);
      this.layoutSequenceChildren(sequenceChildren, nodes, false);

      const maxChildDepth = children.length > 0 ? Math.max(...children.map((n) => n.depth)) : 0;
      const siblingsY = childBaseY + maxChildDepth * VERTICAL_GAP;
      this.layoutRow(siblings, siblingsY, CENTER_X, false);
      this.layoutRow(related, siblingsY + VERTICAL_GAP, CENTER_X, false);
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
        this.layoutRow(children, parent.y, parent.x + HORIZONTAL_GAP, true);
      } else {
        this.layoutRow(children, parent.y + VERTICAL_GAP, parent.x, false);
      }
    }
  }

  private layoutHierarchy(nodes: GraphNode[], direction: -1 | 1, horizontal: boolean, vertBaseY = CENTER_Y) {
    const depths = new Set(nodes.map((node) => node.depth));
    for (const depth of depths) {
      const row = nodes.filter((node) => node.depth === depth);
      if (horizontal) {
        this.layoutRow(row, CENTER_Y, CENTER_X + direction * depth * HORIZONTAL_GAP, true);
      } else {
        // depth 1 → vertBaseY, depth 2 → vertBaseY ± VERTICAL_GAP, etc.
        const y = direction === -1
          ? vertBaseY - (depth - 1) * VERTICAL_GAP
          : vertBaseY + (depth - 1) * VERTICAL_GAP;
        this.layoutRow(row, y, CENTER_X, false);
      }
    }
  }

  private layoutRow(nodes: GraphNode[], y: number, centerX: number, horizontal: boolean) {
    if (nodes.length === 0) return;

    let sorted: GraphNode[];
    if (this.settings.graphNodeSortOrder === 'importance') {
      const descendantCounts = new Map<string, number>();
      for (const node of nodes) {
        descendantCounts.set(node.file.path, this.countDescendants(node.file));
      }
      sorted = [...nodes].sort((a, b) => {
        const countDiff = (descendantCounts.get(b.file.path) ?? 0) - (descendantCounts.get(a.file.path) ?? 0);
        return countDiff !== 0 ? countDiff : a.file.basename.localeCompare(b.file.basename);
      });
    } else {
      sorted = [...nodes].sort((a, b) => a.file.basename.localeCompare(b.file.basename));
    }

    const stageWidth = this.stageEl ? this.stageEl.getBoundingClientRect().width : 1400;
    const idealGap = stageWidth * 0.25;
    const computedStyle = this.stageEl ? getComputedStyle(this.stageEl) : getComputedStyle(activeDocument.documentElement);
    const nodeMaxWidth = parseInt(computedStyle.getPropertyValue('--node-max-width') || '260', 10);
    const minGap = nodeMaxWidth * 1.15;
    const gap = Math.max(minGap, idealGap);

    if (horizontal) {
      sorted.forEach((node, index) => {
        node.x = centerX;
        node.y = y + (index - (sorted.length - 1) / 2) * VERTICAL_GAP;
      });
    } else {
      sorted.forEach((node, index) => {
        node.x = centerX + (index - (sorted.length - 1) / 2) * gap;
        node.y = y;
      });
    }
  }

  private renderNodes(stageEl: HTMLElement) {
    for (const node of this.nodes) {
      const classes = [`bread-trail-graph-node`, `bread-trail-graph-node-${node.relation}`];
      if (node.file.path === this.rootFile.path) {
        classes.push('bread-trail-graph-node-root');
      }
      const nodeEl = stageEl.createEl('button', {
        cls: classes.join(' '),
      });
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;

      // Apply path color
      if (node.pathName) {
        const color = this.pathColorMap.get(node.pathName);
        if (color) nodeEl.style.setProperty('--path-color', color);
        nodeEl.dataset.pathName = node.pathName;
      }

      const label = this.getLabel(node.file);
      nodeEl.setAttribute('aria-label', `${this.capitalize(node.relation)}: ${label}`);
      setIcon(nodeEl.createSpan('bread-trail-graph-node-icon'), this.getIcon(node.relation));
      const labelWrap = nodeEl.createSpan('bread-trail-graph-node-label-wrap');
      labelWrap.createSpan({ text: label, cls: 'bread-trail-graph-node-label' });

      // Show user-specified metadata property below label
      if (this.settings.graphNodeMetaProperty) {
        const fm = this.app.metadataCache.getFileCache(node.file)?.frontmatter;
        const metaVal: unknown = fm?.[this.settings.graphNodeMetaProperty];
        if (metaVal !== undefined && metaVal !== null && metaVal !== '') {
          const display = Array.isArray(metaVal)
            ? (metaVal as unknown[]).map((v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')).filter(Boolean).join(', ')
            : (typeof metaVal === 'string' || typeof metaVal === 'number' || typeof metaVal === 'boolean' ? String(metaVal) : '');
          labelWrap.createSpan({ text: display, cls: 'bread-trail-graph-node-meta' });
        }
      }

      // Show path name chip on sequence nodes
      if (node.pathName && (node.relation === 'previous' || node.relation === 'next')) {
        const chipEl = nodeEl.createSpan({ text: node.pathName, cls: 'bread-trail-path-chip-inline' });
        const color = this.pathColorMap.get(node.pathName);
        if (color) chipEl.style.setProperty('--path-color', color);
      }

      // Show sequence position for prev/next/current nodes
      if ((node.relation === 'previous' || node.relation === 'next' || node.relation === 'current') && node.sequencePosition && node.sequenceLength) {
        nodeEl.createSpan({
          text: `${node.sequencePosition}/${node.sequenceLength}`,
          cls: 'bread-trail-graph-node-depth bread-trail-graph-node-sequence-number'
        });
      } else if (node.depth > 1) {
        nodeEl.createSpan({ text: String(node.depth), cls: 'bread-trail-graph-node-depth' });
      }

      nodeEl.addEventListener('click', () => {
        if (this.settings.graphSingleClickOpens) {
          this.confirmed = true;
          this.close();
          void this.app.workspace.getLeaf('tab').openFile(node.file);
        } else if (this.selectedPath === node.file.path) {
          void this.handleEnter();
        } else {
          this.selectNode(node.file.path);
        }
      });
      this.nodeElements.set(node.file.path, nodeEl);
    }
    this.selectNode(this.selectedPath);
  }

  private renderPathSelector() {
    const panel = this.graphPanelEl!;

    // Remove stale selector before re-creating
    panel.querySelector('.bread-trail-path-selector')?.remove();

    if (this.allPaths.size === 0) return;

    const selectorEl = panel.createDiv('bread-trail-path-selector');
    selectorEl.createSpan({ text: 'Paths:', cls: 'bread-trail-path-selector-label' });

    const chipsEl = selectorEl.createDiv('bread-trail-path-chips');

    const allChip = chipsEl.createEl('button', {
      text: 'All',
      cls: 'bread-trail-path-chip bread-trail-path-chip-all',
    });
    if (!this.activePathFilter) allChip.addClass('is-active');
    allChip.addEventListener('click', () => this.setPathFilter(null));

    for (const pathName of Array.from(this.allPaths).sort()) {
      const color = this.pathColorMap.get(pathName) ?? 'var(--color-blue)';
      const chip = chipsEl.createEl('button', {
        text: pathName,
        cls: 'bread-trail-path-chip',
      });
      chip.style.setProperty('--path-color', color);
      if (this.activePathFilter === pathName) chip.addClass('is-active');
      chip.addEventListener('click', () => {
        this.setPathFilter(this.activePathFilter === pathName ? null : pathName);
      });
    }

    // Insert before the legend (at the top of footer area)
    const legend = panel.querySelector('.bread-trail-graph-legend');
    if (legend) {
      panel.insertBefore(selectorEl, legend);
    }
  }

  private setPathFilter(pathName: string | null) {
    this.activePathFilter = pathName;
    this.renderPathSelector();
    this.applyPathFilter();
    this.updateEdgesForSelection();
    this.updateNodeFading();
  }

  private applyPathFilter() {
    for (const [path, el] of this.nodeElements) {
      const node = this.nodes.find((n) => n.file.path === path);
      if (!node || node.relation === 'current') continue;

      const isSequenceNode = node.relation === 'previous' || node.relation === 'next';
      const passesFilter = !this.activePathFilter
        || !isSequenceNode
        || node.pathName === this.activePathFilter;

      if (passesFilter) {
        el.removeClass('bread-trail-graph-node-path-filtered');
      } else {
        el.addClass('bread-trail-graph-node-path-filtered');
      }
    }
  }

  private renderLegend() {
    const panel = this.graphPanelEl!;
    const legendEl = panel.createDiv('bread-trail-graph-legend');
    legendEl.createSpan({ text: '↑ parent' });
    legendEl.createSpan({ text: '↓ child' });
    legendEl.createSpan({ text: '← previous' });
    legendEl.createSpan({ text: '→ next' });
    legendEl.createSpan({ text: '− sibling' });
    legendEl.createSpan({ text: '↓ sequence child' });
    legendEl.createSpan({ text: '↗ related' });

    panel.createDiv({
      text: 'Arrows/WASD: navigate • Enter: explore • 2×Enter: open • Shift+Enter: flip • Home: recenter • =/−: zoom • Type to filter',
      cls: 'bread-trail-graph-controls-footer'
    });
  }

  private renderEdgeFilter() {
    if (this.allEdgeTypes.size === 0) return;

    const filterContainer = this.graphPanelEl!.createDiv('bread-trail-edge-filter');
    filterContainer.createEl('span', { text: 'Edge types:', cls: 'bread-trail-edge-filter-label' });

    const checkboxContainer = filterContainer.createDiv('bread-trail-edge-filter-checkboxes');
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
    for (const [path, el] of this.nodeElements) {
      const node = this.nodes.find((n) => n.file.path === path);
      if (!node || node.relation === 'current') continue;

      if (this.visibleEdgeTypes.has(node.edgeType) || !node.edgeType) {
        el.removeClass('bread-trail-graph-node-hidden-edge');
      } else {
        el.addClass('bread-trail-graph-node-hidden-edge');
      }
    }

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
    this.scope.register([], '=', () => this.zoomIn());
    this.scope.register([], '-', () => this.zoomOut());
    this.scope.register([], 'Escape', () => {
      if (this.filterText) {
        this.clearFilter();
        return false;
      }
      return true;
    });

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
    if (this.centerTimeout) window.clearTimeout(this.centerTimeout);
    this.centerSelectedNode();
    return false;
  }

  private zoomIn(): false {
    this.zoomLevel = Math.min(2, this.zoomLevel + 0.1);
    this.centerSelectedNode();
    return false;
  }

  private zoomOut(): false {
    this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.1);
    this.centerSelectedNode();
    return false;
  }

  private toggleOrientation(): false {
    this.horizontalOrientation = !this.horizontalOrientation;
    this.render();
    window.requestAnimationFrame(() => { this.centerSelectedNode(); });
    return false;
  }

  private moveSelection(direction: 'up' | 'down' | 'left' | 'right'): false {
    const current = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!current) return false;

    const candidates = this.nodes.filter((node) => {
      if (node.file.path === current.file.path) return false;
      if (!this.isInDirection(current, node, direction)) return false;
      // When path filter is active, only allow navigating within that path for sequence nodes
      if (this.activePathFilter) {
        const isSeq = node.relation === 'previous' || node.relation === 'next';
        if (isSeq && node.pathName !== this.activePathFilter) return false;
      }
      return true;
    });

    const next = candidates
      .map((node) => ({ node, score: this.getDirectionalDistance(current, node, direction) }))
      .sort((left, right) => left.score - right.score)[0]?.node;

    if (next) {
      if (this.centerTimeout) window.clearTimeout(this.centerTimeout);
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
    void this.updatePreview();
  }

  private async updatePreview() {
    if (!this.previewEl) return;
    const node = this.nodes.find((n) => n.file.path === this.selectedPath);
    if (!node) return;

    this.previewEl.empty();

    const titleEl = this.previewEl.createDiv('bread-trail-preview-title');
    setIcon(titleEl.createSpan('bread-trail-preview-title-icon'), this.getIcon(node.relation));
    titleEl.createSpan({ text: node.file.basename });

    const contentEl = this.previewEl.createDiv('bread-trail-preview-content');
    try {
      const source = await this.app.vault.read(node.file);
      this.previewComponent.unload();
      this.previewComponent = new Component();
      this.previewComponent.load();
      await MarkdownRenderer.render(this.app, source, contentEl, node.file.path, this.previewComponent);
    } catch {
      contentEl.createEl('p', { text: 'Could not read file.', cls: 'mod-muted' });
    }
  }

  /** Query the BC graph directly for all nodes visible in the graph that are
   *  actually connected to `file` via a BC edge (either direction). */
  private getActuallyConnectedPaths(file: TFile): Set<string> {
    const nodePaths = new Set(this.nodes.map((n) => n.file.path));
    const connected = new Set<string>();

    const incoming = this.bc.graph.get_incoming_edges(file.path).to_array();
    const outgoing = this.bc.graph.get_outgoing_edges(file.path).to_array();

    for (const edge of incoming) {
      const path = edge.source_path?.(this.bc.graph) ?? edge.source;
      if (path && nodePaths.has(path)) connected.add(path);
    }
    for (const edge of outgoing) {
      const path = edge.target_path?.(this.bc.graph) ?? edge.target;
      if (path && nodePaths.has(path)) connected.add(path);
    }

    return connected;
  }

  private updateNodeFading() {
    // Fade only sequence nodes that don't belong to the active path filter.
    // Nodes that aren't directly connected to the selected node are NOT faded —
    // every node in the graph is shown at full opacity unless a path filter is active.
    for (const [path, el] of this.nodeElements) {
      let faded = false;

      if (this.activePathFilter) {
        const node = this.nodes.find((n) => n.file.path === path);
        if (node) {
          const isSeq = node.relation === 'previous' || node.relation === 'next';
          if (isSeq && node.pathName !== this.activePathFilter) faded = true;
        }
      }

      if (faded) {
        el.addClass('bread-trail-graph-node-faded');
      } else {
        el.removeClass('bread-trail-graph-node-faded');
      }
    }
  }

  private updateEdgesForSelection() {
    if (!this.edgeLayerEl) return;
    this.edgeLayerEl.empty();

    const nodesByPath = new Map(this.nodes.map((node) => [node.file.path, node]));

    // Draw a structural edge for every non-root node, from its sourcePath to itself.
    // This ensures all links are always visible, not just those touching the selected node.
    for (const node of this.nodes) {
      if (node.relation === 'current') continue;
      if (node.edgeType && !this.visibleEdgeTypes.has(node.edgeType)) continue;

      // Skip path-filtered sequence nodes
      if (this.activePathFilter) {
        const isSeq = node.relation === 'previous' || node.relation === 'next';
        if (isSeq && node.pathName !== this.activePathFilter) continue;
      }

      const source = nodesByPath.get(node.sourcePath) ?? nodesByPath.get(this.rootFile.path);
      if (!source) continue;

      const line = this.edgeLayerEl.createSvg('line');
      line.setAttribute('x1', String(source.x));
      line.setAttribute('y1', String(source.y));
      line.setAttribute('x2', String(node.x));
      line.setAttribute('y2', String(node.y));
      line.addClass(`bread-trail-graph-edge-${node.relation}`);

      // Apply path color to sequence edges
      if ((node.relation === 'previous' || node.relation === 'next') && node.pathName) {
        const color = this.pathColorMap.get(node.pathName);
        if (color) {
          line.style.setProperty('--path-color', color);
          line.addClass('bread-trail-graph-edge-path');
        }
      }
    }
  }

  private handleEnter(): false {
    const selected = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!selected) return false;

    const now = Date.now();
    const timeSinceLastEnter = now - this.lastEnterPress;

    if (timeSinceLastEnter < 500) {
      if (this.renderTimeout) {
        window.clearTimeout(this.renderTimeout);
        this.renderTimeout = undefined;
      }
      this.confirmed = true;
      this.close();
      void this.app.workspace.getLeaf('tab').openFile(selected.file);
      return false;
    }

    this.lastEnterPress = now;

    if (selected.file.path !== this.rootFile.path) {
      if (this.renderTimeout) window.clearTimeout(this.renderTimeout);
      this.renderTimeout = window.setTimeout(() => {
        this.rootFile = selected.file;
        this.render();
        window.requestAnimationFrame(() => {
          this.centerSelectedNode();
        });
        this.renderTimeout = undefined;
      }, 150);
      return false;
    }

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
    return direction === 'up' || direction === 'down' ? y + x * 0.1 : x + y * 2;
  }

  private centerSelectedNodeDebounced() {
    if (this.centerTimeout) window.clearTimeout(this.centerTimeout);
    this.centerTimeout = window.setTimeout(() => {
      this.centerSelectedNode();
    }, 500);
  }

  private updateViewportTransform(viewport: HTMLElement) {
    viewport.style.transform = `translate(${this.panOffset.x}px, ${this.panOffset.y}px) scale(${this.zoomLevel})`;
  }

  private centerSelectedNode() {
    const selected = this.nodes.find((node) => node.file.path === this.selectedPath);
    if (!selected || !this.stageEl) return;

    const stageRect = this.stageEl.getBoundingClientRect();
    const centerX = stageRect.width / 2;
    const centerY = stageRect.height / 2;

    const viewport = this.stageEl.querySelector('.bread-trail-graph-viewport') as HTMLElement;
    if (viewport) {
      this.panOffset = {
        x: centerX - (selected.x * this.zoomLevel),
        y: centerY - (selected.y * this.zoomLevel)
      };
      this.updateViewportTransform(viewport);
    }
  }

  private registerMouseHandlers(stageEl: HTMLElement, viewport: HTMLElement) {
    stageEl.addEventListener('mousedown', (e) => {
      if (e.target !== stageEl && e.target !== viewport && !(e.target as HTMLElement).closest('.bread-trail-graph-edges')) {
        return;
      }
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.panOffset.x, y: e.clientY - this.panOffset.y };
      stageEl.addClass('is-grabbing');
      e.preventDefault();
    });

    activeDocument.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panOffset = {
        x: e.clientX - this.dragStart.x,
        y: e.clientY - this.dragStart.y,
      };
      this.updateViewportTransform(viewport);
    });

    activeDocument.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        if (this.stageEl) this.stageEl.removeClass('is-grabbing');
      }
    });

    stageEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const delta = -e.deltaY / 1000;
      this.zoomLevel = Math.max(0.5, Math.min(2, this.zoomLevel + delta));
      this.updateViewportTransform(viewport);
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
    if (this.filterTimeout) window.clearTimeout(this.filterTimeout);

    let filterEl = this.graphPanelEl!.querySelector('.bread-trail-filter-indicator') as HTMLElement;
    if (!filterEl) {
      filterEl = this.graphPanelEl!.createDiv('bread-trail-filter-indicator');
    }

    if (this.filterText) {
      filterEl.setText(`Filter: ${this.filterText}`);
      filterEl.removeClass('is-hidden');
    } else {
      filterEl.addClass('is-hidden');
    }

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

    this.filterTimeout = window.setTimeout(() => {
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
