import { App, Component, setIcon } from 'obsidian';
import type { NavData, NavActions, GroupData, BrowserItem } from './types';
import { Toolbar } from './Toolbar';
import { Section } from './Section';
import { Card } from './Card';

interface AppProps {
  data: NavData;
  actions: NavActions;
  app: App;
  component: Component;
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
      <Toolbar data={toolbar} actions={actions} />
      <div class="bread-trail-nav-content">
        {renderContent()}
      </div>
    </div>
  );
}
