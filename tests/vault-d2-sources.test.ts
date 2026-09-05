import type { TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { loadD2SourceBundle } from "../src/vault-d2-sources";

function vaultFile(path: string, extension: string): TFile {
  return { path, extension } as TFile;
}

describe("vault-backed D2 source loading", () => {
  it("snapshots only normalized vault-local D2 sources", async () => {
    const main = vaultFile("Architecture\\main.d2", "d2");
    const shared = vaultFile("Architecture/shared.d2", "d2");
    const notes = vaultFile("Architecture/notes.md", "md");
    const cachedRead = vi.fn(async (file: TFile) => `source:${file.path}`);
    const vault = {
      getFiles: () => [main, shared, notes],
      cachedRead
    } as unknown as Vault;

    await expect(
      loadD2SourceBundle(vault, "Architecture\\main.d2")
    ).resolves.toEqual({
      fs: {
        "Architecture/main.d2": "source:Architecture\\main.d2",
        "Architecture/shared.d2": "source:Architecture/shared.d2"
      },
      inputPath: "Architecture/main.d2"
    });
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it("rejects when the requested entry is absent from the snapshot", async () => {
    const vault = {
      getFiles: () => [vaultFile("Architecture/shared.d2", "d2")],
      cachedRead: async () => "shared"
    } as unknown as Vault;

    await expect(
      loadD2SourceBundle(vault, "Architecture/main.d2")
    ).rejects.toThrow(
      "D2 source not found in vault: Architecture/main.d2"
    );
  });
});
