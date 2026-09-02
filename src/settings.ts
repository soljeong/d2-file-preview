import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

export interface D2Settings {
  executablePath: string;
}

export const DEFAULT_SETTINGS: D2Settings = {
  executablePath: "d2"
};

type D2SettingsPlugin = Plugin & {
  settings: D2Settings;
};

export class D2SettingTab extends PluginSettingTab {
  constructor(app: App, private readonly d2Plugin: D2SettingsPlugin) {
    super(app, d2Plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("D2 executable path")
      .addText((text) =>
        text
          .setValue(this.d2Plugin.settings.executablePath)
          .onChange(async (value) => {
            this.d2Plugin.settings.executablePath = value;
            await this.d2Plugin.saveData(this.d2Plugin.settings);
          })
      );
  }
}
