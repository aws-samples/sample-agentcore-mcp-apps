#!/bin/bash
# ============================================================================
# package-mcp-server.sh
#
# Creates a deployment zip for the Unicorn Rentals MCP server to be deployed
# on Amazon Bedrock AgentCore Runtime using direct code deployment.
#
# The zip contains:
#   - main.py (entry point)
#   - widgets/ (HTML widget templates)
#   - All Python dependencies installed from requirements.txt
#
# Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/
#            runtime-get-started-code-deploy-python.html
#
# Usage:
#   ./src/scripts/package-mcp-server.sh
# ============================================================================

set -euo pipefail

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MCP_SERVER_DIR="${PROJECT_ROOT}/src/mcp-server/unicorn-rentals"
BUILD_DIR="${PROJECT_ROOT}/build"
PACKAGE_DIR="${BUILD_DIR}/deployment_package"
OUTPUT_ZIP="${BUILD_DIR}/mcp-server-deployment.zip"
PYTHON_VERSION="python3.13"
TARGET_PLATFORM="manylinux2014_aarch64"

echo "============================================"
echo " AgentCore Runtime - MCP Server Packager"
echo "============================================"
echo ""
echo "Source directory : ${MCP_SERVER_DIR}"
echo "Build directory  : ${BUILD_DIR}"
echo "Output zip       : ${OUTPUT_ZIP}"
echo ""

# --- Step 1: Clean previous build artifacts ---
echo "[1/4] Cleaning previous build artifacts..."
rm -rf "${PACKAGE_DIR}"
rm -f "${OUTPUT_ZIP}"
mkdir -p "${PACKAGE_DIR}"

# --- Step 2: Install dependencies ---
echo "[2/4] Installing dependencies into deployment package..."
pip install \
    --target "${PACKAGE_DIR}" \
    --platform "${TARGET_PLATFORM}" \
    --implementation cp \
    --python-version 3.13 \
    --only-binary=:all: \
    --upgrade \
    -r "${MCP_SERVER_DIR}/requirements.txt"

# --- Step 3: Copy application source code ---
echo "[3/4] Copying application source code..."
cp "${MCP_SERVER_DIR}/main.py" "${PACKAGE_DIR}/"
cp -r "${MCP_SERVER_DIR}/widgets" "${PACKAGE_DIR}/"

# Remove unnecessary files to reduce package size
echo "       Removing __pycache__ and test directories..."
find "${PACKAGE_DIR}" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "${PACKAGE_DIR}" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "${PACKAGE_DIR}" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true

# --- Step 4: Create zip archive ---
echo "[4/4] Creating deployment zip archive..."
cd "${PACKAGE_DIR}"
zip -qr "${OUTPUT_ZIP}" . -x "*.pyc" "*.pyo"
cd "${PROJECT_ROOT}"

# --- Summary ---
# Clean up the intermediate deployment_package directory
rm -rf "${PACKAGE_DIR}"

ZIP_SIZE=$(du -h "${OUTPUT_ZIP}" | cut -f1)
echo ""
echo "============================================"
echo " Packaging complete!"
echo "============================================"
echo " Output: ${OUTPUT_ZIP}"
echo " Size:   ${ZIP_SIZE}"
echo ""
echo " Next steps:"
echo "   1. Run 'cdk deploy' to upload the zip to S3 and create AgentCore Runtime"
echo "   2. The CDK stack will reference this zip for the AgentCore Runtime resource"
echo "============================================"
