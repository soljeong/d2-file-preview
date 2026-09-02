import type { App, TFile, Vault } from "obsidian";
import { describe, expect, it } from "vitest";
import {
  createNewD2File,
  findAvailableD2Path,
  getTargetFolderPath
} from "../src/create-d2";

function mockVaultWithPaths(paths: string[]): Vault {
  const existingPaths = new Set(paths);

  return {
    getAbstractFileByPath(path: string) {
      return existingPaths.has(path) ? ({ path } as never) : null;
    }
  } as Vault;
}

describe("D2 file destination", () => {
  it("uses the active file folder", () => {
    expect(
      getTargetFolderPath({
        parent: { path: "Architecture", isRoot: () => false }
      } as never)
    ).toBe("Architecture");
  });

  it("falls back to vault root", () => {
    expect(getTargetFolderPath(null)).toBe("");
  });

  it("increments Untitled names until a free path exists", () => {
    const vault = mockVaultWithPaths([
      "Architecture/Untitled.d2",
      "Architecture/Untitled 1.d2"
    ]);

    expect(findAvailableD2Path(vault, "Architecture")).toBe(
      "Architecture/Untitled 2.d2"
    );
  });
});

describe("new D2 file creation", () => {
  it("creates exactly Untitled.d2 when the active file is in the vault root", async () => {
    const createdFile = { path: "Untitled.d2" } as TFile;
    const created: Array<{ path: string; contents: string }> = [];
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        async create(path: string, contents: string) {
          created.push({ path, contents });
          return createdFile;
        }
      },
      workspace: {
        getActiveFile: () => ({
          parent: { path: "/", isRoot: () => true }
        }),
        getLeaf: () => ({
          async openFile() {}
        })
      }
    } as unknown as App;

    await createNewD2File(app);

    expect(created).toEqual([{ path: "Untitled.d2", contents: "" }]);
  });

  it("creates an empty file in the active folder and opens it", async () => {
    const createdFile = { path: "Architecture/Untitled.d2" } as TFile;
    const created: Array<{ path: string; contents: string }> = [];
    const opened: TFile[] = [];
    const selectedLeafArguments: boolean[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        async create(path: string, contents: string) {
          created.push({ path, contents });
          return createdFile;
        }
      },
      workspace: {
        getActiveFile: () => ({
          parent: { path: "Architecture", isRoot: () => false }
        }),
        getLeaf(newLeaf: boolean) {
          selectedLeafArguments.push(newLeaf);
          return {
            async openFile(file: TFile) {
              opened.push(file);
            }
          };
        }
      }
    } as unknown as App;

    await expect(createNewD2File(app)).resolves.toBe(createdFile);
    expect(created).toEqual([
      { path: "Architecture/Untitled.d2", contents: "" }
    ]);
    expect(selectedLeafArguments).toEqual([false]);
    expect(opened).toEqual([createdFile]);
  });
});
