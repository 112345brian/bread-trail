import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { BreadcrumbsPlugin } from './main';
import type { BreadTrailSettings } from './settings';
import {
  Sequencer,
  parseLinkChildrenConfig,
  findAllConfiguredParents,
  countChanges,
  countIgnored,
  type SequencePlan,
  type ChildResult,
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

// ── Shared renderers ──────────────────────────────────────────────────────────

function renderChange(container: HTMLElement, change: import('./Sequencer').FrontmatterChange) {
  if (change.kind === 'no-change') return;
  const el = container.createDiv(`bread-trail-seq-change bread-trail-seq-change-${change.kind}`);
  el.createSpan({ text: change.kind === 'add' ? 'add' : 'remove', cls: 'bread-trail-seq-change-verb' });
  el.createSpan({ text: `  ${change.key}: ${change.value}`, cls: 'bread-trail-seq-change-kv' });
}

function renderChildCompact(listEl: HTMLElement, result: ChildResult) {
  const row = listEl.createDiv('bread-trail-seq-child');

  if (result.ignored) {
    const iconEl = row.createSpan('bread-trail-seq-child-icon bread-trail-seq-child-icon-ignored');
    setIcon(iconEl, 'minus-circle');
    row.createSpan({ text: result.file.basename, cls: 'bread-trail-seq-child-name bread-trail-seq-child-name-ignored' });
    row.createSpan({ text: `ignored — ${result.ignoreReason}`, cls: 'bread-trail-seq-child-reason' });
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
}
