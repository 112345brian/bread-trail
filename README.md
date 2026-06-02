# Bread Trail

Navigate and edit your [[Breadcrumbs](https://github.com/michaelpporter/breadcrumbs)](https://github.com/SkepticMystic/breadcrumbs) graph — view hierarchies, reorder via drag-drop, quick-switch between related notes.

An auxiliary plugin for [Breadcrumbs](https://github.com/michaelpporter/breadcrumbs) that provides enhanced navigation and editing tools for your knowledge graph.

## Features

### Graph Switcher
Visual graph navigation with spatial layout showing your note's relationships:

- **Edge type filtering**: Toggle individual edge types (up/down/next/uses/etc.) with checkboxes to focus on specific relationships
- **Keyboard zoom**: Press `=` to zoom in, `-` to zoom out (0.5x-2x range)
- **Scroll wheel zoom**: Ctrl/Cmd+scroll for precise zoom control
- **Type to filter**: Start typing to highlight matching nodes (auto-clears in 3s)
- **Fade non-connected**: Dim nodes not directly linked to selection for clarity
- **Sequence numbering**: Shows position/total (e.g., 3/7) for prev/next chains
- **Root node styling**: Exploration root has thicker border + glow
- **Styled edges**: Different colors/styles by relation type
  - Parent/child: accent color, solid, 2.5px
  - Prev/next: blue, solid, 2.5px  
  - Siblings/related: dashed, 60% opacity
- **Mouse pan**: Click-drag background to pan around graph
- **Two-stage navigation**: First Enter explores a node (recenters graph), second Enter opens it
- **Escape returns**: Escape key returns to initial file if you haven't confirmed navigation

**Controls:**
- Arrows/WASD: navigate between nodes
- Enter: explore node (recenter graph on it)
- 2×Enter: open file  
- Shift+Enter: flip orientation (vertical ↔ horizontal)
- Home: recenter on selected node
- `=` / `-`: zoom in/out
- Ctrl/Cmd+scroll: zoom
- Type: filter nodes by name
- Escape: clear filter (or close modal)

### Quick Switcher
Fuzzy search through breadcrumb-related notes with keyboard shortcuts:

- Shows parents, children, previous, next, siblings, and related notes
- Customizable traversal depth per relation type
- Cmd+arrows for direct navigation (up=parent, down=child, left=previous, right=next)
- Option to include all vault files with breadcrumb context
- Sequence position display (e.g., "3/7") for prev/next chains

### Breadcrumb Outline
Hierarchical tree view of all children beneath the current note:

- Recursive traversal showing full descendant tree
- Click to navigate
- Drag-and-drop to reorder files (updates `next` field in frontmatter)
- Live refresh when graph updates

## Requirements

**[Breadcrumbs](https://github.com/michaelpporter/breadcrumbs) plugin required** - Bread Trail detects [Breadcrumbs](https://github.com/michaelpporter/breadcrumbs) on startup and shows install instructions if missing.

## Installation

### Via BRAT (recommended for beta testing)
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add `112345brian/bread-trail` as a beta plugin
3. Enable Bread Trail in Community Plugins settings

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/112345brian/bread-trail/releases)
2. Create folder `VaultFolder/.obsidian/plugins/bread-trail/`
3. Copy the three files into that folder
4. Reload Obsidian and enable the plugin

## Settings

### Quick Switcher Traversal
- **Parent/Child/Previous/Next depth**: Maximum levels to traverse (set to 0 to disable)

### Graph View
- **Graph label property**: Frontmatter property for node labels (default: `aliases`). Leave blank to use filenames.
- **Show siblings in graph**: Include other children of your parents as siblings
- **Show sequence children in graph**: Include one level of children beneath prev/next notes
- **Single click opens note**: When enabled, clicking a node opens it immediately. When disabled (default), first click selects, second click opens.
- **Graph node sort order**: 
  - **Alphabetical**: Sort nodes A-Z
  - **Importance**: Place nodes with more descendants toward center (hub detection)

## Commands

- **Show trail for current note**: Basic modal showing parents/children
- **Show breadcrumb outline**: Hierarchical tree view with drag-drop reordering
- **Quick switch to breadcrumb-related note**: Fuzzy search through related notes only
- **Quick switch notes with breadcrumb context**: Fuzzy search all vault notes with relation metadata
- **Show breadcrumb graph switcher**: Visual graph navigation

## Tips

### Graph Switcher Workflow
1. Open graph switcher on any note
2. Use arrow keys to explore relationships visually
3. Press Enter to recenter graph on a new node (explore its connections)
4. Press Enter again on the same node to open it
5. Press Escape to return to your starting point without opening anything

### Edge Type Filtering
Filter graph to specific relationships:
- Only "uses" and "used_by" to see dependency graphs
- Hide "next"/"prev" to focus on hierarchy
- Show only custom edge types you've defined

### Reordering with Outline
1. Open outline view
2. Drag a note onto another note
3. The dragged note's `next` field is updated to point to the target
4. [Breadcrumbs](https://github.com/michaelpporter/breadcrumbs) automatically picks up the change

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
npm run lint   # Check code quality
```

## Credits

Built by [112345brian](https://github.com/112345brian)

Integrates with [[Breadcrumbs](https://github.com/michaelpporter/breadcrumbs)](https://github.com/SkepticMystic/breadcrumbs) by SkepticMystic

## License

MIT - see [LICENSE](LICENSE) file for details

---

## My Other Plugins

Like this plugin? I make a few others for Obsidian:

- [**Breadbake**](https://github.com/112345brian/breadbake) — Breadcrumbs graph configuration
- [**Citation Suite**](https://github.com/112345brian/bripey-citation-suite) — enhanced citation tools
- [**Inherit**](https://github.com/112345brian/inherit) — frontmatter property inheritance
- [**Properties First**](https://github.com/112345brian/obsidian-properties-first) — move properties above the inline title
- [**Return Headings**](https://github.com/112345brian/return-headings) — heading-return navigation markers

Want to install them all at once? Check out [**obsidian-setup**](https://github.com/112345brian/obsidian-setup).
