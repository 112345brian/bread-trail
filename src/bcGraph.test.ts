/* eslint-disable import/no-nodejs-modules */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getParentPaths, getChildPaths, hasParent, hasChildren, isDirectChild, getChainPathIds,
  buildEdgeDirections,
} from './bcGraph.js';
import type { BreadcrumbsGraph, BreadcrumbEdge } from './main.js';

// ── Fake graph ─────────────────────────────────────────────────────────────────

type EdgeEntry = BreadcrumbEdge & { _from: string };

class FakeGraph implements BreadcrumbsGraph {
  private edges: EdgeEntry[] = [];

  addEdge(from: string, to: string, edgeType: string) {
    this.edges.push({ _from: from, target: to, source: from, edge_type: edgeType });
  }

  get_outgoing_edges(path: string) {
    const out = this.edges.filter((e) => e._from === path);
    return { to_array: () => out };
  }

  get_incoming_edges(path: string) {
    const inc = this.edges
      .filter((e) => e.target === path)
      .map((e) => ({ ...e, source: e._from, target: path }));
    return { to_array: () => inc };
  }
}

// ── Direction fixtures ────────────────────────────────────────────────────────

// Mirrors this project's real vault config: BC 4.x field labels grouped by
// direction, no literal "up"/"down"/"next"/"prev" fields declared at all.
const LABELED_DIRS = buildEdgeDirections([
  { label: 'ups', fields: ['broader', 'component-of'] },
  { label: 'downs', fields: ['narrower', 'has-component', 'uses'] },
  { label: 'nexts', fields: ['next', 'up_next'] },
  { label: 'prevs', fields: ['prev', 'down_prev'] },
]);

// No edge_field_groups configured at all (older BC, or a vault that never set
// custom groups) — only the legacy literal direction words should resolve.
const LEGACY_DIRS = buildEdgeDirections(undefined);

// ── Tests ───────────────────────────────────────────────────────────────────────

void describe('bcGraph — parent/child helpers (legacy literal edge types)', () => {
  void it('finds parent declared via outgoing up edge', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    assert.deepEqual(getParentPaths(g, 'child.md', LEGACY_DIRS), ['parent.md']);
    assert.ok(hasParent(g, 'child.md', LEGACY_DIRS));
    assert.ok(!hasParent(g, 'parent.md', LEGACY_DIRS));
  });

  void it('finds parent declared via incoming down edge (bidirectionality trap)', () => {
    // Bug class: parent declares children with outgoing `down`, not the child
    // declaring `up`. A query that only checks outgoing `up` misses this.
    const g = new FakeGraph();
    g.addEdge('parent.md', 'child.md', 'down');
    assert.deepEqual(getParentPaths(g, 'child.md', LEGACY_DIRS), ['parent.md']);
    assert.ok(hasParent(g, 'child.md', LEGACY_DIRS));
  });

  void it('finds children via outgoing down edge', () => {
    const g = new FakeGraph();
    g.addEdge('parent.md', 'child.md', 'down');
    assert.deepEqual(getChildPaths(g, 'parent.md', LEGACY_DIRS), ['child.md']);
    assert.ok(hasChildren(g, 'parent.md', LEGACY_DIRS));
  });

  void it('finds children via incoming up edge (bidirectionality trap)', () => {
    // Child declares parent via `up` → parent's getChildPaths must see it
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    assert.deepEqual(getChildPaths(g, 'parent.md', LEGACY_DIRS), ['child.md']);
    assert.ok(hasChildren(g, 'parent.md', LEGACY_DIRS));
  });

  void it('handles mixed-case edge types (lowercase normalisation trap)', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'UP');
    assert.ok(hasParent(g, 'child.md', LEGACY_DIRS));
    assert.ok(hasChildren(g, 'parent.md', LEGACY_DIRS));
  });

  void it('deduplicates when parent declared by both directions', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    g.addEdge('parent.md', 'child.md', 'down');
    const parents = getParentPaths(g, 'child.md', LEGACY_DIRS);
    assert.equal(parents.length, 1);
    assert.equal(parents[0], 'parent.md');
  });

  void it('multi-parent note returns all parents', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent-a.md', 'up');
    g.addEdge('parent-b.md', 'child.md', 'down');
    const parents = getParentPaths(g, 'child.md', LEGACY_DIRS);
    assert.equal(parents.length, 2);
    assert.ok(parents.includes('parent-a.md'));
    assert.ok(parents.includes('parent-b.md'));
  });

  void it('isDirectChild returns true for parent declared either direction', () => {
    const g = new FakeGraph();
    g.addEdge('child-a.md', 'parent.md', 'up');
    g.addEdge('parent.md', 'child-b.md', 'down');
    assert.ok(isDirectChild(g, 'child-a.md', 'parent.md', LEGACY_DIRS));
    assert.ok(isDirectChild(g, 'child-b.md', 'parent.md', LEGACY_DIRS));
    assert.ok(!isDirectChild(g, 'parent.md', 'child-a.md', LEGACY_DIRS));
  });

  void it('getChildPaths includes child edge type only when requested', () => {
    const g = new FakeGraph();
    g.addEdge('parent.md', 'child.md', 'child');
    assert.equal(getChildPaths(g, 'parent.md', LEGACY_DIRS).length, 0);
    assert.equal(getChildPaths(g, 'parent.md', LEGACY_DIRS, true).length, 1);
  });
});

void describe('bcGraph — buildEdgeDirections (BC 4.x field-label resolution)', () => {
  void it('resolves field labels via edge_field_groups, not direction literals', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'broader');
    assert.deepEqual(getParentPaths(g, 'child.md', LABELED_DIRS), ['parent.md']);
    assert.ok(hasParent(g, 'child.md', LABELED_DIRS));
  });

  void it('resolves a different field within the same group (component-of)', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'component-of');
    assert.ok(hasParent(g, 'child.md', LABELED_DIRS));
  });

  void it('does not treat an ungrouped field as a direction', () => {
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'has-part'); // not in any group in this fixture
    assert.ok(!hasParent(g, 'a.md', LABELED_DIRS));
    assert.ok(!hasChildren(g, 'b.md', LABELED_DIRS));
  });

  void it('still honors the literal up/down words even when groups are configured', () => {
    // Suggested-approach requirement: the ~65 legacy notes using literal
    // direction words must keep working after a vault migrates to groups.
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    assert.ok(hasParent(g, 'child.md', LABELED_DIRS));
  });

  void it('falls back to legacy literals only when edge_field_groups is missing/empty', () => {
    assert.ok(buildEdgeDirections(undefined).ups.has('up'));
    assert.ok(buildEdgeDirections([]).downs.has('down'));
    assert.ok(!buildEdgeDirections(undefined).ups.has('broader'));
  });

  void it('is case-insensitive on both group labels and field labels', () => {
    const dirs = buildEdgeDirections([{ label: 'UPS', fields: ['Broader'] }]);
    assert.ok(dirs.ups.has('broader'));
  });
});

void describe('bcGraph — chain helpers (BC 4.x has no per-field sequence namespacing)', () => {
  void it('detects a next edge via the literal field', () => {
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'next');
    const ids = getChainPathIds(g, 'a.md', LEGACY_DIRS);
    assert.ok(ids.has(''));
  });

  void it('detects prev via incoming direction', () => {
    // prev declared on predecessor means b is the successor — check incoming
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'prev');
    const ids = getChainPathIds(g, 'b.md', LEGACY_DIRS);
    assert.ok(ids.has(''));
  });

  void it('merges every field in the nexts/prevs group into a single chain (next and up_next)', () => {
    // Design decision: BC 4.x groups (e.g. this vault's nexts: [next, up_next])
    // mean "any of these fields is a forward pointer" — same relationship, not
    // parallel named sequences — so both resolve to the one default chain id.
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'next');
    g.addEdge('c.md', 'a.md', 'up_next');
    const ids = getChainPathIds(g, 'a.md', LABELED_DIRS);
    assert.deepEqual([...ids], ['']);
  });

  void it('reports no chain when the note has no next/prev-group edges', () => {
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'broader');
    const ids = getChainPathIds(g, 'a.md', LABELED_DIRS);
    assert.equal(ids.size, 0);
  });
});
