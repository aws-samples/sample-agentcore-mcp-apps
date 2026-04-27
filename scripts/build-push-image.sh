#!/bin/bash
# Build and push MCP server container image to ECR.
# Usage: ./build-push-image.sh [python|typescript]
set -euo pipefail

LANGUAGE="${1:-python}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="unicorn-mcp-server"
IMAGE_TAG="latest"

case "$LANGUAGE" in
  python)     CONTEXT_DIR="$(dirname "$0")/../mcp-server/python" ;;
  typescript) CONTEXT_DIR="$(dirname "$0")/../mcp-server/typescript" ;;
  *) echo "Usage: $0 [python|typescript]"; exit 1 ;;
esac

echo "Building $LANGUAGE MCP server image..."
docker build -t "${ECR_REPO}:${IMAGE_TAG}" "$CONTEXT_DIR"

echo "Logging into ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "Tagging and pushing image..."
docker tag "${ECR_REPO}:${IMAGE_TAG}" "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
docker push "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"

echo "Done! Image pushed to: ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
