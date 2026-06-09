/* eslint-disable import/no-nodejs-modules */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getParentPaths, getChildPaths, hasParent, hasChildren, isDirectChild, getChainPathIds } from './bcGraph.js';
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

// ── Tests ───────────────────────────────────────────────────────────────────────

void describe('bcGraph — parent/child helpers', () => {
  void it('finds parent declared via outgoing up edge', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    assert.deepEqual(getParentPaths(g, 'child.md'), ['parent.md']);
    assert.ok(hasParent(g, 'child.md'));
    assert.ok(!hasParent(g, 'parent.md'));
  });

  void it('finds parent declared via incoming down edge (bidirectionality trap)', () => {
    // Bug class: parent declares children with outgoing `down`, not the child
    // declaring `up`. A query that only checks outgoing `up` misses this.
    const g = new FakeGraph();
    g.addEdge('parent.md', 'child.md', 'down');
    assert.deepEqual(getParentPaths(g, 'child.md'), ['parent.md']);
    assert.ok(hasParent(g, 'child.md'));
  });

  void it('finds children via outgoing down edge', () => {
    const g = new FakeGraph();
    g.addEdge('parent.md', 'child.md', 'down');
    assert.deepEqual(getChildPaths(g, 'parent.md'), ['child.md']);
    assert.ok(hasChildren(g, 'parent.md'));
  });

  void it('finds children via incoming up edge (bidirectionality trap)', () => {
    // Child declares parent via `up` → parent's getChildPaths must see it
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    assert.deepEqual(getChildPaths(g, 'parent.md'), ['child.md']);
    assert.ok(hasChildren(g, 'parent.md'));
  });

  void it('handles mixed-case edge types (lowercase normalisation trap)', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'UP');
    assert.ok(hasParent(g, 'child.md'));
    assert.ok(hasChildren(g, 'parent.md'));
  });

  void it('deduplicates when parent declared by both directions', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent.md', 'up');
    g.addEdge('parent.md', 'child.md', 'down');
    const parents = getParentPaths(g, 'child.md');
    assert.equal(parents.length, 1);
    assert.equal(parents[0], 'parent.md');
  });

  void it('multi-parent note returns all parents', () => {
    const g = new FakeGraph();
    g.addEdge('child.md', 'parent-a.md', 'up');
    g.addEdge('parent-b.md', 'child.md', 'down');
    const parents = getParentPaths(g, 'child.md');
    assert.equal(parents.length, 2);
    assert.ok(parents.includes('parent-a.md'));
    assert.ok(parents.includes('parent-b.md'));
  });

  void it('isDirectChild returns true for parent declared either direction', () => {
    const g = new FakeGraph();
    g.addEdge('child-a.md', 'parent.md', 'up');
    g.addEdge('parent.md', 'child-b.md', 'down');
    assert.ok(isDirectChild(g, 'child-a.md', 'parent.md'));
    assert.ok(isDirectChild(g, 'child-b.md', 'parent.md'));
    assert.ok(!isDirectChild(g, 'parent.md', 'child-a.md'));
  });

  void it('getChildPaths includes child edge type only when requested', () => {
    const g = new FakeGraph();
    g.addEdge('parent.md', 'child.md', 'child');
    assert.equal(getChildPaths(g, 'parent.md').length, 0);
    assert.equal(getChildPaths(g, 'parent.md', true).length, 1);
  });
});

void describe('bcGraph — chain helpers', () => {
  void it('detects un-namespaced next edge', () => {
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'next');
    const ids = getChainPathIds(g, 'a.md');
    assert.ok(ids.has(''));
  });

  void it('detects namespaced next edge', () => {
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'next.series');
    const ids = getChainPathIds(g, 'a.md');
    assert.ok(ids.has('series'));
    assert.ok(!ids.has(''));
  });

  void it('detects prev via incoming direction', () => {
    // prev declared on predecessor means b is the successor — check incoming
    const g = new FakeGraph();
    g.addEdge('a.md', 'b.md', 'prev');
    const ids = getChainPathIds(g, 'b.md');
    assert.ok(ids.has(''));
  });
});
