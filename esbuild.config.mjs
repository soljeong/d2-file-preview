import esbuild from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifest = require("./manifest.json");
const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr"],
  format: "cjs",
  platform: "browser",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}

console.log(`${manifest.name} ${prod ? "production build" : "development watcher"} ready`);
