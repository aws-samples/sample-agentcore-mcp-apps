/**
 * Build script:
 * 1. Bundles widget HTML files with Vite (inlines the @modelcontextprotocol/ext-apps SDK)
 * 2. Bundles the MCP server with esbuild into dist/main.js
 * 3. Copies the bundled widgets to dist/widgets/
 */

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = resolve(__dirname, "dist");
const distWidgetsDir = resolve(distDir, "widgets");
const srcWidgetsDir = resolve(__dirname, "src", "widgets");

// Clean dist
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
mkdirSync(distWidgetsDir, { recursive: true });

// --- Step 1: Bundle widgets with Vite (inlines ext-apps SDK into each HTML) ---

const widgetInputs = [
  "unicorn-list.html",
  "booking-confirmation.html",
  "availability.html",
];

console.log("Building widgets with Vite...");

for (const widget of widgetInputs) {
  await viteBuild({
    plugins: [viteSingleFile()],
    root: srcWidgetsDir,
    build: {
      outDir: distWidgetsDir,
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(srcWidgetsDir, widget),
      },
    },
    logLevel: "warn",
  });
}

console.log("Widgets built successfully.");

// --- Step 2: Bundle the server with esbuild ---

await esbuild({
  entryPoints: [resolve(__dirname, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: resolve(distDir, "main.js"),
  sourcemap: false,
  minify: true,
  external: [],
  banner: {
    js: `
import { createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';
const require = createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
`.trim(),
  },
});

// --- Step 3: Done ---

console.log("Build complete: dist/main.js + dist/widgets/");
