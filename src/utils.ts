const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'avif']);

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

/** Strip YAML frontmatter and return the first N lines of body content.
 *  Used for rendered markdown previews — keeps tables, lists, etc. intact. */
export function extractContentSnippet(content: string, maxLines = 12): string {
  let body = content;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }
  const lines = body.split('\n');
  return lines.slice(0, maxLines).join('\n').trim();
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
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')             // markdown links
    .replace(/^[-*+]\s+/gm, '')                           // list bullets
    .replace(/^\d+\.\s+/gm, '')                           // ordered lists
    .replace(/^>\s+/gm, '')                               // blockquotes
    .replace(/\n+/g, ' ')                                 // collapse newlines
    .trim();

  if (!body) return '';
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength).trimEnd() + '…';
}
