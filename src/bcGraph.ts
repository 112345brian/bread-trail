/**
 * bcGraph — canonical wrappers over the Breadcrumbs graph API.
 *
 * All BC relationships are bidirectional: a child can declare its parent with
 * an outgoing `up` edge, or a parent can declare its children with an outgoing
 * `down` edge. Every query must check both directions.
 *
 * Functions here operate on raw paths (strings), not TFile objects, so they
 * are vault-independent and unit-testable. Callers resolve paths to TFile
 * via app.vault.getAbstractFileByPath where needed.
 */

import type { BreadcrumbsGraph, BreadcrumbEdge } from './main';

function resolveTarget(graph: BreadcrumbsGraph, e: BreadcrumbEdge): string | undefined {
  return e.target_path?.(graph) ?? e.target;
}

function resolveSource(graph: BreadcrumbsGraph, e: BreadcrumbEdge): string | undefined {
  return e.source_path?.(graph) ?? e.source;
}

/** All parent paths of `path` (outgoing `up` + incoming `down`). */
export function getParentPaths(graph: BreadcrumbsGraph, path: string): string[] {
  const seen = new Set<string>([path]);
  const parents: string[] = [];
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'up') continue;
    const p = resolveTarget(graph, e);
    if (p && !seen.has(p)) { seen.add(p); parents.push(p); }
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'down') continue;
    const p = resolveSource(graph, e);
    if (p && !seen.has(p)) { seen.add(p); parents.push(p); }
  }
  return parents;
}

/** All child paths of `path` (outgoing `down` + incoming `up`).
 *  Pass `includeChildEdge: true` to also match the `child` edge type
 *  (used by the Sequencer for custom-configured child edges). */
export function getChildPaths(graph: BreadcrumbsGraph, path: string, includeChildEdge = false): string[] {
  const seen = new Set<string>([path]);
  const children: string[] = [];
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    const t = e.edge_type?.toLowerCase();
    if (t !== 'down' && !(includeChildEdge && t === 'child')) continue;
    const p = resolveTarget(graph, e);
    if (p && !seen.has(p)) { seen.add(p); children.push(p); }
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'up') continue;
    const p = resolveSource(graph, e);
    if (p && !seen.has(p)) { seen.add(p); children.push(p); }
  }
  return children;
}

/** True if `path` has at least one BC parent. */
export function hasParent(graph: BreadcrumbsGraph, path: string): boolean {
  return graph.get_outgoing_edges(path).to_array().some((e) => e.edge_type?.toLowerCase() === 'up') ||
    graph.get_incoming_edges(path).to_array().some((e) => e.edge_type?.toLowerCase() === 'down');
}

/** True if `path` has at least one BC child. */
export function hasChildren(graph: BreadcrumbsGraph, path: string): boolean {
  return graph.get_outgoing_edges(path).to_array().some((e) => e.edge_type?.toLowerCase() === 'down') ||
    graph.get_incoming_edges(path).to_array().some((e) => e.edge_type?.toLowerCase() === 'up');
}

/** True if `path` declares `parentPath` as a direct BC parent. */
export function isDirectChild(graph: BreadcrumbsGraph, path: string, parentPath: string): boolean {
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'up') continue;
    if (resolveTarget(graph, e) === parentPath) return true;
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (e.edge_type?.toLowerCase() !== 'down') continue;
    if (resolveSource(graph, e) === parentPath) return true;
  }
  return false;
}

/** Chain-path identifiers reachable from `path` via next/prev edges.
 *  Returns '' for un-namespaced next/prev, and 'foo' for next.foo/prev.foo. */
export function getChainPathIds(graph: BreadcrumbsGraph, path: string): Set<string> {
  const ids = new Set<string>();
  const check = (t: string | undefined) => {
    const lower = t?.toLowerCase() ?? '';
    if (lower === 'next' || lower === 'prev') ids.add('');
    else if (lower.startsWith('next.') || lower.startsWith('prev.')) ids.add(lower.split('.').slice(1).join('.'));
  };
  for (const e of graph.get_outgoing_edges(path).to_array()) check(e.edge_type);
  for (const e of graph.get_incoming_edges(path).to_array()) check(e.edge_type);
  return ids;
}
