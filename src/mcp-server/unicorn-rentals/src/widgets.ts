// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Widget loader — reads HTML widget files from the widgets directory.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve widgets directory: in the deployment package, widgets/ is a sibling of main.js.
// During local dev/build (src/ or dist/), widgets/ is one level up.
// Try the sibling path first (deployed), then fall back to parent (local dev/build).
const WIDGET_DIR = existsSync(resolve(__dirname, "widgets"))
  ? resolve(__dirname, "widgets")
  : resolve(__dirname, "..", "widgets");

/**
 * Load a widget HTML file from the widgets directory.
 */
export function loadWidget(name: string): string {
  try {
    const widgetPath = resolve(WIDGET_DIR, name);
    return readFileSync(widgetPath, "utf-8");
  } catch {
    return `<html><body>Widget ${name} not found</body></html>`;
  }
}
