import { App, Component, MarkdownRenderer } from 'obsidian';
import { useEffect, useRef } from 'preact/hooks';
import type { CardData, NavActions } from './types';
import { OIcon } from './OIcon';

interface CardProps {
  data: CardData;
  actions: NavActions;
  app: App;
  component: Component;
}

function SnippetRenderer({ app, source, path, component }: {
  app: App; source: string; path: string; component: Component;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !source) return;
    el.empty();
    void MarkdownRenderer.render(app, source, el, path, component);
  }, [source, path]);
  return <div class="bread-trail-nav-card-excerpt" ref={ref} />;
}

export function Card({ data, actions, app, component }: CardProps) {
  const { file, relation, seqPos, label, meta, isActive, hasDrillIn, snippet, imageUrl } = data;
  const isCurrent = relation === 'current';

  return (
    <div
      class={[
        'bread-trail-nav-card',
        `bread-trail-nav-card-${relation}`,
        isCurrent || isActive ? 'is-current' : '',
        hasDrillIn ? 'has-children' : '',
      ].filter(Boolean).join(' ')}
      onClick={isCurrent ? undefined : (e: MouseEvent) => actions.openFile(file, e.ctrlKey || e.metaKey)}
      onContextMenu={(e: MouseEvent) => { e.preventDefault(); actions.showContextMenu(file, e); }}
    >
      <div class="bread-trail-nav-card-title-row">
        {seqPos !== undefined && (
          <span class="bread-trail-nav-card-pos">{seqPos}</span>
        )}
        <span class="bread-trail-nav-card-title">{label}</span>
        {hasDrillIn && (
          <button
            class="bread-trail-nav-card-chevron"
            aria-label="Browse children"
            onClick={(e: MouseEvent) => { e.stopPropagation(); actions.drillIn(file); }}
          >
            <OIcon name="chevron-right" />
          </button>
        )}
      </div>

      {meta.length > 0 && (
        <div class="bread-trail-nav-card-meta">
          {meta.map((val, i) => (
            <div key={i} class="bread-trail-nav-card-meta-row">
              <span class="bread-trail-nav-card-meta-val">{val}</span>
            </div>
          ))}
        </div>
      )}

      {imageUrl && (
        <img
          class="bread-trail-nav-card-image"
          src={imageUrl}
          alt={file.basename}
          loading="lazy"
        />
      )}

      {snippet && (
        <SnippetRenderer app={app} source={snippet} path={file.path} component={component} />
      )}
    </div>
  );
}
