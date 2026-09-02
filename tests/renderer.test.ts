import type { ChildProcess, ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RenderScheduler,
  resolveFilesystemPath,
  runD2,
  svgPathForD2
} from "../src/renderer";

vi.mock("node:child_process", () => ({
  execFile: vi.fn()
}));

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string
) => void;

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

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

  it("resolves a vault-relative D2 path below the desktop vault directory", () => {
    expect(resolveFilesystemPath("/vault", "Architecture/network.d2")).toBe(
      path.join("/vault", "Architecture/network.d2")
    );
  });
});

describe("D2 process execution", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("passes input and output as separate execFile arguments", async () => {
    const testDirectory = mkdtempSync(path.join(tmpdir(), "d2-file-preview-unit-"));
    const inputPath = path.join(testDirectory, "network.d2");
    const outputPath = path.join(testDirectory, "network.svg");

    try {
      execFileMock.mockImplementationOnce(
        (
          executable: string,
          arguments_: string[],
          options: { windowsHide: boolean },
          callback: ExecFileCallback
        ): ChildProcess => {
          const [actualInputPath, temporaryOutputPath] = arguments_;
          expect(executable).toBe("/opt/d2 bin/d2");
          expect(actualInputPath).toBe(inputPath);
          expect(temporaryOutputPath).not.toBe(outputPath);
          expect(path.dirname(temporaryOutputPath)).toBe(testDirectory);
          expect(temporaryOutputPath.endsWith(".svg")).toBe(true);
          expect(options).toEqual({ windowsHide: true });
          writeFileSync(temporaryOutputPath, "rendered");
          callback(null, "rendered", "");
          return {} as ChildProcess;
        }
      );

      await expect(
        runD2("/opt/d2 bin/d2", inputPath, outputPath)
      ).resolves.toEqual({ ok: true });
      expect(readFileSync(outputPath, "utf8")).toBe("rendered");
    } finally {
      rmSync(testDirectory, { recursive: true, force: true });
    }
  });

  it("resolves process errors with captured stdout and stderr", async () => {
    const error = Object.assign(new Error("D2 failed"), { code: 1 });
    execFileMock.mockImplementationOnce(
      (
        _executable: string,
        _arguments: string[],
        _options: { windowsHide: boolean },
        callback: ExecFileCallback
      ): ChildProcess => {
        callback(error, "partial output", "syntax error");
        return {} as ChildProcess;
      }
    );

    await expect(runD2("d2", "network.d2", "network.svg")).resolves.toEqual({
      ok: false,
      error,
      stdout: "partial output",
      stderr: "syntax error"
    });
  });

  it("resolves synchronous execFile errors with empty process output", async () => {
    const error = new TypeError("The argument 'file' cannot be empty");
    execFileMock.mockImplementationOnce(() => {
      throw error;
    });

    await expect(runD2("", "network.d2", "network.svg")).resolves.toEqual({
      ok: false,
      error,
      stdout: "",
      stderr: ""
    });
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
