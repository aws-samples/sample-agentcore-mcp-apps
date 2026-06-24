#!/bin/bash
# =============================================================================
# Deploy Script: Build all artifacts and deploy via CDK
#
# This script handles:
#   1. Building artifacts (delegates to build.sh)
#   2. Installing CDK dependencies
#   3. Bootstrapping CDK (if not already done)
#   4. Deploying the stack via CDK
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

# Prerequisite check
for cmd in aws npx; do
  command -v "$cmd" >/dev/null 2>&1 || { echo -e "${RED}Error: '$cmd' not found. See README prerequisites.${NC}"; exit 1; }
done

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Build & Deploy${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# Step 1: Build all artifacts
# =============================================================================
echo -e "${GREEN}[1/4] Building artifacts...${NC}"

"$SCRIPT_DIR/build.sh"

echo ""

# =============================================================================
# Step 2: Install CDK dependencies
# =============================================================================
echo -e "${GREEN}[2/4] Installing CDK dependencies...${NC}"

cd "$CDK_DIR"
npm install --silent

echo "      Done."
echo ""

# =============================================================================
# Step 3: Bootstrap CDK (if needed)
# =============================================================================
echo -e "${GREEN}[3/4] Checking CDK bootstrap status...${NC}"

if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS credentials not configured or invalid. Please configure AWS CLI credentials.${NC}"
    exit 1
fi

if aws cloudformation describe-stacks --stack-name CDKToolkit > /dev/null 2>&1; then
    echo "      CDKToolkit stack found — bootstrap already complete."
else
    echo "      CDKToolkit stack not found — running cdk bootstrap..."
    npx cdk bootstrap
fi

echo ""

# =============================================================================
# Step 4: Deploy
# =============================================================================
echo -e "${GREEN}[4/4] Deploying AgentCoreMcpStack...${NC}"
echo ""

npx cdk deploy AgentCoreMcpStack "$CDK_ARGS"

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Deployment complete!${NC}"
echo -e "${BLUE}============================================${NC}"
