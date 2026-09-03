import type { App, PluginManifest, TAbstractFile, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import D2Plugin from "../src/main";
import { Notice as RuntimeNotice, Plugin as RuntimePlugin } from "./obsidian-runtime";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  writeSvg: vi.fn(),
  openOrRefresh: vi.fn()
}));

vi.mock("../src/d2-wasm-renderer", () => ({
  WasmD2Renderer: class {
    render = mocks.render;
    dispose = mocks.dispose;
  }
}));

vi.mock("../src/svg-output", () => ({ writeSvgToVault: mocks.writeSvg }));

vi.mock("../src/preview", () => ({
  PreviewManager: class {
    openOrRefresh = mocks.openOrRefresh;
  }
}));

function runtimeFile(path: string, extension: string): TFile {
  return Object.assign(new ObsidianTFile(), { path, extension });
}

function createPlugin(): {
  plugin: D2Plugin & RuntimePlugin;
  vault: { on: ReturnType<typeof vi.fn> };
  getModifyHandler: () => ((file: TAbstractFile) => unknown) | undefined;
} {
  let onModify: ((file: TAbstractFile) => unknown) | undefined;
  const vault = {
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

  return { plugin, vault, getModifyHandler: () => onModify };
}

describe("plugin lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    RuntimeNotice.messages.length = 0;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.dispose.mockResolvedValue(undefined);
    mocks.openOrRefresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers the existing surface and ignores non-D2 modifications", async () => {
    const { plugin, vault, getModifyHandler } = createPlugin();

    await plugin.onload();

    expect(plugin.registeredExtensions).toEqual([
      { extensions: ["d2"], viewType: "markdown" }
    ]);
    expect(plugin.commands).toHaveLength(1);
    expect(plugin.commands[0]).toMatchObject({
      id: "create-new-d2-file",
      name: "Create new D2 file"
    });
    expect(vault.on).toHaveBeenCalledOnce();

    getModifyHandler()?.({
      path: "Architecture/shape.d2",
      extension: "d2"
    } as never);
    getModifyHandler()?.(runtimeFile("Architecture/shape.svg", "svg"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("debounces 1000ms then writes and previews the rendered sibling SVG", async () => {
    const svgFile = runtimeFile("Architecture/shape.svg", "svg");
    mocks.render.mockResolvedValue("<svg>complete</svg>");
    mocks.writeSvg.mockResolvedValue(svgFile);
    const { plugin, getModifyHandler } = createPlugin();
    await plugin.onload();

    getModifyHandler()?.(runtimeFile("Architecture/shape.d2", "d2"));
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(mocks.render).toHaveBeenCalledWith("Architecture/shape.d2");
    expect(mocks.writeSvg).toHaveBeenCalledWith(
      plugin.app.vault,
      "Architecture/shape.svg",
      "<svg>complete</svg>"
    );
    expect(mocks.openOrRefresh).toHaveBeenCalledWith(
      svgFile,
      expect.any(AbortSignal)
    );
  });

  it("preserves the previous SVG and reports one error when rendering fails", async () => {
    const error = new Error("syntax error");
    mocks.render.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { plugin, getModifyHandler } = createPlugin();
    await plugin.onload();

    getModifyHandler()?.(runtimeFile("Architecture/shape.d2", "d2"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.writeSvg).not.toHaveBeenCalled();
    expect(mocks.openOrRefresh).not.toHaveBeenCalled();
    expect(RuntimeNotice.messages).toEqual(["D2 render failed"]);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "D2 render failed: Architecture/shape.d2",
      { renderer: "d2-wasm", sourcePath: "Architecture/shape.d2", error }
    );
  });

  it("cancels pending work and disposes the WASM renderer on unload", async () => {
    const { plugin, getModifyHandler } = createPlugin();
    await plugin.onload();
    getModifyHandler()?.(runtimeFile("Architecture/pending.d2", "d2"));

    plugin.onunload();
    await vi.runAllTimersAsync();

    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
