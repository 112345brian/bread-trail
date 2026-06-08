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
    return app.vault.getMarkdownFiles()
      .find((f) => f.basename === configured || f.path === configured) ?? null;
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
  const direct = app.vault.getAbstractFileByPath(target) ??
    app.vault.getAbstractFileByPath(target + '.md');
  if (direct instanceof TFile) return { kind: 'file', file: direct };
  if (direct instanceof TFolder) return { kind: 'folder', path: direct.path };
  const file = app.vault.getMarkdownFiles()
    .find((f) => f.basename === target || f.path === target);
  if (file) return { kind: 'file', file };
  return { kind: 'folder', path: target.replace(/^\/+|\/+$/g, '') };
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
