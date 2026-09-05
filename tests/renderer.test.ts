import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderScheduler, svgPathForD2 } from "../src/renderer";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("D2 output path", () => {
  it.each([
    ["Architecture/network.d2", "Architecture/network.svg"],
    ["network.d2", "network.svg"]
  ])("maps %s to %s", (inputPath, outputPath) => {
    expect(svgPathForD2(inputPath)).toBe(outputPath);
  });
});

describe("per-file render scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the full debounce delay", async () => {
    const render = vi.fn(async () => {});
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(999);
    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith("a.d2");
  });

  it("resets the debounce delay after another change to the same file", async () => {
    const render = vi.fn(async () => {});
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(500);
    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(999);
    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("allows different files to render concurrently", async () => {
    const renders = new Map([
      ["a.d2", deferred()],
      ["b.d2", deferred()]
    ]);
    const activePaths = new Set<string>();
    let peakConcurrency = 0;
    const render = vi.fn(async (path: string) => {
      activePaths.add(path);
      peakConcurrency = Math.max(peakConcurrency, activePaths.size);
      await renders.get(path)!.promise;
      activePaths.delete(path);
    });
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    scheduler.schedule("b.d2");
    await vi.advanceTimersByTimeAsync(1000);

    expect(render.mock.calls).toEqual([["a.d2"], ["b.d2"]]);
    expect(peakConcurrency).toBe(2);

    renders.get("a.d2")!.resolve();
    renders.get("b.d2")!.resolve();
    await Promise.all(Array.from(renders.values(), ({ promise }) => promise));
  });

  it("continues rendering another path after one path fails", async () => {
    const render = vi.fn(async (path: string) => {
      if (path === "a.d2") throw new Error("render failed");
    });
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    scheduler.schedule("b.d2");
    await vi.advanceTimersByTimeAsync(1000);

    expect(render.mock.calls).toEqual([["a.d2"], ["b.d2"]]);

    scheduler.schedule("b.d2");
    await vi.advanceTimersByTimeAsync(1000);

    expect(render.mock.calls).toEqual([["a.d2"], ["b.d2"], ["b.d2"]]);
  });

  it("keeps a pending debounce after the active render finishes", async () => {
    const firstRender = deferred();
    const render = vi.fn(async () => {
      if (render.mock.calls.length === 1) await firstRender.promise;
    });
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(500);

    firstRender.resolve();
    await firstRender.promise;
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(render).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest debounce when an older timer requested a rerender", async () => {
    const firstRender = deferred();
    let activeRenders = 0;
    let peakConcurrency = 0;
    const render = vi.fn(async () => {
      activeRenders += 1;
      peakConcurrency = Math.max(peakConcurrency, activeRenders);
      if (render.mock.calls.length === 1) await firstRender.promise;
      activeRenders -= 1;
    });
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(1000);
    expect(render).toHaveBeenCalledTimes(1);

    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(100);
    firstRender.resolve();
    await firstRender.promise;
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(899);
    expect(render).toHaveBeenCalledTimes(1);
    expect(peakConcurrency).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("clears pending timers when disposed", async () => {
    const render = vi.fn(async () => {});
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    scheduler.schedule("b.d2");
    scheduler.dispose();
    await vi.runAllTimersAsync();

    expect(render).not.toHaveBeenCalled();
  });

  it("drops a requested follow-up when disposed during a render", async () => {
    const firstRender = deferred();
    const render = vi.fn(async () => {
      await firstRender.promise;
    });
    const scheduler = new RenderScheduler({ delayMs: 1000, render });

    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.schedule("a.d2");
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.dispose();

    firstRender.resolve();
    await firstRender.promise;
    await vi.runAllTimersAsync();

    expect(render).toHaveBeenCalledTimes(1);
  });
});
