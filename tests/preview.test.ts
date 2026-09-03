import type {
  App,
  TAbstractFile,
  TFile,
  Vault,
  WorkspaceLeaf
} from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { PreviewManager, waitForVaultFile } from "../src/preview";
import { FileView as RuntimeFileView } from "./obsidian-runtime";

type TestLeaf = {
  leaf: WorkspaceLeaf;
  openFile: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
};

function svgFile(path: string): TFile {
  return { path } as TFile;
}

function leafWithOpenFile(path: string, openError?: Error): TestLeaf {
  const openFile = vi.fn(async () => {
    if (openError !== undefined) throw openError;
  });
  const detach = vi.fn();
  const view = new RuntimeFileView({});
  view.file = svgFile(path);
  return {
    leaf: {
      view,
      openFile,
      detach
    } as unknown as WorkspaceLeaf,
    openFile,
    detach
  };
}

function mockApp(
  openLeaves: WorkspaceLeaf[],
  newLeaf: WorkspaceLeaf
): {
  app: App;
  getLeaf: ReturnType<typeof vi.fn>;
} {
  const getLeaf = vi.fn(() => newLeaf);
  const app = {
    workspace: {
      iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown) {
        openLeaves.forEach(callback);
      },
      getLeaf
    }
  } as unknown as App;

  return { app, getLeaf };
}

describe("SVG preview leaf selection", () => {
  it("reuses an existing leaf for the same SVG", async () => {
    const matching = leafWithOpenFile("Architecture/network.svg");
    const newLeaf = leafWithOpenFile("empty.svg");
    const { app, getLeaf } = mockApp([matching.leaf], newLeaf.leaf);
    const target = svgFile("Architecture/network.svg");

    await new PreviewManager(app).openOrRefresh(target);

    expect(getLeaf).not.toHaveBeenCalled();
    expect(matching.openFile).toHaveBeenCalledOnce();
    expect(matching.openFile).toHaveBeenCalledWith(target);
  });

  it("opens one right-side split when the SVG is not already open", async () => {
    const newLeaf = leafWithOpenFile("empty.svg");
    const { app, getLeaf } = mockApp([], newLeaf.leaf);
    const target = svgFile("Architecture/network.svg");

    await new PreviewManager(app).openOrRefresh(target);

    expect(getLeaf).toHaveBeenCalledOnce();
    expect(getLeaf).toHaveBeenCalledWith("split", "vertical");
    expect(newLeaf.openFile).toHaveBeenCalledOnce();
    expect(newLeaf.openFile).toHaveBeenCalledWith(target);
  });

  it("does not reuse a leaf showing an unrelated SVG", async () => {
    const unrelated = leafWithOpenFile("Architecture/other.svg");
    const newLeaf = leafWithOpenFile("empty.svg");
    const { app, getLeaf } = mockApp([unrelated.leaf], newLeaf.leaf);
    const target = svgFile("Architecture/network.svg");

    await new PreviewManager(app).openOrRefresh(target);

    expect(unrelated.openFile).not.toHaveBeenCalled();
    expect(getLeaf).toHaveBeenCalledOnce();
    expect(getLeaf).toHaveBeenCalledWith("split", "vertical");
    expect(newLeaf.openFile).toHaveBeenCalledWith(target);
  });

  it("does not reuse a non-FileView exposing a matching file shape", async () => {
    const customViewOpenFile = vi.fn(async () => {});
    const customViewLeaf = {
      view: { file: svgFile("Architecture/network.svg") },
      openFile: customViewOpenFile,
      detach: vi.fn()
    } as unknown as WorkspaceLeaf;
    const newLeaf = leafWithOpenFile("empty.svg");
    const { app, getLeaf } = mockApp([customViewLeaf], newLeaf.leaf);
    const target = svgFile("Architecture/network.svg");

    await new PreviewManager(app).openOrRefresh(target);

    expect(customViewOpenFile).not.toHaveBeenCalled();
    expect(getLeaf).toHaveBeenCalledOnce();
    expect(newLeaf.openFile).toHaveBeenCalledWith(target);
  });

  it("detaches a newly created split when opening the SVG fails", async () => {
    const openError = new Error("SVG view failed");
    const newLeaf = leafWithOpenFile("empty.svg", openError);
    const { app } = mockApp([], newLeaf.leaf);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        new PreviewManager(app).openOrRefresh(
          svgFile("Architecture/network.svg")
        )
      ).resolves.toBeUndefined();

      expect(newLeaf.detach).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to open D2 SVG preview: Architecture/network.svg",
        openError
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not detach an existing SVG leaf when refresh fails", async () => {
    const openError = new Error("SVG refresh failed");
    const matching = leafWithOpenFile(
      "Architecture/network.svg",
      openError
    );
    const newLeaf = leafWithOpenFile("empty.svg");
    const { app, getLeaf } = mockApp([matching.leaf], newLeaf.leaf);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        new PreviewManager(app).openOrRefresh(
          svgFile("Architecture/network.svg")
        )
      ).resolves.toBeUndefined();

      expect(getLeaf).not.toHaveBeenCalled();
      expect(matching.detach).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not open or create a leaf after preview work is aborted", async () => {
    const matching = leafWithOpenFile("Architecture/network.svg");
    const newLeaf = leafWithOpenFile("empty.svg");
    const { app, getLeaf } = mockApp([matching.leaf], newLeaf.leaf);
    const controller = new AbortController();
    controller.abort();

    await new PreviewManager(app).openOrRefresh(
      svgFile("Architecture/network.svg"),
      controller.signal
    );

    expect(matching.openFile).not.toHaveBeenCalled();
    expect(getLeaf).not.toHaveBeenCalled();
  });
});

describe("rendered SVG Vault lookup", () => {
  it("waits for the matching Vault create event when a new SVG is not indexed yet", async () => {
    let indexedFile: TFile | null = null;
    let onCreate: ((file: TAbstractFile) => unknown) | undefined;
    const vault = {
      getFileByPath: () => indexedFile,
      on(name: string, callback: (file: TAbstractFile) => unknown) {
        expect(name).toBe("create");
        onCreate = callback;
        return { id: "create-listener" };
      },
      offref: vi.fn()
    } as unknown as Vault;
    const pendingFile = waitForVaultFile(
      vault,
      "Architecture/network.svg",
      new AbortController().signal
    );
    const createdFile = svgFile("Architecture/network.svg");

    indexedFile = createdFile;
    onCreate?.(createdFile);

    await expect(pendingFile).resolves.toBe(createdFile);
  });

  it("keeps waiting beyond the old timeout until the SVG is indexed", async () => {
    vi.useFakeTimers();
    let indexedFile: TFile | null = null;
    let onCreate: ((file: TAbstractFile) => unknown) | undefined;
    const vault = {
      getFileByPath: () => indexedFile,
      on(_name: string, callback: (file: TAbstractFile) => unknown) {
        onCreate = callback;
        return { id: "create-listener" };
      },
      offref: vi.fn()
    } as unknown as Vault;
    const controller = new AbortController();

    try {
      const pendingFile = waitForVaultFile(
        vault,
        "Architecture/network.svg",
        controller.signal
      );
      let settled = false;
      void pendingFile.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5000);

      expect(settled).toBe(false);

      const createdFile = svgFile("Architecture/network.svg");
      indexedFile = createdFile;
      onCreate?.(createdFile);

      await expect(pendingFile).resolves.toBe(createdFile);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves and removes the Vault listener when aborted", async () => {
    const offref = vi.fn();
    const vault = {
      getFileByPath: () => null,
      on: () => ({ id: "create-listener" }),
      offref
    } as unknown as Vault;
    const controller = new AbortController();
    const pendingFile = waitForVaultFile(
      vault,
      "Architecture/network.svg",
      controller.signal
    );
    let result: TFile | null | undefined;
    void pendingFile.then((file) => {
      result = file;
    });

    controller.abort();
    await Promise.resolve();

    expect(result).toBeNull();
    expect(offref).toHaveBeenCalledOnce();
  });

  it("does not subscribe when preview work was already aborted", async () => {
    const on = vi.fn();
    const vault = {
      getFileByPath: () => null,
      on,
      offref: vi.fn()
    } as unknown as Vault;
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForVaultFile(
        vault,
        "Architecture/network.svg",
        controller.signal
      )
    ).resolves.toBeNull();
    expect(on).not.toHaveBeenCalled();
  });
});
