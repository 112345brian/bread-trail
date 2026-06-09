import { App, Component, Platform, setIcon } from 'obsidian';
import type { NavData, NavActions, GroupData, BrowserItem, ToolbarData, CardData } from './types';
import { Toolbar } from './Toolbar';
import { Section } from './Section';
import { Card } from './Card';

// ── Grid card (gallery layout) ────────────────────────────────────────────────

function formatGridDate(mtime: number): string {
  return new Date(mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function GridCard({ data, actions }: { data: CardData; actions: NavActions }) {
  return (
    <button
      class={`bt-grid-card${data.isActive ? ' is-active' : ''}${!data.imageUrl && !data.snippet ? ' bt-grid-card-compact' : ''}`}
      onClick={(e) => actions.openFile(data.file, e.ctrlKey || e.metaKey)}
      onContextMenu={(e: MouseEvent) => { e.preventDefault(); actions.showContextMenu(data.file, e); }}
      aria-label={data.label}
    >
      {(data.imageUrl || data.snippet) && (
        <div class="bt-grid-card-preview">
          {data.imageUrl
            ? <img class="bt-grid-card-img" src={data.imageUrl} />
            : <span class="bt-grid-card-text">{data.snippet}</span>}
        </div>
      )}
      <div class="bt-grid-card-title">{data.label}</div>
      <div class="bt-grid-card-date">{formatGridDate(data.file.stat.mtime)}</div>
    </button>
  );
}

function GridView({ cards, actions, small }: { cards: CardData[]; actions: NavActions; small?: boolean }) {
  // Group by year descending
  const byYear: Record<number, CardData[]> = {};
  for (const c of cards) {
    const y = new Date(c.file.stat.mtime).getFullYear();
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(c);
  }
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  return (
    <div class={`bt-grid-view${small ? ' bt-grid-small' : ''}`}>
      {years.map((year) => (
        <div key={year} class="bt-grid-year-group">
          <div class="bt-grid-year-header">{year}</div>
          <div class="bt-grid-year-grid">
            {(byYear[year] ?? []).map((c) => (
              <GridCard key={c.file.path} data={c} actions={actions} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface AppProps {
  data: NavData;
  actions: NavActions;
  app: App;
  component: Component;
}


/** Browser navigation header — back button + current folder title.
 *  Rendered inside the content area on mobile so the toolbar stays a single
 *  compact row. On desktop this is shown in the toolbar itself. */
function BrowserHeader({ data, actions }: { data: ToolbarData; actions: NavActions }) {
  const { browserTitle, browserIsRoots, browserCanGoBack } = data;
  return (
    <div class="bread-trail-nav-browser-header">
      <button class="bread-trail-nav-back-btn" disabled={!browserCanGoBack}
        aria-label="Go up" onClick={(e) => actions.browserBack(e)}>
        <span ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, 'arrow-left'); }} />
      </button>
      <span class={`bread-trail-nav-browser-title${browserIsRoots ? ' is-roots' : ''}`}>
        {browserTitle}
      </span>
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
  const { toolbar, sections, flatCards, groups, browserItems, emptyMessage, layoutMode, filterQuery } = data;
  const isMobile = Platform.isMobile;
  const useGrid = layoutMode === 'grid-large' || layoutMode === 'grid-small';
  const smallGrid = layoutMode === 'grid-small';

  const renderContent = () => {
    if (emptyMessage) {
      return <p class="bread-trail-nav-empty">{emptyMessage}</p>;
    }
    // Context mode always uses list
    if (sections.length > 0) {
      return sections.map((s) => (
        <Section key={s.id} data={s} actions={actions} app={app} component={component} />
      ));
    }
    if (browserItems) {
      // In grid mode: render folder rows as-is, collect all cards and show as grid
      if (useGrid) {
        const folderRows = browserItems.filter((i): i is { kind: 'folder'; name: string; path: string } => i.kind === 'folder');
        const cardItems = browserItems.filter((i): i is { kind: 'card'; data: CardData } => i.kind === 'card').map((i) => i.data);
        return (
          <>
            {folderRows.map((item) => (
              <BrowserItemEl
                key={`folder:${item.path}`}
                item={item}
                actions={actions}
                app={app}
                component={component}
              />
            ))}
            {cardItems.length > 0 && <GridView cards={cardItems} actions={actions} small={smallGrid} />}
          </>
        );
      }
      return browserItems.map((item) => (
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
      if (useGrid) {
        // In grid mode keep group labels — render each group with its own header + grid
        return groups.map((g, i) => (
          <div key={`group:${i}:${g.label}`} class="bread-trail-nav-group">
            <div class="bread-trail-nav-group-header">
              <span class="bread-trail-nav-group-label">{g.label}</span>
            </div>
            <GridView cards={g.cards} actions={actions} small={smallGrid} />
          </div>
        ));
      }
      return groups.map((g, i) => (
        <GroupEl key={`group:${i}:${g.label}`} group={g} actions={actions} app={app} component={component} />
      ));
    }
    if (flatCards) {
      if (useGrid) return <GridView cards={flatCards} actions={actions} small={smallGrid} />;
      return flatCards.map((c) => (
        <Card key={c.file.path} data={c} actions={actions} app={app} component={component} />
      ));
    }
    return null;
  };

  return (
    <div class="bread-trail-nav">
      <Toolbar data={toolbar} actions={actions} isMobile={isMobile} />
      {toolbar.filterActive && (
        <div class="bt-nav-filter-bar">
          <input
            class="bt-nav-filter-input"
            type="text"
            placeholder="Filter notes…"
            value={filterQuery}
            ref={(el: HTMLInputElement | null) => { if (el && !filterQuery) el.focus(); }}
            onInput={(e: Event) => actions.setFilter((e.target as HTMLInputElement).value)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Escape') actions.toggleFilter();
            }}
          />
        </div>
      )}
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
