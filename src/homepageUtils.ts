import { App, TFile, TFolder } from 'obsidian';
import type { BreadTrailSettings } from './settings';

export type HomepageTarget = { kind: 'folder'; path: string } | { kind: 'file'; file: TFile };

/** Resolve the configured homepage file — either from settings or by detecting
 *  `cssclasses: homepage` in frontmatter. Returns null if not configured. */
export function resolveHomepageFile(app: App, settings: BreadTrailSettings): TFile | null {
  const configured = settings.homepageNote.trim();
  if (configured) {
    const direct = app.vault.getAbstractFileByPath(configured) ??
      app.vault.getAbstractFileByPath(configured + '.md');
    if (direct instanceof TFile) return direct;
    // Exact path fallback — always unambiguous
    const byPath = app.vault.getMarkdownFiles().find((f) => f.path === configured);
    if (byPath) return byPath;
    // Basename fallback — require a unique match to avoid picking the wrong file
    const byBasename = app.vault.getMarkdownFiles().filter((f) => f.basename === configured);
    if (byBasename.length === 1) return byBasename[0] ?? null;
    return null;
  }
  return app.vault.getMarkdownFiles().find((f) => {
    const frontmatter = app.metadataCache.getFileCache(f)?.frontmatter as unknown;
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return false;
    const cssclasses = (frontmatter as Record<string, unknown>)['cssclasses'];
    return Array.isArray(cssclasses)
      ? cssclasses.some((v) => String(v).toLowerCase() === 'homepage')
      : typeof cssclasses === 'string' && cssclasses.toLowerCase() === 'homepage';
  }) ?? null;
}

/** Resolve where the homepage should browse to — a folder or a specific note. */
export function resolveHomepageTarget(app: App, settings: BreadTrailSettings): HomepageTarget | null {
  const target = settings.homepageTarget.trim();
  if (!target) return null;
  // Normalize slashes so "ARCHIVE/" resolves the same as "ARCHIVE"
  const normalized = target.replace(/^\/+|\/+$/g, '');
  const direct = app.vault.getAbstractFileByPath(normalized) ??
    app.vault.getAbstractFileByPath(normalized + '.md');
  if (direct instanceof TFile) return { kind: 'file', file: direct };
  if (direct instanceof TFolder) return { kind: 'folder', path: direct.path };
  // Exact path fallback — paths are unique so this is always unambiguous
  const byPath = app.vault.getMarkdownFiles().find((f) => f.path === normalized);
  if (byPath) return { kind: 'file', file: byPath };
  // Basename fallback — only use when exactly one note has this name
  const byBasename = app.vault.getMarkdownFiles().filter((f) => f.basename === normalized);
  if (byBasename.length === 1) return { kind: 'file', file: byBasename[0]! };
  // Unknown target — return null rather than silently fabricating a folder path
  return null;
}

/** If `file` is the configured homepage, return where it should browse to. */
export function getHomepageTargetForFile(
  file: TFile | null, app: App, settings: BreadTrailSettings,
): HomepageTarget | null {
  if (!file) return null;
  const homepage = resolveHomepageFile(app, settings);
  if (!homepage || homepage.path !== file.path) return null;
  return resolveHomepageTarget(app, settings);
}
