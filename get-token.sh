#!/bin/bash
# =============================================================================
# get-token.sh — mint a Cognito access token for the deployed MCP endpoint
#
# Only meaningful for `-c auth=cognito` deployments: reads the stack outputs,
# fetches the app-client secret, and prints a client_credentials access token
# (valid 1 hour) to stdout. Use it as:
#
#   TOKEN=$(./get-token.sh)
#   curl -4 https://<front-door>/mcp -H "Authorization: Bearer $TOKEN" ...
#
#   ./get-token.sh --header        # print "Authorization: Bearer <token>"
#   ./get-token.sh --stack MyStack # non-default stack name
# =============================================================================
set -euo pipefail

STACK_NAME="AgentCoreMcpStack"
AS_HEADER="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --stack)  STACK_NAME="$2"; shift 2 ;;
    --header) AS_HEADER="true"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
[ -n "$REGION" ] || { echo "Error: no AWS region configured." >&2; exit 1; }

out() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

TOKEN_ENDPOINT="$(out CognitoTokenEndpoint || true)"
if [ -z "$TOKEN_ENDPOINT" ] || [ "$TOKEN_ENDPOINT" = "None" ]; then
  echo "Error: stack '$STACK_NAME' has no CognitoTokenEndpoint output." >&2
  echo "This deployment uses No Auth inbound — no token is needed." >&2
  echo "(Deploy with './deploy.sh -c auth=cognito' to enable Cognito auth.)" >&2
  exit 1
fi

CLIENT_ID="$(out CognitoClientId)"
CLIENT_SECRET="$(aws cognito-idp describe-user-pool-client --region "$REGION" \
  --user-pool-id "$(out CognitoUserPoolId)" --client-id "$CLIENT_ID" \
  --query 'UserPoolClient.ClientSecret' --output text)"

TOKEN="$(curl -4 -fsS -m 20 -X POST "$TOKEN_ENDPOINT" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -d 'grant_type=client_credentials&scope=mcp-gateway/invoke' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")"

if [ "$AS_HEADER" = "true" ]; then
  printf 'Authorization: Bearer %s\n' "$TOKEN"
else
  printf '%s\n' "$TOKEN"
fi
