import type { TFile, Vault } from "obsidian";

export async function writeSvgToVault(
  vault: Vault,
  svgPath: string,
  svg: string
): Promise<TFile> {
  const existingFile = vault.getFileByPath(svgPath);
  if (existingFile !== null) {
    await vault.modify(existingFile, svg);
    return existingFile;
  }

  return vault.create(svgPath, svg);
}
