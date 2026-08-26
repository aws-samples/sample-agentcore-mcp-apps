#!/bin/bash
# =============================================================================
# Deploy Script: one command to build and deploy the whole solution
#
# This script handles:
#   1. Preflight checks (tooling, credentials, region support)
#   2. Building artifacts (delegates to build.sh)
#   3. Installing CDK dependencies
#   4. Bootstrapping CDK (if not already done)
#   5. Deploying the stack via CDK
#
# Usage:
#   ./deploy.sh                             # Build and deploy
#   ./deploy.sh --require-approval never    # Skip the IAM approval prompt
#   ./deploy.sh -c projectName=my-unicorns  # Any other cdk deploy args pass through
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
CDK_DIR="$PROJECT_ROOT/infrastructure/cdk"

# Minimum Node major version the MCP server and CDK app expect.
NODE_MIN_MAJOR=22

# AgentCore is not available in every region yet. Deploying elsewhere fails deep
# inside CloudFormation with an opaque error, so warn up front instead.
AGENTCORE_REGIONS="us-east-1 us-west-2 eu-central-1 ap-southeast-2"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

fail() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }
warn() { echo -e "${YELLOW}Warning: $1${NC}"; }

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Build & Deploy${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# Step 1: Preflight checks
#
# Everything here is cheap and catches the failures that are otherwise painful
# to diagnose: missing tooling, expired credentials, or an unsupported region.
# =============================================================================
echo -e "${GREEN}[1/5] Preflight checks...${NC}"

for cmd in aws node npx; do
  command -v "$cmd" >/dev/null 2>&1 || fail "'$cmd' not found. See the README prerequisites."
done

NODE_MAJOR="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
  fail "Node $NODE_MIN_MAJOR+ required (found $(node --version)). See the README prerequisites."
fi
echo "      Node $(node --version)"

# Credentials must be valid before we spend time building.
CALLER="$(aws sts get-caller-identity --output json 2>/dev/null)" \
  || fail "AWS credentials are not configured or have expired. Run 'aws configure' (or refresh your session) and try again."
ACCOUNT="$(printf '%s' "$CALLER" | sed -n 's/.*"Account": *"\([0-9]*\)".*/\1/p')"

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
[ -n "$REGION" ] || fail "No AWS region configured. Set AWS_REGION or run 'aws configure'."

echo "      Account $ACCOUNT / region $REGION"

# A region check, not a hard gate: the supported list changes over time and we
# would rather warn than block a legitimate deployment in a new region.
case " $AGENTCORE_REGIONS " in
  *" $REGION "*) : ;;
  *) warn "Amazon Bedrock AgentCore may not be available in '$REGION'. Known regions: $AGENTCORE_REGIONS. If deployment fails, retry with AWS_REGION=us-west-2." ;;
esac

echo ""

# =============================================================================
# Step 2: Build all artifacts
# =============================================================================
echo -e "${GREEN}[2/5] Building artifacts...${NC}"

bash "$SCRIPT_DIR/build.sh"

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

if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" > /dev/null 2>&1; then
    echo "      CDKToolkit stack found — bootstrap already complete."
else
    echo "      CDKToolkit stack not found — running cdk bootstrap..."
    npx cdk bootstrap
fi

# The CLOUDFRONT-scope WAF stack always deploys to us-east-1, so that region
# must be bootstrapped too when deploying the app elsewhere.
if [ "$REGION" != "us-east-1" ]; then
  if aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1 > /dev/null 2>&1; then
      echo "      CDKToolkit stack found in us-east-1 (WAF stack region)."
  else
      echo "      Bootstrapping us-east-1 for the WAF stack..."
      npx cdk bootstrap "aws://${ACCOUNT}/us-east-1"
  fi
fi

echo ""

# =============================================================================
# Step 5: Deploy
# =============================================================================
echo -e "${GREEN}[5/5] Deploying EdgeWafStack (us-east-1) + AgentCoreMcpStack...${NC}"
echo "      This usually takes 10-20 minutes, occasionally longer. Everything"
echo "      except CloudFront is done in the first few minutes; the CLI then"
echo "      looks stalled around 43/49 while CloudFront propagates. That is"
echo "      expected — leave it running unless you see an actual error."
echo ""

# "$@" (not a single joined string) so multi-word args survive intact.
# --all deploys EdgeWafStack first (AgentCoreMcpStack depends on its Web ACL).
npx cdk deploy --all "$@"

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Deployment complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "Next steps:"
echo "  ./verify.sh    # smoke-test the deployed MCP endpoint"
echo ""
echo "Copy the GatewayResourceUrl output above into your AI host — see"
echo "docs/chatgpt-setup.md or docs/claude-setup.md."
