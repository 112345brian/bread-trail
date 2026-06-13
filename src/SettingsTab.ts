import { App, Platform, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type BreadTrail from './main';
import type { BreadTrailSettings, PinboardSectionType, ValidationSeverity } from './settings';
import { DEFAULT_SETTINGS } from './settings';

const SEVERITY_OPTIONS: Record<string, string> = {
  'error':   'Error',
  'warning': 'Warning',
  'off':     'Off',
};

const GESTURE_OPTIONS: Record<string, string> = {
  'off':      'Off — do nothing',
  'parent':   'Open parent — show where the active note lives',
  'children': "Open children — show what's inside the active note",
  'home':     'Open home — go to the configured home note',
};

class BreadTrailSettingTab extends PluginSettingTab {
  private advancedMode = false;
  private _pinboardEl: HTMLElement | null = null;

  constructor(app: App, private plugin: BreadTrail) {
    super(app, plugin);
  }

  // ── Declarative API (1.13.0+) ─────────────────────────────────────────────

  override getControlValue(key: string): unknown {
    const s = this.plugin.settings;

    // Array keys
    if (key === 'navigatorMetaProperties')         return s.navigatorMetaProperties.join('\n');
    if (key === 'navigatorFavorites')              return s.navigatorFavorites.join('\n');
    if (key === 'navigatorFavoritesMetaProperties') return s.navigatorFavoritesMetaProperties.join('\n');
    if (key === 'navigatorRecentMetaProperties')   return s.navigatorRecentMetaProperties.join('\n');
    if (key === 'navigatorExcludeFolders')         return s.navigatorExcludeFolders.join(', ');
    if (key === 'navigatorExcludeFiles')           return s.navigatorExcludeFiles.join(', ');
    if (key === 'navigatorExcludeFrontmatter')     return s.navigatorExcludeFrontmatter.join(', ');

    // Nested validation keys (dot-path prefix vr.)
    if (key === 'vr.requireSpecificity.severity')  return s.validationRules.requireSpecificity.severity;
    if (key === 'vr.requireSpecificity.edgeTypes') return s.validationRules.requireSpecificity.edgeTypes.join(', ');
    if (key === 'vr.brokenLinks.severity')         return s.validationRules.brokenLinks.severity;
    if (key === 'vr.missingReciprocal.severity')   return s.validationRules.missingReciprocal.severity;
    if (key === 'vr.missingReciprocal.namedPathsOnly') return s.validationRules.missingReciprocal.namedPathsOnly;
    if (key === 'vr.crossHierarchy.severity')      return s.validationRules.crossHierarchy.severity;

    // Nested toolbar keys (toolbar.)
    if (key.startsWith('toolbar.')) {
      const k = key.slice(8) as keyof BreadTrailSettings['navigatorToolbarVisible'];
      return s.navigatorToolbarVisible[k];
    }

    const fallback = (s as unknown as Record<string, unknown>)[key];
    if (fallback === undefined) console.warn(`BreadTrail: getControlValue called with unknown key "${key}"`);
    return fallback;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    const splitLines  = (v: unknown) => String(v).split('\n').map(l => l.trim()).filter(Boolean);
    const splitCommas = (v: unknown) => String(v).split(',').map(l => l.trim()).filter(Boolean);

    // Array keys
    if (key === 'navigatorMetaProperties')         { s.navigatorMetaProperties = splitLines(value); }
    else if (key === 'navigatorFavorites')         { s.navigatorFavorites = splitLines(value); }
    else if (key === 'navigatorFavoritesMetaProperties') { s.navigatorFavoritesMetaProperties = splitLines(value); }
    else if (key === 'navigatorRecentMetaProperties') { s.navigatorRecentMetaProperties = splitLines(value); }
    else if (key === 'navigatorExcludeFolders')    { s.navigatorExcludeFolders = splitCommas(value); }
    else if (key === 'navigatorExcludeFiles')      { s.navigatorExcludeFiles = splitCommas(value); }
    else if (key === 'navigatorExcludeFrontmatter') { s.navigatorExcludeFrontmatter = splitCommas(value); }

    // Nested validation keys
    else if (key === 'vr.requireSpecificity.severity')  { s.validationRules.requireSpecificity.severity = value as ValidationSeverity; }
    else if (key === 'vr.requireSpecificity.edgeTypes') { s.validationRules.requireSpecificity.edgeTypes = splitCommas(value); }
    else if (key === 'vr.brokenLinks.severity')         { s.validationRules.brokenLinks.severity = value as ValidationSeverity; }
    else if (key === 'vr.missingReciprocal.severity')   { s.validationRules.missingReciprocal.severity = value as ValidationSeverity; }
    else if (key === 'vr.missingReciprocal.namedPathsOnly') { s.validationRules.missingReciprocal.namedPathsOnly = Boolean(value); }
    else if (key === 'vr.crossHierarchy.severity')      { s.validationRules.crossHierarchy.severity = value as ValidationSeverity; }

    // Nested toolbar keys
    else if (key.startsWith('toolbar.')) {
      const k = key.slice(8) as keyof BreadTrailSettings['navigatorToolbarVisible'];
      s.navigatorToolbarVisible[k] = Boolean(value);
    }

    // Side-effect keys
    else if (key === 'headerBreadcrumbs') {
      s.headerBreadcrumbs = Boolean(value);
      await this.save();
      this.plugin.updateAllHeaderBreadcrumbs();
      return;
    }
    else if (key === 'navigatorPreviewLines') {
      s.navigatorPreviewLines = Number(value);
      await this.save();
      this.plugin.getNavigatorView()?.clearSnippetCache();
      return;
    }
    else if (key === 'headerBreadcrumbsDepth') {
      s.headerBreadcrumbsDepth = Number(value);
      await this.save();
      this.plugin.updateAllHeaderBreadcrumbs();
      return;
    }

    // Number keys
    else if (key === 'parentDepth' || key === 'childDepth') {
      const parsed = Number.parseInt(String(value), 10);
      (s as unknown as Record<string, unknown>)[key] = Number.isNaN(parsed) ? DEFAULT_SETTINGS[key] : Math.max(0, parsed);
    }
    else if (key === 'navigatorRecentLimit' || key === 'navigatorHomeRecentsCount') {
      const n = parseInt(String(value), 10);
      if (!isNaN(n) && n > 0) (s as unknown as Record<string, unknown>)[key] = n;
    }
    else if (key === 'explorerTileMinWidth') {
      const n = parseInt(String(value), 10);
      if (!isNaN(n) && n >= 60) s.explorerTileMinWidth = n;
    }

    else {
      (s as unknown as Record<string, unknown>)[key] = value;
    }

    await this.save();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      // ── General ────────────────────────────────────────────────────────────
      {
        type: 'page', name: 'General',
        items: [
          { type: 'group', heading: 'Quick switcher', items: [
            { name: 'Parent depth', desc: 'Maximum parent levels to traverse. Set to 0 to disable.',
              control: { type: 'number', key: 'parentDepth', min: 0, step: 1 } },
            { name: 'Child depth', desc: 'Maximum child levels to traverse. Set to 0 to disable.',
              control: { type: 'number', key: 'childDepth', min: 0, step: 1 } },
          ]},
        ],
      },

      // ── Graph ──────────────────────────────────────────────────────────────
      {
        type: 'page', name: 'Graph',
        items: [
          { type: 'group', heading: 'Labels & metadata', items: [
            { name: 'Node metadata property',
              desc: 'Frontmatter property shown as a subtitle on each node. Leave blank to hide.',
              control: { type: 'text', key: 'graphNodeMetaProperty', placeholder: 'Status, date, author' } },
          ]},
          { type: 'group', heading: 'Display', items: [
            { name: 'Show preview pane',
              desc: 'Split the graph into two columns: graph on the left, rendered note preview on the right.',
              control: { type: 'toggle', key: 'graphShowPreview' } },
            { name: 'Show siblings',
              desc: "Include other children of the active note's direct parents.",
              control: { type: 'toggle', key: 'showGraphSiblings' } },
            { name: 'Show sequence children',
              desc: 'Include one level of children beneath visible previous and next notes.',
              control: { type: 'toggle', key: 'showSequenceChildren' } },
            { name: 'Node display',
              desc: 'Choose whether graph nodes show compact labels or note excerpts by default.',
              control: { type: 'dropdown', key: 'graphNodeDisplayMode', options: {
                'compact': 'Compact',
                'excerpt': 'Excerpt',
              } }},
          ]},
          { type: 'group', heading: 'Interaction', items: [
            { name: 'Single click opens note',
              desc: 'When on, one click opens the note immediately. When off, first click selects, second opens.',
              control: { type: 'toggle', key: 'graphSingleClickOpens' } },
            { name: 'Node sort order',
              desc: 'Alphabetical sorts a–z. Importance places nodes with more descendants toward the center.',
              control: { type: 'dropdown', key: 'graphNodeSortOrder', options: {
                'alphabetical': 'Alphabetical',
                'importance':   'Importance (by descendant count)',
              } }},
          ]},
        ],
      },

      // ── Navigator ──────────────────────────────────────────────────────────
      {
        type: 'page', name: 'Navigator',
        items: [
          // Advanced mode toggle — imperative so we can call refreshDomState()
          {
            name: 'Advanced settings',
            desc: 'Show granular options for power users.',
            render: (setting) => {
              setting.addToggle((t) => {
                t.setValue(this.advancedMode);
                t.onChange((v) => { this.advancedMode = v; this.refreshDomState(); });
              });
            },
          },
          { type: 'group', heading: 'Home', items: [
            { name: 'Home',
              desc: 'Default folder or index note for the sidebar browser. Use homepage note and homepage target to override what appears while viewing your homepage.',
              control: { type: 'text', key: 'homeNote', placeholder: 'TOC/index.md' } },
            { name: 'Homepage note',
              desc: 'Dashboard note that should browse from the homepage target instead of from its own breadcrumb parent. Leave blank to auto-detect cssclasses: homepage.',
              control: { type: 'text', key: 'homepageNote', placeholder: 'TOC/Home.md' } },
            { name: 'Homepage target',
              desc: 'Folder or note to show when the active note is the homepage. Folders show parentless roots inside them; notes show their children.',
              control: { type: 'text', key: 'homepageTarget', placeholder: 'ARCHIVE or TOC/index.md' } },
          ]},
          { type: 'group', heading: 'Cards', items: [
            { name: 'Metadata properties',
              desc: 'Frontmatter keys to display below each card title, one per line. Iso date values are formatted automatically (e.g. 2026-01-05 → jan 5, 2026).',
              control: { type: 'textarea', key: 'navigatorMetaProperties', placeholder: 'Date\nstatus\ntags' } },
            { name: 'Note layout',
              desc: 'How notes are displayed in the navigator.',
              control: { type: 'dropdown', key: 'navigatorLayoutMode', options: {
                'grid-large': 'Grid — large (2 columns)',
                'grid-small': 'Grid — small (3 columns)',
                'list':       'List',
              } }},
            { name: 'Show siblings in context mode',
              desc: 'Adds a siblings section showing other notes that share the same parent as the active note.',
              control: { type: 'toggle', key: 'navigatorShowSiblings' } },
            { name: 'Sort-by-field property',
              desc: 'Frontmatter key to sort by when the "by field" sort mode is active.',
              visible: () => this.advancedMode,
              control: { type: 'text', key: 'navigatorSortField', placeholder: 'Date-created' } },
            { name: 'Preview lines',
              desc: 'Number of content lines shown in card previews.',
              visible: () => this.advancedMode,
              control: { type: 'slider', key: 'navigatorPreviewLines', min: 1, max: 20, step: 1 } },
            { name: 'Skip preview for base notes',
              desc: 'When on, notes whose first 3 lines contain a transcluded base (![[*.base]]) or an inline ```base block are shown without a preview excerpt.',
              visible: () => this.advancedMode,
              control: { type: 'toggle', key: 'navigatorSkipPreviewForBases' } },
          ]},
          { type: 'group', heading: 'Tile explorer', items: [
            { name: 'Double-tap to open note',
              desc: 'When on, double-tapping a folder tile opens the note directly. When off, a long-press (500 ms) is required. Single-tap always drills into the folder. Note: double-tap mode adds a ~300 ms delay to single-taps.',
              control: { type: 'toggle', key: 'explorerDoubleTapToOpen' } },
            { name: 'Default opening position',
              desc: "Where the tile explorer starts when no home note or homepage target applies.",
              visible: () => this.advancedMode,
              control: { type: 'dropdown', key: 'explorerDefaultStart', options: {
                'active-parent': "Active note's parent",
                'roots':         'Vault roots',
              } }},
            { name: 'Tile minimum width',
              desc: 'Minimum width of each tile in the explorer grid (px). Smaller values fit more tiles per row.',
              visible: () => this.advancedMode,
              control: { type: 'slider', key: 'explorerTileMinWidth', min: 60, max: 160, step: 10 } },
          ]},
          // Floating navigator — mobile vs desktop are different settings; use render:
          {
            name: 'Floating navigator',
            searchable: false,
            render: (setting, group) => {
              setting.setHeading();
              this.renderFloatingNavigatorSection(group.listEl);
            },
          },
          { name: 'Header breadcrumbs',
            desc: 'Replace the file-path breadcrumb in note headers with clickable bc ancestor links.',
            control: { type: 'toggle', key: 'headerBreadcrumbs' } },
          { name: 'Breadcrumb depth',
            desc: 'How many ancestor levels to show. 0 = all.',
            visible: () => this.advancedMode,
            control: { type: 'slider', key: 'headerBreadcrumbsDepth', min: 0, max: 8, step: 1 } },
          // Pinboard — dynamic section reorder UI; use render:
          {
            name: 'Pinboard',
            searchable: false,
            render: (setting, group) => {
              setting.setHeading();
              this._pinboardEl = group.listEl;
              group.listEl.createEl('p', {
                text: 'The ★ favorites sidebar tab is a fully customizable pinboard. Enable sections, reorder them with ↑ ↓, and configure each one below.',
                cls: 'setting-item-description',
              });
              this.renderPinboardSections(group.listEl);
            },
          },
          { type: 'group', heading: 'Favorites section', items: [
            { name: 'Pinned notes',
              desc: 'File paths to always include in the favorites section, one per line. Notes with bread-trail.favorite: true in their frontmatter are also included automatically.',
              control: { type: 'textarea', key: 'navigatorFavorites', placeholder: 'Journal/Index.md\nProjects/MOC.md' } },
            { name: 'Favorites parent note',
              desc: 'Path to a note whose bc children are treated as favorites. Leave blank to disable.',
              control: { type: 'text', key: 'navigatorFavoritesParentNote', placeholder: 'e.g. Meta/Frequent.md' } },
            { name: 'Favorites metadata properties',
              desc: 'Frontmatter keys shown in favorites section cards, one per line.',
              visible: () => this.advancedMode,
              control: { type: 'textarea', key: 'navigatorFavoritesMetaProperties', placeholder: 'Date\nstatus' } },
          ]},
          { type: 'group', heading: 'Exclusions', items: [
            { name: 'Exclude folders',
              desc: 'Comma-separated folder paths. Notes inside are hidden from the navigator.',
              control: { type: 'text', key: 'navigatorExcludeFolders', placeholder: 'Templates, archive/old' } },
            { name: 'Exclude files',
              desc: 'Comma-separated exact file paths to hide.',
              control: { type: 'text', key: 'navigatorExcludeFiles', placeholder: 'Daily Notes/Index.md, MOC.md' } },
            { name: 'Exclude by frontmatter',
              desc: '"key" hides notes where that key is truthy. "key:value" matches exactly. Example: type:template, draft, status:archived',
              visible: () => this.advancedMode,
              control: { type: 'text', key: 'navigatorExcludeFrontmatter', placeholder: 'Type:template, draft, status:archived' } },
          ]},
          { type: 'group', heading: 'Toolbar buttons', visible: () => this.advancedMode, items: [
            { name: 'Context mode',     desc: 'Show the Context button (breadcrumb hierarchy view).', control: { type: 'toggle', key: 'toolbar.context' } },
            { name: 'Browse mode',      desc: 'Show the Browse button (folder drill-down view).',     control: { type: 'toggle', key: 'toolbar.browse' } },
            { name: 'Recent mode',      desc: 'Show the Recent button (recently modified notes).',     control: { type: 'toggle', key: 'toolbar.recent' } },
            { name: 'Favorites mode',   desc: 'Show the Favorites / Pinboard button.',                control: { type: 'toggle', key: 'toolbar.favorites' } },
            { name: 'Go to active note',desc: 'Show the button that jumps the browse view to the currently open note.', control: { type: 'toggle', key: 'toolbar.goToActive' } },
          ]},
          { type: 'group', heading: 'Recent view', visible: () => this.advancedMode, items: [
            { name: 'Recent metadata properties',
              desc: 'Frontmatter keys shown in recent view cards, one per line. Independent from the context/browse card properties.',
              control: { type: 'textarea', key: 'navigatorRecentMetaProperties', placeholder: 'Date\nstatus' } },
            { name: 'Recent sort field',
              desc: 'Frontmatter date field to sort by in recent view. Leave blank to use file modification time.',
              control: { type: 'text', key: 'navigatorRecentSortField', placeholder: 'Date-modified' } },
            { name: 'Recent view limit',
              desc: 'Maximum number of notes to show in recent view.',
              control: { type: 'number', key: 'navigatorRecentLimit', min: 1, step: 1 } },
            { name: 'Normalize links in group-by values',
              desc: 'When on, [[index]] and index are treated as the same group. Applies whenever bread-trail.group-by is set on a note.',
              control: { type: 'toggle', key: 'navigatorGroupByNormalizeLinks' } },
          ]},
          { type: 'group', heading: 'Home view', visible: () => this.advancedMode, items: [
            { name: 'Show favorites on home view',
              desc: 'Display a favorites section at the bottom of the browser home (vault roots) view.',
              control: { type: 'toggle', key: 'navigatorHomeShowFavorites' } },
            { name: 'Show recent notes on home view',
              desc: 'Display a recent section at the bottom of the browser home (vault roots) view.',
              control: { type: 'toggle', key: 'navigatorHomeShowRecents' } },
            { name: 'Home view recent count',
              desc: 'Max number of recent notes shown in the home view recent section.',
              control: { type: 'slider', key: 'navigatorHomeRecentsCount', min: 3, max: 30, step: 1 } },
          ]},
        ],
      },

      // ── Sequences ──────────────────────────────────────────────────────────
      {
        type: 'page', name: 'Sequences',
        items: [
          { type: 'group', heading: 'Link format', items: [
            {
              name: 'Write links in nested YAML form',
              desc: 'When on, new links use nested objects (next: { journal: [[X]] }) instead of flat keys (next.journal: [[X]]). Requires the Nested Properties plugin. Existing links always keep their current form.',
              render: (setting) => {
                setting.addToggle((t) => {
                  t.setValue(this.plugin.settings.sequenceLinkFormat === 'nested');
                  t.onChange(async (v) => {
                    this.plugin.settings.sequenceLinkFormat = v ? 'nested' : 'flat';
                    await this.save();
                  });
                });
              },
            },
          ]},
        ],
      },

      // ── Validation ─────────────────────────────────────────────────────────
      {
        type: 'page', name: 'Validation',
        items: [
          { type: 'group', heading: 'Conflict detection', items: [
            { name: 'Require path names when edges conflict',
              desc: 'When a note has 2+ edges of the same type, every one must use a named sub-path (e.g. Next.journal). A plain "next" alongside any other next-type link is always flagged.',
              control: { type: 'dropdown', key: 'vr.requireSpecificity.severity', options: SEVERITY_OPTIONS } },
            { name: 'Edge types to check for conflicts',
              desc: 'Comma-separated bc edge-type names. Only these types trigger the conflict rule.',
              control: { type: 'text', key: 'vr.requireSpecificity.edgeTypes', placeholder: 'Next, prev' } },
          ]},
          { type: 'group', heading: 'Link integrity', items: [
            { name: 'Flag broken sequence links',
              desc: 'Report next.X or prev.X links whose target note does not exist in the vault.',
              control: { type: 'dropdown', key: 'vr.brokenLinks.severity', options: SEVERITY_OPTIONS } },
            { name: 'Flag missing reciprocal links',
              desc: 'Report when next.X: [[B]] exists but B has no prev.X back, or vice versa.',
              control: { type: 'dropdown', key: 'vr.missingReciprocal.severity', options: SEVERITY_OPTIONS } },
            { name: 'Only check named paths for reciprocals',
              desc: 'When on, the reciprocal rule only applies to dot-notation links (next.X). Plain next/prev are ignored.',
              control: { type: 'toggle', key: 'vr.missingReciprocal.namedPathsOnly' } },
          ]},
          { type: 'group', heading: 'Hierarchy', items: [
            { name: 'Flag cross-hierarchy sequences',
              desc: 'Warn when a next/prev link connects notes with no shared "up" parent. Root notes and parentless notes are exempt.',
              control: { type: 'dropdown', key: 'vr.crossHierarchy.severity', options: SEVERITY_OPTIONS } },
          ]},
        ],
      },
    ];
  }

  // ── Imperative helpers used by render: callbacks ──────────────────────────

  private renderFloatingNavigatorSection(el: HTMLElement) {
    if (Platform.isMobile) {
      new Setting(el)
        .setName('Open navigator on startup')
        .setDesc('Automatically open the navigator sidebar when the app launches.')
        .addToggle((t) => {
          t.setValue(this.plugin.settings.mobileAutoOpenSidebar);
          t.onChange(async (v) => { this.plugin.settings.mobileAutoOpenSidebar = v; await this.save(); });
        });

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

      new Setting(el)
        .setName('Pinch action')
        .setDesc('What the two-finger pinch-in (contract) gesture does.')
        .addDropdown((d) => {
          for (const [value, label] of Object.entries(GESTURE_OPTIONS)) d.addOption(value, label);
          d.setValue(this.plugin.settings.explorerGesturePinch);
          d.onChange(async (v) => {
            this.plugin.settings.explorerGesturePinch = v as typeof this.plugin.settings.explorerGesturePinch;
            await this.save();
          });
        });

      new Setting(el)
        .setName('Spread action')
        .setDesc('What the two-finger spread-out (expand) gesture does.')
        .addDropdown((d) => {
          for (const [value, label] of Object.entries(GESTURE_OPTIONS)) d.addOption(value, label);
          d.setValue(this.plugin.settings.explorerGestureExpand);
          d.onChange(async (v) => {
            this.plugin.settings.explorerGestureExpand = v as typeof this.plugin.settings.explorerGestureExpand;
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
          this.refreshPinboard();
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
          this.refreshPinboard();
        });
      });

      // Delete button for custom (tag/filter) sections
      if (isCustom) {
        setting.addExtraButton((btn) => {
          btn.setIcon('trash').setTooltip('Remove section');
          btn.onClick(async () => {
            sections.splice(i, 1);
            await this.save();
            this.refreshPinboard();
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
        this.refreshPinboard();
        })();
      });
    };

    addBtn('Add tag section', 'tag', 'tag');
    addBtn('Add filter section', 'filter', 'filter');
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private refreshPinboard(): void {
    const el = this._pinboardEl;
    if (!el) return;
    el.empty();
    el.createEl('p', {
      text: 'The ★ favorites sidebar tab is a fully customizable pinboard. Enable sections, reorder them with ↑ ↓, and configure each one below.',
      cls: 'setting-item-description',
    });
    this.renderPinboardSections(el);
  }

  private async save() {
    await this.plugin.saveSettings().catch((err) => {
      console.error('Failed to save Bread Trail settings:', err);
    });
  }

}

export function addSettingTab(plugin: BreadTrail) {
  plugin.addSettingTab(new BreadTrailSettingTab(plugin.app, plugin));
}
