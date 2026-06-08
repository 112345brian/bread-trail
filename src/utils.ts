import type { App, TFile } from 'obsidian';
import type { BreadTrailSettings } from './settings';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'avif']);

/**
 * Single source of truth for whether a file is hidden from all BreadTrail UI
 * surfaces (navigator sidebar, floating panels, explorer modal).
 *
 * Rules checked (in order):
 *   1. `bread-trail.hidden: true` in frontmatter
 *   2. Exact path match in `navigatorExcludeFiles`
 *   3. Path starts with a prefix in `navigatorExcludeFolders`
 *   4. A `navigatorExcludeFrontmatter` pattern matches
 *
 * Previously duplicated in NavigatorView and ExplorerModal — keep this the
 * single canonical definition.
 */
export function isExcluded(file: TFile, app: App, settings: BreadTrailSettings): boolean {
  const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
  const bt = fm && typeof fm === 'object' && !Array.isArray(fm)
    ? (fm as Record<string, unknown>)['bread-trail']
    : undefined;
  if (typeof bt === 'object' && bt !== null && (bt as Record<string, unknown>)['hidden'] === true) return true;
  if (settings.navigatorExcludeFiles.includes(file.path)) return true;
  for (const folder of settings.navigatorExcludeFolders) {
    const prefix = folder.endsWith('/') ? folder : folder + '/';
    if (file.path.startsWith(prefix)) return true;
  }
  if (settings.navigatorExcludeFrontmatter.length > 0) {
    const frontmatter = fm && typeof fm === 'object' && !Array.isArray(fm) ? fm as Record<string, unknown> : {};
    for (const pattern of settings.navigatorExcludeFrontmatter) {
      const colonIdx = pattern.indexOf(':');
      if (colonIdx === -1) {
        const val = frontmatter[pattern];
        if (val !== undefined && val !== null && val !== false && val !== '' && val !== 0) return true;
      } else {
        const key = pattern.slice(0, colonIdx).trim();
        const expected = pattern.slice(colonIdx + 1).trim();
        const val = frontmatter[key];
        if ((typeof val === 'string' || typeof val === 'number') && String(val).trim() === expected) return true;
      }
    }
  }
  return false;
}

/** Return the raw link text of the first image embed in content, or null. */
export function extractFirstImageLink(content: string): string | null {
  // Match ![[filename.ext]] or ![[filename.ext|alias]]
  const match = content.match(/!\[\[([^\]]+)\]\]/);
  if (!match || !match[1]) return null;
  const linkText = (match[1].split('|')[0] ?? '').trim();
  const ext = linkText.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext) ? linkText : null;
}

/**
 * Try to interpret a frontmatter string as a date value and return a human-
 * readable form (e.g. "Jun 5, 2026"). Falls back to the original string if it
 * doesn't look like a recognisable date. Only activates for strings that start
 * with four digits followed by a dash — avoids false positives on things like
 * "published" or "draft".
 */
/**
 * Format a date (or datetime) string for display. Date-only values show just
 * the date (e.g. "Jun 5, 2026"). Values that include a time component show
 * both (e.g. "Jun 5, 2026, 2:30 PM"). Pass a numeric mtime (ms) to format a
 * file modification timestamp directly.
 */
export function formatDateValue(raw: string | number): string {
  if (typeof raw === 'number') {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
  if (typeof raw !== 'string') return String(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw.trim())) return raw;
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
    const d = isDateOnly ? new Date(`${raw.trim()}T00:00:00`) : new Date(raw.trim());
    if (isNaN(d.getTime())) return raw;
    if (isDateOnly) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

/**
 * Returns true when the note's body starts with a transcluded Base or an
 * inline base/dataview block in the first `checkLines` non-blank lines.
 *
 * Detects:
 *   ![[anything.base]]          — transcluded Obsidian Base file
 *   ![[anything.base|alias]]    — same with an alias
 *   ```base … ```               — inline base block
 *   ```dataview … ```           — inline Dataview block
 */
export function startsWithBaseTransclusion(content: string, checkLines = 3): boolean {
  let body = content;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }

  let seen = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;                         // skip blank lines
    if (seen >= checkLines) break;
    seen++;

    // Transcluded .base file: ![[name.base]] or ![[name.base|alias]]
    if (/^!\[\[[^\]]+\.base(?:\|[^\]]*)?\]\]$/.test(trimmed)) return true;

    // Fenced code block opening: ```base or ```dataview
    if (/^```(base|dataview)\b/.test(trimmed)) return true;
  }
  return false;
}

/** Strip YAML frontmatter and return the first N lines of body content.
 *  Used for rendered markdown previews — keeps tables, lists, etc. intact.
 *
 *  Also de-indents the snippet so that list items whose minimum indentation
 *  is > 0 (e.g. a note whose entire content is inside one parent bullet) are
 *  shifted left. This prevents incorrectly nested rendering when the visible
 *  note content is entirely at one logical indent level. */
export function extractContentSnippet(content: string, maxLines = 12): string {
  let body = content;

  // Strip YAML frontmatter (handles both \n and \r\n)
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }

  const lines = body.split('\n').slice(0, maxLines);

  // Find the minimum indentation across non-empty lines so we can strip it.
  // This normalises snippets where all content is nested one level deeper
  // than it should appear (e.g. inside a single parent bullet in the source).
  const minIndent = lines.reduce((min, line) => {
    if (!line.trim()) return min;               // skip blank lines
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    return Math.min(min, indent);
  }, Infinity);

  const deindent = Number.isFinite(minIndent) && minIndent > 0;
  const result = deindent
    ? lines.map((l) => l.slice(minIndent)).join('\n')
    : lines.join('\n');

  return result.trim();
}

/** Strip YAML frontmatter and markdown syntax, return plain-text excerpt. */
export function extractExcerpt(content: string, maxLength = 200): string {
  let body = content;

  // Strip YAML frontmatter
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4);
  }

  body = body
    .replace(/!\[\[[^\]]*\]\]/g, '')                      // image/file embeds — remove entirely
    .replace(/^#{1,6}\s+/gm, '')                          // headings
    .replace(/\*\*(.+?)\*\*/gs, '$1')                     // bold
    .replace(/\*(.+?)\*/gs, '$1')                         // italic
    .replace(/~~(.+?)~~/gs, '$1')                         // strikethrough
    .replace(/`[^`]+`/g, '')                              // inline code
    .replace(/```[\s\S]*?```/g, '')                       // code blocks
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')    // wikilinks → display text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')              // markdown links
    .replace(/^[-*+]\s+/gm, '')                           // list bullets
    .replace(/^\d+\.\s+/gm, '')                           // ordered lists
    .replace(/^>\s+/gm, '')                               // blockquotes
    .replace(/\n+/g, ' ')                                 // collapse newlines
    .trim();

  if (!body) return '';
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength).trimEnd() + '…';
}
