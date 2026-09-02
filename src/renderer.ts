import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

export type RenderResult =
  | { ok: true }
  | { ok: false; error: Error; stdout: string; stderr: string };

export function svgPathForD2(d2Path: string): string {
  return d2Path.replace(/\.d2$/, ".svg");
}

export function resolveFilesystemPath(
  vaultBasePath: string,
  vaultPath: string
): string {
  return path.join(vaultBasePath, vaultPath);
}

export function runD2(
  executable: string,
  inputPath: string,
  outputPath: string
): Promise<RenderResult> {
  const temporaryOutputPath = path.join(
    path.dirname(outputPath),
    `.${randomUUID()}.tmp.svg`
  );

  return runD2Transaction(
    executable,
    inputPath,
    outputPath,
    temporaryOutputPath
  );
}

type ProcessResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; error: Error; stdout: string; stderr: string };

class D2CleanupError extends Error {
  readonly name = "D2CleanupError";

  constructor(
    readonly primaryError: Error,
    readonly cleanupError: Error
  ) {
    super(
      `${primaryError.message}; temporary D2 output cleanup also failed: ${cleanupError.message}`
    );
  }
}

function executeD2(
  executable: string,
  inputPath: string,
  outputPath: string
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        executable,
        [inputPath, outputPath],
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, error, stdout, stderr });
            return;
          }

          resolve({ ok: true, stdout, stderr });
        }
      );
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
        stdout: "",
        stderr: ""
      });
    }
  });
}

async function removeTemporaryOutput(
  temporaryOutputPath: string
): Promise<Error | null> {
  try {
    await rm(temporaryOutputPath, { force: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function runD2Transaction(
  executable: string,
  inputPath: string,
  outputPath: string,
  temporaryOutputPath: string
): Promise<RenderResult> {
  const result = await executeD2(executable, inputPath, temporaryOutputPath);

  if (!result.ok) {
    const cleanupError = await removeTemporaryOutput(temporaryOutputPath);
    return cleanupError === null
      ? result
      : {
          ok: false,
          error: new D2CleanupError(result.error, cleanupError),
          stdout: result.stdout,
          stderr: result.stderr
        };
  }

  try {
    await rename(temporaryOutputPath, outputPath);
    return { ok: true };
  } catch (error) {
    const replacementError =
      error instanceof Error ? error : new Error(String(error));
    const cleanupError = await removeTemporaryOutput(temporaryOutputPath);
    return {
      ok: false,
      error:
        cleanupError === null
          ? replacementError
          : new D2CleanupError(replacementError, cleanupError),
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}

type RenderState = {
  timer?: ReturnType<typeof setTimeout>;
  rendering: boolean;
  rerenderRequested: boolean;
};

type RenderSchedulerOptions = {
  delayMs: number;
  render: (path: string) => Promise<void>;
};

export class RenderScheduler {
  private readonly delayMs: number;
  private readonly render: (path: string) => Promise<void>;
  private readonly states = new Map<string, RenderState>();

  constructor({ delayMs, render }: RenderSchedulerOptions) {
    this.delayMs = delayMs;
    this.render = render;
  }

  schedule(path: string): void {
    const state = this.states.get(path) ?? {
      rendering: false,
      rerenderRequested: false
    };
    this.states.set(path, state);

    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      this.onTimer(path, state);
    }, this.delayMs);
  }

  dispose(): void {
    for (const state of this.states.values()) {
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.timer = undefined;
      state.rerenderRequested = false;
    }
    this.states.clear();
  }

  private onTimer(path: string, state: RenderState): void {
    if (state.rendering) {
      state.rerenderRequested = true;
      return;
    }

    void this.renderPath(path, state);
  }

  private async renderPath(path: string, state: RenderState): Promise<void> {
    state.rendering = true;

    try {
      await this.render(path);
    } catch {
      // Rendering failures are reported by the callback that owns the render.
    }

    state.rendering = false;

    if (state.rerenderRequested) {
      state.rerenderRequested = false;
      if (
        state.timer === undefined &&
        this.states.get(path) === state
      ) {
        void this.renderPath(path, state);
        return;
      }
    }

    if (state.timer === undefined && this.states.get(path) === state) {
      this.states.delete(path);
    }
  }
}
