import { App, PluginSettingTab, Setting } from 'obsidian';
import type BreadTrail from './main';

export type ValidationSeverity = 'error' | 'warning' | 'off';

export interface ValidationRules {
  /** When a note has 2+ edges of the same type (e.g. two `next`), all must
   *  use named sub-paths (dot notation). Plain `next: [[A]]` alongside any
   *  other `next`-type edge is a conflict. */
  requireSpecificity: {
    severity: ValidationSeverity;
    /** BC edge-type names to enforce this on. e.g. ["next", "prev"] */
    edgeTypes: string[];
  };
  /** `next.X` / `prev.X` links that point to a note that does not exist. */
  brokenLinks: {
    severity: ValidationSeverity;
  };
  /** `next.X: [[B]]` exists but B has no `prev.X` pointing back. */
  missingReciprocal: {
    severity: ValidationSeverity;
    /** Only enforce for named paths (dot notation). When false, plain next/prev are also checked. */
    namedPathsOnly: boolean;
  };
  /** A next/prev link connects two notes that share no common `up` parent.
   *  Both notes must have at least one `up` link for this rule to fire
   *  (root notes and parentless notes are exempt). */
  crossHierarchy: {
    severity: ValidationSeverity;
  };
}

export interface BreadTrailSettings {
  parentDepth: number;
  childDepth: number;
  previousDepth: number;
  nextDepth: number;
  graphLabelProperty: string;
  graphNodeMetaProperty: string;
  showGraphSiblings: boolean;
  showSequenceChildren: boolean;
  graphSingleClickOpens: boolean;
  graphNodeSortOrder: 'alphabetical' | 'importance';
  graphShowPreview: boolean;
  showStartupNotice: boolean;
  pathColors: Record<string, string>;
  validationRules: ValidationRules;
}

type DepthSettingKey = 'parentDepth' | 'childDepth' | 'previousDepth' | 'nextDepth';

export const DEFAULT_VALIDATION_RULES: ValidationRules = {
  requireSpecificity: {
    severity: 'error',
    edgeTypes: ['next', 'prev'],
  },
  brokenLinks: {
    severity: 'error',
  },
  missingReciprocal: {
    severity: 'warning',
    namedPathsOnly: false,
  },
  crossHierarchy: {
    severity: 'warning',
  },
};

export const DEFAULT_SETTINGS: BreadTrailSettings = {
  parentDepth: 3,
  childDepth: 3,
  previousDepth: 3,
  nextDepth: 3,
  graphLabelProperty: 'aliases',
  graphNodeMetaProperty: '',
  showGraphSiblings: false,
  showSequenceChildren: true,
  graphSingleClickOpens: false,
  graphNodeSortOrder: 'alphabetical',
  graphShowPreview: false,
  showStartupNotice: true,
  pathColors: {},
  validationRules: DEFAULT_VALIDATION_RULES,
};

function normalizeDepth(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function normalizeSeverity(value: unknown, fallback: ValidationSeverity): ValidationSeverity {
  return value === 'error' || value === 'warning' || value === 'off' ? value : fallback;
}

function normalizeValidationRules(raw: unknown): ValidationRules {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

  const spec = r['requireSpecificity'] && typeof r['requireSpecificity'] === 'object'
    ? r['requireSpecificity'] as Record<string, unknown>
    : {};
  const broken = r['brokenLinks'] && typeof r['brokenLinks'] === 'object'
    ? r['brokenLinks'] as Record<string, unknown>
    : {};
  const recip = r['missingReciprocal'] && typeof r['missingReciprocal'] === 'object'
    ? r['missingReciprocal'] as Record<string, unknown>
    : {};

  const cross = r['crossHierarchy'] && typeof r['crossHierarchy'] === 'object'
    ? r['crossHierarchy'] as Record<string, unknown>
    : {};

  return {
    requireSpecificity: {
      severity: normalizeSeverity(spec['severity'], DEFAULT_VALIDATION_RULES.requireSpecificity.severity),
      edgeTypes: Array.isArray(spec['edgeTypes'])
        ? (spec['edgeTypes'] as unknown[]).filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        : [...DEFAULT_VALIDATION_RULES.requireSpecificity.edgeTypes],
    },
    brokenLinks: {
      severity: normalizeSeverity(broken['severity'], DEFAULT_VALIDATION_RULES.brokenLinks.severity),
    },
    missingReciprocal: {
      severity: normalizeSeverity(recip['severity'], DEFAULT_VALIDATION_RULES.missingReciprocal.severity),
      namedPathsOnly: typeof recip['namedPathsOnly'] === 'boolean'
        ? recip['namedPathsOnly']
        : DEFAULT_VALIDATION_RULES.missingReciprocal.namedPathsOnly,
    },
    crossHierarchy: {
      severity: normalizeSeverity(cross['severity'], DEFAULT_VALIDATION_RULES.crossHierarchy.severity),
    },
  };
}

export function normalizeSettings(settings: Partial<BreadTrailSettings>): BreadTrailSettings {
  return {
    parentDepth: normalizeDepth(settings.parentDepth, DEFAULT_SETTINGS.parentDepth),
    childDepth: normalizeDepth(settings.childDepth, DEFAULT_SETTINGS.childDepth),
    previousDepth: normalizeDepth(settings.previousDepth, DEFAULT_SETTINGS.previousDepth),
    nextDepth: normalizeDepth(settings.nextDepth, DEFAULT_SETTINGS.nextDepth),
    graphLabelProperty: typeof settings.graphLabelProperty === 'string' ? settings.graphLabelProperty.trim() : DEFAULT_SETTINGS.graphLabelProperty,
    graphNodeMetaProperty: typeof settings.graphNodeMetaProperty === 'string' ? settings.graphNodeMetaProperty.trim() : DEFAULT_SETTINGS.graphNodeMetaProperty,
    showGraphSiblings: typeof settings.showGraphSiblings === 'boolean' ? settings.showGraphSiblings : DEFAULT_SETTINGS.showGraphSiblings,
    showSequenceChildren: typeof settings.showSequenceChildren === 'boolean' ? settings.showSequenceChildren : DEFAULT_SETTINGS.showSequenceChildren,
    graphSingleClickOpens: typeof settings.graphSingleClickOpens === 'boolean' ? settings.graphSingleClickOpens : DEFAULT_SETTINGS.graphSingleClickOpens,
    graphNodeSortOrder: settings.graphNodeSortOrder === 'importance' ? 'importance' : 'alphabetical',
    graphShowPreview: typeof settings.graphShowPreview === 'boolean' ? settings.graphShowPreview : DEFAULT_SETTINGS.graphShowPreview,
    showStartupNotice: typeof settings.showStartupNotice === 'boolean' ? settings.showStartupNotice : DEFAULT_SETTINGS.showStartupNotice,
    pathColors: settings.pathColors && typeof settings.pathColors === 'object' ? settings.pathColors : {},
    validationRules: normalizeValidationRules(settings.validationRules),
  };
}

class BreadTrailSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BreadTrail) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Startup')
      .setHeading();

    new Setting(containerEl)
      .setName('Show startup notice')
      .setDesc('Show a notice when Obsidian loads confirming that breadcrumbs was detected. Disable to silence startup messages.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showStartupNotice);
        toggle.onChange(async (value) => {
          this.plugin.settings.showStartupNotice = value;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Quick switcher traversal')
      .setHeading();

    this.addDepthSetting('Parent depth', 'Maximum number of parent levels to include.', 'parentDepth');
    this.addDepthSetting('Child depth', 'Maximum number of child levels to include.', 'childDepth');
    this.addDepthSetting('Previous depth', 'Maximum number of previous sequence notes to include.', 'previousDepth');
    this.addDepthSetting('Next depth', 'Maximum number of next sequence notes to include.', 'nextDepth');

    new Setting(containerEl)
      .setName('Graph view')
      .setHeading();

    new Setting(containerEl)
      .setName('Graph label property')
      .setDesc('Frontmatter property used for graph node labels. Uses the first value when the property is a list. Leave blank to use filenames.')
      .addText((text) => {
        text.setPlaceholder('Aliases');
        text.setValue(this.plugin.settings.graphLabelProperty);
        text.onChange(async (value) => {
          this.plugin.settings.graphLabelProperty = value.trim();
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Graph node metadata property')
      .setDesc('Frontmatter property to display as a subtitle on each node. Leave blank to show nothing.')
      .addText((text) => {
        text.setPlaceholder('E.g. status, date, author');
        text.setValue(this.plugin.settings.graphNodeMetaProperty);
        text.onChange(async (value) => {
          this.plugin.settings.graphNodeMetaProperty = value.trim();
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Show preview pane in graph')
      .setDesc('Split the graph view into two columns: graph on the left, a rendered preview of the selected note on the right.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.graphShowPreview);
        toggle.onChange(async (value) => {
          this.plugin.settings.graphShowPreview = value;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Show siblings in graph')
      .setDesc('Include other children of the active note\'s direct parents. Sibling links are inferred from the shared parent.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showGraphSiblings);
        toggle.onChange(async (value) => {
          this.plugin.settings.showGraphSiblings = value;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Show sequence children in graph')
      .setDesc('Include one level of children beneath visible previous and next notes.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showSequenceChildren);
        toggle.onChange(async (value) => {
          this.plugin.settings.showSequenceChildren = value;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Single click opens note in graph')
      .setDesc('When enabled, clicking a node immediately opens it. When disabled (default), first click selects, second click opens.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.graphSingleClickOpens);
        toggle.onChange(async (value) => {
          this.plugin.settings.graphSingleClickOpens = value;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Graph node sort order')
      .setDesc('Alphabetical sorts nodes a–z. Importance places nodes with more descendants toward the center.')
      .addDropdown((dropdown) => {
        dropdown.addOption('alphabetical', 'Alphabetical');
        dropdown.addOption('importance', 'Importance (by descendant count)');
        dropdown.setValue(this.plugin.settings.graphNodeSortOrder);
        dropdown.onChange(async (value) => {
          this.plugin.settings.graphNodeSortOrder = value as 'alphabetical' | 'importance';
          await this.save();
        });
      });

    // ── Validation ────────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName('Validation')
      .setHeading();

    containerEl.createEl('p', {
      text: 'Rules run when you open the validation report (command palette) and show inline banners in reading view.',
      cls: 'setting-item-description bread-trail-settings-section-desc',
    });

    // Rule: require specificity
    new Setting(containerEl)
      .setName('Require path names when multiple edges conflict')
      .setDesc(
        'When a note has 2 or more edges of the same type (e.g. two "next" links), every one of them must use a named sub-path (e.g. next.journal, next.fiction). A plain "next" alongside any other "next"-type link is always a conflict regardless of target.'
      )
      .addDropdown((dd) => {
        dd.addOption('error', 'Error');
        dd.addOption('warning', 'Warning');
        dd.addOption('off', 'Off');
        dd.setValue(this.plugin.settings.validationRules.requireSpecificity.severity);
        dd.onChange(async (value) => {
          this.plugin.settings.validationRules.requireSpecificity.severity = value as ValidationSeverity;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Edge types to check for conflicts')
      .setDesc('Comma-separated list of BC edge-type names. Only edges of these types trigger the conflict rule above.')
      .addText((text) => {
        text.setPlaceholder('next, prev');
        text.setValue(this.plugin.settings.validationRules.requireSpecificity.edgeTypes.join(', '));
        text.onChange(async (value) => {
          this.plugin.settings.validationRules.requireSpecificity.edgeTypes = value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          await this.save();
        });
      });

    // Rule: broken links
    new Setting(containerEl)
      .setName('Flag broken sequence links')
      .setDesc('Report next.X or prev.X frontmatter links whose target note does not exist in the vault.')
      .addDropdown((dd) => {
        dd.addOption('error', 'Error');
        dd.addOption('warning', 'Warning');
        dd.addOption('off', 'Off');
        dd.setValue(this.plugin.settings.validationRules.brokenLinks.severity);
        dd.onChange(async (value) => {
          this.plugin.settings.validationRules.brokenLinks.severity = value as ValidationSeverity;
          await this.save();
        });
      });

    // Rule: missing reciprocal
    new Setting(containerEl)
      .setName('Flag missing reciprocal links')
      .setDesc('Report when next.X: [[B]] exists but note B has no prev.X pointing back, or vice versa.')
      .addDropdown((dd) => {
        dd.addOption('warning', 'Warning');
        dd.addOption('error', 'Error');
        dd.addOption('off', 'Off');
        dd.setValue(this.plugin.settings.validationRules.missingReciprocal.severity);
        dd.onChange(async (value) => {
          this.plugin.settings.validationRules.missingReciprocal.severity = value as ValidationSeverity;
          await this.save();
        });
      });

    new Setting(containerEl)
      .setName('Only check named paths for reciprocals')
      .setDesc('When enabled, the reciprocal rule only applies to dot-notation links (next.X). Plain "next" and "prev" are ignored.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.validationRules.missingReciprocal.namedPathsOnly);
        toggle.onChange(async (value) => {
          this.plugin.settings.validationRules.missingReciprocal.namedPathsOnly = value;
          await this.save();
        });
      });

    // Rule: cross-hierarchy sequence
    new Setting(containerEl)
      .setName('Flag cross-hierarchy sequences')
      .setDesc('Warn when a next/prev link connects two notes that have no shared "up" parent. Both notes must have at least one "up" link for this to fire — root notes and parentless notes are exempt.')
      .addDropdown((dd) => {
        dd.addOption('warning', 'Warning');
        dd.addOption('error', 'Error');
        dd.addOption('off', 'Off');
        dd.setValue(this.plugin.settings.validationRules.crossHierarchy.severity);
        dd.onChange(async (value) => {
          this.plugin.settings.validationRules.crossHierarchy.severity = value as ValidationSeverity;
          await this.save();
        });
      });
  }

  private async save() {
    await this.plugin.saveSettings().catch((err) => {
      console.error('Failed to save Bread Trail settings:', err);
    });
  }

  private addDepthSetting(name: string, description: string, key: DepthSettingKey) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(`${description} Set to 0 to disable.`)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings[key]));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings[key] = Number.isNaN(parsed) ? DEFAULT_SETTINGS[key] : Math.max(0, parsed);
          await this.save();
        });
      });
  }
}

export function addSettingTab(plugin: BreadTrail) {
  plugin.addSettingTab(new BreadTrailSettingTab(plugin.app, plugin));
}
