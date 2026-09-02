import { normalizePath, type App, type TFile, type Vault } from "obsidian";

export function getTargetFolderPath(activeFile: TFile | null): string {
  const parent = activeFile?.parent;
  return parent === null || parent === undefined || parent.isRoot()
    ? ""
    : normalizePath(parent.path);
}

export function findAvailableD2Path(vault: Vault, folderPath: string): string {
  for (let index = 0; ; index += 1) {
    const name = index === 0 ? "Untitled.d2" : `Untitled ${index}.d2`;
    const path = normalizePath(folderPath ? `${folderPath}/${name}` : name);

    if (!vault.getAbstractFileByPath(path)) return path;
  }
}

export async function createNewD2File(app: App): Promise<TFile> {
  const folderPath = getTargetFolderPath(app.workspace.getActiveFile());
  const path = findAvailableD2Path(app.vault, folderPath);
  const file = await app.vault.create(path, "");

  await app.workspace.getLeaf(false).openFile(file);
  return file;
}
