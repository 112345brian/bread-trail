import { App, Component, Platform, setIcon } from 'obsidian';
import type { NavData, NavActions, GroupData, BrowserItem, ToolbarData } from './types';
import { Toolbar } from './Toolbar';
import { OIcon } from './OIcon';
import { Section } from './Section';
import { Card } from './Card';

interface AppProps {
  data: NavData;
  actions: NavActions;
  app: App;
  component: Component;
}

const SORT_ICON: Record<string, string> = {
  sequence: 'list-ordered', alpha: 'arrow-up-a-z', 'alpha-desc': 'arrow-down-z-a',
  field: 'arrow-up-narrow-wide', mtime: 'clock', ctime: 'calendar',
};
const SORT_LABEL: Record<string, string> = {
  sequence: 'Sequence order', alpha: 'A → Z', 'alpha-desc': 'Z → A',
  field: 'By field', mtime: 'Date modified', ctime: 'Date created',
};

/** Browser navigation header — back button, current folder title, sort toggle.
 *  Rendered inside the content area on mobile so the toolbar stays a single
 *  compact row. On desktop this is shown in the toolbar itself. */
function BrowserHeader({ data, actions }: { data: ToolbarData; actions: NavActions }) {
  const { browserTitle, browserIsRoots, browserCanGoBack, browserSortMode, browserSortCycle, browserViewMode } = data;
  return (
    <div class="bread-trail-nav-browser-header">
      <button class="bread-trail-nav-back-btn" disabled={!browserCanGoBack}
        aria-label="Go up" onClick={actions.browserBack}>
        <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'arrow-left'); }} />
      </button>
      <span class={`bread-trail-nav-browser-title${browserIsRoots ? ' is-roots' : ''}`}>
        {browserTitle}
      </span>
      {browserViewMode === 'bc' && browserSortCycle.length > 1 && (
        <button class="bread-trail-nav-sort-btn"
          aria-label={SORT_LABEL[browserSortMode] ?? browserSortMode}
          onClick={actions.browserCycleSort}>
          <OIcon name={SORT_ICON[browserSortMode] ?? 'list-ordered'} />
        </button>
      )}
    </div>
  );
}

function FolderRow({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <div class="bread-trail-nav-folder-row" onClick={onClick}>
      <span class="bread-trail-nav-folder-icon"
        ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'folder'); }} />
      <span class="bread-trail-nav-folder-name">{name}</span>
      <span class="bread-trail-nav-folder-icon"
        ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'chevron-right'); }} />
    </div>
  );
}

function GroupEl({ group, actions, app, component }: {
  group: GroupData; actions: NavActions; app: App; component: Component;
}) {
  return (
    <div class="bread-trail-nav-group">
      <div class="bread-trail-nav-group-header">
        <span class="bread-trail-nav-group-label">{group.label}</span>
      </div>
      {group.cards.map((c) => (
        <Card key={c.file.path} data={c} actions={actions} app={app} component={component} />
      ))}
    </div>
  );
}

function BrowserItemEl({ item, actions, app, component }: {
  item: BrowserItem; actions: NavActions; app: App; component: Component;
}) {
  if (item.kind === 'folder') {
    return <FolderRow name={item.name} onClick={() => actions.navigateFolder(item.path)} />;
  }
  return <Card data={item.data} actions={actions} app={app} component={component} />;
}

export function NavigatorApp({ data, actions, app, component }: AppProps) {
  const { toolbar, sections, flatCards, groups, browserItems, emptyMessage } = data;
  const isMobile = Platform.isMobile;

  const renderContent = () => {
    if (emptyMessage) {
      return <p class="bread-trail-nav-empty">{emptyMessage}</p>;
    }
    if (sections.length > 0) {
      return sections.map((s) => (
        <Section key={s.id} data={s} actions={actions} app={app} component={component} />
      ));
    }
    if (browserItems) {
      return browserItems.map((item, i) => (
        <BrowserItemEl
          key={item.kind === 'folder' ? `folder:${item.path}` : `card:${item.data.file.path}`}
          item={item}
          actions={actions}
          app={app}
          component={component}
        />
      ));
    }
    if (groups) {
      return groups.map((g, i) => (
        <GroupEl key={`group:${i}:${g.label}`} group={g} actions={actions} app={app} component={component} />
      ));
    }
    if (flatCards) {
      return flatCards.map((c) => (
        <Card key={c.file.path} data={c} actions={actions} app={app} component={component} />
      ));
    }
    return null;
  };

  return (
    <div class="bread-trail-nav">
      <Toolbar data={toolbar} actions={actions} isMobile={isMobile} />
      <div class="bread-trail-nav-content">
        {/* On mobile, browser nav (back + title + sort) lives here as a sticky
            header instead of in the toolbar — keeps the toolbar a single row. */}
        {isMobile && toolbar.mode === 'browser' && (
          <BrowserHeader data={toolbar} actions={actions} />
        )}
        {renderContent()}
      </div>
    </div>
  );
}
