#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Package the Node.js MCP server for AgentCore Runtime deployment.
#
# Use this script if you've only changed the MCP server and want to rebuild
# just that component without rebuilding the API Gateway Proxy Lambda.
# For a full build (proxy + MCP server), use the root build.sh instead.
#
# This script:
# 1. Installs dependencies
# 2. Builds the TypeScript server with esbuild (bundled into single file)
# 3. Creates a deployment zip with the bundled server + widgets + node_modules (for native deps)
#
# Output: build/mcp-server-deployment.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_SERVER_DIR="$PROJECT_ROOT/src/mcp-server/unicorn-rentals"
BUILD_DIR="$PROJECT_ROOT/build"
STAGING_DIR="$BUILD_DIR/deployment_package"

echo "=== Packaging MCP Server (Node.js) ==="

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$STAGING_DIR"

# Install dependencies for the build host (Vite/Rollup/esbuild need native binaries to run).
# The build output is pure JS, so it runs on any architecture including ARM64.
# Remove package-lock.json to avoid npm optional dependency resolution bugs.
echo "Installing dependencies..."
cd "$MCP_SERVER_DIR"
rm -rf node_modules package-lock.json
npm install

# Build the server (esbuild bundle)
echo "Building server..."
npm run build

# Copy bundled output to staging
echo "Staging deployment package..."
cp "$MCP_SERVER_DIR/dist/main.js" "$STAGING_DIR/"
cp -r "$MCP_SERVER_DIR/dist/widgets" "$STAGING_DIR/widgets"

# Copy package.json for Node.js runtime detection
cat > "$STAGING_DIR/package.json" << 'EOF'
{
  "name": "unicorn-rentals-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "main.js"
}
EOF

# Create the deployment zip
echo "Creating deployment zip..."
cd "$STAGING_DIR"
zip -r "$BUILD_DIR/mcp-server-deployment.zip" .

echo "=== Done: $BUILD_DIR/mcp-server-deployment.zip ==="
ls -lh "$BUILD_DIR/mcp-server-deployment.zip"
