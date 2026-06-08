import { Menu, setIcon } from 'obsidian';
import type { ToolbarData, NavActions, SortMode } from './types';
import { OIcon } from './OIcon';

const SORT_MENU_ITEMS: { mode: SortMode; label: string; icon: string }[] = [
  { mode: 'mtime',      label: 'Date modified', icon: 'clock' },
  { mode: 'alpha',      label: 'A → Z',         icon: 'arrow-up-a-z' },
  { mode: 'alpha-desc', label: 'Z → A',          icon: 'arrow-down-z-a' },
  { mode: 'ctime',      label: 'Date created',   icon: 'calendar' },
];

function ModeBtn({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button class={`bread-trail-nav-mode-btn${active ? ' is-active' : ''}`}
      aria-label={label} onClick={onClick}>
      <OIcon name={icon} />
    </button>
  );
}

function ActionBtn({ icon, label, onClick }: {
  icon: string; label: string; onClick: () => void;
}) {
  return (
    <button class="bread-trail-nav-action-btn" aria-label={label} onClick={onClick}>
      <OIcon name={icon} />
    </button>
  );
}

interface ToolbarProps { data: ToolbarData; actions: NavActions; isMobile?: boolean; }

export function Toolbar({ data, actions, isMobile }: ToolbarProps) {
  const { mode, vis, previewExpanded, atActive, recentViewMode,
          browserViewMode, browserTitle, browserIsRoots, browserCanGoBack,
          browserSortMode, followMode, layoutMode, filterActive } = data;
  const isBrowser = mode === 'browser';
  const isFileBrowser = isBrowser && browserViewMode === 'files';

  const openMenu = (e: MouseEvent) => {
    const menu = new Menu();

    // ── Browser sub-mode ─────────────────────────────────────────────────
    if (isBrowser) {
      menu.addItem((item) =>
        item.setSection('browser').setTitle(isFileBrowser ? 'BC hierarchy view' : 'File system view')
          .setIcon(isFileBrowser ? 'git-branch' : 'hard-drive')
          .setChecked(isFileBrowser)
          .onClick(() => actions.toggleFileBrowser()));
    }

    // ── View ──────────────────────────────────────────────────────────────
    menu.addItem((item) =>
      item.setSection('view').setTitle('Grid — large').setIcon('layout-grid')
        .setChecked(layoutMode === 'grid-large')
        .onClick(() => actions.setLayoutMode('grid-large')));
    menu.addItem((item) =>
      item.setSection('view').setTitle('Grid — small').setIcon('grip')
        .setChecked(layoutMode === 'grid-small')
        .onClick(() => actions.setLayoutMode('grid-small')));
    menu.addItem((item) =>
      item.setSection('view').setTitle('List').setIcon('list')
        .setChecked(layoutMode === 'list')
        .onClick(() => actions.setLayoutMode('list')));
    menu.addItem((item) =>
      item.setSection('view').setTitle(previewExpanded ? 'Hide previews' : 'Show previews')
        .setIcon(previewExpanded ? 'eye-off' : 'eye')
        .setChecked(previewExpanded)
        .onClick(() => actions.togglePreview()));

    // ── Sort ──────────────────────────────────────────────────────────────
    for (const { mode: m, label, icon } of SORT_MENU_ITEMS) {
      menu.addItem((item) =>
        item.setSection('sort').setTitle(label).setIcon(icon)
          .setChecked(browserSortMode === m)
          .onClick(() => actions.setBrowserSortMode(m)));
    }

    // ── Create ────────────────────────────────────────────────────────────
    menu.addItem((item) =>
      item.setSection('create').setTitle('New note').setIcon('file-plus')
        .onClick(() => actions.createNote()));
    menu.addItem((item) =>
      item.setSection('create').setTitle('New child note').setIcon('file-plus-2')
        .onClick(() => actions.createChildNote()));

    menu.showAtMouseEvent(e);
  };

  return (
    <div class="bread-trail-nav-toolbar">
      <div class="bread-trail-nav-mode-group">
        {vis.context && (
          <ModeBtn icon="git-branch" label="Context" active={mode === 'context'}
            onClick={() => actions.setMode('context')} />
        )}
        {vis.browse && (
          <ModeBtn
            icon={isFileBrowser ? 'hard-drive' : 'folder-open'}
            label={isFileBrowser ? 'Browse (file system)' : 'Browse'}
            active={isBrowser}
            onClick={() => actions.setMode('browser')}
          />
        )}
        {vis.recent && (
          <ModeBtn
            icon={mode === 'recent' && recentViewMode === 'local' ? 'users' : 'clock'}
            label={mode === 'recent' && recentViewMode === 'local' ? 'Recent (siblings)' : 'Recent'}
            active={mode === 'recent'}
            onClick={() => actions.setMode('recent')}
          />
        )}
        {vis.favorites && (
          <ModeBtn icon="star" label="Favorites" active={mode === 'favorites'}
            onClick={() => actions.setMode('favorites')} />
        )}
      </div>

      {vis.goToActive && (
        <ActionBtn
          icon={isBrowser && atActive ? 'rotate-ccw' : 'crosshair'}
          label={isBrowser && atActive ? 'Reset browser to start' : 'Go to active note'}
          onClick={actions.goToActive}
        />
      )}
      <button
        class={`bread-trail-nav-action-btn${followMode ? ' is-active' : ''}`}
        aria-label={followMode ? 'Follow mode on' : 'Follow mode off'}
        onClick={actions.toggleFollowMode}
      >
        <OIcon name="navigation" />
      </button>
      <button
        class={`bread-trail-nav-action-btn${filterActive ? ' is-active' : ''}`}
        aria-label={filterActive ? 'Close filter' : 'Filter notes'}
        onClick={actions.toggleFilter}
      >
        <OIcon name="search" />
      </button>
      <button class="bread-trail-nav-action-btn" aria-label="More options" onClick={openMenu}>
        <OIcon name="more-horizontal" />
      </button>

      {/* Desktop only: browser nav (back + title) goes LAST so it wraps
          to its own full-width row below the mode group + action buttons.
          On mobile this lives in the content area as a sticky header instead. */}
      {!isMobile && isBrowser && (
        <div class="bread-trail-nav-browser-nav">
          <button class="bread-trail-nav-back-btn" disabled={!browserCanGoBack}
            onClick={actions.browserBack}>
            <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'arrow-left'); }} />
          </button>
          <span class={`bread-trail-nav-browser-title${browserIsRoots ? ' is-roots' : ''}`}>
            {browserTitle}
          </span>
        </div>
      )}
    </div>
  );
}
