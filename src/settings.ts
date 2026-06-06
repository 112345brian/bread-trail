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
  /** Format used when writing NEW sequence links. 'flat' = next.journal: [[X]];
   *  'nested' = next: { journal: [[X]] } (requires Nested Properties plugin). */
  sequenceLinkFormat: 'flat' | 'nested';
  /** How much content to show per node in the graph switcher. */
  graphNodeDisplayMode: 'compact' | 'excerpt';
  /** Navigator sidebar mode persisted between sessions. */
  navigatorMode: 'context' | 'browser' | 'recent' | 'favorites';
  /** Whether the preview/excerpt panel is expanded in the navigator. */
  navigatorPreviewExpanded: boolean;
  /** When true, group-by treats [[link]] and bare text as the same value. */
  navigatorGroupByNormalizeLinks: boolean;
  /** Frontmatter field used for sorting in Recent view. Empty = use file mtime. */
  navigatorRecentSortField: string;
  /** Frontmatter properties shown in Recent view cards. */
  navigatorRecentMetaProperties: string[];
  /** Max number of notes shown in Recent view. */
  navigatorRecentLimit: number;
  /** Which toolbar buttons are visible in the navigator. */
  navigatorToolbarVisible: {
    context: boolean;
    browse: boolean;
    recent: boolean;
    favorites: boolean;
    preview: boolean;
    reset: boolean;
    goToActive: boolean;
  };
  /** What the browse view starts from. */
  navigatorBrowseStart: 'active' | 'note' | 'roots';
  /** File path of the start note when navigatorBrowseStart is 'note'. */
  navigatorBrowseStartNote: string;
  /** Frontmatter properties to show as metadata lines in each navigator card. */
  navigatorMetaProperties: string[];
  /** Frontmatter field to sort by when sort mode is 'field'. */
  navigatorSortField: string;
  /** Show a floating navigator panel on the left edge of each note. */
  floatingNavLeft: boolean;
  /** Show a floating navigator panel on the right edge of each note. */
  floatingNavRight: boolean;
  /** File paths pinned as favorites in settings (shown in Favorites view alongside bread-trail.favorite: true notes). */
  navigatorFavorites: string[];
  /** Frontmatter properties shown in Favorites view cards. */
  navigatorFavoritesMetaProperties: string[];
  /** Folder paths whose contents are hidden from the navigator (prefix match). */
  navigatorExcludeFolders: string[];
  /** Exact file paths to hide from the navigator. */
  navigatorExcludeFiles: string[];
  /** Frontmatter patterns that hide a note from the navigator.
   *  Format: "key" (any truthy value) or "key:value" (exact match). */
  navigatorExcludeFrontmatter: string[];
}

type DepthSettingKey = 'parentDepth' | 'childDepth';

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
  parentDepth: 2,
  childDepth: 1,
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
  sequenceLinkFormat: 'flat',
  graphNodeDisplayMode: 'compact',
  navigatorMode: 'context',
  navigatorPreviewExpanded: true,
  navigatorGroupByNormalizeLinks: true,
  navigatorRecentSortField: '',
  navigatorRecentMetaProperties: [],
  navigatorRecentLimit: 50,
  navigatorToolbarVisible: {
    context: true,
    browse: true,
    recent: true,
    favorites: true,
    preview: true,
    reset: true,
    goToActive: true,
  },
  navigatorBrowseStart: 'active',
  navigatorBrowseStartNote: '',
  navigatorMetaProperties: [],
  navigatorSortField: '',
  floatingNavLeft: false,
  floatingNavRight: false,
  navigatorFavorites: [],
  navigatorFavoritesMetaProperties: [],
  navigatorExcludeFolders: [],
  navigatorExcludeFiles: [],
  navigatorExcludeFrontmatter: [],
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
    sequenceLinkFormat: settings.sequenceLinkFormat === 'nested' ? 'nested' : 'flat',
    graphNodeDisplayMode: settings.graphNodeDisplayMode === 'excerpt' ? 'excerpt' : 'compact',
    navigatorMode: (settings.navigatorMode === 'browser' || settings.navigatorMode === 'recent' || settings.navigatorMode === 'favorites') ? settings.navigatorMode : 'context',
    navigatorPreviewExpanded: typeof settings.navigatorPreviewExpanded === 'boolean' ? settings.navigatorPreviewExpanded : true,
    navigatorGroupByNormalizeLinks: typeof settings.navigatorGroupByNormalizeLinks === 'boolean' ? settings.navigatorGroupByNormalizeLinks : true,
    navigatorRecentSortField: typeof settings.navigatorRecentSortField === 'string' ? settings.navigatorRecentSortField.trim() : '',
    navigatorRecentMetaProperties: Array.isArray(settings.navigatorRecentMetaProperties)
      ? (settings.navigatorRecentMetaProperties as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    navigatorRecentLimit: typeof settings.navigatorRecentLimit === 'number' && settings.navigatorRecentLimit > 0
      ? Math.floor(settings.navigatorRecentLimit) : 50,
    navigatorToolbarVisible: (() => {
      const raw = settings.navigatorToolbarVisible;
      const def = DEFAULT_SETTINGS.navigatorToolbarVisible;
      const b = (key: keyof typeof def) =>
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>)[key] === 'boolean'
          ? (raw as Record<string, unknown>)[key] as boolean
          : def[key];
      return { context: b('context'), browse: b('browse'), recent: b('recent'), favorites: b('favorites'), preview: b('preview'), reset: b('reset'), goToActive: b('goToActive') };
    })(),
    navigatorBrowseStart: (settings.navigatorBrowseStart === 'note' || settings.navigatorBrowseStart === 'roots')
      ? settings.navigatorBrowseStart : 'active',
    navigatorBrowseStartNote: typeof settings.navigatorBrowseStartNote === 'string'
      ? settings.navigatorBrowseStartNote.trim() : '',
    navigatorMetaProperties: Array.isArray(settings.navigatorMetaProperties)
      ? (settings.navigatorMetaProperties as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    navigatorSortField: typeof settings.navigatorSortField === 'string' ? settings.navigatorSortField.trim() : '',
    floatingNavLeft: typeof settings.floatingNavLeft === 'boolean' ? settings.floatingNavLeft : false,
    floatingNavRight: typeof settings.floatingNavRight === 'boolean' ? settings.floatingNavRight : false,
    navigatorFavorites: Array.isArray(settings.navigatorFavorites)
      ? (settings.navigatorFavorites as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorFavoritesMetaProperties: Array.isArray(settings.navigatorFavoritesMetaProperties)
      ? (settings.navigatorFavoritesMetaProperties as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    navigatorExcludeFolders: Array.isArray(settings.navigatorExcludeFolders)
      ? (settings.navigatorExcludeFolders as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorExcludeFiles: Array.isArray(settings.navigatorExcludeFiles)
      ? (settings.navigatorExcludeFiles as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorExcludeFrontmatter: Array.isArray(settings.navigatorExcludeFrontmatter)
      ? (settings.navigatorExcludeFrontmatter as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
  };
}

type TabId = 'general' | 'graph' | 'navigator' | 'sequences' | 'validation';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general',    label: 'General' },
  { id: 'graph',      label: 'Graph' },
  { id: 'navigator',  label: 'Navigator' },
  { id: 'sequences',  label: 'Sequences' },
  { id: 'validation', label: 'Validation' },
];

class BreadTrailSettingTab extends PluginSettingTab {
  private activeTab: TabId = 'general';

  constructor(app: App, private plugin: BreadTrail) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabBar = containerEl.createDiv('bread-trail-settings-tabs');
    for (const tab of TABS) {
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: 'bread-trail-settings-tab' + (this.activeTab === tab.id ? ' is-active' : ''),
      });
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    }

    // ── Tab content ───────────────────────────────────────────────────────
    const content = containerEl.createDiv('bread-trail-settings-content');
    switch (this.activeTab) {
      case 'general':    this.renderGeneral(content); break;
      case 'graph':      this.renderGraph(content); break;
      case 'navigator':  this.renderNavigator(content); break;
      case 'sequences':  this.renderSequences(content); break;
      case 'validation': this.renderValidation(content); break;
    }
  }

  // ── General ───────────────────────────────────────────────────────────────

  private renderGeneral(el: HTMLElement) {
    new Setting(el).setName('Startup').setHeading();

    new Setting(el)
      .setName('Show startup notice')
      .setDesc('Show a notice when Obsidian loads confirming that breadcrumbs was detected.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showStartupNotice);
        t.onChange(async (v) => { this.plugin.settings.showStartupNotice = v; await this.save(); });
      });

    new Setting(el).setName('Quick switcher').setHeading();
    this.depthSetting(el, 'Parent depth', 'Maximum parent levels to traverse.', 'parentDepth');
    this.depthSetting(el, 'Child depth',  'Maximum child levels to traverse.',  'childDepth');
  }

  // ── Graph ─────────────────────────────────────────────────────────────────

  private renderGraph(el: HTMLElement) {
    new Setting(el).setName('Labels & metadata').setHeading();

    new Setting(el)
      .setName('Label property')
      .setDesc('Frontmatter property used for node labels. Uses the first value when it\'s a list. Leave blank to use filenames.')
      .addText((t) => {
        t.setPlaceholder('Aliases');
        t.setValue(this.plugin.settings.graphLabelProperty);
        t.onChange(async (v) => { this.plugin.settings.graphLabelProperty = v.trim(); await this.save(); });
      });

    new Setting(el)
      .setName('Node metadata property')
      .setDesc('Frontmatter property shown as a subtitle on each node. Leave blank to hide.')
      .addText((t) => {
        t.setPlaceholder('Status, date, author');
        t.setValue(this.plugin.settings.graphNodeMetaProperty);
        t.onChange(async (v) => { this.plugin.settings.graphNodeMetaProperty = v.trim(); await this.save(); });
      });

    new Setting(el).setName('Display').setHeading();

    new Setting(el)
      .setName('Show preview pane')
      .setDesc('Split the graph into two columns: graph on the left, rendered note preview on the right.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.graphShowPreview);
        t.onChange(async (v) => { this.plugin.settings.graphShowPreview = v; await this.save(); });
      });

    new Setting(el)
      .setName('Show siblings')
      .setDesc('Include other children of the active note\'s direct parents.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showGraphSiblings);
        t.onChange(async (v) => { this.plugin.settings.showGraphSiblings = v; await this.save(); });
      });

    new Setting(el)
      .setName('Show sequence children')
      .setDesc('Include one level of children beneath visible previous and next notes.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showSequenceChildren);
        t.onChange(async (v) => { this.plugin.settings.showSequenceChildren = v; await this.save(); });
      });

    new Setting(el).setName('Interaction').setHeading();

    new Setting(el)
      .setName('Single click opens note')
      .setDesc('When on, one click opens the note immediately. When off, first click selects, second opens.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.graphSingleClickOpens);
        t.onChange(async (v) => { this.plugin.settings.graphSingleClickOpens = v; await this.save(); });
      });

    new Setting(el)
      .setName('Node sort order')
      .setDesc('Alphabetical sorts a–z. Importance places nodes with more descendants toward the center.')
      .addDropdown((d) => {
        d.addOption('alphabetical', 'Alphabetical');
        d.addOption('importance', 'Importance (by descendant count)');
        d.setValue(this.plugin.settings.graphNodeSortOrder);
        d.onChange(async (v) => {
          this.plugin.settings.graphNodeSortOrder = v as 'alphabetical' | 'importance';
          await this.save();
        });
      });
  }

  // ── Navigator ─────────────────────────────────────────────────────────────

  private renderNavigator(el: HTMLElement) {
    new Setting(el).setName('Cards').setHeading();

    new Setting(el)
      .setName('Metadata properties')
      .setDesc('Frontmatter keys to display below each card title, one per line. Iso date values are formatted automatically (e.g. 2026-01-05 → jan 5, 2026).')
      .addTextArea((t) => {
        t.setPlaceholder('Date\nstatus\ntags');
        t.setValue(this.plugin.settings.navigatorMetaProperties.join('\n'));
        t.inputEl.rows = 4;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorMetaProperties = v.split('\n').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el)
      .setName('Sort-by-field property')
      .setDesc('Frontmatter key to sort by when the "by field" sort mode is active.')
      .addText((t) => {
        t.setPlaceholder('Date-created');
        t.setValue(this.plugin.settings.navigatorSortField);
        t.onChange(async (v) => { this.plugin.settings.navigatorSortField = v.trim(); await this.save(); });
      });

    new Setting(el).setName('Toolbar buttons').setHeading();

    const toolbarDefs: { key: keyof BreadTrailSettings['navigatorToolbarVisible']; name: string; desc: string }[] = [
      { key: 'context',    name: 'Context mode',       desc: 'Show the Context button (breadcrumb hierarchy view).' },
      { key: 'browse',     name: 'Browse mode',         desc: 'Show the Browse button (folder drill-down view).' },
      { key: 'recent',     name: 'Recent mode',         desc: 'Show the Recent button (recently modified notes).' },
      { key: 'favorites',  name: 'Favorites mode',      desc: 'Show the Favorites button (starred and pinned notes).' },
      { key: 'preview',    name: 'Preview toggle',      desc: 'Show the eye button that hides/shows card previews.' },
      { key: 'reset',      name: 'Reset browser',       desc: 'Show the button that resets the browse view to its configured start.' },
      { key: 'goToActive', name: 'Go to active note',   desc: 'Show the button that jumps the browse view to the currently open note.' },
    ];

    for (const { key, name, desc } of toolbarDefs) {
      new Setting(el)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) => {
          t.setValue(this.plugin.settings.navigatorToolbarVisible[key]);
          t.onChange(async (v) => { this.plugin.settings.navigatorToolbarVisible[key] = v; await this.save(); });
        });
    }

    new Setting(el).setName('Floating navigator').setHeading();

    el.createEl('p', {
      text: 'A thin strip on the edge of each note that expands on hover, showing the same breadcrumb context as the sidebar. Clicking the pin button opens the sidebar on that side; closing the sidebar brings the float back.',
      cls: 'setting-item-description',
    });

    new Setting(el)
      .setName('Left edge panel')
      .setDesc('Show a floating navigator on the left edge of every note.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.floatingNavLeft);
        t.onChange(async (v) => { this.plugin.settings.floatingNavLeft = v; await this.save(); });
      });

    new Setting(el)
      .setName('Right edge panel')
      .setDesc('Show a floating navigator on the right edge of every note.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.floatingNavRight);
        t.onChange(async (v) => { this.plugin.settings.floatingNavRight = v; await this.save(); });
      });

    new Setting(el).setName('Favorites view').setHeading();

    new Setting(el)
      .setName('Pinned notes')
      .setDesc('File paths to always include in favorites, one per line. Notes with bread-trail.favorite: true in their frontmatter are also included automatically.')
      .addTextArea((t) => {
        t.setPlaceholder('Journal/Index.md\nProjects/MOC.md');
        t.setValue(this.plugin.settings.navigatorFavorites.join('\n'));
        t.inputEl.rows = 4;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorFavorites = v.split('\n').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el)
      .setName('Favorites metadata properties')
      .setDesc('Frontmatter keys shown in favorites view cards, one per line.')
      .addTextArea((t) => {
        t.setPlaceholder('Date\nstatus');
        t.setValue(this.plugin.settings.navigatorFavoritesMetaProperties.join('\n'));
        t.inputEl.rows = 3;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorFavoritesMetaProperties = v.split('\n').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el).setName('Recent view').setHeading();

    new Setting(el)
      .setName('Recent metadata properties')
      .setDesc('Frontmatter keys shown in recent view cards, one per line. Independent from the context/browse card properties.')
      .addTextArea((t) => {
        t.setPlaceholder('Date\nstatus');
        t.setValue(this.plugin.settings.navigatorRecentMetaProperties.join('\n'));
        t.inputEl.rows = 3;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorRecentMetaProperties = v.split('\n').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el)
      .setName('Recent sort field')
      .setDesc('Frontmatter date field to sort by in recent view. Leave blank to use file modification time.')
      .addText((t) => {
        t.setPlaceholder('Date-modified');
        t.setValue(this.plugin.settings.navigatorRecentSortField);
        t.onChange(async (v) => { this.plugin.settings.navigatorRecentSortField = v.trim(); await this.save(); });
      });

    new Setting(el)
      .setName('Recent view limit')
      .setDesc('Maximum number of notes to show in recent view.')
      .addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.min = '1';
        t.inputEl.step = '1';
        t.setValue(String(this.plugin.settings.navigatorRecentLimit));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) { this.plugin.settings.navigatorRecentLimit = n; await this.save(); }
        });
      });

    new Setting(el)
      .setName('Normalize links in group-by values')
      .setDesc('When on, [[index]] and index are treated as the same group. Applies whenever bread-trail.group-by is set on a note.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.navigatorGroupByNormalizeLinks);
        t.onChange(async (v) => { this.plugin.settings.navigatorGroupByNormalizeLinks = v; await this.save(); });
      });

    new Setting(el).setName('Browse mode').setHeading();

    new Setting(el)
      .setName('Start view')
      .setDesc('What the browse view shows when you first open it.')
      .addDropdown((d) => {
        d.addOption('active', 'Parent of active note');
        d.addOption('note',   'Specific note');
        d.addOption('roots',  'Vault roots (top of hierarchy)');
        d.setValue(this.plugin.settings.navigatorBrowseStart);
        d.onChange(async (v) => {
          this.plugin.settings.navigatorBrowseStart = v as 'active' | 'note' | 'roots';
          await this.save();
          this.display();
        });
      });

    if (this.plugin.settings.navigatorBrowseStart === 'note') {
      new Setting(el)
        .setName('Start note path')
        .setDesc('Path to the note browse opens at. Example: Journal/Index.md')
        .addText((t) => {
          t.setPlaceholder('Journal/Index.md');
          t.setValue(this.plugin.settings.navigatorBrowseStartNote);
          t.onChange(async (v) => { this.plugin.settings.navigatorBrowseStartNote = v.trim(); await this.save(); });
        });
    }

    new Setting(el).setName('Exclusions').setHeading();

    new Setting(el)
      .setName('Exclude folders')
      .setDesc('Comma-separated folder paths. Notes inside are hidden from the navigator.')
      .addTextArea((t) => {
        t.setPlaceholder('Templates, archive/old');
        t.setValue(this.plugin.settings.navigatorExcludeFolders.join(', '));
        t.inputEl.rows = 2;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorExcludeFolders = v.split(',').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el)
      .setName('Exclude files')
      .setDesc('Comma-separated exact file paths to hide.')
      .addTextArea((t) => {
        t.setPlaceholder('Daily Notes/Index.md, MOC.md');
        t.setValue(this.plugin.settings.navigatorExcludeFiles.join(', '));
        t.inputEl.rows = 2;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorExcludeFiles = v.split(',').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el)
      .setName('Exclude by frontmatter')
      .setDesc('"key" hides notes where that key is truthy. "key:value" matches exactly. Example: type:template, draft, status:archived')
      .addTextArea((t) => {
        t.setPlaceholder('Type:template, draft, status:archived');
        t.setValue(this.plugin.settings.navigatorExcludeFrontmatter.join(', '));
        t.inputEl.rows = 2;
        t.onChange(async (v) => {
          this.plugin.settings.navigatorExcludeFrontmatter = v.split(',').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });
  }

  // ── Sequences ─────────────────────────────────────────────────────────────

  private renderSequences(el: HTMLElement) {
    new Setting(el).setName('Link format').setHeading();

    new Setting(el)
      .setName('Write links in nested YAML form')
      .setDesc('When on, new links use nested objects (next: { journal: [[X]] }) instead of flat keys (next.journal: [[X]]). Requires the Nested Properties plugin. Existing links always keep their current form.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.sequenceLinkFormat === 'nested');
        t.onChange(async (v) => { this.plugin.settings.sequenceLinkFormat = v ? 'nested' : 'flat'; await this.save(); });
      });
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private renderValidation(el: HTMLElement) {
    el.createEl('p', {
      text: 'Rules run when you open the validation report (command palette) and show inline banners in reading view.',
      cls: 'setting-item-description',
    });

    new Setting(el).setName('Conflict detection').setHeading();

    new Setting(el)
      .setName('Require path names when edges conflict')
      .setDesc('When a note has 2+ edges of the same type, every one must use a named sub-path (e.g. Next.journal). A plain "next" alongside any other next-type link is always flagged.')
      .addDropdown((d) => {
        d.addOption('error', 'Error'); d.addOption('warning', 'Warning'); d.addOption('off', 'Off');
        d.setValue(this.plugin.settings.validationRules.requireSpecificity.severity);
        d.onChange(async (v) => { this.plugin.settings.validationRules.requireSpecificity.severity = v as ValidationSeverity; await this.save(); });
      });

    new Setting(el)
      .setName('Edge types to check for conflicts')
      .setDesc('Comma-separated bc edge-type names. Only these types trigger the conflict rule.')
      .addText((t) => {
        t.setPlaceholder('Next, prev');
        t.setValue(this.plugin.settings.validationRules.requireSpecificity.edgeTypes.join(', '));
        t.onChange(async (v) => {
          this.plugin.settings.validationRules.requireSpecificity.edgeTypes = v.split(',').map((s) => s.trim()).filter(Boolean);
          await this.save();
        });
      });

    new Setting(el).setName('Link integrity').setHeading();

    new Setting(el)
      .setName('Flag broken sequence links')
      .setDesc('Report next.X or prev.X links whose target note does not exist in the vault.')
      .addDropdown((d) => {
        d.addOption('error', 'Error'); d.addOption('warning', 'Warning'); d.addOption('off', 'Off');
        d.setValue(this.plugin.settings.validationRules.brokenLinks.severity);
        d.onChange(async (v) => { this.plugin.settings.validationRules.brokenLinks.severity = v as ValidationSeverity; await this.save(); });
      });

    new Setting(el)
      .setName('Flag missing reciprocal links')
      .setDesc('Report when next.X: [[B]] exists but B has no prev.X back, or vice versa.')
      .addDropdown((d) => {
        d.addOption('warning', 'Warning'); d.addOption('error', 'Error'); d.addOption('off', 'Off');
        d.setValue(this.plugin.settings.validationRules.missingReciprocal.severity);
        d.onChange(async (v) => { this.plugin.settings.validationRules.missingReciprocal.severity = v as ValidationSeverity; await this.save(); });
      });

    new Setting(el)
      .setName('Only check named paths for reciprocals')
      .setDesc('When on, the reciprocal rule only applies to dot-notation links (next.X). Plain next/prev are ignored.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.validationRules.missingReciprocal.namedPathsOnly);
        t.onChange(async (v) => { this.plugin.settings.validationRules.missingReciprocal.namedPathsOnly = v; await this.save(); });
      });

    new Setting(el).setName('Hierarchy').setHeading();

    new Setting(el)
      .setName('Flag cross-hierarchy sequences')
      .setDesc('Warn when a next/prev link connects notes with no shared "up" parent. Root notes and parentless notes are exempt.')
      .addDropdown((d) => {
        d.addOption('warning', 'Warning'); d.addOption('error', 'Error'); d.addOption('off', 'Off');
        d.setValue(this.plugin.settings.validationRules.crossHierarchy.severity);
        d.onChange(async (v) => { this.plugin.settings.validationRules.crossHierarchy.severity = v as ValidationSeverity; await this.save(); });
      });
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async save() {
    await this.plugin.saveSettings().catch((err) => {
      console.error('Failed to save Bread Trail settings:', err);
    });
  }

  private depthSetting(el: HTMLElement, name: string, description: string, key: DepthSettingKey) {
    new Setting(el)
      .setName(name)
      .setDesc(`${description} Set to 0 to disable.`)
      .addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.min = '0';
        t.inputEl.step = '1';
        t.setValue(String(this.plugin.settings[key]));
        t.onChange(async (v) => {
          const parsed = Number.parseInt(v, 10);
          this.plugin.settings[key] = Number.isNaN(parsed) ? DEFAULT_SETTINGS[key] : Math.max(0, parsed);
          await this.save();
        });
      });
  }
}

export function addSettingTab(plugin: BreadTrail) {
  plugin.addSettingTab(new BreadTrailSettingTab(plugin.app, plugin));
}
