import esbuild from "esbuild";
import process from "process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";
const root = dirname(fileURLToPath(import.meta.url));

const context = await esbuild.context({
  absWorkingDir: root,
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: resolve(root, "main.js"),
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
