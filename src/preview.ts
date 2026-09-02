import {
  FileView,
  type App,
  type EventRef,
  type TFile,
  type Vault,
  type WorkspaceLeaf
} from "obsidian";

export function waitForVaultFile(
  vault: Vault,
  path: string,
  signal: AbortSignal
): Promise<TFile | null> {
  if (signal.aborted) return Promise.resolve(null);

  const existingFile = vault.getFileByPath(path);
  if (existingFile !== null) return Promise.resolve(existingFile);

  return new Promise((resolve) => {
    let eventRef: EventRef | undefined;
    let settled = false;

    const finish = (file: TFile | null): void => {
      if (settled) return;
      settled = true;
      if (eventRef !== undefined) vault.offref(eventRef);
      signal.removeEventListener("abort", onAbort);
      resolve(file);
    };

    const onAbort = (): void => finish(null);
    signal.addEventListener("abort", onAbort, { once: true });

    if (signal.aborted) {
      finish(null);
      return;
    }

    eventRef = vault.on("create", (file) => {
      if (file.path !== path) return;
      const indexedFile = vault.getFileByPath(path);
      if (indexedFile !== null) finish(indexedFile);
    });

    if (settled) {
      vault.offref(eventRef);
      return;
    }

    const indexedAfterSubscription = vault.getFileByPath(path);
    if (indexedAfterSubscription !== null) {
      finish(indexedAfterSubscription);
      return;
    }
  });
}

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
      targetLeaf = this.app.workspace.getLeaf("split", "vertical");
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
