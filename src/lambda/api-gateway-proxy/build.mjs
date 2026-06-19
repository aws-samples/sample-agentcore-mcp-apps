// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Build script for the API Gateway proxy Lambda.
 * Bundles into a single file for Lambda deployment.
 */

import { build } from "esbuild";
import { rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = resolve(__dirname, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [resolve(__dirname, "src/proxy.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: resolve(distDir, "index.mjs"),
  sourcemap: false,
  minify: false,
  external: ["@aws-sdk/*"],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

console.log("Proxy Lambda build complete: dist/index.mjs");
