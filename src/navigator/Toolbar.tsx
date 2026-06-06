import { setIcon } from 'obsidian';
import type { ToolbarData, NavActions } from './types';
import { OIcon } from './OIcon';

const SORT_ICON: Record<string, string> = {
  sequence: 'list-ordered', alpha: 'arrow-up-a-z', 'alpha-desc': 'arrow-down-z-a',
  field: 'arrow-up-narrow-wide', mtime: 'clock', ctime: 'calendar',
};
const SORT_LABEL: Record<string, string> = {
  sequence: 'Sequence order', alpha: 'A → Z', 'alpha-desc': 'Z → A',
  field: 'By field', mtime: 'Date modified', ctime: 'Date created',
};

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
          browserSortMode, browserSortCycle, followMode } = data;
  const isBrowser = mode === 'browser';

  return (
    <div class="bread-trail-nav-toolbar">
      <div class="bread-trail-nav-mode-group">
        {vis.context && (
          <ModeBtn icon="git-branch" label="Context" active={mode === 'context'}
            onClick={() => actions.setMode('context')} />
        )}
        {vis.browse && (
          <ModeBtn
            icon={isBrowser && browserViewMode === 'files' ? 'hard-drive' : 'folder-open'}
            label={isBrowser && browserViewMode === 'files' ? 'Browse (file system)' : 'Browse'}
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

      {/* Desktop only: browser nav (back + title + sort) sits in-line with action buttons.
          On mobile, this is rendered as a sticky header inside the content area instead. */}
      {!isMobile && (
        <div class={`bread-trail-nav-browser-nav${isBrowser ? '' : ' is-inactive'}`}>
          <button class="bread-trail-nav-back-btn" disabled={!browserCanGoBack}
            onClick={actions.browserBack}>
            <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'arrow-left'); }} />
          </button>
          <span class={`bread-trail-nav-browser-title${browserIsRoots ? ' is-roots' : ''}`}>
            {browserTitle}
          </span>
          {browserViewMode === 'bc' && browserSortCycle.length > 1 && (
            <button class="bread-trail-nav-sort-btn bread-trail-nav-browser-sort"
              aria-label={SORT_LABEL[browserSortMode] ?? browserSortMode}
              onClick={actions.browserCycleSort}>
              <OIcon name={SORT_ICON[browserSortMode] ?? 'list-ordered'} />
            </button>
          )}
        </div>
      )}

      {(vis.goToActive || vis.reset) && (
        <ActionBtn
          icon={isBrowser && atActive ? 'rotate-ccw' : 'crosshair'}
          label={isBrowser && atActive ? 'Reset browser to start' : 'Go to active note'}
          onClick={actions.goToActive}
        />
      )}
      {/* Preview toggle: desktop always, mobile only when not in browser mode to save space */}
      {vis.preview && (!isMobile || !isBrowser) && (
        <ActionBtn
          icon={previewExpanded ? 'eye' : 'eye-off'}
          label={previewExpanded ? 'Hide previews' : 'Show previews'}
          onClick={actions.togglePreview}
        />
      )}
      <button
        class={`bread-trail-nav-action-btn${followMode ? ' is-active' : ''}`}
        aria-label={followMode ? 'Follow mode on' : 'Follow mode off'}
        onClick={actions.toggleFollowMode}
      >
        <OIcon name="navigation" />
      </button>
    </div>
  );
}
