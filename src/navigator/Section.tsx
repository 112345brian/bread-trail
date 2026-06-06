import { App, Component } from 'obsidian';
import type { SectionData, NavActions } from './types';
import { OIcon } from './OIcon';
import { Card } from './Card';

const SORT_ICON: Record<string, string> = {
  sequence: 'list-ordered', alpha: 'arrow-up-a-z', 'alpha-desc': 'arrow-down-z-a',
  field: 'arrow-up-narrow-wide', mtime: 'clock', ctime: 'calendar',
};
const SORT_LABEL: Record<string, string> = {
  sequence: 'Sequence order', alpha: 'A → Z', 'alpha-desc': 'Z → A',
  field: 'By field', mtime: 'Date modified', ctime: 'Date created',
};

interface SectionProps {
  data: SectionData;
  actions: NavActions;
  app: App;
  component: Component;
}

export function Section({ data, actions, app, component }: SectionProps) {
  const { id, label, icon, cards, groups, isCollapsed, sortMode, sortCycle, isChain } = data;
  const showSort = sortCycle.length > 1;

  return (
    <div class={`bread-trail-nav-section${isChain ? ' bread-trail-nav-section-chain' : ''}`}>
      <div
        class="bread-trail-nav-section-header is-clickable"
        onClick={() => actions.toggleCollapse(id)}
      >
        <span class="bread-trail-nav-section-icon">
          <OIcon name={icon} />
        </span>
        <span class="bread-trail-nav-section-label">{label}</span>
        {showSort && (
          <button
            class="bread-trail-nav-sort-btn"
            aria-label={SORT_LABEL[sortMode] ?? sortMode}
            onClick={(e: MouseEvent) => { e.stopPropagation(); actions.cycleSort(id); }}
          >
            <OIcon name={SORT_ICON[sortMode] ?? 'list-ordered'} />
          </button>
        )}
        <span class="bread-trail-nav-collapse-btn">
          <OIcon name={isCollapsed ? 'chevron-right' : 'chevron-down'} />
        </span>
      </div>

      {!isCollapsed && (
        groups
          ? groups.map((g, i) => (
            <div key={`${id}-group-${i}`} class="bread-trail-nav-group">
              <div class="bread-trail-nav-group-header">
                <span class="bread-trail-nav-group-label">{g.label}</span>
              </div>
              {g.cards.map((c) => (
                <Card key={c.file.path} data={c} actions={actions} app={app} component={component} />
              ))}
            </div>
          ))
          : cards.map((card) => (
            <Card
              key={card.file.path}
              data={card}
              actions={actions}
              app={app}
              component={component}
            />
          ))
      )}
    </div>
  );
}
