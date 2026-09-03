import type { TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { writeSvgToVault } from "../src/svg-output";

describe("SVG Vault output", () => {
  it("creates and returns a missing sibling SVG", async () => {
    const created = { path: "Architecture/main.svg" } as TFile;
    const create = vi.fn(async () => created);
    const modify = vi.fn();
    const vault = {
      getFileByPath: () => null,
      create,
      modify
    } as unknown as Vault;

    await expect(
      writeSvgToVault(vault, "Architecture/main.svg", "<svg />")
    ).resolves.toBe(created);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      "Architecture/main.svg",
      "<svg />"
    );
    expect(modify).not.toHaveBeenCalled();
  });

  it("modifies and returns an existing sibling SVG", async () => {
    const existing = { path: "Architecture/main.svg" } as TFile;
    const create = vi.fn();
    const modify = vi.fn(async () => {});
    const vault = {
      getFileByPath: () => existing,
      create,
      modify
    } as unknown as Vault;

    await expect(
      writeSvgToVault(vault, "Architecture/main.svg", "<svg>new</svg>")
    ).resolves.toBe(existing);
    expect(modify).toHaveBeenCalledOnce();
    expect(modify).toHaveBeenCalledWith(existing, "<svg>new</svg>");
    expect(create).not.toHaveBeenCalled();
  });
});
