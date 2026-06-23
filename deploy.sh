#!/bin/bash
# =============================================================================
# Deploy Script: Build all artifacts and deploy via CDK
#
# This script handles:
#   1. Building the API Gateway Proxy Lambda (esbuild bundle)
#   2. Packaging the MCP Server for AgentCore Runtime (Vite + esbuild + zip)
#   3. Installing CDK dependencies
#   4. Bootstrapping CDK (if not already done)
#   5. Deploying the stack via CDK
#
# Usage:
#   ./deploy.sh                  # Build and deploy (with approval prompt)
#   ./deploy.sh --require-approval never   # Auto-approve deployment
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
CDK_DIR="$PROJECT_ROOT/infrastructure/cdk"

# Pass-through args to cdk deploy (e.g. --require-approval never)
CDK_ARGS="${*}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Build & Deploy${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# Step 1: Build the API Gateway Proxy Lambda
# =============================================================================
echo -e "${GREEN}[1/5] Building API Gateway Proxy Lambda...${NC}"

PROXY_DIR="$PROJECT_ROOT/src/lambda/api-gateway-proxy"

cd "$PROXY_DIR"
npm install --silent
npm run build

echo "      Output: src/lambda/api-gateway-proxy/dist/index.mjs"
echo ""

# =============================================================================
# Step 2: Package the MCP Server
# =============================================================================
echo -e "${GREEN}[2/5] Packaging MCP Server for AgentCore Runtime...${NC}"

MCP_SERVER_DIR="$PROJECT_ROOT/src/mcp-server/unicorn-rentals"
BUILD_DIR="$PROJECT_ROOT/build"
STAGING_DIR="$BUILD_DIR/deployment_package"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$STAGING_DIR"

# Install dependencies (clean install for reproducible builds)
cd "$MCP_SERVER_DIR"
rm -rf node_modules package-lock.json
npm install --silent

# Build the server (Vite widgets + esbuild bundle)
npm run build

# Stage deployment package
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
# Step 3: Install CDK dependencies
# =============================================================================
echo -e "${GREEN}[3/5] Installing CDK dependencies...${NC}"

cd "$CDK_DIR"
npm install --silent

echo "      Done."
echo ""

# =============================================================================
# Step 4: Bootstrap CDK (if needed)
# =============================================================================
echo -e "${GREEN}[4/5] Checking CDK bootstrap status...${NC}"

if aws cloudformation describe-stacks --stack-name CDKToolkit > /dev/null 2>&1; then
    echo "      CDKToolkit stack found — bootstrap already complete."
else
    echo "      CDKToolkit stack not found — running cdk bootstrap..."
    npx cdk bootstrap
fi

echo ""

# =============================================================================
# Step 5: Deploy
# =============================================================================
echo -e "${GREEN}[5/5] Deploying AgentCoreMcpStack...${NC}"
echo ""

npx cdk deploy AgentCoreMcpStack $CDK_ARGS

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Deployment complete!${NC}"
echo -e "${BLUE}============================================${NC}"
