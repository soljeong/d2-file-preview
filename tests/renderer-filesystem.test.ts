import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runD2 } from "../src/renderer";

describe("transactional D2 output", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "d2-file-preview-render-"));
  });

  afterEach(async () => {
    await rm(testDirectory, { recursive: true, force: true });
  });

  it("preserves the existing SVG when D2 writes garbage and exits nonzero", async () => {
    const fakeD2Path = path.join(testDirectory, "fake-failing-d2.cjs");
    const outputPath = path.join(testDirectory, "network.svg");
    const validSvg = '<svg aria-label="last successful render"></svg>';
    await writeFile(
      fakeD2Path,
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync(process.argv[2], "garbage from failed render");',
        'process.stderr.write("syntax error");',
        "process.exit(7);"
      ].join("\n")
    );
    await writeFile(outputPath, validSvg);

    const result = await runD2(process.execPath, fakeD2Path, outputPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected process failure");
    expect(result.error).toBeInstanceOf(Error);
    expect(result.stderr).toBe("syntax error");
    expect(await readFile(outputPath, "utf8")).toBe(validSvg);
    expect((await readdir(testDirectory)).sort()).toEqual(
      ["fake-failing-d2.cjs", "network.svg"].sort()
    );
  });

  it("replaces the final SVG only after success and removes the temporary output", async () => {
    const fakeD2Path = path.join(testDirectory, "fake-successful-d2.cjs");
    const outputPath = path.join(testDirectory, "network.svg");
    await writeFile(
      fakeD2Path,
      [
        'const fs = require("node:fs");',
        "const payload = { marker: \"new render\", outputPath: process.argv[2] };",
        'fs.writeFileSync(process.argv[2], JSON.stringify(payload));'
      ].join("\n")
    );
    await writeFile(outputPath, "old render");

    const result = await runD2(process.execPath, fakeD2Path, outputPath);
    const rendered = JSON.parse(await readFile(outputPath, "utf8")) as {
      marker: string;
      outputPath: string;
    };

    expect(result).toEqual({ ok: true });
    expect(rendered.marker).toBe("new render");
    expect(rendered.outputPath).not.toBe(outputPath);
    expect(path.dirname(rendered.outputPath)).toBe(testDirectory);
    expect(path.basename(rendered.outputPath)).toMatch(
      /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp\.svg$/
    );
    expect((await readdir(testDirectory)).sort()).toEqual(
      ["fake-successful-d2.cjs", "network.svg"].sort()
    );
  });

  it("cleans the temporary output when replacing the final SVG fails", async () => {
    const fakeD2Path = path.join(testDirectory, "fake-successful-d2.cjs");
    const outputPath = path.join(testDirectory, "network.svg");
    await writeFile(
      fakeD2Path,
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync(process.argv[2], "rendered output");',
        'process.stdout.write("render complete");'
      ].join("\n")
    );
    await mkdir(outputPath);

    const result = await runD2(process.execPath, fakeD2Path, outputPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected replacement failure");
    expect(result.stdout).toBe("render complete");
    expect((await readdir(testDirectory)).sort()).toEqual(
      ["fake-successful-d2.cjs", "network.svg"].sort()
    );
  });

  it("does not leave a temporary output after a synchronous launch error", async () => {
    const outputPath = path.join(testDirectory, "network.svg");
    await writeFile(outputPath, "last successful render");

    const result = await runD2("", "network.d2", outputPath);

    expect(result.ok).toBe(false);
    expect(await readFile(outputPath, "utf8")).toBe("last successful render");
    expect(await readdir(testDirectory)).toEqual(["network.svg"]);
  });
});
