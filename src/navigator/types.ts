import type { TFile } from 'obsidian';

export type NavMode = 'context' | 'browser' | 'recent' | 'favorites';
export type NavRelation = 'parent' | 'previous' | 'current' | 'next' | 'child';
export type SortMode = 'sequence' | 'alpha' | 'alpha-desc' | 'field' | 'mtime' | 'ctime';
export type BrowserViewMode = 'bc' | 'files';

export interface CardData {
  file: TFile;
  relation: NavRelation;
  seqPos?: number;
  label: string;
  meta: string[];
  isActive: boolean;
  hasDrillIn: boolean;
  snippet?: string;
  imageUrl?: string;
}

export interface GroupData {
  label: string;
  cards: CardData[];
}

/** A single row in the file-system browser (either a folder or a note card). */
export type BrowserItem =
  | { kind: 'folder'; name: string; path: string }
  | { kind: 'card'; data: CardData };

export interface SectionData {
  id: string;
  label: string;
  icon: string;
  /** Flat card list — used when `groups` is absent. */
  cards: CardData[];
  /** Grouped card list — when present, rendered instead of `cards`. */
  groups?: GroupData[];
  isCollapsed: boolean;
  sortMode: SortMode;
  /** Length > 1 → show sort button. */
  sortCycle: SortMode[];
  isChain: boolean;
}

export interface ToolbarData {
  mode: NavMode;
  vis: {
    context: boolean; browse: boolean; recent: boolean; favorites: boolean;
    goToActive: boolean;
  };
  previewExpanded: boolean;
  /** True when the browser is already positioned at the active note (→ shows reset icon). */
  atActive: boolean;
  recentViewMode: 'global' | 'local';
  browserViewMode: BrowserViewMode;
  browserTitle: string;
  browserIsRoots: boolean;
  browserCanGoBack: boolean;
  browserSortMode: SortMode;
  /** Empty → hide sort button. */
  browserSortCycle: SortMode[];
  followMode: boolean;
  layoutMode: 'list' | 'grid-small' | 'grid-large';
  filterActive: boolean;
}

export interface NavData {
  toolbar: ToolbarData;
  mode: NavMode;
  layoutMode: 'list' | 'grid-small' | 'grid-large';
  /** Context mode — structured sections with collapsible headers. */
  sections: SectionData[];
  /** Browser/Recent/Favorites — flat card list (no section header). */
  flatCards?: CardData[];
  /** Browser folder view with groupBy — groups rendered without a section header. */
  groups?: GroupData[];
  /** File-system browser — mixed folder rows + note cards. */
  browserItems?: BrowserItem[];
  emptyMessage?: string;
  /** Current filter string — empty = no filter. */
  filterQuery: string;
}

export interface NavActions {
  openFile: (file: TFile, newTab: boolean) => void;
  /** Drill into a note in browser mode (push to stack). */
  drillIn: (file: TFile) => void;
  /**
   * Switch modes.
   * Smart behaviour: clicking the active mode's button toggles sub-state
   * (browser: bc ↔ files; recent: global ↔ local) instead of switching away.
   */
  setMode: (mode: NavMode) => void;
  /** Smart locate / reset: goes to active note, or resets to vault roots when already there. */
  goToActive: () => void;
  togglePreview: () => void;
  cycleSort: (sectionId: string) => void;
  toggleCollapse: (sectionId: string) => void;
  browserBack: () => void;
  browserCycleSort: () => void;
  setBrowserSortMode: (mode: SortMode) => void;
  showContextMenu: (file: TFile, e: MouseEvent) => void;
  /** Navigate into a folder in the file-system browser. */
  navigateFolder: (path: string) => void;
  toggleFollowMode: () => void;
  setLayoutMode: (mode: 'list' | 'grid-small' | 'grid-large') => void;
  createNote: () => void;
  /** Create a new note pre-linked as a child (up: [[active]]) of the current note. */
  createChildNote: () => void;
  /** Show/hide the filter bar. */
  toggleFilter: () => void;
  /** Update the filter query (triggers re-render with filtered cards). */
  setFilter: (query: string) => void;
}
