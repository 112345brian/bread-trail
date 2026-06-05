import fs from 'fs';
import path from 'path';

const JOURNAL_DIR = '/Users/bri/MEGA/LIBRARY/OBSIDIAN/ARCHIVE/Journal';

// Extract a frontmatter value for an exact key (handles quoted wikilinks)
function getVal(fm, key) {
  // key may contain a literal dot, escape it for regex
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = fm.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'm'));
  if (!m) return null;
  // Strip surrounding quotes if present
  return m[1].trim().replace(/^"|"$/g, '');
}

// Remove a frontmatter line for an exact key
function removeLine(fm, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return fm.replace(new RegExp(`^${escaped}:.*\\n?`, 'm'), '');
}

const files = fs.readdirSync(JOURNAL_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => path.join(JOURNAL_DIR, f));

for (const filePath of files) {
  const original = fs.readFileSync(filePath, 'utf8');
  const match = original.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) { console.log(`SKIP (no frontmatter): ${path.basename(filePath)}`); continue; }

  let fm = match[1];
  const body = match[2];

  const nextJournal = getVal(fm, 'next.journal');
  const prevJournal = getVal(fm, 'prev.journal');

  if (!nextJournal && !prevJournal) {
    console.log(`SKIP (no journal links): ${path.basename(filePath)}`);
    continue;
  }

  const nextPlain = getVal(fm, 'next');
  const prevPlain = getVal(fm, 'prev');

  // Remove all flat keys being replaced
  if (nextJournal) fm = removeLine(fm, 'next.journal');
  if (prevJournal) fm = removeLine(fm, 'prev.journal');
  if (nextPlain)   fm = removeLine(fm, 'next');
  if (prevPlain)   fm = removeLine(fm, 'prev');

  // Append nested form
  if (nextJournal) fm += `\nnext:\n  journal: ${nextJournal}`;
  if (prevJournal) fm += `\nprev:\n  journal: ${prevJournal}`;

  // Clean up excess blank lines from removals
  fm = fm.replace(/\n{3,}/g, '\n\n').trim();

  fs.writeFileSync(filePath, `---\n${fm}\n---\n${body}`, 'utf8');
  console.log(`DONE: ${path.basename(filePath)}`);
  if (nextPlain && !nextPlain.includes(nextJournal?.replace(/^\[\[|\]\]$/g, '') ?? ''))
    console.log(`  ⚠  dropped stale next: ${nextPlain}`);
  if (prevPlain && !prevPlain.includes(prevJournal?.replace(/^\[\[|\]\]$/g, '') ?? ''))
    console.log(`  ⚠  dropped stale prev: ${prevPlain}`);
}

console.log('\nDone.');
