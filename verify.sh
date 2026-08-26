#!/bin/bash
# =============================================================================
# Verify Script: smoke-test the deployed MCP endpoint
#
# The Gateway sits behind a CloudFront front door protected by AWS WAF
# (CLOUDFRONT scope, deployed in us-east-1) with a default-deny policy that
# only allows the ChatGPT and Claude egress ranges. That means you cannot call
# your own endpoint straight after deploying — every request returns HTTP 403.
# This script closes that gap:
#
#   1. Reads the front-door MCP URL from the deployed stack outputs
#   2. Confirms WAF blocks unlisted IPs, then temporarily allowlists yours
#   3. Runs initialize -> tools/list -> tools/call list_unicorns, plus the
#      OAuth protected-resource discovery endpoint (CloudFront Function)
#   4. Removes your IP again (always, even if a test fails or you Ctrl-C)
#
# Usage:
#   ./verify.sh                       # verify the default stack
#   ./verify.sh --stack MyStackName   # verify a differently-named stack
#   ./verify.sh --keep-ip             # leave your IP allowlisted (for MCP Inspector)
# =============================================================================

set -euo pipefail

STACK_NAME="AgentCoreMcpStack"
KEEP_IP="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --stack)    STACK_NAME="$2"; shift 2 ;;
    --keep-ip)  KEEP_IP="true"; shift ;;
    -h|--help)  sed -n '2,22p' "$0"; exit 0 ;;
    *)          echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

fail() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }
pass() { echo -e "      ${GREEN}PASS${NC} $1"; }
bad()  { echo -e "      ${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }

FAILURES=0
IP_ADDED="false"

for cmd in aws curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || fail "'$cmd' not found."
done

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
[ -n "$REGION" ] || fail "No AWS region configured. Set AWS_REGION or run 'aws configure'."

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Verify deployment${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# Step 1: Read the Gateway URL from the stack outputs
# =============================================================================
echo -e "${GREEN}[1/4] Reading stack outputs...${NC}"

GATEWAY_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayResourceUrl'].OutputValue" \
  --output text 2>/dev/null || true)"

[ -n "$GATEWAY_URL" ] && [ "$GATEWAY_URL" != "None" ] \
  || fail "Could not read GatewayResourceUrl from stack '$STACK_NAME' in $REGION. Has ./deploy.sh finished successfully?"

echo "      $GATEWAY_URL"

# Cognito inbound auth (present only on `-c auth=cognito` deployments): fetch a
# client_credentials access token so the MCP calls below carry a valid JWT.
ACCESS_TOKEN=""
TOKEN_ENDPOINT="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoTokenEndpoint'].OutputValue" \
  --output text 2>/dev/null || true)"
if [ -n "$TOKEN_ENDPOINT" ] && [ "$TOKEN_ENDPOINT" != "None" ]; then
  CLIENT_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoClientId'].OutputValue" --output text)"
  POOL_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" --output text)"
  CLIENT_SECRET="$(aws cognito-idp describe-user-pool-client --region "$REGION" \
    --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
    --query 'UserPoolClient.ClientSecret' --output text)"
  ACCESS_TOKEN="$(curl -4 -fsS -m 20 -X POST "$TOKEN_ENDPOINT" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -u "${CLIENT_ID}:${CLIENT_SECRET}" \
    -d 'grant_type=client_credentials&scope=mcp-gateway/invoke' \
    | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")" \
    || fail "Could not obtain a Cognito access token from $TOKEN_ENDPOINT."
  echo "      Cognito auth detected — obtained a client_credentials token"
fi
echo ""

# =============================================================================
# Step 2: Temporarily allowlist this machine's public IP
#
# The cleanup trap is registered before the IP is added, so an interrupted or
# failing run still tidies up rather than leaving the endpoint open.
# =============================================================================
echo -e "${GREEN}[2/4] Allowlisting your IP in WAF...${NC}"

# The Web ACL is CLOUDFRONT-scoped, so all WAF API calls go to us-east-1
# regardless of where the application stack deployed.
WAF_REGION="us-east-1"

# Prove the WAF front door is actually enforcing before poking holes in it.
# All endpoint calls force IPv4 (-4): the allowlist IP sets are IPv4-only, and
# CloudFront (unlike the regional Gateway endpoint) is dual-stack — a machine
# with IPv6 would otherwise reach it from an address the allowlist can't match.
BLOCKED_CODE="$(curl -4 -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$GATEWAY_URL" \
  -H "Content-Type: application/json" -d '{}' || true)"
if [ "$BLOCKED_CODE" = "403" ]; then
  pass "WAF default-deny (got 403 before allowlisting)"
else
  bad "WAF default-deny — expected 403 before allowlisting, got '$BLOCKED_CODE'"
fi

IP_SET_NAME="$(aws wafv2 list-ip-sets --scope CLOUDFRONT --region "$WAF_REGION" \
  --query "IPSets[?contains(Name, 'chatgpt-ips')].Name | [0]" --output text 2>/dev/null || true)"
IP_SET_ID="$(aws wafv2 list-ip-sets --scope CLOUDFRONT --region "$WAF_REGION" \
  --query "IPSets[?contains(Name, 'chatgpt-ips')].Id | [0]" --output text 2>/dev/null || true)"

[ -n "$IP_SET_ID" ] && [ "$IP_SET_ID" != "None" ] \
  || fail "Could not find the CLOUDFRONT-scope WAF IP set for this stack in $WAF_REGION."

MY_IP="$(curl -4 -fsS -m 10 https://checkip.amazonaws.com | tr -d '[:space:]')" \
  || fail "Could not determine your public IP address."
MY_CIDR="${MY_IP}/32"

# Rewrite the IP set's address list, adding or removing our CIDR.
# WAF requires the current lock token, so always re-read immediately before writing.
update_ip_set() {
  local mode="$1"  # add | remove
  python3 - "$WAF_REGION" "$IP_SET_NAME" "$IP_SET_ID" "$MY_CIDR" "$mode" <<'PY'
import json, subprocess, sys
region, name, ip_id, cidr, mode = sys.argv[1:6]

def aws(*args):
    return subprocess.run(["aws", *args], check=True, capture_output=True, text=True).stdout

info = json.loads(aws("wafv2", "get-ip-set", "--scope", "CLOUDFRONT", "--region", region,
                      "--name", name, "--id", ip_id))
addrs = list(info["IPSet"]["Addresses"])
lock = info["LockToken"]

if mode == "add":
    if cidr in addrs:
        print("already-present"); sys.exit(0)
    addrs.append(cidr)
else:
    if cidr not in addrs:
        print("already-absent"); sys.exit(0)
    addrs = [a for a in addrs if a != cidr]

aws("wafv2", "update-ip-set", "--scope", "CLOUDFRONT", "--region", region,
    "--name", name, "--id", ip_id, "--lock-token", lock, "--addresses", *addrs)
print("ok")
PY
}

cleanup() {
  if [ "$IP_ADDED" = "true" ] && [ "$KEEP_IP" != "true" ]; then
    echo ""
    echo -e "${GREEN}[4/4] Removing your IP from the WAF allowlist...${NC}"
    if update_ip_set remove >/dev/null 2>&1; then
      echo "      Removed $MY_CIDR — the endpoint is locked down again."
    else
      warn_msg="Could not remove $MY_CIDR from WAF IP set '$IP_SET_NAME'. Remove it manually so the endpoint is not left open."
      echo -e "${RED}${warn_msg}${NC}" >&2
    fi
  elif [ "$IP_ADDED" = "true" ]; then
    echo ""
    echo -e "${YELLOW}[4/4] --keep-ip set: leaving $MY_CIDR allowlisted.${NC}"
    echo "      Remember to remove it when you are done."
  fi
}
trap cleanup EXIT INT TERM

update_ip_set add >/dev/null
IP_ADDED="true"
echo "      Added $MY_CIDR to '$IP_SET_NAME'"
echo "      Waiting for the WAF rule to propagate to the edge..."
sleep 30
echo ""

# =============================================================================
# Step 3: Exercise the MCP endpoint
# =============================================================================
echo -e "${GREEN}[3/4] Testing the MCP endpoint...${NC}"

# Tools are exposed through the Gateway as "<target>___<tool>", so discover the
# real name from tools/list rather than assuming the bare "list_unicorns".
mcp_call() {
  if [ -n "$ACCESS_TOKEN" ]; then
    curl -4 -fsS -m 45 -X POST "$GATEWAY_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -d "$1" 2>/dev/null
  else
    curl -4 -fsS -m 45 -X POST "$GATEWAY_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d "$1" 2>/dev/null
  fi
}

# With Cognito auth enabled, an allowlisted request without a token must still
# be rejected by the Gateway itself (this is what closes the WAF-bypass gap).
if [ -n "$ACCESS_TOKEN" ]; then
  NOAUTH_CODE="$(curl -4 -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$GATEWAY_URL" \
    -H "Content-Type: application/json" -d '{}' || true)"
  case "$NOAUTH_CODE" in
    401|403) pass "gateway rejects requests without a Cognito token (HTTP $NOAUTH_CODE)" ;;
    *)       bad  "gateway accepted an unauthenticated request (HTTP $NOAUTH_CODE)" ;;
  esac
fi

INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"verify.sh","version":"1.0"}}}'
if RESP="$(mcp_call "$INIT_BODY")" && printf '%s' "$RESP" | grep -q '"protocolVersion"'; then
  pass "initialize"
else
  bad "initialize — $(printf '%s' "${RESP:-no response}" | head -c 200)"
fi

LIST_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
TOOL_NAME=""
if RESP="$(mcp_call "$LIST_BODY")"; then
  TOOL_NAME="$(printf '%s' "$RESP" | python3 -c "
import sys, json
try:
    tools = json.load(sys.stdin)['result']['tools']
except Exception:
    sys.exit(0)
print(next((t['name'] for t in tools if t['name'].endswith('list_unicorns')), ''))
" 2>/dev/null)"
fi
if [ -n "$TOOL_NAME" ]; then
  pass "tools/list (found $TOOL_NAME)"
else
  bad "tools/list — could not find a list_unicorns tool"
fi

if [ -n "$TOOL_NAME" ]; then
  CALL_BODY="$(printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"%s","arguments":{"unicorn_type":"all"}}}' "$TOOL_NAME")"
  if RESP="$(mcp_call "$CALL_BODY")"; then
    TOTAL="$(printf '%s' "$RESP" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin)['result']['structuredContent']['total'])
except Exception:
    print('')
" 2>/dev/null)"
    if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] 2>/dev/null; then
      pass "tools/call list_unicorns — returned $TOTAL unicorns"
    else
      bad "tools/call list_unicorns — unexpected response: $(printf '%s' "$RESP" | head -c 200)"
    fi
  else
    bad "tools/call list_unicorns — request failed"
  fi
fi

# The CloudFront Function must answer OAuth discovery with the front-door
# domain (not the *.gateway.bedrock-agentcore.* origin domain).
FRONT_HOST="$(printf '%s' "$GATEWAY_URL" | sed -E 's#https://([^/]+).*#\1#')"
DISCOVERY_URL="https://${FRONT_HOST}/.well-known/oauth-protected-resource"
if RESP="$(curl -4 -fsS -m 30 "$DISCOVERY_URL" 2>/dev/null)" \
   && printf '%s' "$RESP" | grep -q "https://${FRONT_HOST}/mcp"; then
  pass "oauth-protected-resource discovery returns the front-door domain"
  if [ -n "$ACCESS_TOKEN" ] && ! printf '%s' "$RESP" | grep -q "cognito-idp"; then
    bad "oauth-protected-resource discovery — Cognito issuer missing from authorization_servers"
  fi
else
  bad "oauth-protected-resource discovery — unexpected response: $(printf '%s' "${RESP:-no response}" | head -c 200)"
fi

# cleanup() runs here via the EXIT trap, then we report.
if [ "$FAILURES" -eq 0 ]; then
  trap - EXIT; cleanup; trap - INT TERM
  echo ""
  echo -e "${BLUE}============================================${NC}"
  echo -e "${GREEN}  All checks passed — your deployment works.${NC}"
  echo -e "${BLUE}============================================${NC}"
  echo ""
  echo "MCP Server URL for your AI host:"
  echo "  $GATEWAY_URL"
  exit 0
else
  trap - EXIT; cleanup; trap - INT TERM
  echo ""
  echo -e "${RED}$FAILURES check(s) failed.${NC}" >&2
  echo "Troubleshooting: confirm ./deploy.sh completed, and see the Security" >&2
  echo "section of the README for how WAF gates access to the endpoint." >&2
  exit 1
fi
