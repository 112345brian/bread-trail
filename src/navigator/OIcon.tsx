import { setIcon } from 'obsidian';

interface OIconProps {
  name: string;
  class?: string;
}

/** Thin wrapper that calls Obsidian's setIcon on mount/update. */
export function OIcon({ name, class: cls }: OIconProps) {
  return (
    <span
      class={cls}
      ref={(el: HTMLSpanElement | null) => { if (el) setIcon(el, name); }}
    />
  );
}
