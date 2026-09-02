import type {
  App,
  PluginManifest,
  TAbstractFile
} from "obsidian";
import path from "node:path";
import { FileSystemAdapter, TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import D2Plugin from "../src/main";
import { runD2 } from "../src/renderer";
import { Plugin as RuntimePlugin } from "./obsidian-runtime";

vi.mock("../src/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/renderer")>();
  return {
    ...actual,
    runD2: vi.fn()
  };
});

const runD2Mock = vi.mocked(runD2);

function runtimeFile(path: string, extension: string): TFile {
  return Object.assign(new TFile(), { path, extension });
}

describe("plugin lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runD2Mock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers the MVP surface, filters modifies, debounces 1000ms, and disposes on unload", async () => {
    let onModify: ((file: TAbstractFile) => unknown) | undefined;
    const vault = {
      adapter: new FileSystemAdapter(),
      on: vi.fn((name: string, callback: (file: TAbstractFile) => unknown) => {
        expect(name).toBe("modify");
        onModify = callback;
        return { id: "modify-listener" };
      })
    };
    const app = { vault, workspace: {} } as unknown as App;
    const plugin = new D2Plugin(
      app,
      {} as PluginManifest
    ) as D2Plugin & RuntimePlugin;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runD2Mock.mockResolvedValue({
      ok: false,
      error: new Error("expected lifecycle test failure"),
      stdout: "",
      stderr: ""
    });

    await plugin.onload();

    expect(plugin.registeredExtensions).toEqual([
      { extensions: ["d2"], viewType: "markdown" }
    ]);
    expect(plugin.commands).toHaveLength(1);
    expect(plugin.commands[0]).toMatchObject({
      id: "create-new-d2-file",
      name: "Create new D2 file"
    });
    expect(plugin.commands[0]?.callback).toEqual(expect.any(Function));
    expect(vault.on).toHaveBeenCalledOnce();

    onModify?.({ path: "Architecture/shape.d2", extension: "d2" } as never);
    onModify?.(runtimeFile("Architecture/shape.svg", "svg"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(runD2Mock).not.toHaveBeenCalled();

    onModify?.(runtimeFile("Architecture/shape.d2", "d2"));
    await vi.advanceTimersByTimeAsync(999);
    expect(runD2Mock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runD2Mock).toHaveBeenCalledOnce();
    expect(runD2Mock).toHaveBeenCalledWith(
      "d2",
      path.join("/vault", "Architecture/shape.d2"),
      path.join("/vault", "Architecture/shape.svg")
    );

    onModify?.(runtimeFile("Architecture/pending.d2", "d2"));
    await vi.advanceTimersByTimeAsync(500);
    plugin.onunload();
    onModify?.(runtimeFile("Architecture/after-unload.d2", "d2"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(runD2Mock).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
