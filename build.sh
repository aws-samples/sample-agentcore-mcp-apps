#!/bin/bash
# =============================================================================
# Build Script: Prepares all artifacts for CDK deployment
#
# This script handles:
#   1. Packaging the MCP Server for AgentCore Runtime (Vite + esbuild + zip)
#
# Options:
#   --clean   Force a clean install of dependencies (removes node_modules and
#             package-lock.json). Recommended for CI to ensure reproducible builds.
#             Without this flag, existing node_modules are reused for faster local
#             iteration.
#
# After running this script, deploy with:
#   cd infrastructure/cdk && npm install && npx cdk deploy
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Parse flags
CLEAN_INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN_INSTALL=true ;;
  esac
done

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Prerequisite check
for cmd in node npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo -e "${RED}Error: '$cmd' not found. See README prerequisites.${NC}"; exit 1; }
done

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Building deployment artifacts${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# Step 1: Package the MCP Server
# =============================================================================
echo -e "${GREEN}[1/1] Packaging MCP Server for AgentCore Runtime...${NC}"

MCP_SERVER_DIR="$PROJECT_ROOT/src/mcp-server/unicorn-rentals"
BUILD_DIR="$PROJECT_ROOT/build"
STAGING_DIR="$BUILD_DIR/deployment_package"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$STAGING_DIR"

# Install dependencies
# Use --clean flag to wipe node_modules for reproducible CI builds;
# otherwise reuse existing modules for faster local iteration.
cd "$MCP_SERVER_DIR"
if [ "$CLEAN_INSTALL" = true ]; then
    echo "      Clean install (--clean flag set)..."
    rm -rf node_modules package-lock.json
fi
npm install --silent

# Build the server (Vite widgets + esbuild bundle)
npm run build

# Stage deployment package
if [ ! -f "$MCP_SERVER_DIR/dist/main.js" ]; then
    echo -e "${RED}Error: dist/main.js not found. Build may have failed.${NC}"
    exit 1
fi
if [ ! -d "$MCP_SERVER_DIR/dist/widgets" ]; then
    echo -e "${RED}Error: dist/widgets directory not found. Build may have failed.${NC}"
    exit 1
fi
cp "$MCP_SERVER_DIR/dist/main.js" "$STAGING_DIR/"
cp -r "$MCP_SERVER_DIR/dist/widgets" "$STAGING_DIR/widgets"

# Minimal package.json for AgentCore Runtime
cat > "$STAGING_DIR/package.json" << 'EOF'
{
  "name": "unicorn-rentals-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "main.js"
}
EOF

# Create deployment zip
cd "$STAGING_DIR"
zip -r "$BUILD_DIR/mcp-server-deployment.zip" .

echo "      Output: build/mcp-server-deployment.zip"
echo ""

# =============================================================================
# Done
# =============================================================================
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Build complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "Next steps:"
echo "  cd infrastructure/cdk"
echo "  npm install"
echo "  npx cdk deploy"
echo ""
