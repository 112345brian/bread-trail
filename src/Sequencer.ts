import { App, TFile } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';

// ── Config types (parsed from a parent note's frontmatter) ───────────────────

export interface LinkChildrenConfig {
  /** Frontmatter field names to sort by, in priority order. */
  frontmatter: string[];
  /** 'auto' re-sequences on file change; 'manual' only runs on command. */
  mode: 'auto' | 'manual';
  /** Named sub-path for next.X / prev.X. Defaults to normalized parent basename. */
  path: string;
  /** When true, stale next.X / prev.X links are removed. */
  removeStale: boolean;
  /** 'flat' writes `next.journal: [[X]]`; 'nested' writes `next: { journal: [[X]] }`. */
  format: 'flat' | 'nested';
}

// ── Per-child diff ────────────────────────────────────────────────────────────

export type ChangeKind = 'add' | 'remove' | 'no-change';

export interface FrontmatterChange {
  key: string;       // e.g. "next.journal"
  value: string;     // e.g. "[[2024-01-02 Entry]]"
  kind: ChangeKind;
}

export interface ChildResult {
  file: TFile;
  ignored: boolean;
  ignoreReason?: string;
  changes: FrontmatterChange[];
}

export interface SequencePlan {
  parent: TFile;
  config: LinkChildrenConfig;
  results: ChildResult[];
}

// ── Config parser ─────────────────────────────────────────────────────────────

/** Convert a note basename to a lowercase hyphenated path token.
 *  e.g. "My Journal" → "my-journal" */
function toPathName(basename: string): string {
  return basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Read and validate `bread-trail.link-children` from a file's frontmatter.
 *  Returns null if the key is absent or malformed. */
export function parseLinkChildrenConfig(
  app: App,
  file: TFile,
): LinkChildrenConfig | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return null;

  const bt = fm['bread-trail'];
  if (!bt || typeof bt !== 'object') return null;

  const lc = (bt as Record<string, unknown>)['link-children'];
  if (!lc || typeof lc !== 'object') return null;

  const raw = lc as Record<string, unknown>;

  const frontmatter = Array.isArray(raw['frontmatter'])
    ? (raw['frontmatter'] as unknown[]).filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];
  if (frontmatter.length === 0) return null;

  const mode = raw['mode'] === 'auto' ? 'auto' : 'manual';
  const path = typeof raw['path'] === 'string' && raw['path'].trim().length > 0
    ? raw['path'].trim()
    : toPathName(file.basename);
  const removeStale = typeof raw['remove-stale'] === 'boolean' ? raw['remove-stale'] : false;
  const format = raw['format'] === 'nested' ? 'nested' : 'flat';

  return { frontmatter, mode, path, removeStale, format };
}

/** Return every file in the vault that has `bread-trail.link-children` configured. */
export function findAllConfiguredParents(app: App): Array<{ file: TFile; config: LinkChildrenConfig }> {
  const results: Array<{ file: TFile; config: LinkChildrenConfig }> = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const config = parseLinkChildrenConfig(app, file);
    if (config) results.push({ file, config });
  }
  return results;
}

// ── Resolve a frontmatter date/sort value ─────────────────────────────────────

/** Try each field name in order; return the first non-null string value. */
function resolveField(fm: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const val = fm[field];
    if (val !== undefined && val !== null && val !== '') {
      return String(val);
    }
  }
  return null;
}

// ── Flat/nested frontmatter helpers ──────────────────────────────────────────

/** Read a dotted key from frontmatter, checking both flat (`next.journal`) and
 *  nested (`next: { journal: ... }`) forms. Returns null if absent. */
function readFmKey(fm: Record<string, unknown>, key: string): string | null {
  // Flat form: fm['next.journal']
  if (fm[key] !== undefined && fm[key] !== null) return String(fm[key]);

  // Nested form: fm['next']['journal']
  const dot = key.indexOf('.');
  if (dot !== -1) {
    const prefix = key.slice(0, dot);
    const subpath = key.slice(dot + 1);
    const nested = fm[prefix];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const val = (nested as Record<string, unknown>)[subpath];
      if (val !== undefined && val !== null) return String(val);
    }
  }
  return null;
}

/** Write a dotted key into a processFrontMatter object in the target format. */
function writeFmKey(fm: Record<string, unknown>, key: string, value: string, format: 'flat' | 'nested') {
  if (format === 'flat') {
    fm[key] = value;
    return;
  }
  // Nested: ensure prefix object exists, then set sub-key
  const dot = key.indexOf('.');
  if (dot === -1) { fm[key] = value; return; }
  const prefix = key.slice(0, dot);
  const subpath = key.slice(dot + 1);
  if (!fm[prefix] || typeof fm[prefix] !== 'object' || Array.isArray(fm[prefix])) {
    fm[prefix] = {};
  }
  (fm[prefix] as Record<string, unknown>)[subpath] = value;
}

/** Delete a dotted key from a processFrontMatter object, handling both forms. */
function deleteFmKey(fm: Record<string, unknown>, key: string) {
  // Delete flat form
  if (fm[key] !== undefined) delete fm[key];

  // Delete from nested form
  const dot = key.indexOf('.');
  if (dot !== -1) {
    const prefix = key.slice(0, dot);
    const subpath = key.slice(dot + 1);
    const nested = fm[prefix];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      delete (nested as Record<string, unknown>)[subpath];
      // Remove the parent key if now empty
      if (Object.keys(nested as object).length === 0) delete fm[prefix];
    }
  }
}

// ── Core sequencer ────────────────────────────────────────────────────────────

export class Sequencer {
  constructor(
    private app: App,
    private bc: BreadcrumbsPlugin,
  ) {}

  /** Build a full plan for a single parent without writing anything. */
  plan(parent: TFile, config: LinkChildrenConfig): SequencePlan {
    const children = this.getChildren(parent);
    const { nextKey, prevKey } = keys(config.path);

    // Partition into included (have a sort value) and ignored (none)
    type WithValue = { file: TFile; sortValue: string };
    const included: WithValue[] = [];
    const ignored: ChildResult[] = [];

    for (const child of children) {
      const fm = this.app.metadataCache.getFileCache(child)?.frontmatter ?? {};
      const val = resolveField(fm, config.frontmatter);
      if (val === null) {
        ignored.push({
          file: child,
          ignored: true,
          ignoreReason: `no ${config.frontmatter.join(' or ')}`,
          changes: [],
        });
      } else {
        included.push({ file: child, sortValue: val });
      }
    }

    // Sort included by sort value (lexicographic — works for ISO dates and numbers-as-strings)
    included.sort((a, b) => a.sortValue.localeCompare(b.sortValue, undefined, { numeric: true }));

    // Compute desired next/prev for each included child
    const results: ChildResult[] = included.map(({ file }, idx) => {
      const prevFile = idx > 0 ? included[idx - 1]!.file : null;
      const nextFile = idx < included.length - 1 ? included[idx + 1]!.file : null;

      const desiredPrev = prevFile ? `[[${prevFile.basename}]]` : null;
      const desiredNext = nextFile ? `[[${nextFile.basename}]]` : null;

      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const changes: FrontmatterChange[] = [];

      // prev link
      changes.push(...this.diffKey(fm, prevKey, desiredPrev, config.removeStale));
      // next link
      changes.push(...this.diffKey(fm, nextKey, desiredNext, config.removeStale));

      return { file, ignored: false, changes };
    });

    // For ignored children: if removeStale, flag any existing next/prev links for removal
    for (const ig of ignored) {
      if (config.removeStale) {
        const fm = this.app.metadataCache.getFileCache(ig.file)?.frontmatter ?? {};
        const staleChanges: FrontmatterChange[] = [];
        staleChanges.push(...this.diffKey(fm, prevKey, null, true));
        staleChanges.push(...this.diffKey(fm, nextKey, null, true));
        ig.changes = staleChanges;
      }
      results.push(ig);
    }

    return { parent, config, results };
  }

  /** Execute a plan — writes all non-no-change diffs to frontmatter. */
  async apply(plan: SequencePlan): Promise<void> {
    const format = plan.config.format;
    for (const result of plan.results) {
      const writes = result.changes.filter((c) => c.kind !== 'no-change');
      if (writes.length === 0) continue;

      await this.app.fileManager.processFrontMatter(result.file, (fm) => {
        for (const change of writes) {
          if (change.kind === 'add') {
            writeFmKey(fm, change.key, change.value, format);
          } else if (change.kind === 'remove') {
            deleteFmKey(fm, change.key);
          }
        }
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Get all direct children of a file via the BC graph. */
  private getChildren(parent: TFile): TFile[] {
    const edges = this.bc.graph.get_outgoing_edges(parent.path).to_array();
    const children: TFile[] = [];
    const seen = new Set<string>();

    for (const edge of edges) {
      const edgeType = edge.edge_type ?? '';
      if (edgeType !== 'down' && edgeType !== 'child') continue;
      const targetPath = edge.target_path?.(this.bc.graph) ?? edge.target;
      if (!targetPath || seen.has(targetPath)) continue;
      seen.add(targetPath);

      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (file instanceof TFile) children.push(file);
    }
    return children;
  }

  /** Compute the diff for a single key, reading both flat and nested forms. */
  private diffKey(
    fm: Record<string, unknown>,
    key: string,
    desired: string | null,
    removeStale: boolean,
  ): FrontmatterChange[] {
    const current = readFmKey(fm, key);

    if (desired === null) {
      // We want no link here
      if (current !== null && removeStale) {
        return [{ key, value: current, kind: 'remove' }];
      }
      return [];
    }

    if (current === desired) {
      return [{ key, value: desired, kind: 'no-change' }];
    }

    const changes: FrontmatterChange[] = [];
    if (current !== null && removeStale) {
      changes.push({ key, value: current, kind: 'remove' });
    }
    changes.push({ key, value: desired, kind: 'add' });
    return changes;
  }
}

// ── Shared util ───────────────────────────────────────────────────────────────

export function keys(path: string): { nextKey: string; prevKey: string } {
  return { nextKey: `next.${path}`, prevKey: `prev.${path}` };
}

/** Count real changes (adds + removes) in a plan. */
export function countChanges(plan: SequencePlan): number {
  return plan.results.reduce(
    (sum, r) => sum + r.changes.filter((c) => c.kind !== 'no-change').length,
    0,
  );
}

/** Count ignored children in a plan. */
export function countIgnored(plan: SequencePlan): number {
  return plan.results.filter((r) => r.ignored).length;
}
