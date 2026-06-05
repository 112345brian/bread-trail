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
  //
  // If a note has 2+ frontmatter links whose key starts with the same BC edge
  // type (e.g. "next"), every one of those links must have a named sub-path
  // (next.journal, next.fiction, …). A plain "next" alongside ANY other
  // "next"-type link — whether plain or named — is a conflict.

  private checkRequireSpecificity(file: TFile, violations: ValidationViolation[]) {
    const { severity, edgeTypes } = this.settings.validationRules.requireSpecificity;
    if (severity === 'off' || edgeTypes.length === 0) return;

    const links = this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

    for (const edgeType of edgeTypes) {
      // Collect every link whose key prefix matches this edge type
      const matching = links.filter((l) => {
        const prefix = l.key.split('.')[0];
        return prefix === edgeType;
      });

      if (matching.length < 2) continue; // 0 or 1 → no conflict possible

      // Check if any of them lacks a sub-path (plain "next" with no dot)
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

      // All links have sub-paths — check for duplicate sub-paths (two next.journal pointing to different notes)
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
  //
  // Any next.X or prev.X link whose target note does not exist.

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
  // If A has `next.X: [[B]]`, then B must have `prev.X: [[A]]`, and vice versa.

  private checkMissingReciprocal(file: TFile, violations: ValidationViolation[]) {
    const { severity, namedPathsOnly } = this.settings.validationRules.missingReciprocal;
    if (severity === 'off') return;

    const links = this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];

    for (const link of links) {
      const parts = link.key.split('.');
      const prefix = parts[0];
      if (prefix !== 'next' && prefix !== 'prev') continue;

      const subpath = parts.slice(1).join('.');
      if (namedPathsOnly && !subpath) continue; // skip plain next/prev when option is set

      const direction = prefix as 'next' | 'prev';
      const recipDir = direction === 'next' ? 'prev' : 'next';
      const expectedKey = subpath ? `${recipDir}.${subpath}` : recipDir;

      const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (!target) continue; // already caught by broken-links rule

      const targetLinks = this.app.metadataCache.getFileCache(target)?.frontmatterLinks ?? [];
      const hasReciprocal = targetLinks.some((tl) => {
        if (tl.key !== expectedKey) return false;
        const resolved = this.app.metadataCache.getFirstLinkpathDest(tl.link, target.path);
        return resolved?.path === file.path;
      });

      if (!hasReciprocal) {
        violations.push({
          file,
          severity,
          ruleId: 'missing-reciprocal',
          message: `\`${link.key}: [[${target.basename}]]\` — that note has no \`${expectedKey}\` pointing back.`,
          context: link.key,
        });
      }
    }
  }
}

export const RULE_LABELS: Record<string, string> = {
  'require-specificity': 'Conflict — path name required',
  'broken-link': 'Broken link',
  'missing-reciprocal': 'Missing reciprocal',
};
