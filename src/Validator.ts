import { App, TFile } from 'obsidian';
import type { BreadTrailSettings } from './settings';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationViolation {
  file: TFile;
  severity: ValidationSeverity;
  ruleId: string;
  message: string;
  /** Optional: the field / path name this violation is about, for grouping. */
  context?: string;
}

export class Validator {
  constructor(
    private app: App,
    private settings: BreadTrailSettings,
  ) {}

  /** Validate a single file. Returns all violations found. */
  validateFile(file: TFile): ValidationViolation[] {
    const violations: ValidationViolation[] = [];
    this.checkSequenceFields(file, violations);
    this.checkChainIntegrity(file, violations);
    return violations;
  }

  /** Validate all markdown files in the vault. Returns a map from file path → violations. */
  validateVault(): Map<string, ValidationViolation[]> {
    const results = new Map<string, ValidationViolation[]>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const violations = this.validateFile(file);
      if (violations.length > 0) {
        results.set(file.path, violations);
      }
    }
    return results;
  }

  // ── Rule 1: sequence-field integrity ─────────────────────────────────────

  /** If a note uses a configured field (e.g. `journal: [[Parent]]`) it must also have
   *  at least one `next.journal` or `prev.journal` frontmatter link. */
  private checkSequenceFields(file: TFile, violations: ValidationViolation[]) {
    if (this.settings.sequenceFields.length === 0) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return;

    for (const fieldName of this.settings.sequenceFields) {
      // Does the note use this field as a parent link?
      const hasParentField = fieldName in fm && fm[fieldName] !== undefined && fm[fieldName] !== null;
      if (!hasParentField) continue;

      // Does it have at least one next.{field} or prev.{field} link?
      const hasSequenceLink = cache?.frontmatterLinks?.some((link) => {
        const parts = link.key.split('.');
        return (
          parts.length >= 2 &&
          (parts[0] === 'next' || parts[0] === 'prev') &&
          parts.slice(1).join('.') === fieldName
        );
      }) ?? false;

      if (!hasSequenceLink) {
        violations.push({
          file,
          severity: 'warning',
          ruleId: 'sequence-field-missing-link',
          message: `Has \`${fieldName}\` parent link but no \`next.${fieldName}\` or \`prev.${fieldName}\` sequence link.`,
          context: fieldName,
        });
      }
    }
  }

  // ── Rule 2: next/prev chain integrity ────────────────────────────────────

  /** For every `next.X` or `prev.X` link in this file, check that:
   *  1. The target note exists.
   *  2. The target note has the reciprocal link pointing back. */
  private checkChainIntegrity(file: TFile, violations: ValidationViolation[]) {
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.frontmatterLinks ?? [];

    for (const link of links) {
      const parts = link.key.split('.');
      if (parts[0] !== 'next' && parts[0] !== 'prev') continue;

      const direction = parts[0] as 'next' | 'prev';
      const pathName = parts.slice(1).join('.'); // may be '' for plain next/prev

      // 1. Check the target exists
      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (!target) {
        violations.push({
          file,
          severity: 'error',
          ruleId: 'chain-broken-link',
          message: `\`${link.key}\` points to \`${link.link}\` which does not exist.`,
          context: pathName || direction,
        });
        continue;
      }

      // 2. Check reciprocal link in target
      const reciprocalDir = direction === 'next' ? 'prev' : 'next';
      const expectedKey = pathName ? `${reciprocalDir}.${pathName}` : reciprocalDir;
      const targetCache = this.app.metadataCache.getFileCache(target);
      const targetLinks = targetCache?.frontmatterLinks ?? [];

      const hasReciprocal = targetLinks.some((tl) => {
        const tParts = tl.key.split('.');
        const tDir = tParts[0];
        const tPath = tParts.slice(1).join('.');
        if (tDir !== reciprocalDir) return false;
        if (tPath !== pathName) return false;
        const resolved = this.app.metadataCache.getFirstLinkpathDest(tl.link, target.path);
        return resolved?.path === file.path;
      });

      // Also accept a plain prev/next (no sub-path) if pathName is empty
      const hasFallback = !pathName && targetCache?.frontmatter?.[reciprocalDir] !== undefined;

      if (!hasReciprocal && !hasFallback) {
        violations.push({
          file,
          severity: 'warning',
          ruleId: 'chain-missing-reciprocal',
          message: `\`${link.key}\` → \`${target.basename}\` but that note has no \`${expectedKey}\` pointing back.`,
          context: pathName || direction,
        });
      }
    }
  }
}

/** Group violations by ruleId for display purposes. */
export function groupByRule(violations: ValidationViolation[]): Map<string, ValidationViolation[]> {
  const grouped = new Map<string, ValidationViolation[]>();
  for (const v of violations) {
    const list = grouped.get(v.ruleId) ?? [];
    list.push(v);
    grouped.set(v.ruleId, list);
  }
  return grouped;
}

export const RULE_LABELS: Record<string, string> = {
  'sequence-field-missing-link': 'Missing sequence link',
  'chain-broken-link': 'Broken link',
  'chain-missing-reciprocal': 'Missing reciprocal',
};
