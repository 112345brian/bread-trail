
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
  /** On mobile: auto-open the navigator sidebar when the app starts. */
  mobileAutoOpenSidebar: boolean;
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
  mobileAutoOpenSidebar: false,
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
    mobileAutoOpenSidebar: typeof settings.mobileAutoOpenSidebar === 'boolean' ? settings.mobileAutoOpenSidebar : false,
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
      if (settings.explorerDefaultStart === 'active-parent') return 'active-parent';
      // Migrate from removed explorerStartMode setting (only when new field is absent)
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

