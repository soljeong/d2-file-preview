import {
  FileView,
  Platform,
  type App,
  type TFile,
  type WorkspaceLeaf
} from "obsidian";

export class PreviewManager {
  constructor(private readonly app: App) {}

  async openOrRefresh(
    svgFile: TFile,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return;

    let targetLeaf: WorkspaceLeaf | undefined;
    let createdLeaf = false;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof FileView)) return;
      const currentFile = leaf.view.file;
      if (targetLeaf === undefined && currentFile?.path === svgFile.path) {
        targetLeaf = leaf;
      }
    });

    if (signal?.aborted) return;

    if (targetLeaf === undefined) {
      targetLeaf = Platform.isMobileApp
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getLeaf("split", "vertical");
      createdLeaf = true;
    }

    if (signal?.aborted) {
      if (createdLeaf) targetLeaf.detach();
      return;
    }

    try {
      await targetLeaf.openFile(svgFile);
    } catch (error) {
      if (createdLeaf) targetLeaf.detach();
      console.error(`Failed to open D2 SVG preview: ${svgFile.path}`, error);
    }
  }
}
