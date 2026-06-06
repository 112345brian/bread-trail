import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import {
  Sequencer,
  parseLinkChildrenConfig,
  findAllConfiguredParents,
  findStaleGlobalLinks,
  applyStaleGlobalRemoval,
  countChanges,
  countIgnored,
  type SequencePlan,
  type ChildResult,
  type StaleGlobalResult,
} from './Sequencer';

// ── Single-parent dry-run modal ───────────────────────────────────────────────

export class SequenceModal extends Modal {
  private plan: SequencePlan | null = null;
  private sequencer: Sequencer;

  constructor(
    app: App,
    private parent: TFile,
    private bc: BreadcrumbsPlugin,
    private settings: BreadTrailSettings,
  ) {
    super(app);
    this.sequencer = new Sequencer(app, bc, settings);
  }

  onOpen() {
    const { titleEl, contentEl } = this;
    titleEl.setText('Sequence children');
    contentEl.addClass('bread-trail-sequence-modal');

    const config = parseLinkChildrenConfig(this.app, this.parent);
    if (!config) {
      contentEl.createEl('p', {
        text: `"${this.parent.basename}" has no bread-trail.link-children config.`,
        cls: 'mod-warning',
      });
      return;
    }

    this.plan = this.sequencer.plan(this.parent, config);
    this.renderPlan(contentEl, this.plan);
  }

  private renderPlan(containerEl: HTMLElement, plan: SequencePlan) {
    const changes = countChanges(plan);
    const ignored = countIgnored(plan);
    const included = plan.results.filter((r) => !r.ignored).length;

    // Header
    const header = containerEl.createDiv('bread-trail-seq-header');
    header.createEl('strong', { text: plan.parent.basename });
    header.createSpan({
      text: ` — ${included} children sorted by ${plan.config.frontmatter.join(', then ')}` +
        (ignored > 0 ? `, ${ignored} ignored` : ''),
      cls: 'bread-trail-seq-header-desc',
    });

    if (changes === 0) {
      containerEl.createEl('p', {
        text: 'Everything is already up to date — no changes needed.',
        cls: 'bread-trail-seq-no-changes',
      });
      return;
    }

    // Child list
    const listEl = containerEl.createDiv('bread-trail-seq-list');
    for (const result of plan.results) {
      this.renderChild(listEl, result);
    }

    // Apply button
    const footer = containerEl.createDiv('bread-trail-seq-footer');
    footer.createSpan({ text: `${changes} change${changes !== 1 ? 's' : ''} pending`, cls: 'bread-trail-seq-change-count' });
    const applyBtn = footer.createEl('button', {
      text: 'Apply',
      cls: 'mod-cta bread-trail-seq-apply-btn',
    });
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.setText('Applying…');
      try {
        await this.sequencer.apply(plan);
        applyBtn.setText('✓ Done');
        new Notice(`Sequenced "${plan.parent.basename}" — ${changes} change${changes !== 1 ? 's' : ''} applied.`);
        this.close();
      } catch (err) {
        applyBtn.disabled = false;
        applyBtn.setText('Apply');
        new Notice('Sequencing failed — see console for details.');
        console.error('Bread Trail sequencer error:', err);
      }
    });
  }

  private renderChild(listEl: HTMLElement, result: ChildResult) {
    const row = listEl.createDiv('bread-trail-seq-child');

    if (result.ignored) {
      const iconEl = row.createSpan('bread-trail-seq-child-icon bread-trail-seq-child-icon-ignored');
      setIcon(iconEl, 'minus-circle');
      row.createSpan({ text: result.file.basename, cls: 'bread-trail-seq-child-name bread-trail-seq-child-name-ignored' });
      row.createSpan({ text: `ignored — ${result.ignoreReason}`, cls: 'bread-trail-seq-child-reason' });

      // Still show stale-link removals for ignored notes if any
      if (result.changes.length > 0) {
        const changesEl = row.createDiv('bread-trail-seq-child-changes');
        for (const change of result.changes) {
          renderChange(changesEl, change);
        }
      }
      renderWarnings(row, result.warnings);
      return;
    }

    const realChanges = result.changes.filter((c) => c.kind !== 'no-change');
    const iconEl = row.createSpan('bread-trail-seq-child-icon');
    setIcon(iconEl, realChanges.length > 0 ? 'pencil' : 'check');
    if (realChanges.length === 0) iconEl.addClass('bread-trail-seq-child-icon-ok');

    row.createSpan({ text: result.file.basename, cls: 'bread-trail-seq-child-name' });

    if (realChanges.length > 0) {
      const changesEl = row.createDiv('bread-trail-seq-child-changes');
      for (const change of result.changes) {
        renderChange(changesEl, change);
      }
    } else {
      row.createSpan({ text: 'no change', cls: 'bread-trail-seq-child-nochange' });
    }
    renderWarnings(row, result.warnings);
  }
}

// ── Vault-wide dry-run modal ──────────────────────────────────────────────────

export class SequenceAllModal extends Modal {
  private plans: SequencePlan[] = [];
  private sequencer: Sequencer;

  constructor(
    app: App,
    private bc: BreadcrumbsPlugin,
    private settings: BreadTrailSettings,
  ) {
    super(app);
    this.sequencer = new Sequencer(app, bc, settings);
  }

  onOpen() {
    const { titleEl, contentEl } = this;
    titleEl.setText('Sequence all configured parents');
    contentEl.addClass('bread-trail-sequence-modal');

    const parents = findAllConfiguredParents(this.app);
    if (parents.length === 0) {
      contentEl.createEl('p', {
        text: 'No notes found with bread-trail.link-children configured.',
        cls: 'mod-warning',
      });
      return;
    }

    this.plans = parents.map(({ file, config }) => this.sequencer.plan(file, config));

    const totalChanges = this.plans.reduce((s, p) => s + countChanges(p), 0);
    const totalIgnored = this.plans.reduce((s, p) => s + countIgnored(p), 0);

    // Summary
    const summary = contentEl.createDiv('bread-trail-seq-summary');
    summary.createSpan({ text: `${parents.length} configured parent${parents.length !== 1 ? 's' : ''}` });
    summary.createSpan({ text: ` · ${totalChanges} change${totalChanges !== 1 ? 's' : ''} pending` });
    if (totalIgnored > 0) summary.createSpan({ text: ` · ${totalIgnored} ignored` });

    // Per-parent sections
    for (const plan of this.plans) {
      const changes = countChanges(plan);
      const ignored = countIgnored(plan);
      const included = plan.results.filter((r) => !r.ignored).length;

      const section = contentEl.createDiv('bread-trail-seq-section');
      const sectionHeader = section.createDiv('bread-trail-seq-section-header');
      sectionHeader.createEl('strong', { text: plan.parent.basename });
      sectionHeader.createSpan({
        text: ` — ${included} children` +
          (ignored > 0 ? `, ${ignored} ignored` : '') +
          (changes === 0 ? ' — up to date' : ` — ${changes} change${changes !== 1 ? 's' : ''}`),
        cls: 'bread-trail-seq-header-desc',
      });

      if (changes > 0 || ignored > 0) {
        const listEl = section.createDiv('bread-trail-seq-list');
        for (const result of plan.results) {
          const realChanges = result.changes.filter((c) => c.kind !== 'no-change');
          if (!result.ignored && realChanges.length === 0) continue; // skip unchanged
          renderChildCompact(listEl, result);
        }
      }
    }

    if (totalChanges === 0) {
      contentEl.createEl('p', {
        text: 'Everything is already up to date.',
        cls: 'bread-trail-seq-no-changes',
      });
      return;
    }

    // Apply button
    const footer = contentEl.createDiv('bread-trail-seq-footer');
    footer.createSpan({ text: `${totalChanges} total change${totalChanges !== 1 ? 's' : ''} pending`, cls: 'bread-trail-seq-change-count' });
    const applyBtn = footer.createEl('button', {
      text: 'Apply all',
      cls: 'mod-cta bread-trail-seq-apply-btn',
    });
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.setText('Applying…');
      try {
        for (const plan of this.plans) {
          await this.sequencer.apply(plan);
        }
        applyBtn.setText('✓ Done');
        new Notice(`Sequencing complete — ${totalChanges} change${totalChanges !== 1 ? 's' : ''} applied.`);
        this.close();
      } catch (err) {
        applyBtn.disabled = false;
        applyBtn.setText('Apply all');
        new Notice('Sequencing failed — see console for details.');
        console.error('Bread Trail sequencer error:', err);
      }
    });
  }
}

// ── Remove stale bare-link modal ──────────────────────────────────────────────

export class RemoveStaleModal extends Modal {
  private results: StaleGlobalResult[] = [];

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { titleEl, contentEl } = this;
    titleEl.setText('Remove stale bare links');
    contentEl.addClass('bread-trail-sequence-modal');

    this.results = findStaleGlobalLinks(this.app);

    if (this.results.length === 0) {
      contentEl.createEl('p', {
        text: 'No stale bare next/prev links found — everything looks clean.',
        cls: 'bread-trail-seq-no-changes',
      });
      return;
    }

    const totalKeys = this.results.reduce((s, r) => s + r.removeKeys.length, 0);

    const summary = contentEl.createDiv('bread-trail-seq-summary');
    summary.createSpan({
      text: `${this.results.length} note${this.results.length !== 1 ? 's' : ''} with stale bare links`,
    });
    summary.createSpan({ text: ` · ${totalKeys} key${totalKeys !== 1 ? 's' : ''} to remove` });

    contentEl.createEl('p', {
      text: 'These notes have a plain next or prev key alongside a path-specific next.X / prev.X key. The bare key is the stale one.',
      cls: 'bread-trail-seq-stale-desc',
    });

    const listEl = contentEl.createDiv('bread-trail-seq-list');
    for (const result of this.results) {
      const row = listEl.createDiv('bread-trail-seq-child');
      const iconEl = row.createSpan('bread-trail-seq-child-icon');
      setIcon(iconEl, 'trash-2');
      iconEl.addClass('bread-trail-seq-child-icon-remove');
      row.createSpan({ text: result.file.basename, cls: 'bread-trail-seq-child-name' });
      const changesEl = row.createDiv('bread-trail-seq-child-changes');
      for (const key of result.removeKeys) {
        const el = changesEl.createDiv('bread-trail-seq-change bread-trail-seq-change-remove');
        el.createSpan({ text: 'remove', cls: 'bread-trail-seq-change-verb' });
        el.createSpan({ text: `  ${key}: ${result.currentValues[key] ?? ''}`, cls: 'bread-trail-seq-change-kv' });
      }
    }

    const footer = contentEl.createDiv('bread-trail-seq-footer');
    footer.createSpan({
      text: `${totalKeys} removal${totalKeys !== 1 ? 's' : ''} pending`,
      cls: 'bread-trail-seq-change-count',
    });
    const applyBtn = footer.createEl('button', {
      text: 'Remove all',
      cls: 'mod-cta bread-trail-seq-apply-btn',
    });
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.setText('Removing…');
      try {
        await applyStaleGlobalRemoval(this.app, this.results);
        applyBtn.setText('✓ Done');
        new Notice(
          `Removed ${totalKeys} stale bare link${totalKeys !== 1 ? 's' : ''} from ${this.results.length} note${this.results.length !== 1 ? 's' : ''}.`,
        );
        this.close();
      } catch (err) {
        applyBtn.disabled = false;
        applyBtn.setText('Remove all');
        new Notice('Removal failed — see console for details.');
        console.error('Bread Trail stale removal error:', err);
      }
    });
  }
}

// ── Shared renderers ──────────────────────────────────────────────────────────

function renderChange(container: HTMLElement, change: import('./Sequencer').FrontmatterChange) {
  if (change.kind === 'no-change') return;
  const el = container.createDiv(`bread-trail-seq-change bread-trail-seq-change-${change.kind}`);
  el.createSpan({ text: change.kind === 'add' ? 'add' : 'remove', cls: 'bread-trail-seq-change-verb' });
  el.createSpan({ text: `  ${change.key}: ${change.value}`, cls: 'bread-trail-seq-change-kv' });
}

function renderWarnings(container: HTMLElement, warnings: string[]) {
  if (!warnings || warnings.length === 0) return;
  const warningsEl = container.createDiv('bread-trail-seq-child-warnings');
  for (const w of warnings) {
    const el = warningsEl.createDiv('bread-trail-seq-child-warning');
    setIcon(el.createSpan('bread-trail-seq-child-warning-icon'), 'alert-triangle');
    el.createSpan({ text: w, cls: 'bread-trail-seq-child-warning-text' });
  }
}

function renderChildCompact(listEl: HTMLElement, result: ChildResult) {
  const row = listEl.createDiv('bread-trail-seq-child');

  if (result.ignored) {
    const iconEl = row.createSpan('bread-trail-seq-child-icon bread-trail-seq-child-icon-ignored');
    setIcon(iconEl, 'minus-circle');
    row.createSpan({ text: result.file.basename, cls: 'bread-trail-seq-child-name bread-trail-seq-child-name-ignored' });
    row.createSpan({ text: `ignored — ${result.ignoreReason}`, cls: 'bread-trail-seq-child-reason' });
    renderWarnings(row, result.warnings);
    return;
  }

  const realChanges = result.changes.filter((c) => c.kind !== 'no-change');
  const iconEl = row.createSpan('bread-trail-seq-child-icon');
  setIcon(iconEl, 'pencil');
  row.createSpan({ text: result.file.basename, cls: 'bread-trail-seq-child-name' });
  const changesEl = row.createDiv('bread-trail-seq-child-changes');
  for (const change of realChanges) {
    renderChange(changesEl, change);
  }
  renderWarnings(row, result.warnings);
}
