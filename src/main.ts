import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import { createNewD2File } from "./create-d2";
import {
  RenderScheduler,
  resolveFilesystemPath,
  runD2,
  svgPathForD2
} from "./renderer";
import { PreviewManager, waitForVaultFile } from "./preview";
import { D2Settings, D2SettingTab, DEFAULT_SETTINGS } from "./settings";

export default class D2Plugin extends Plugin {
  settings: D2Settings = { ...DEFAULT_SETTINGS };

  private scheduler: RenderScheduler | null = null;
  private readonly previewAbortController = new AbortController();
  private readonly previewManager = new PreviewManager(this.app);
  private readonly onRendered = async (
    svgVaultPath: string
  ): Promise<void> => {
    const signal = this.previewAbortController.signal;
    if (signal.aborted) return;

    const svgFile = await waitForVaultFile(
      this.app.vault,
      svgVaultPath,
      signal
    );
    if (signal.aborted || svgFile === null) return;

    await this.previewManager.openOrRefresh(svgFile, signal);
  };

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
  }

  private async loadSettings(): Promise<void> {
    const savedSettings = (await this.loadData()) as Partial<D2Settings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
  }

  private async renderD2File(d2VaultPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      this.reportRenderFailure(
        d2VaultPath,
        new Error("D2 rendering requires a desktop filesystem vault"),
        "",
        ""
      );
      return;
    }

    const svgVaultPath = svgPathForD2(d2VaultPath);
    const vaultBasePath = adapter.getBasePath();
    const result = await runD2(
      this.settings.executablePath,
      resolveFilesystemPath(vaultBasePath, d2VaultPath),
      resolveFilesystemPath(vaultBasePath, svgVaultPath)
    );

    if (!result.ok) {
      this.reportRenderFailure(
        d2VaultPath,
        result.error,
        result.stdout,
        result.stderr
      );
      return;
    }

    await this.onRendered(svgVaultPath);
  }

  private reportRenderFailure(
    d2VaultPath: string,
    error: Error,
    stdout: string,
    stderr: string
  ): void {
    new Notice("D2 render failed");
    console.error(`D2 render failed: ${d2VaultPath}`, {
      executablePath: this.settings.executablePath,
      error,
      stdout,
      stderr
    });
  }
}
