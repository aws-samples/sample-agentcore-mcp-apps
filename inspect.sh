#!/bin/bash
# =============================================================================
# inspect.sh — interactive testing with MCP Inspector, preconfigured correctly
#
# Wraps the two footguns that make manual testing fail with WAF 403s:
#   - Your IP must be in the WAF allowlist  -> run `./verify.sh --keep-ip` first
#   - Node resolves CloudFront to IPv6, but the allowlist is IPv4-only
#     -> Inspector is launched with --dns-result-order=ipv4first
#
# On Cognito deployments it also mints a token and prints the exact
# Authorization header to paste into Inspector's Custom Headers.
#
# Usage:
#   ./verify.sh --keep-ip   # once, to allowlist your IP (remove it later!)
#   ./inspect.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_NAME="${1:-AgentCoreMcpStack}"

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
[ -n "$REGION" ] || { echo "Error: no AWS region configured." >&2; exit 1; }

MCP_URL="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayResourceUrl'].OutputValue" --output text)"
[ -n "$MCP_URL" ] && [ "$MCP_URL" != "None" ] || { echo "Error: could not read GatewayResourceUrl." >&2; exit 1; }

echo "MCP endpoint (transport: Streamable HTTP):"
echo "  $MCP_URL"
echo ""

if AUTH_HEADER="$("$SCRIPT_DIR/get-token.sh" --stack "$STACK_NAME" --header 2>/dev/null)"; then
  echo "Cognito deployment — add this Custom Header in Inspector (valid 1 hour):"
  echo "  $AUTH_HEADER"
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "${AUTH_HEADER#Authorization: }" | pbcopy
    echo "  (header value copied to clipboard)"
  fi
else
  echo "No Auth deployment — no Authorization header needed."
fi
echo ""
echo "Reminder: your IP must be allowlisted (./verify.sh --keep-ip) or WAF returns 403."
echo "Launching MCP Inspector (IPv4-first DNS)..."
echo ""

NODE_OPTIONS="--dns-result-order=ipv4first" exec npx -y @modelcontextprotocol/inspector
