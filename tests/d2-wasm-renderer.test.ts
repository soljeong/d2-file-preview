import { describe, expect, it, vi } from "vitest";
import {
  type D2Engine,
  WasmD2Renderer
} from "../src/d2-wasm-renderer";

const d2Runtime = vi.hoisted(() => ({
  compile: vi.fn(),
  render: vi.fn(),
  terminate: vi.fn(),
  ready: Promise.resolve()
}));

vi.mock("@d2lang/d2", () => ({
  D2: class {
    ready = d2Runtime.ready;
    worker = { terminate: d2Runtime.terminate };
    compile = d2Runtime.compile;
    render = d2Runtime.render;
  }
}));

function fakeEngine(): D2Engine {
  return {
    compile: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(async () => {})
  };
}

describe("D2.js WASM renderer", () => {
  it("lazily compiles vault sources and renders the resulting diagram", async () => {
    const bundle = {
      fs: {
        "Architecture/main.d2": "import: shared.d2",
        "Architecture/shared.d2": "shared: true"
      },
      inputPath: "Architecture/main.d2"
    };
    const diagram = { name: "compiled" } as never;
    const renderOptions = { pad: 16 } as never;
    const engine = fakeEngine();
    vi.mocked(engine.compile).mockResolvedValue({
      diagram,
      renderOptions
    } as never);
    vi.mocked(engine.render).mockResolvedValue("<svg>rendered</svg>");
    const loadSources = vi.fn(async () => bundle);
    const createEngine = vi.fn(() => engine);
    const renderer = new WasmD2Renderer(loadSources, createEngine);

    await expect(
      renderer.render("Architecture/main.d2")
    ).resolves.toBe("<svg>rendered</svg>");
    expect(createEngine).toHaveBeenCalledOnce();
    expect(loadSources).toHaveBeenCalledWith("Architecture/main.d2");
    expect(engine.compile).toHaveBeenCalledWith({ ...bundle, options: {} });
    expect(engine.render).toHaveBeenCalledWith(diagram, renderOptions);
  });

  it("reuses one engine for subsequent renders", async () => {
    const engine = fakeEngine();
    vi.mocked(engine.compile).mockResolvedValue({
      diagram: {} as never,
      renderOptions: {} as never
    } as never);
    vi.mocked(engine.render).mockResolvedValue("<svg />");
    const renderer = new WasmD2Renderer(
      async (path) => ({ fs: { [path]: "x -> y" }, inputPath: path }),
      vi.fn(() => engine)
    );

    await renderer.render("a.d2");
    await renderer.render("b.d2");

    expect(engine.compile).toHaveBeenCalledTimes(2);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent requests through the single-worker engine", async () => {
    let finishFirst!: () => void;
    const firstCompile = new Promise<never>((resolve) => {
      finishFirst = () => resolve({
        diagram: { name: "first" },
        renderOptions: {}
      } as never);
    });
    const engine = fakeEngine();
    vi.mocked(engine.compile)
      .mockReturnValueOnce(firstCompile)
      .mockResolvedValueOnce({
        diagram: { name: "second" } as never,
        renderOptions: {} as never
      } as never);
    vi.mocked(engine.render).mockResolvedValue("<svg />");
    const renderer = new WasmD2Renderer(
      async (path) => ({ fs: { [path]: "x" }, inputPath: path }),
      () => engine
    );

    const first = renderer.render("a.d2");
    const second = renderer.render("b.d2");
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.compile).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second]);
    expect(engine.compile).toHaveBeenCalledTimes(2);
  });

  it("propagates compile failures without rendering", async () => {
    const error = new Error("syntax error");
    const engine = fakeEngine();
    vi.mocked(engine.compile).mockRejectedValue(error);
    const renderer = new WasmD2Renderer(
      async () => ({ fs: { "a.d2": "bad" }, inputPath: "a.d2" }),
      () => engine
    );

    await expect(renderer.render("a.d2")).rejects.toBe(error);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("disposes an initialized engine exactly once", async () => {
    const engine = fakeEngine();
    vi.mocked(engine.compile).mockResolvedValue({
      diagram: {} as never,
      renderOptions: {} as never
    } as never);
    vi.mocked(engine.render).mockResolvedValue("<svg />");
    const createEngine = vi.fn(() => engine);
    const renderer = new WasmD2Renderer(
      async () => ({ fs: { "a.d2": "x" }, inputPath: "a.d2" }),
      createEngine
    );

    await renderer.render("a.d2");
    await renderer.dispose();
    await renderer.dispose();

    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it("does not create an engine when disposed before the first render", async () => {
    const createEngine = vi.fn(() => fakeEngine());
    const renderer = new WasmD2Renderer(
      async () => ({ fs: {}, inputPath: "a.d2" }),
      createEngine
    );

    await renderer.dispose();

    expect(createEngine).not.toHaveBeenCalled();
  });

  it("disposes promptly and rejects rendering when compile never settles", async () => {
    const engine = fakeEngine();
    vi.mocked(engine.compile).mockReturnValue(new Promise(() => {}));
    const renderer = new WasmD2Renderer(
      async () => ({ fs: { "a.d2": "x" }, inputPath: "a.d2" }),
      () => engine
    );
    const rendering = renderer.render("a.d2");
    await vi.waitFor(() => expect(engine.compile).toHaveBeenCalledOnce());

    const disposalResult = await Promise.race([
      renderer.dispose().then(() => "disposed"),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timed out"), 10);
      })
    ]);

    expect(disposalResult).toBe("disposed");
    await expect(rendering).rejects.toThrow("D2 renderer has been disposed");
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it("rejects renders after disposal without creating an engine", async () => {
    const createEngine = vi.fn(() => fakeEngine());
    const renderer = new WasmD2Renderer(
      async () => ({ fs: { "a.d2": "x" }, inputPath: "a.d2" }),
      createEngine
    );
    await renderer.dispose();

    await expect(renderer.render("a.d2")).rejects.toThrow(
      "D2 renderer has been disposed"
    );
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("terminates the pinned D2.js browser worker exactly once", async () => {
    d2Runtime.compile.mockReset();
    d2Runtime.render.mockReset();
    d2Runtime.terminate.mockReset();
    d2Runtime.compile.mockResolvedValue({
      diagram: {} as never,
      renderOptions: {} as never
    } as never);
    d2Runtime.render.mockResolvedValue("<svg />");
    const renderer = new WasmD2Renderer(async () => ({
      fs: { "a.d2": "x" },
      inputPath: "a.d2"
    }));

    await renderer.render("a.d2");
    await renderer.dispose();
    await renderer.dispose();

    expect(d2Runtime.terminate).toHaveBeenCalledOnce();
  });
});
