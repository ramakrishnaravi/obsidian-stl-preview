import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting } from 'obsidian';
import { STLView, VIEW_TYPE } from './stl-view';

// ── Settings ──────────────────────────────────────────────────────────────────

export interface STLPreviewSettings {
  backgroundColor: string;
  modelColor:      string;
  showGrid:        boolean;
}

const DEFAULT_SETTINGS: STLPreviewSettings = {
  backgroundColor: '#18181b',
  modelColor:      '#2e74b5',
  showGrid:        false,
};

// ── Settings Tab ──────────────────────────────────────────────────────────────

class STLPreviewSettingTab extends PluginSettingTab {
  plugin: STLPreviewPlugin;

  constructor(app: App, plugin: STLPreviewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'STL Preview Settings' });

    new Setting(containerEl)
      .setName('Background colour')
      .setDesc('Canvas background colour for the 3D viewer.')
      .addColorPicker(cp =>
        cp
          .setValue(this.plugin.settings.backgroundColor)
          .onChange(async value => {
            this.plugin.settings.backgroundColor = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Model colour')
      .setDesc('Default surface colour applied to loaded STL meshes.')
      .addColorPicker(cp =>
        cp
          .setValue(this.plugin.settings.modelColor)
          .onChange(async value => {
            this.plugin.settings.modelColor = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Show floor grid')
      .setDesc('Display a reference grid beneath the model.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.showGrid)
          .onChange(async value => {
            this.plugin.settings.showGrid = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class STLPreviewPlugin extends Plugin {
  settings: STLPreviewSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new STLView(leaf, this),
    );
    this.registerExtensions(['stl'], VIEW_TYPE);
    this.addSettingTab(new STLPreviewSettingTab(this.app, this));

    console.log('STL Preview plugin loaded');
  }

  onunload(): void {
    console.log('STL Preview plugin unloaded');
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Cast needed: Obsidian workspace trigger typings don't cover custom event names.
    (this.app.workspace as any).trigger('stl-preview:settings-changed');
  }
}
