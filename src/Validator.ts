import { App, TFile } from 'obsidian';
import type { BreadTrailSettings, ValidationSeverity } from './settings';

export type { ValidationSeverity };

export interface ValidationViolation {
  file: TFile;
  severity: ValidationSeverity;
  ruleId: string;
  message: string;
  /** Field / path name for grouping and display. */
  context?: string;
  /** If present, the violation can be auto-fixed. */
  fix?: () => Promise<void>;
  /** Short label shown on the fix button. */
  fixLabel?: string;
}

export class Validator {
  constructor(
    private app: App,
    private settings: BreadTrailSettings,
  ) {}

  validateFile(file: TFile): ValidationViolation[] {
    const violations: ValidationViolation[] = [];
    this.checkRequireSpecificity(file, violations);
    this.checkBrokenLinks(file, violations);
    this.checkMissingReciprocal(file, violations);
    this.checkCrossHierarchy(file, violations);
    return violations;
  }

  validateVault(): Map<string, ValidationViolation[]> {
    const results = new Map<string, ValidationViolation[]>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const violations = this.validateFile(file);
      if (violations.length > 0) results.set(file.path, violations);
    }
    return results;
  }

  // ── Rule: require specificity ─────────────────────────────────────────────

  private checkRequireSpecificity(file: TFile, violations: ValidationViolation[]) {
    const { severity, edgeTypes } = this.settings.validationRules.requireSpecificity;
    if (severity === 'off' || edgeTypes.length === 0) return;

    const links = this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

    for (const edgeType of edgeTypes) {
      const matching = links.filter((l) => l.key.split('.')[0] === edgeType);
      if (matching.length < 2) continue;

      const hasPlain = matching.some((l) => !l.key.includes('.'));
      if (hasPlain) {
        violations.push({
          file,
          severity,
          ruleId: 'require-specificity',
          message: `Has ${matching.length} \`${edgeType}\`-type links but at least one uses the plain \`${edgeType}\` key without a path name. Use \`${edgeType}.name\` for every link when there are multiple.`,
          context: edgeType,
        });
        continue;
      }

      const subpathCount = new Map<string, number>();
      for (const l of matching) {
        const subpath = l.key.split('.').slice(1).join('.');
        subpathCount.set(subpath, (subpathCount.get(subpath) ?? 0) + 1);
      }
      for (const [subpath, count] of subpathCount) {
        if (count > 1) {
          violations.push({
            file,
            severity,
            ruleId: 'require-specificity',
            message: `Has ${count} links with the same key \`${edgeType}.${subpath}\`. Each sub-path must be unique.`,
            context: `${edgeType}.${subpath}`,
          });
        }
      }
    }
  }

  // ── Rule: broken links ────────────────────────────────────────────────────

  private checkBrokenLinks(file: TFile, violations: ValidationViolation[]) {
    const { severity } = this.settings.validationRules.brokenLinks;
    if (severity === 'off') return;

    const links = this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

    for (const link of links) {
      const prefix = link.key.split('.')[0];
      if (prefix !== 'next' && prefix !== 'prev') continue;

      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (!target) {
        violations.push({
          file,
          severity,
          ruleId: 'broken-link',
          message: `\`${link.key}: [[${link.link}]]\` — target note not found in vault.`,
          context: link.key,
        });
      }
    }
  }

  // ── Rule: missing reciprocal ──────────────────────────────────────────────
  //
  // If A has `next.X: [[B]]`, B must have `prev.X: [[A]]`.
  // When both notes share a common `up` parent, the fix also offers to rename
  // the path to the parent's normalised name (e.g. prev.0 → prev.hypothesis-test).

  private checkMissingReciprocal(file: TFile, violations: ValidationViolation[]) {
    const { severity, namedPathsOnly } = this.settings.validationRules.missingReciprocal;
    if (severity === 'off') return;

    const links = this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

    for (const link of links) {
      const parts = link.key.split('.');
      const prefix = parts[0];
      if (prefix !== 'next' && prefix !== 'prev') continue;

      const subpath = parts.slice(1).join('.');
      if (namedPathsOnly && !subpath) continue;

      const direction = prefix;
      const recipDir = direction === 'next' ? 'prev' : 'next';
      const expectedKey = subpath ? `${recipDir}.${subpath}` : recipDir;

      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (!target) continue; // caught by broken-links rule

      const targetLinks = this.app.metadataCache.getFileCache(target)?.frontmatterLinks ?? [];
      const hasReciprocal = targetLinks.some((tl) => {
        if (tl.key !== expectedKey) return false;
        const resolved = this.app.metadataCache.getFirstLinkpathDest(tl.link, target.path);
        return resolved?.path === file.path;
      });

      if (!hasReciprocal) {
        const fixTarget = target;
        const sourceFile = file;

        // Check if both notes share a common `up` parent and the current
        // sub-path doesn't already match the parent name.
        const sharedParentName = this.findSharedParentName(sourceFile, fixTarget);
        const suggestedSubpath = sharedParentName ?? subpath;
        const useRename = !!sharedParentName && subpath !== sharedParentName;

        const finalSourceKey = `${direction}.${suggestedSubpath}`;
        const finalRecipKey = `${recipDir}.${suggestedSubpath}`;
        const recipValue = `[[${sourceFile.basename}]]`;

        let message: string;
        let fixLabel: string;

        if (useRename) {
          message = `\`${link.key}: [[${fixTarget.basename}]]\` — no \`${expectedKey}\` in that note. Both notes share parent "${sharedParentName}" — consider renaming to \`${finalSourceKey}\` / \`${finalRecipKey}\`.`;
          fixLabel = `Rename to \`${finalSourceKey}\` and add \`${finalRecipKey}\` in ${fixTarget.basename}`;
        } else {
          message = `\`${link.key}: [[${fixTarget.basename}]]\` — that note has no \`${expectedKey}\` pointing back.`;
          fixLabel = `Add \`${finalRecipKey}: ${recipValue}\` to ${fixTarget.basename}`;
        }

        violations.push({
          file,
          severity,
          ruleId: 'missing-reciprocal',
          message,
          context: link.key,
          fixLabel,
          fix: async () => {
            if (useRename) {
              // Rename the key in the source file and add the reciprocal in the target
              const oldKey = link.key;
              const oldValue = `[[${fixTarget.basename}]]`;
              await this.app.fileManager.processFrontMatter(sourceFile, (fm) => {
                if (oldKey in fm) delete fm[oldKey];
                fm[finalSourceKey] = oldValue;
              });
              await this.app.fileManager.processFrontMatter(fixTarget, (fm) => {
                fm[finalRecipKey] = recipValue;
              });
            } else {
              // Just add the missing reciprocal with the existing key
              await this.app.fileManager.processFrontMatter(fixTarget, (fm) => {
                fm[finalRecipKey] = recipValue;
              });
            }
          },
        });
      }
    }
  }

  // ── Rule: cross-hierarchy sequence ───────────────────────────────────────
  //
  // A next/prev link between two notes whose `up` parents are entirely disjoint.
  // Only fires when BOTH notes have at least one `up` link — root/parentless
  // notes are intentionally exempt so you can freely sequence across top-level
  // topics without noise.

  private checkCrossHierarchy(file: TFile, violations: ValidationViolation[]) {
    const { severity } = this.settings.validationRules.crossHierarchy;
    if (severity === 'off') return;

    const sourceParents = this.getUpTargetPaths(file);
    if (sourceParents.size === 0) return; // source has no parent — exempt

    const links = this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

    for (const link of links) {
      const prefix = link.key.split('.')[0];
      if (prefix !== 'next' && prefix !== 'prev') continue;

      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (!target) continue; // caught by broken-links rule

      const targetParents = this.getUpTargetPaths(target);
      if (targetParents.size === 0) continue; // target has no parent — exempt

      // Check for any overlap
      let shared = false;
      for (const p of sourceParents) {
        if (targetParents.has(p)) { shared = true; break; }
      }
      if (shared) continue;

      const sourceNames = this.getParentBasenames(sourceParents);
      const targetNames = this.getParentBasenames(targetParents);

      violations.push({
        file,
        severity,
        ruleId: 'cross-hierarchy',
        message: `\`${link.key}: [[${target.basename}]]\` — no shared parent. This note is under ${sourceNames}; that note is under ${targetNames}.`,
        context: link.key,
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Returns the normalised basename of a shared `up` parent if both files
   *  have one, otherwise null. */
  private findSharedParentName(fileA: TFile, fileB: TFile): string | null {
    const parentsA = this.getUpTargetPaths(fileA);
    const parentsB = this.getUpTargetPaths(fileB);
    for (const path of parentsA) {
      if (parentsB.has(path)) {
        const parent = this.app.vault.getAbstractFileByPath(path);
        if (parent instanceof TFile) return this.toPathName(parent.basename);
      }
    }
    return null;
  }

  /** Collect all resolved file paths reachable via any `up` or `up.*` frontmatter link. */
  private getUpTargetPaths(file: TFile): Set<string> {
    const paths = new Set<string>();
    const cache = this.app.metadataCache.getFileCache(file);

    // Wikilinks in frontmatterLinks (covers `up: [[X]]` and `up.foo: [[X]]`)
    for (const link of cache?.frontmatterLinks ?? []) {
      if (link.key !== 'up' && !link.key.startsWith('up.')) continue;
      const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (resolved) paths.add(resolved.path);
    }

    // Plain string value (`up: Note Name` without brackets)
    const raw = cache?.frontmatter?.['up'];
    if (typeof raw === 'string') {
      const stripped = raw.replace(/^\[\[|\]\]$/g, '').trim();
      const resolved = this.app.metadataCache.getFirstLinkpathDest(stripped, file.path);
      if (resolved) paths.add(resolved.path);
    }

    return paths;
  }

  /** Convert a note basename to a lowercase hyphenated path-name token.
   *  e.g. "Hypothesis Test" → "hypothesis-test" */
  private toPathName(basename: string): string {
    return basename
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Return a human-readable comma-separated list of basenames for a set of file paths. */
  private getParentBasenames(paths: Set<string>): string {
    const names = Array.from(paths).map((p) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? `"${f.basename}"` : `"${p}"`;
    });
    if (names.length === 0) return '(none)';
    if (names.length === 1) return names[0] ?? '(none)';
    const last = names.pop();
    return `${names.join(', ')} and ${last}`;
  }
}

export const RULE_LABELS: Record<string, string> = {
  'require-specificity': 'Conflict — path name required',
  'broken-link': 'Broken link',
  'missing-reciprocal': 'Missing reciprocal',
  'cross-hierarchy': 'Cross-hierarchy sequence',
};
