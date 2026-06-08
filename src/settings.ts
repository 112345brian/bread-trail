import { App, Platform, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type BreadTrail from './main';

export type ValidationSeverity = 'error' | 'warning' | 'off';

export type PinboardSectionType = 'favorites' | 'current' | 'recents' | 'roots' | 'tag' | 'filter';

/** What a two-finger gesture does in the tile explorer. */
export type ExplorerGestureAction = 'off' | 'parent' | 'children' | 'home';

export interface PinboardSection {
  type: PinboardSectionType;
  enabled: boolean;
  /** Max items shown. 0 = use global default. Only meaningful for 'recents'/'tag'/'filter'. */
  limit: number;
  /** Tag name (for 'tag') or "key:value" / "key" pattern (for 'filter'). Unused for other types. */
  param: string;
}

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
  graphNodeMetaProperty: string;
  showGraphSiblings: boolean;
  showSequenceChildren: boolean;
  graphSingleClickOpens: boolean;
  graphNodeSortOrder: 'alphabetical' | 'importance';
  graphShowPreview: boolean;
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
    goToActive: boolean;
  };
  /** Home note — the anchor the sidebar browser and explorer modal start from.
   *  When set, overrides navigatorBrowseStart. */
  homeNote: string;
  /** Dashboard/shell note that should browse from homepageTarget instead of its own BC parent. */
  homepageNote: string;
  /** Folder or note to show when the active note is the homepage. */
  homepageTarget: string;
  /** What the browse view starts from. */
  navigatorBrowseStart: 'active' | 'roots';
  /** Frontmatter properties to show as metadata lines in each navigator card. */
  navigatorMetaProperties: string[];
  /** Frontmatter field to sort by when sort mode is 'field'. */
  navigatorSortField: string;
  /** Show a floating navigator panel on the left edge of each note. */
  floatingNavLeft: boolean;
  /** Show a floating navigator panel on the right edge of each note. */
  floatingNavRight: boolean;
  /** On mobile: which sidebar the navigator auto-opens into on startup. */
  mobileNavigatorSide: 'left' | 'right';
  /** On mobile: pinch-out (two-finger spread) anywhere to open the tile explorer. */
  mobileTapExplorer: boolean;
  /** What the pinch-in (contract) gesture does. */
  explorerGesturePinch: ExplorerGestureAction;
  /** What the spread-out (expand) gesture does. */
  explorerGestureExpand: ExplorerGestureAction;
  /** In the tile explorer, double-tap a folder tile to open its note directly.
   *  When off, a long-press (500 ms) is required instead. */
  explorerDoubleTapToOpen: boolean;
  /** Replace the file-path breadcrumb in note headers with BC ancestor links. */
  headerBreadcrumbs: boolean;
  /** How many ancestor levels to show (0 = all). */
  headerBreadcrumbsDepth: number;
  /** File paths pinned as favorites in settings (shown in Favorites view alongside bread-trail.favorite: true notes). */
  navigatorFavorites: string[];
  /** Frontmatter properties shown in Favorites view cards. */
  navigatorFavoritesMetaProperties: string[];
  /** File path of a note whose BC children (up: [[this]]) are treated as favorites.
   *  Leave blank to disable. Works alongside bread-trail.favorite: true and pinned paths. */
  navigatorFavoritesParentNote: string;
  /** Show a Favorites section on the home (roots) view in browser mode. */
  navigatorHomeShowFavorites: boolean;
  /** Show a Recent section on the home (roots) view in browser mode. */
  navigatorHomeShowRecents: boolean;
  /** Max recent notes shown in the home view Recent section. */
  navigatorHomeRecentsCount: number;
  /** When on, notes whose first 3 body lines contain a transcluded Base (![[*.base]])
   *  or an inline base/dataview block are shown without a preview excerpt. */
  navigatorSkipPreviewForBases: boolean;
  /** Number of content lines shown in the card preview (default 3). */
  navigatorPreviewLines: number;
  /** Display layout for note lists: list, 2-column grid, or compact 3-column grid. */
  navigatorLayoutMode: 'list' | 'grid-small' | 'grid-large';
  /** Minimum tile width (px) in the tile explorer grid. Smaller = more columns. */
  explorerTileMinWidth: number;
  /** Where the tile explorer opens when no homepage target applies. */
  explorerDefaultStart: 'active-parent' | 'roots';
  /** Folder paths whose contents are hidden from the navigator (prefix match). */
  navigatorExcludeFolders: string[];
  /** Exact file paths to hide from the navigator. */
  navigatorExcludeFiles: string[];
  /** Frontmatter patterns that hide a note from the navigator.
   *  Format: "key" (any truthy value) or "key:value" (exact match). */
  navigatorExcludeFrontmatter: string[];
  /** Ordered list of sections shown in the Pinboard (Favorites) sidebar panel. */
  navigatorPinboardSections: PinboardSection[];
  /** Show a Siblings section in Context mode (notes sharing the same parent). */
  navigatorShowSiblings: boolean;
  /** Persist the navigator's follow-mode state across reloads. */
  navigatorFollowMode: boolean;
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
  graphNodeMetaProperty: '',
  showGraphSiblings: false,
  showSequenceChildren: true,
  graphSingleClickOpens: false,
  graphNodeSortOrder: 'alphabetical',
  graphShowPreview: false,
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
    goToActive: true,
  },
  homeNote: '',
  homepageNote: '',
  homepageTarget: '',
  navigatorBrowseStart: 'active',
  navigatorMetaProperties: [],
  navigatorSortField: '',
  floatingNavLeft: false,
  floatingNavRight: false,
  mobileNavigatorSide: 'left',
  mobileTapExplorer: true,
  explorerGesturePinch: 'parent',
  explorerGestureExpand: 'children',
  explorerDoubleTapToOpen: false,
  headerBreadcrumbs: false,
  headerBreadcrumbsDepth: 0,
  navigatorFavorites: [],
  navigatorFavoritesMetaProperties: [],
  navigatorFavoritesParentNote: '',
  navigatorHomeShowFavorites: true,
  navigatorHomeShowRecents: true,
  navigatorHomeRecentsCount: 10,
  navigatorSkipPreviewForBases: true,
  navigatorPreviewLines: 3,
  navigatorLayoutMode: 'grid-large',
  explorerTileMinWidth: 90,
  explorerDefaultStart: 'active-parent',
  navigatorExcludeFolders: [],
  navigatorExcludeFiles: [],
  navigatorExcludeFrontmatter: [],
  navigatorPinboardSections: [
    { type: 'favorites', enabled: true,  limit: 0,  param: '' },
    { type: 'current',   enabled: true,  limit: 0,  param: '' },
    { type: 'recents',   enabled: true,  limit: 10, param: '' },
    { type: 'roots',     enabled: false, limit: 0,  param: '' },
  ],
  navigatorShowSiblings: false,
  navigatorFollowMode: false,
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
    graphNodeMetaProperty: typeof settings.graphNodeMetaProperty === 'string' ? settings.graphNodeMetaProperty.trim() : DEFAULT_SETTINGS.graphNodeMetaProperty,
    showGraphSiblings: typeof settings.showGraphSiblings === 'boolean' ? settings.showGraphSiblings : DEFAULT_SETTINGS.showGraphSiblings,
    showSequenceChildren: typeof settings.showSequenceChildren === 'boolean' ? settings.showSequenceChildren : DEFAULT_SETTINGS.showSequenceChildren,
    graphSingleClickOpens: typeof settings.graphSingleClickOpens === 'boolean' ? settings.graphSingleClickOpens : DEFAULT_SETTINGS.graphSingleClickOpens,
    graphNodeSortOrder: settings.graphNodeSortOrder === 'importance' ? 'importance' : 'alphabetical',
    graphShowPreview: typeof settings.graphShowPreview === 'boolean' ? settings.graphShowPreview : DEFAULT_SETTINGS.graphShowPreview,
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
      return { context: b('context'), browse: b('browse'), recent: b('recent'), favorites: b('favorites'), goToActive: b('goToActive') };
    })(),
    homeNote: typeof settings.homeNote === 'string' ? settings.homeNote.trim() : '',
    homepageNote: typeof settings.homepageNote === 'string' ? settings.homepageNote.trim() : '',
    homepageTarget: typeof settings.homepageTarget === 'string'
      ? settings.homepageTarget.trim()
      : typeof (settings as { homepageDirectory?: unknown }).homepageDirectory === 'string'
        ? (settings as { homepageDirectory: string }).homepageDirectory.trim()
      : typeof (settings as { homepageRootFolder?: unknown }).homepageRootFolder === 'string'
        ? (settings as { homepageRootFolder: string }).homepageRootFolder.trim()
        : '',
    navigatorBrowseStart: settings.navigatorBrowseStart === 'roots' ? 'roots' : 'active',
    navigatorMetaProperties: Array.isArray(settings.navigatorMetaProperties)
      ? (settings.navigatorMetaProperties as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    navigatorSortField: typeof settings.navigatorSortField === 'string' ? settings.navigatorSortField.trim() : '',
    floatingNavLeft: typeof settings.floatingNavLeft === 'boolean' ? settings.floatingNavLeft : false,
    floatingNavRight: typeof settings.floatingNavRight === 'boolean' ? settings.floatingNavRight : false,
    mobileNavigatorSide: settings.mobileNavigatorSide === 'right' ? 'right' : 'left',
    mobileTapExplorer: typeof settings.mobileTapExplorer === 'boolean' ? settings.mobileTapExplorer : true,
    explorerGesturePinch: (['off', 'parent', 'children', 'home'] as ExplorerGestureAction[]).includes(settings.explorerGesturePinch as ExplorerGestureAction) ? settings.explorerGesturePinch as ExplorerGestureAction : 'parent',
    explorerGestureExpand: (['off', 'parent', 'children', 'home'] as ExplorerGestureAction[]).includes(settings.explorerGestureExpand as ExplorerGestureAction) ? settings.explorerGestureExpand as ExplorerGestureAction : 'children',
    explorerDoubleTapToOpen: typeof settings.explorerDoubleTapToOpen === 'boolean' ? settings.explorerDoubleTapToOpen : false,
    headerBreadcrumbs: typeof settings.headerBreadcrumbs === 'boolean' ? settings.headerBreadcrumbs : false,
    headerBreadcrumbsDepth: typeof settings.headerBreadcrumbsDepth === 'number' ? settings.headerBreadcrumbsDepth : 0,
    navigatorFavorites: Array.isArray(settings.navigatorFavorites)
      ? (settings.navigatorFavorites as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorFavoritesMetaProperties: Array.isArray(settings.navigatorFavoritesMetaProperties)
      ? (settings.navigatorFavoritesMetaProperties as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    navigatorFavoritesParentNote: typeof settings.navigatorFavoritesParentNote === 'string' ? settings.navigatorFavoritesParentNote.trim() : '',
    navigatorHomeShowFavorites: typeof settings.navigatorHomeShowFavorites === 'boolean' ? settings.navigatorHomeShowFavorites : true,
    navigatorHomeShowRecents: typeof settings.navigatorHomeShowRecents === 'boolean' ? settings.navigatorHomeShowRecents : true,
    navigatorHomeRecentsCount: typeof settings.navigatorHomeRecentsCount === 'number' && settings.navigatorHomeRecentsCount > 0 ? Math.floor(settings.navigatorHomeRecentsCount) : 10,
    navigatorSkipPreviewForBases: typeof settings.navigatorSkipPreviewForBases === 'boolean' ? settings.navigatorSkipPreviewForBases : true,
    navigatorPreviewLines: typeof settings.navigatorPreviewLines === 'number' && settings.navigatorPreviewLines > 0 ? Math.floor(settings.navigatorPreviewLines) : 3,
    navigatorLayoutMode: (settings.navigatorLayoutMode === 'list' ? 'list' : settings.navigatorLayoutMode === 'grid-small' ? 'grid-small' : 'grid-large'),
    explorerTileMinWidth: typeof settings.explorerTileMinWidth === 'number' && settings.explorerTileMinWidth >= 60 ? Math.floor(settings.explorerTileMinWidth) : 90,
    explorerDefaultStart: (() => {
      if (settings.explorerDefaultStart === 'roots') return 'roots';
      // Migrate from removed explorerStartMode setting
      const legacy = (settings as { explorerStartMode?: unknown }).explorerStartMode;
      if (legacy === 'roots') return 'roots';
      return 'active-parent';
    })(),
    navigatorExcludeFolders: Array.isArray(settings.navigatorExcludeFolders)
      ? (settings.navigatorExcludeFolders as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorExcludeFiles: Array.isArray(settings.navigatorExcludeFiles)
      ? (settings.navigatorExcludeFiles as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorExcludeFrontmatter: Array.isArray(settings.navigatorExcludeFrontmatter)
      ? (settings.navigatorExcludeFrontmatter as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((s) => s.trim())
      : [],
    navigatorPinboardSections: (() => {
      const fixedTypes: PinboardSectionType[] = ['favorites', 'current', 'recents', 'roots'];
      const allValidTypes: PinboardSectionType[] = [...fixedTypes, 'tag', 'filter'];
      const raw = settings.navigatorPinboardSections;
      if (Array.isArray(raw) && raw.length > 0) {
        const seenFixed = new Set<PinboardSectionType>();
        const result: PinboardSection[] = [];
        for (const item of raw as unknown[]) {
          if (!item || typeof item !== 'object') continue;
          const s = item as Record<string, unknown>;
          const type = s['type'] as PinboardSectionType;
          if (!allValidTypes.includes(type)) continue;
          // Fixed types: deduplicate; tag/filter: allow multiples (deduplicate by param)
          if (fixedTypes.includes(type)) {
            if (seenFixed.has(type)) continue;
            seenFixed.add(type);
          }
          const param = typeof s['param'] === 'string' ? s['param'].trim() : '';
          result.push({
            type,
            enabled: typeof s['enabled'] === 'boolean' ? s['enabled'] : true,
            limit:   typeof s['limit']   === 'number' && s['limit'] >= 0
              ? Math.floor(s['limit']) : 0,
            param,
          });
        }
        // Append any missing fixed types at the end (disabled)
        for (const type of fixedTypes) {
          if (!seenFixed.has(type)) {
            const def = DEFAULT_SETTINGS.navigatorPinboardSections.find((s) => s.type === type);
            result.push(def ?? { type, enabled: false, limit: 0, param: '' });
          }
        }
        return result;
      }
      return DEFAULT_SETTINGS.navigatorPinboardSections.map((s) => ({ ...s }));
    })(),
    navigatorShowSiblings: typeof settings.navigatorShowSiblings === 'boolean' ? settings.navigatorShowSiblings : false,
    navigatorFollowMode: typeof settings.navigatorFollowMode === 'boolean' ? settings.navigatorFollowMode : false,
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
  private advancedMode = false;

  constructor(app: App, private plugin: BreadTrail) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabBar = containerEl.createDiv('bread-trail-settings-tabs');
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', 'Breadtrail settings');
    for (const tab of TABS) {
      const isActive = this.activeTab === tab.id;
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: 'bread-trail-settings-tab' + (isActive ? ' is-active' : ''),
      });
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(isActive));
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
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
    new Setting(el).setName('Quick switcher').setHeading();
    this.depthSetting(el, 'Parent depth', 'Maximum parent levels to traverse.', 'parentDepth');
    this.depthSetting(el, 'Child depth',  'Maximum child levels to traverse.',  'childDepth');

  }

  // ── Graph ─────────────────────────────────────────────────────────────────

  private renderGraph(el: HTMLElement) {
    new Setting(el).setName('Labels & metadata').setHeading();

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

    new Setting(el)
      .setName('Node display')
      .setDesc('Choose whether graph nodes show compact labels or note excerpts by default.')
      .addDropdown((d) => {
        d.addOption('compact', 'Compact');
        d.addOption('excerpt', 'Excerpt');
        d.setValue(this.plugin.settings.graphNodeDisplayMode);
        d.onChange(async (v) => {
          this.plugin.settings.graphNodeDisplayMode = v as 'compact' | 'excerpt';
          await this.save();
        });
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
    // ── Advanced toggle ───────────────────────────────────────────────────
    new Setting(el)
      .setName('Advanced settings')
      .setDesc('Show granular options for power users.')
      .addToggle((t) => {
        t.setValue(this.advancedMode);
        t.onChange((v) => { this.advancedMode = v; this.display(); });
      });

    // ── Home note ─────────────────────────────────────────────────────────
    new Setting(el).setName('Home').setHeading();

    new Setting(el)
      .setName('Home')
      .setDesc('Default folder or index note for the sidebar browser. Use homepage note and homepage target to override what appears while viewing your homepage.')
      .addText((t) => {
        t.setPlaceholder('TOC/index.md');
        t.setValue(this.plugin.settings.homeNote);
        t.onChange(async (v) => {
          this.plugin.settings.homeNote = v.trim();
          await this.save();
        });
      });

    new Setting(el)
      .setName('Homepage note')
      .setDesc('Dashboard note that should browse from the homepage target instead of from its own breadcrumb parent. Leave blank to auto-detect cssclasses: homepage.')
      .addText((t) => {
        t.setPlaceholder('TOC/Home.md');
        t.setValue(this.plugin.settings.homepageNote);
        t.onChange(async (v) => {
          this.plugin.settings.homepageNote = v.trim();
          await this.save();
        });
      });

    new Setting(el)
      .setName('Homepage target')
      .setDesc('Folder or note to show when the active note is the homepage. Folders show parentless roots inside them; notes show their children.')
      .addText((t) => {
        t.setPlaceholder('ARCHIVE or TOC/index.md');
        t.setValue(this.plugin.settings.homepageTarget);
        t.onChange(async (v) => {
          this.plugin.settings.homepageTarget = v.trim();
          await this.save();
        });
      });

    // ── Cards ─────────────────────────────────────────────────────────────
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
      .setName('Note layout')
      .setDesc('How notes are displayed in the navigator.')
      .addDropdown((d) => {
        d.addOption('grid-large', 'Grid — large (2 columns)');
        d.addOption('grid-small', 'Grid — small (3 columns)');
        d.addOption('list', 'List');
        d.setValue(this.plugin.settings.navigatorLayoutMode);
        d.onChange(async (v: string) => {
          this.plugin.settings.navigatorLayoutMode = v as 'list' | 'grid-small' | 'grid-large';
          await this.save();
        });
      });

    new Setting(el)
      .setName('Show siblings in context mode')
      .setDesc('Adds a siblings section showing other notes that share the same parent as the active note.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.navigatorShowSiblings);
        t.onChange(async (v) => { this.plugin.settings.navigatorShowSiblings = v; await this.save(); });
      });

    if (this.advancedMode) {
      new Setting(el)
        .setName('Sort-by-field property')
        .setDesc('Frontmatter key to sort by when the "by field" sort mode is active.')
        .addText((t) => {
          t.setPlaceholder('Date-created');
          t.setValue(this.plugin.settings.navigatorSortField);
          t.onChange(async (v) => { this.plugin.settings.navigatorSortField = v.trim(); await this.save(); });
        });

      new Setting(el)
        .setName('Preview lines')
        .setDesc('Number of content lines shown in card previews.')
        .addSlider((s) => {
          s.setLimits(1, 20, 1);
          s.setValue(this.plugin.settings.navigatorPreviewLines);
          s.setDynamicTooltip();
          s.onChange(async (v) => {
            this.plugin.settings.navigatorPreviewLines = v;
            this.plugin.getNavigatorView()?.clearSnippetCache();
            await this.save();
          });
        });

      new Setting(el)
        .setName('Skip preview for base notes')
        .setDesc('When on, notes whose first 3 lines contain a transcluded base (![[*.base]]) or an inline ```base block are shown without a preview excerpt.')
        .addToggle((t) => {
          t.setValue(this.plugin.settings.navigatorSkipPreviewForBases);
          t.onChange(async (v) => { this.plugin.settings.navigatorSkipPreviewForBases = v; await this.save(); });
        });
    }

    // ── Tile explorer ─────────────────────────────────────────────────────
    new Setting(el).setName('Tile explorer').setHeading();

    new Setting(el)
      .setName('Double-tap to open note')
      .setDesc('When on, double-tapping a folder tile opens the note directly. When off, a long-press (500 ms) is required. Single-tap always drills into the folder. Note: double-tap mode adds a ~300 ms delay to single-taps.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.explorerDoubleTapToOpen);
        t.onChange(async (v) => { this.plugin.settings.explorerDoubleTapToOpen = v; await this.save(); });
      });

    if (this.advancedMode) {
      new Setting(el)
        .setName('Default opening position')
        .setDesc('Where the tile explorer starts when no home note or homepage target applies.')
        .addDropdown((d) => {
          d.addOption('active-parent', "Active note's parent");
          d.addOption('roots', 'Vault roots');
          d.setValue(this.plugin.settings.explorerDefaultStart);
          d.onChange(async (v: string) => {
            this.plugin.settings.explorerDefaultStart = v as 'active-parent' | 'roots';
            await this.save();
          });
        });

      new Setting(el)
        .setName('Tile minimum width')
        .setDesc('Minimum width of each tile in the explorer grid (px). Smaller values fit more tiles per row.')
        .addSlider((s) => {
          s.setLimits(60, 160, 10);
          s.setValue(this.plugin.settings.explorerTileMinWidth);
          s.setDynamicTooltip();
          s.onChange(async (v) => { this.plugin.settings.explorerTileMinWidth = v; await this.save(); });
        });
    }

    // ── Floating navigator ─────────────────────────────────────────────────
    new Setting(el).setName('Floating navigator').setHeading();

    if (Platform.isMobile) {
      new Setting(el)
        .setName('Navigator sidebar side')
        .setDesc('Which side the navigator opens into on startup.')
        .addDropdown((d) => {
          d.addOption('left', 'Left');
          d.addOption('right', 'Right');
          d.setValue(this.plugin.settings.mobileNavigatorSide);
          d.onChange(async (v: string) => {
            this.plugin.settings.mobileNavigatorSide = v as 'left' | 'right';
            await this.save();
          });
        });

      new Setting(el)
        .setName('Gesture navigation')
        .setDesc('Enable two-finger gestures anywhere on screen to open the tile explorer.')
        .addToggle((t) => {
          t.setValue(this.plugin.settings.mobileTapExplorer);
          t.onChange(async (v) => { this.plugin.settings.mobileTapExplorer = v; await this.save(); });
        });

      const gestureOptions = (d: import('obsidian').DropdownComponent) => {
        d.addOption('off',      'Off — do nothing');
        d.addOption('parent',   'Open parent — show where the active note lives');
        d.addOption('children', 'Open children — show what\'s inside the active note');
        d.addOption('home',     'Open home — go to the configured home note');
      };

      new Setting(el)
        .setName('Pinch action')
        .setDesc('What the two-finger pinch-in (contract) gesture does.')
        .addDropdown((d) => {
          gestureOptions(d);
          d.setValue(this.plugin.settings.explorerGesturePinch);
          d.onChange(async (v) => {
            this.plugin.settings.explorerGesturePinch = v as import('./settings').ExplorerGestureAction;
            await this.save();
          });
        });

      new Setting(el)
        .setName('Spread action')
        .setDesc('What the two-finger spread-out (expand) gesture does.')
        .addDropdown((d) => {
          gestureOptions(d);
          d.setValue(this.plugin.settings.explorerGestureExpand);
          d.onChange(async (v) => {
            this.plugin.settings.explorerGestureExpand = v as import('./settings').ExplorerGestureAction;
            await this.save();
          });
        });
    } else {
      el.createEl('p', {
        text: 'A thin strip on the edge of each note that expands on hover, showing the same breadcrumb context as the sidebar. Clicking the pin opens the sidebar on that side; closing it brings the float back.',
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
    }

    // ── Header breadcrumbs ─────────────────────────────────────────────────
    new Setting(el)
      .setName('Header breadcrumbs')
      .setDesc('Replace the file-path breadcrumb in note headers with clickable bc ancestor links.')
      .addToggle((t) => {
        t.setValue(this.plugin.settings.headerBreadcrumbs);
        t.onChange(async (v) => {
          this.plugin.settings.headerBreadcrumbs = v;
          await this.save();
          this.plugin.updateAllHeaderBreadcrumbs();
        });
      });

    if (this.advancedMode) {
      new Setting(el)
        .setName('Breadcrumb depth')
        .setDesc('How many ancestor levels to show. 0 = all.')
        .addSlider((s) => {
          s.setLimits(0, 8, 1);
          s.setValue(this.plugin.settings.headerBreadcrumbsDepth);
          s.setDynamicTooltip();
          s.onChange(async (v) => {
            this.plugin.settings.headerBreadcrumbsDepth = v;
            await this.save();
            this.plugin.updateAllHeaderBreadcrumbs();
          });
        });
    }

    // ── Pinboard ───────────────────────────────────────────────────────────
    new Setting(el).setName('Pinboard').setHeading();

    el.createEl('p', {
      text: 'The ★ favorites sidebar tab is a fully customizable pinboard. Enable sections, reorder them with ↑ ↓, and configure each one below.',
      cls: 'setting-item-description',
    });

    this.renderPinboardSections(el);

    new Setting(el).setName('Favorites section').setHeading();

    new Setting(el)
      .setName('Pinned notes')
      .setDesc('File paths to always include in the favorites section, one per line. Notes with bread-trail.favorite: true in their frontmatter are also included automatically.')
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
      .setName('Favorites parent note')
      .setDesc('Path to a note whose bc children are treated as favorites. Leave blank to disable.')
      .addText((t) => {
        t.setPlaceholder('e.g. Meta/Frequent.md');
        t.setValue(this.plugin.settings.navigatorFavoritesParentNote);
        t.onChange(async (v) => { this.plugin.settings.navigatorFavoritesParentNote = v.trim(); await this.save(); });
      });

    if (this.advancedMode) {
      new Setting(el)
        .setName('Favorites metadata properties')
        .setDesc('Frontmatter keys shown in favorites section cards, one per line.')
        .addTextArea((t) => {
          t.setPlaceholder('Date\nstatus');
          t.setValue(this.plugin.settings.navigatorFavoritesMetaProperties.join('\n'));
          t.inputEl.rows = 3;
          t.onChange(async (v) => {
            this.plugin.settings.navigatorFavoritesMetaProperties = v.split('\n').map((s) => s.trim()).filter(Boolean);
            await this.save();
          });
        });
    }

    // ── Exclusions ─────────────────────────────────────────────────────────
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

    if (this.advancedMode) {
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

      // ── Toolbar buttons ───────────────────────────────────────────────────
      new Setting(el).setName('Toolbar buttons').setHeading();

      const toolbarDefs: { key: keyof BreadTrailSettings['navigatorToolbarVisible']; name: string; desc: string }[] = [
        { key: 'context',    name: 'Context mode',     desc: 'Show the Context button (breadcrumb hierarchy view).' },
        { key: 'browse',     name: 'Browse mode',       desc: 'Show the Browse button (folder drill-down view).' },
        { key: 'recent',     name: 'Recent mode',       desc: 'Show the Recent button (recently modified notes).' },
        { key: 'favorites',  name: 'Favorites mode',    desc: 'Show the Favorites / Pinboard button.' },
        { key: 'goToActive', name: 'Go to active note', desc: 'Show the button that jumps the browse view to the currently open note.' },
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

      // ── Recent view ───────────────────────────────────────────────────────
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

      // ── Home view ─────────────────────────────────────────────────────────
      new Setting(el).setName('Home view').setHeading();

      new Setting(el)
        .setName('Show favorites on home view')
        .setDesc('Display a favorites section at the bottom of the browser home (vault roots) view.')
        .addToggle((t) => {
          t.setValue(this.plugin.settings.navigatorHomeShowFavorites);
          t.onChange(async (v) => { this.plugin.settings.navigatorHomeShowFavorites = v; await this.save(); });
        });

      new Setting(el)
        .setName('Show recent notes on home view')
        .setDesc('Display a recent section at the bottom of the browser home (vault roots) view.')
        .addToggle((t) => {
          t.setValue(this.plugin.settings.navigatorHomeShowRecents);
          t.onChange(async (v) => { this.plugin.settings.navigatorHomeShowRecents = v; await this.save(); });
        });

      new Setting(el)
        .setName('Home view recent count')
        .setDesc('Max number of recent notes shown in the home view recent section.')
        .addSlider((s) => {
          s.setLimits(3, 30, 1);
          s.setValue(this.plugin.settings.navigatorHomeRecentsCount);
          s.setDynamicTooltip();
          s.onChange(async (v) => { this.plugin.settings.navigatorHomeRecentsCount = v; await this.save(); });
        });
    }
  }

  // ── Pinboard section reorder UI ───────────────────────────────────────────

  private renderPinboardSections(el: HTMLElement) {
    const DEFS: Record<string, { name: string; icon: string; desc: string }> = {
      favorites: { name: 'Favorites', icon: 'star',        desc: 'Starred and pinned notes'       },
      current:   { name: 'Current',   icon: 'folder-open', desc: 'BC children of the active note' },
      recents:   { name: 'Recent',    icon: 'clock',       desc: 'Recently modified notes'        },
      roots:     { name: 'Roots',     icon: 'git-branch',  desc: 'Top-level BC hierarchy nodes'   },
      tag:       { name: 'Tag',       icon: 'tag',         desc: 'Notes with a specific tag'      },
      filter:    { name: 'Filter',    icon: 'filter',      desc: 'Notes matching a frontmatter pattern' },
    };

    const fixedTypes = new Set<PinboardSectionType>(['favorites', 'current', 'recents', 'roots']);
    const sections = this.plugin.settings.navigatorPinboardSections;

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      if (!sec) continue;
      const def = DEFS[sec.type] ?? { name: sec.type, icon: 'file', desc: '' };
      const isCustom = !fixedTypes.has(sec.type);

      const displayName = isCustom
        ? (sec.param ? `${def.name}: ${sec.param}` : `${def.name} (set below)`)
        : def.name;

      const setting = new Setting(el)
        .setName(displayName)
        .setDesc(def.desc)
        .addToggle((t) => {
          t.setValue(sec.enabled);
          t.onChange(async (v) => { sec.enabled = v; await this.save(); });
        });

      // Move-up button
      setting.addExtraButton((btn) => {
        btn.setIcon('arrow-up').setTooltip('Move up');
        btn.extraSettingsEl.toggleClass('is-disabled', i === 0);
        btn.onClick(async () => {
          if (i === 0) return;
          const a = sections[i - 1], b = sections[i];
          if (!a || !b) return;
          sections[i - 1] = b; sections[i] = a;
          await this.save();
          this.display();
        });
      });

      // Move-down button
      setting.addExtraButton((btn) => {
        btn.setIcon('arrow-down').setTooltip('Move down');
        btn.extraSettingsEl.toggleClass('is-disabled', i === sections.length - 1);
        btn.onClick(async () => {
          if (i === sections.length - 1) return;
          const a = sections[i], b = sections[i + 1];
          if (!a || !b) return;
          sections[i] = b; sections[i + 1] = a;
          await this.save();
          this.display();
        });
      });

      // Delete button for custom (tag/filter) sections
      if (isCustom) {
        setting.addExtraButton((btn) => {
          btn.setIcon('trash').setTooltip('Remove section');
          btn.onClick(async () => {
            sections.splice(i, 1);
            await this.save();
            this.display();
          });
        });
      }

      // Icon prefix
      const iconSpan = setting.nameEl.createSpan({ cls: 'bt-pinboard-setting-icon' });
      setting.nameEl.prepend(iconSpan);
      setIcon(iconSpan, def.icon);

      // Param input for tag/filter
      if (sec.type === 'tag') {
        new Setting(el)
          .setName('Tag')
          .setDesc('Show notes tagged with this value (sub-tags included, e.g. Project also matches project/work).')
          .addText((t) => {
            t.setPlaceholder('Project');
            t.setValue(sec.param);
            t.onChange(async (v) => { sec.param = v.trim().replace(/^#/, ''); await this.save(); });
          });
      }

      if (sec.type === 'filter') {
        new Setting(el)
          .setName('Frontmatter filter')
          .setDesc('"key" matches any truthy value. "key:value" matches exactly. Example: status:active')
          .addText((t) => {
            t.setPlaceholder('Status:active');
            t.setValue(sec.param);
            t.onChange(async (v) => { sec.param = v.trim(); await this.save(); });
          });
      }

      // Limit for recents / tag / filter
      if (sec.type === 'recents' || sec.type === 'tag' || sec.type === 'filter') {
        new Setting(el)
          .setName('Limit')
          .setDesc('Max notes shown. 0 = show all.')
          .addText((t) => {
            t.inputEl.type = 'number';
            t.inputEl.min = '0';
            t.inputEl.step = '1';
            t.setValue(String(sec.limit > 0 ? sec.limit : (sec.type === 'recents' ? 10 : 0)));
            t.onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!isNaN(n) && n >= 0) { sec.limit = n; await this.save(); }
            });
          });
      }

      if (sec.type === 'current') {
        new Setting(el)
          .setName('Limit')
          .setDesc('Max children shown. 0 = show all.')
          .addText((t) => {
            t.inputEl.type = 'number';
            t.inputEl.min = '0';
            t.inputEl.step = '1';
            t.setValue(String(sec.limit));
            t.onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!isNaN(n) && n >= 0) { sec.limit = n; await this.save(); }
            });
          });
      }

    }

    // ── Add custom section buttons ─────────────────────────────────────────
    const addRow = el.createDiv({ cls: 'bt-pinboard-add-row' });

    const addBtn = (label: string, icon: string, type: 'tag' | 'filter') => {
      const btn = addRow.createEl('button', { text: label, cls: 'bt-pinboard-add-btn' });
      const iconEl = btn.createSpan({ cls: 'bt-pinboard-add-icon' });
      btn.prepend(iconEl);
      setIcon(iconEl, icon);
      btn.addEventListener('click', () => {
        void (async () => {
        sections.push({ type, enabled: true, limit: 0, param: '' });
        await this.save();
        this.display();
        })();
      });
    };

    addBtn('Add tag section', 'tag', 'tag');
    addBtn('Add filter section', 'filter', 'filter');
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
