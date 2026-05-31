import { App, PluginSettingTab, Setting } from 'obsidian';
import type BreadTrail from './main';

export interface BreadTrailSettings {
  parentDepth: number;
  childDepth: number;
  previousDepth: number;
  nextDepth: number;
  graphLabelProperty: string;
  showGraphSiblings: boolean;
  showSequenceChildren: boolean;
  graphSingleClickOpens: boolean;
  graphNodeSortOrder: 'alphabetical' | 'importance';
}

type DepthSettingKey = 'parentDepth' | 'childDepth' | 'previousDepth' | 'nextDepth';

export const DEFAULT_SETTINGS: BreadTrailSettings = {
  parentDepth: 3,
  childDepth: 3,
  previousDepth: 3,
  nextDepth: 3,
  graphLabelProperty: 'aliases',
  showGraphSiblings: false,
  showSequenceChildren: true,
  graphSingleClickOpens: false,
  graphNodeSortOrder: 'alphabetical',
};

function normalizeDepth(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function normalizeSettings(settings: Partial<BreadTrailSettings>): BreadTrailSettings {
  return {
    parentDepth: normalizeDepth(settings.parentDepth, DEFAULT_SETTINGS.parentDepth),
    childDepth: normalizeDepth(settings.childDepth, DEFAULT_SETTINGS.childDepth),
    previousDepth: normalizeDepth(settings.previousDepth, DEFAULT_SETTINGS.previousDepth),
    nextDepth: normalizeDepth(settings.nextDepth, DEFAULT_SETTINGS.nextDepth),
    graphLabelProperty: typeof settings.graphLabelProperty === 'string' ? settings.graphLabelProperty.trim() : DEFAULT_SETTINGS.graphLabelProperty,
    showGraphSiblings: typeof settings.showGraphSiblings === 'boolean' ? settings.showGraphSiblings : DEFAULT_SETTINGS.showGraphSiblings,
    showSequenceChildren: typeof settings.showSequenceChildren === 'boolean' ? settings.showSequenceChildren : DEFAULT_SETTINGS.showSequenceChildren,
    graphSingleClickOpens: typeof settings.graphSingleClickOpens === 'boolean' ? settings.graphSingleClickOpens : DEFAULT_SETTINGS.graphSingleClickOpens,
    graphNodeSortOrder: settings.graphNodeSortOrder === 'importance' ? 'importance' : 'alphabetical',
  };
}

class BreadTrailSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BreadTrail) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Quick switcher traversal')
      .setHeading();

    this.addDepthSetting('Parent depth', 'Maximum number of parent levels to include.', 'parentDepth');
    this.addDepthSetting('Child depth', 'Maximum number of child levels to include.', 'childDepth');
    this.addDepthSetting('Previous depth', 'Maximum number of previous sequence notes to include.', 'previousDepth');
    this.addDepthSetting('Next depth', 'Maximum number of next sequence notes to include.', 'nextDepth');

    new Setting(containerEl)
      .setName('Graph label property')
      .setDesc('Frontmatter property used for graph node labels. Uses the first value when the property is a list. Leave blank to use filenames.')
      .addText((text) => {
        text.setPlaceholder('aliases');
        text.setValue(this.plugin.settings.graphLabelProperty);
        text.onChange(async (value) => {
          this.plugin.settings.graphLabelProperty = value.trim();
          await this.plugin.saveSettings().catch((err) => {
            console.error('Failed to save Bread Trail settings:', err);
          });
        });
      });

    new Setting(containerEl)
      .setName('Show siblings in graph')
      .setDesc('Include other children of the active note direct parents. Sibling links are inferred from the shared parent.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showGraphSiblings);
        toggle.onChange(async (value) => {
          this.plugin.settings.showGraphSiblings = value;
          await this.plugin.saveSettings().catch((err) => {
            console.error('Failed to save Bread Trail settings:', err);
          });
        });
      });

    new Setting(containerEl)
      .setName('Show sequence children in graph')
      .setDesc('Include one level of children beneath visible previous and next notes.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showSequenceChildren);
        toggle.onChange(async (value) => {
          this.plugin.settings.showSequenceChildren = value;
          await this.plugin.saveSettings().catch((err) => {
            console.error('Failed to save Bread Trail settings:', err);
          });
        });
      });

    new Setting(containerEl)
      .setName('Single click opens note in graph')
      .setDesc('When enabled, clicking a node immediately opens it. When disabled (default), first click selects, second click opens.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.graphSingleClickOpens);
        toggle.onChange(async (value) => {
          this.plugin.settings.graphSingleClickOpens = value;
          await this.plugin.saveSettings().catch((err) => {
            console.error('Failed to save Bread Trail settings:', err);
          });
        });
      });

    new Setting(containerEl)
      .setName('Graph node sort order')
      .setDesc('Alphabetical sorts nodes A-Z. Importance places nodes with more descendants toward the center (often more frequently referenced hubs).')
      .addDropdown((dropdown) => {
        dropdown.addOption('alphabetical', 'Alphabetical');
        dropdown.addOption('importance', 'Importance (by descendant count)');
        dropdown.setValue(this.plugin.settings.graphNodeSortOrder);
        dropdown.onChange(async (value) => {
          this.plugin.settings.graphNodeSortOrder = value as 'alphabetical' | 'importance';
          await this.plugin.saveSettings().catch((err) => {
            console.error('Failed to save Bread Trail settings:', err);
          });
        });
      });
  }

  private addDepthSetting(name: string, description: string, key: DepthSettingKey) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(`${description} Set to 0 to disable.`)
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';
        text.setValue(String(this.plugin.settings[key]));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings[key] = Number.isNaN(parsed) ? DEFAULT_SETTINGS[key] : Math.max(0, parsed);
          await this.plugin.saveSettings().catch((err) => {
            console.error('Failed to save Bread Trail settings:', err);
          });
        });
      });
  }
}

export function addSettingTab(plugin: BreadTrail) {
  plugin.addSettingTab(new BreadTrailSettingTab(plugin.app, plugin));
}
