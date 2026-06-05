import { App, Modal, TFile, setIcon } from 'obsidian';
import { RULE_LABELS, Validator } from './Validator';
import type { ValidationViolation } from './Validator';
import type { BreadTrailSettings } from './settings';

export class ValidationModal extends Modal {
  private validator: Validator;

  constructor(app: App, settings: BreadTrailSettings) {
    super(app);
    this.validator = new Validator(app, settings);
  }

  onOpen() {
    this.titleEl.setText('Breadcrumb validation report');
    this.contentEl.addClass('bread-trail-validation-modal');

    const results = this.validator.validateVault();

    if (results.size === 0) {
      const okEl = this.contentEl.createDiv('bread-trail-validation-ok');
      setIcon(okEl.createSpan('bread-trail-validation-ok-icon'), 'check-circle');
      okEl.createSpan({ text: 'No violations found.' });
      return;
    }

    // Summary line
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const violations of results.values()) {
      for (const v of violations) {
        if (v.severity === 'error') totalErrors++;
        else totalWarnings++;
      }
    }

    const summaryEl = this.contentEl.createDiv('bread-trail-validation-summary');
    if (totalErrors > 0) {
      const errEl = summaryEl.createSpan('bread-trail-validation-count-error');
      setIcon(errEl.createSpan(), 'alert-circle');
      errEl.createSpan({ text: ` ${totalErrors} error${totalErrors !== 1 ? 's' : ''}` });
    }
    if (totalWarnings > 0) {
      const warnEl = summaryEl.createSpan('bread-trail-validation-count-warning');
      setIcon(warnEl.createSpan(), 'alert-triangle');
      warnEl.createSpan({ text: ` ${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}` });
    }
    summaryEl.createSpan({
      text: ` across ${results.size} file${results.size !== 1 ? 's' : ''}`,
      cls: 'bread-trail-validation-summary-files',
    });

    // Sort files: errors first, then by path
    const sortedEntries = Array.from(results.entries()).sort(([, aViols], [, bViols]) => {
      const aHasError = aViols.some((v) => v.severity === 'error') ? 0 : 1;
      const bHasError = bViols.some((v) => v.severity === 'error') ? 0 : 1;
      return aHasError - bHasError;
    });

    const listEl = this.contentEl.createDiv('bread-trail-validation-list');

    for (const [filePath, violations] of sortedEntries) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file) continue;

      const fileEl = listEl.createDiv('bread-trail-validation-file');

      // File header
      const headerEl = fileEl.createDiv('bread-trail-validation-file-header');
      const hasError = violations.some((v) => v.severity === 'error');
      setIcon(headerEl.createSpan('bread-trail-validation-file-icon'), hasError ? 'alert-circle' : 'alert-triangle');

      const nameEl = headerEl.createEl('button', {
        text: filePath,
        cls: 'bread-trail-validation-file-name',
      });
      nameEl.addEventListener('click', () => {
        const tfile = this.app.vault.getAbstractFileByPath(filePath);
        if (tfile instanceof TFile) {
          void this.app.workspace.getLeaf('tab').openFile(tfile);
          this.close();
        }
      });

      const badgeEl = headerEl.createSpan('bread-trail-validation-file-badge');
      badgeEl.setText(String(violations.length));

      // Violation rows
      const violsEl = fileEl.createDiv('bread-trail-validation-violations');
      for (const v of violations) {
        const rowEl = violsEl.createDiv(`bread-trail-validation-row bread-trail-validation-row-${v.severity}`);
        const iconEl = rowEl.createSpan('bread-trail-validation-row-icon');
        setIcon(iconEl, v.severity === 'error' ? 'alert-circle' : 'alert-triangle');

        const textEl = rowEl.createDiv('bread-trail-validation-row-text');
        const ruleEl = textEl.createSpan({
          text: RULE_LABELS[v.ruleId] ?? v.ruleId,
          cls: 'bread-trail-validation-rule-label',
        });
        if (v.context) {
          ruleEl.createSpan({ text: ` · ${v.context}`, cls: 'bread-trail-validation-rule-context' });
        }
        textEl.createDiv({ text: v.message, cls: 'bread-trail-validation-message' });
      }
    }
  }
}
