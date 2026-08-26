# AGENTS.md — deploying and testing this sample

Guidance for AI coding agents (and humans in a hurry). Read the README for the
architecture; this file is the operational fast path.

## What you are deploying

Two CDK stacks (`infrastructure/cdk`):

- **`EdgeWafStack`** — always deploys to **us-east-1** (CLOUDFRONT-scope WAF
  Web ACLs can only live there). ChatGPT/Claude IP allowlist, AWS managed
  rules, rate limiting, default action BLOCK.
- **`AgentCoreMcpStack`** — deploys to your configured region (AgentCore
  regions: us-east-1, us-west-2, eu-central-1, ap-southeast-2). Contains the
  AgentCore Runtime + Gateway, the business Lambda/DynamoDB, and a
  **CloudFront front door** for the Gateway with the WAF attached and a
  CloudFront Function serving `/.well-known/oauth-protected-resource`.

The public MCP endpoint is the **`GatewayResourceUrl`** stack output
(`https://<distribution>.cloudfront.net/mcp`). The `GatewayDirectUrl` output is
the raw Gateway URL — it bypasses CloudFront/WAF; never hand it out.

## Prerequisites

- Node.js >= 22, AWS CLI, valid credentials (`aws sts get-caller-identity`)
- `AWS_REGION` set (deploy fails without a region)
- If deploying outside us-east-1: nothing extra — `deploy.sh` bootstraps
  us-east-1 for the WAF stack automatically.

## Deploy

```bash
./deploy.sh --require-approval never            # No Auth gateway (default)
./deploy.sh --require-approval never -c auth=cognito   # Cognito JWT inbound auth
```

Everything after `deploy.sh` is passed to `cdk deploy` verbatim, so `-c`
context flags and `--tags` work. Expect ~6–20 minutes; the CLI looks stalled
while the two CloudFront distributions propagate — that is normal.

### Auth modes

| Mode | Gateway inbound | Notes |
|---|---|---|
| default (`auth=none`) | No Auth | WAF IP allowlist is the only gate. The raw Gateway URL is unauthenticated — treat it as secret. |
| `-c auth=cognito` | Cognito JWT (client_credentials) | Creates a machine-to-machine User Pool + app client + hosted domain. Requests without a valid Bearer token are rejected by the Gateway itself, so the direct-URL bypass is closed. The CloudFront Function advertises the Cognito issuer in `authorization_servers`. |

Switching modes **replaces the Gateway** (the service forbids in-place
authorizer-type changes; the CDK bakes the mode into the gateway's logical ID
to force it). No teardown needed, but the `GatewayDirectUrl` changes — the
public CloudFront `GatewayResourceUrl` stays the same.

## Test end to end

```bash
./verify.sh          # add --keep-ip to keep your IP allowlisted afterwards
```

`verify.sh` does the whole e2e loop and cleans up after itself:

1. Reads `GatewayResourceUrl`; if `CognitoTokenEndpoint` exists in the outputs
   it fetches the app-client secret and gets a client_credentials token.
2. Confirms the WAF blocks you (expects 403), then temporarily adds your IPv4
   `/32` to the `*-chatgpt-ips` IP set (**CLOUDFRONT scope, us-east-1**).
3. Runs MCP `initialize` → `tools/list` → `tools/call list_unicorns`, checks
   the OAuth discovery endpoint returns the front-door domain, and (Cognito
   mode) checks that tokenless requests still get 401/403.
4. Removes your IP again, even on failure or Ctrl-C.

### Gotchas that will waste your time

- **IPv6**: CloudFront is dual-stack; the allowlist IP sets are IPv4-only. Any
  manual `curl` you run must use `-4`, or WAF will 403 you from your IPv6
  address even though your IPv4 is allowlisted. `verify.sh` already does this.
  The same applies to Node-based clients (e.g. MCP Inspector's proxy): launch
  them with `NODE_OPTIONS=--dns-result-order=ipv4first` or WAF returns its
  403 "Request blocked" page despite the allowlisted IPv4.
- **WAF API scope**: all `aws wafv2` calls for this Web ACL need
  `--scope CLOUDFRONT --region us-east-1`, regardless of the app region.
- **Propagation**: IP set changes take ~30–60 s to reach the edge. Don't
  declare failure on the first 403 after an update.
- **Tool names through the Gateway** are `<target>___<tool>`
  (e.g. `unicorn-mcp-runtime-target___list_unicorns`); the Gateway also injects
  its own `x_amz_bedrock_agentcore_search` tool.
- **Manual MCP calls** need `Accept: application/json, text/event-stream` and,
  in Cognito mode, `Authorization: Bearer <token>` where the token comes from
  `POST $CognitoTokenEndpoint` with
  `grant_type=client_credentials&scope=mcp-gateway/invoke` and HTTP basic auth
  `clientId:clientSecret` (secret via
  `aws cognito-idp describe-user-pool-client`).

## Clean up

```bash
cd infrastructure/cdk
npx cdk destroy --all
```
