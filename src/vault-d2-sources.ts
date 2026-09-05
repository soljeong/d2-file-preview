import { normalizePath, type Vault } from "obsidian";

export type D2SourceBundle = {
  fs: Record<string, string>;
  inputPath: string;
};

export async function loadD2SourceBundle(
  vault: Vault,
  inputPath: string
): Promise<D2SourceBundle> {
  const normalizedInputPath = normalizePath(inputPath);
  const d2Files = vault.getFiles().filter((file) => file.extension === "d2");
  const entries = await Promise.all(
    d2Files.map(async (file) => [
      normalizePath(file.path),
      await vault.cachedRead(file)
    ] as const)
  );
  const fs = Object.fromEntries(entries);

  if (!Object.prototype.hasOwnProperty.call(fs, normalizedInputPath)) {
    throw new Error(`D2 source not found in vault: ${normalizedInputPath}`);
  }

  return { fs, inputPath: normalizedInputPath };
}
