import { App, PluginSettingTab, Setting } from 'obsidian';
import type BreadTrail from './main';

export interface BreadTrailSettings {
  parentDepth: number;
  childDepth: number;
  previousDepth: number;
  nextDepth: number;
  graphLabelProperty: string;
}

type DepthSettingKey = 'parentDepth' | 'childDepth' | 'previousDepth' | 'nextDepth';

export const DEFAULT_SETTINGS: BreadTrailSettings = {
  parentDepth: 3,
  childDepth: 3,
  previousDepth: 3,
  nextDepth: 3,
  graphLabelProperty: 'aliases',
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
        text.setPlaceholder('Aliases');
        text.setValue(this.plugin.settings.graphLabelProperty);
        text.onChange(async (value) => {
          this.plugin.settings.graphLabelProperty = value.trim();
          await this.plugin.saveSettings();
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
          await this.plugin.saveSettings();
        });
      });
  }
}

export function addSettingTab(plugin: BreadTrail) {
  plugin.addSettingTab(new BreadTrailSettingTab(plugin.app, plugin));
}
