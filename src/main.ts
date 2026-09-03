import { Notice, Plugin, TFile } from "obsidian";
import { createNewD2File } from "./create-d2";
import { WasmD2Renderer } from "./d2-wasm-renderer";
import { PreviewManager } from "./preview";
import { RenderScheduler, svgPathForD2 } from "./renderer";
import { D2Settings, D2SettingTab, DEFAULT_SETTINGS } from "./settings";
import { writeSvgToVault } from "./svg-output";
import { loadD2SourceBundle } from "./vault-d2-sources";

export default class D2Plugin extends Plugin {
  settings: D2Settings = { ...DEFAULT_SETTINGS };

  private scheduler: RenderScheduler | null = null;
  private readonly previewAbortController = new AbortController();
  private readonly previewManager = new PreviewManager(this.app);
  private readonly renderer = new WasmD2Renderer((path) =>
    loadD2SourceBundle(this.app.vault, path)
  );

  async onload(): Promise<void> {
    this.registerExtensions(["d2"], "markdown");
    await this.loadSettings();

    this.scheduler = new RenderScheduler({
      delayMs: 1000,
      render: (d2VaultPath) => this.renderD2File(d2VaultPath)
    });

    this.addSettingTab(new D2SettingTab(this.app, this));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "d2") return;
        this.scheduler?.schedule(file.path);
      })
    );

    this.addCommand({
      id: "create-new-d2-file",
      name: "Create new D2 file",
      callback: () => void createNewD2File(this.app)
    });
  }

  onunload(): void {
    this.previewAbortController.abort();
    this.scheduler?.dispose();
    this.scheduler = null;
    void this.renderer.dispose().catch((error: unknown) => {
      console.error("Failed to dispose D2 WASM renderer", error);
    });
  }

  private async loadSettings(): Promise<void> {
    const savedSettings = (await this.loadData()) as Partial<D2Settings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
  }

  private async renderD2File(d2VaultPath: string): Promise<void> {
    try {
      const svg = await this.renderer.render(d2VaultPath);
      const svgFile = await writeSvgToVault(
        this.app.vault,
        svgPathForD2(d2VaultPath),
        svg
      );
      await this.previewManager.openOrRefresh(
        svgFile,
        this.previewAbortController.signal
      );
    } catch (error) {
      this.reportRenderFailure(
        d2VaultPath,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private reportRenderFailure(d2VaultPath: string, error: Error): void {
    new Notice("D2 render failed");
    console.error(`D2 render failed: ${d2VaultPath}`, {
      renderer: "d2-wasm",
      sourcePath: d2VaultPath,
      error
    });
  }
}
