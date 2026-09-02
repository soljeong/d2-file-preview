import type { ChildProcess, ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runD2 } from "../src/renderer";

vi.mock("node:child_process", () => ({
  execFile: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  rename: vi.fn(),
  rm: vi.fn()
}));

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string
) => void;

type CleanupAggregateError = Error & {
  primaryError: Error;
  cleanupError: Error;
};

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const renameMock = vi.mocked(rename);
const rmMock = vi.mocked(rm);

function expectCleanupAggregate(
  error: Error,
  primaryError: Error,
  cleanupError: Error
): void {
  const aggregate = error as CleanupAggregateError;
  expect(aggregate.name).toBe("D2CleanupError");
  expect(aggregate.primaryError).toBe(primaryError);
  expect(aggregate.cleanupError).toBe(cleanupError);
  expect(aggregate.message).toContain(primaryError.message);
  expect(aggregate.message).toContain(cleanupError.message);
}

describe("transaction cleanup diagnostics", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    renameMock.mockReset();
    rmMock.mockReset();
  });

  it("retains the child error when cleanup also fails", async () => {
    const processError = Object.assign(new Error("D2 exited nonzero"), {
      code: 1
    });
    const cleanupError = new Error("temporary SVG is locked");
    execFileMock.mockImplementationOnce(
      (
        _executable: string,
        _arguments: string[],
        _options: { windowsHide: boolean },
        callback: ExecFileCallback
      ): ChildProcess => {
        callback(processError, "partial output", "syntax error");
        return {} as ChildProcess;
      }
    );
    rmMock.mockRejectedValueOnce(cleanupError);

    const result = await runD2("d2", "network.d2", "network.svg");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected process failure");
    expectCleanupAggregate(result.error, processError, cleanupError);
    expect(result.stdout).toBe("partial output");
    expect(result.stderr).toBe("syntax error");
  });

  it("retains the replacement error when cleanup also fails", async () => {
    const replacementError = new Error("cannot replace final SVG");
    const cleanupError = new Error("cannot remove temporary SVG");
    execFileMock.mockImplementationOnce(
      (
        _executable: string,
        _arguments: string[],
        _options: { windowsHide: boolean },
        callback: ExecFileCallback
      ): ChildProcess => {
        callback(null, "render complete", "render warning");
        return {} as ChildProcess;
      }
    );
    renameMock.mockRejectedValueOnce(replacementError);
    rmMock.mockRejectedValueOnce(cleanupError);

    const result = await runD2("d2", "network.d2", "network.svg");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected replacement failure");
    expectCleanupAggregate(result.error, replacementError, cleanupError);
    expect(result.stdout).toBe("render complete");
    expect(result.stderr).toBe("render warning");
  });
});
