/**
 * bcGraph — canonical wrappers over the Breadcrumbs graph API.
 *
 * All BC relationships are bidirectional: a child can declare its parent with
 * an outgoing `up` edge, or a parent can declare its children with an outgoing
 * `down` edge. Every query must check both directions.
 *
 * BC 4.x removed hardcoded direction names — `edge.edge_type` is always the
 * field label the user configured (`broader`, `narrower`, `next`, ...), never
 * `"up"`/`"down"`. Direction is resolved via `plugin.settings.edge_field_groups`,
 * which maps a direction (`ups`/`downs`/`nexts`/`prevs`) to the field labels
 * that mean it. `buildEdgeDirections` turns that into lookup sets; every query
 * below always also honors the literal `up`/`down`/`next`/`prev` words so
 * vaults with no groups configured keep resolving. The literal `child` word
 * is the one exception — it's only ever checked by `getChildPaths` when its
 * caller opts in via `includeChildEdge`, not by every query.
 *
 * Functions here operate on raw paths (strings), not TFile objects, so they
 * are vault-independent and unit-testable. Callers resolve paths to TFile
 * via app.vault.getAbstractFileByPath where needed.
 *
 * Freshness: checked 2026-08-18 · recheck by 2026-12-18 — see freshness.json.
 * This file's whole design assumes BC's edge_field_groups shape; re-verify
 * against the installed Breadcrumbs version whenever it drifts again.
 */

import type { BreadcrumbsGraph, BreadcrumbEdge, BreadcrumbsPlugin } from './main';

export interface EdgeFieldGroup {
  label?: string;
  fields?: string[];
}

export interface EdgeDirections {
  ups: Set<string>;
  downs: Set<string>;
  nexts: Set<string>;
  prevs: Set<string>;
}

const LEGACY_LITERALS: { [K in keyof EdgeDirections]: string } = {
  ups: 'up',
  downs: 'down',
  nexts: 'next',
  prevs: 'prev',
};

/** Builds direction lookup sets from BC's `settings.edge_field_groups`.
 *  Always includes the legacy literal direction word for each direction,
 *  so vaults with no groups configured (or fields named literally
 *  `up`/`down`/`next`/`prev`) keep resolving. */
export function buildEdgeDirections(groups: EdgeFieldGroup[] | undefined | null): EdgeDirections {
  const dirs: EdgeDirections = { ups: new Set(), downs: new Set(), nexts: new Set(), prevs: new Set() };
  (Object.keys(dirs) as (keyof EdgeDirections)[]).forEach((key) => dirs[key].add(LEGACY_LITERALS[key]));
  for (const g of groups ?? []) {
    const label = g.label?.toLowerCase();
    if (!label) continue;
    for (const key of Object.keys(dirs) as (keyof EdgeDirections)[]) {
      if (label === key) {
        for (const f of g.fields ?? []) dirs[key].add(f.toLowerCase());
      }
    }
  }
  return dirs;
}

/** Convenience wrapper: builds direction sets straight from a live BC plugin. */
export function getEdgeDirections(bc: BreadcrumbsPlugin): EdgeDirections {
  return buildEdgeDirections(bc.settings?.edge_field_groups);
}

function edgeType(e: BreadcrumbEdge): string {
  return e.edge_type?.toLowerCase() ?? '';
}

function resolveTarget(graph: BreadcrumbsGraph, e: BreadcrumbEdge): string | undefined {
  return e.target_path?.(graph) ?? e.target;
}

function resolveSource(graph: BreadcrumbsGraph, e: BreadcrumbEdge): string | undefined {
  return e.source_path?.(graph) ?? e.source;
}

/** All parent paths of `path` (outgoing `up`-group + incoming `down`-group). */
export function getParentPaths(graph: BreadcrumbsGraph, path: string, dirs: EdgeDirections): string[] {
  const seen = new Set<string>([path]);
  const parents: string[] = [];
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    if (!dirs.ups.has(edgeType(e))) continue;
    const p = resolveTarget(graph, e);
    if (p && !seen.has(p)) { seen.add(p); parents.push(p); }
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (!dirs.downs.has(edgeType(e))) continue;
    const p = resolveSource(graph, e);
    if (p && !seen.has(p)) { seen.add(p); parents.push(p); }
  }
  return parents;
}

/** All child paths of `path` (outgoing `down`-group + incoming `up`-group).
 *  Pass `includeChildEdge: true` to also match the literal `child` edge type
 *  (used by the Sequencer for custom-configured child edges). */
export function getChildPaths(
  graph: BreadcrumbsGraph,
  path: string,
  dirs: EdgeDirections,
  includeChildEdge = false,
): string[] {
  const seen = new Set<string>([path]);
  const children: string[] = [];
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    const t = edgeType(e);
    if (!dirs.downs.has(t) && !(includeChildEdge && t === 'child')) continue;
    const p = resolveTarget(graph, e);
    if (p && !seen.has(p)) { seen.add(p); children.push(p); }
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (!dirs.ups.has(edgeType(e))) continue;
    const p = resolveSource(graph, e);
    if (p && !seen.has(p)) { seen.add(p); children.push(p); }
  }
  return children;
}

/** True if `path` has at least one BC parent. */
export function hasParent(graph: BreadcrumbsGraph, path: string, dirs: EdgeDirections): boolean {
  return graph.get_outgoing_edges(path).to_array().some((e) => dirs.ups.has(edgeType(e))) ||
    graph.get_incoming_edges(path).to_array().some((e) => dirs.downs.has(edgeType(e)));
}

/** True if `path` has at least one BC child. */
export function hasChildren(graph: BreadcrumbsGraph, path: string, dirs: EdgeDirections): boolean {
  return graph.get_outgoing_edges(path).to_array().some((e) => dirs.downs.has(edgeType(e))) ||
    graph.get_incoming_edges(path).to_array().some((e) => dirs.ups.has(edgeType(e)));
}

/** True if `path` declares `parentPath` as a direct BC parent. */
export function isDirectChild(graph: BreadcrumbsGraph, path: string, parentPath: string, dirs: EdgeDirections): boolean {
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    if (!dirs.ups.has(edgeType(e))) continue;
    if (resolveTarget(graph, e) === parentPath) return true;
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (!dirs.downs.has(edgeType(e))) continue;
    if (resolveSource(graph, e) === parentPath) return true;
  }
  return false;
}

/** Chain-path identifiers reachable from `path` via next/prev edges.
 *
 *  BC 4.x has no per-field sequence namespacing (the old `next.foo` /
 *  `prev.foo` convention doesn't exist) — any field in the `nexts`/`prevs`
 *  groups means "forward"/"backward" in the same single sequence. This
 *  always returns either `{}`  or `{''}` (the one default chain), kept as a
 *  Set for compatibility with existing multi-chain call sites. */
export function getChainPathIds(graph: BreadcrumbsGraph, path: string, dirs: EdgeDirections): Set<string> {
  const ids = new Set<string>();
  const has = (e: BreadcrumbEdge) => dirs.nexts.has(edgeType(e)) || dirs.prevs.has(edgeType(e));
  if (graph.get_outgoing_edges(path).to_array().some(has)) ids.add('');
  if (graph.get_incoming_edges(path).to_array().some(has)) ids.add('');
  return ids;
}

/** Candidate chain-predecessor paths of `path` (outgoing `prev`-group + incoming
 *  `next`-group), in priority order, excluding anything already in `seen`.
 *  Returns every candidate (not just the first) because a candidate path may
 *  not resolve to a live file in the caller's vault (broken link/deleted
 *  note) — the caller should take the first one that does. Shared by
 *  FloatingNav and NavDataBuilder so the two chain views can't drift out of
 *  sync. */
export function findPrevPaths(graph: BreadcrumbsGraph, path: string, seen: Set<string>, dirs: EdgeDirections): string[] {
  const candidates: string[] = [];
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (!dirs.nexts.has(edgeType(e))) continue;
    const p = resolveSource(graph, e);
    if (p && !seen.has(p)) candidates.push(p);
  }
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    if (!dirs.prevs.has(edgeType(e))) continue;
    const p = resolveTarget(graph, e);
    if (p && !seen.has(p)) candidates.push(p);
  }
  return candidates;
}

/** Candidate chain-successor paths of `path` (outgoing `next`-group + incoming
 *  `prev`-group), in priority order, excluding anything already in `seen`. */
export function findNextPaths(graph: BreadcrumbsGraph, path: string, seen: Set<string>, dirs: EdgeDirections): string[] {
  const candidates: string[] = [];
  for (const e of graph.get_outgoing_edges(path).to_array()) {
    if (!dirs.nexts.has(edgeType(e))) continue;
    const p = resolveTarget(graph, e);
    if (p && !seen.has(p)) candidates.push(p);
  }
  for (const e of graph.get_incoming_edges(path).to_array()) {
    if (!dirs.prevs.has(edgeType(e))) continue;
    const p = resolveSource(graph, e);
    if (p && !seen.has(p)) candidates.push(p);
  }
  return candidates;
}
