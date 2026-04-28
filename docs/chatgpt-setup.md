# Connecting to ChatGPT

Step-by-step guide to register your deployed MCP server as a ChatGPT connector and demo it with widgets.

## Prerequisites

- Infrastructure deployed (Terraform or CDK) — you need the `mcp_endpoint_url` and `widget_base_url` outputs
- Widgets uploaded to S3 (`./scripts/upload-widgets.sh <bucket>`)
- A **ChatGPT Plus, Team, or Enterprise** account
- Developer mode enabled (see Step 1)

## Step 1: Enable Developer Mode

1. Open [ChatGPT](https://chatgpt.com)
2. Go to **Settings** (gear icon, bottom-left)
3. Navigate to **Apps & Connectors**
4. Scroll to the bottom and click **Advanced settings**
5. Toggle **Developer mode** on

> If you don't see this option, your organization may have restricted it. Contact your admin.

Once enabled, you'll see a **Create** button under **Settings > Connectors**.

## Step 2: Create the MCP Connector

1. Go to **Settings > Connectors**
2. Click **Create**
3. Fill in the following:

| Field | Value |
|-------|-------|
| **Connector name** | `Unicorn Rentals` (or any user-facing name) |
| **Description** | `Browse, check availability, and book unicorn rentals. Shows rich UI cards with pricing and booking confirmations.` |
| **Connector URL** | Your `mcp_endpoint_url` output, e.g. `https://blui23a1q4.execute-api.eu-west-1.amazonaws.com/prod/mcp` |

4. Click **Create**

If the connection succeeds, ChatGPT will display the list of tools your server advertises:
- `list_unicorns` — List available unicorns for rental
- `check_availability` — Check if a unicorn is available
- `book_unicorn` — Book a unicorn for rental

If it fails, see [Troubleshooting](#troubleshooting) below.

## Step 3: Demo It

1. Open a **new chat** in ChatGPT
2. Click the **+** button near the message composer, then click **More**
3. Select your **Unicorn Rentals** connector from the list (this adds it to the conversation)
4. Try these prompts:

### Demo Prompt 1: List Unicorns
```
Show me all available unicorns for rental
```
ChatGPT will call `list_unicorns` and render the **unicorn list widget** — a card grid showing all 6 unicorns with type badges (Classic, Rainbow, Winged), hourly rates, and availability.

### Demo Prompt 2: Check Availability
```
Is Prism available on May 15th for 3 hours?
```
ChatGPT will call `check_availability` and render the **availability widget** — a card showing availability status, unicorn details, duration, rate, and estimated total cost.

### Demo Prompt 3: Book a Unicorn
```
Book Prism for Jane Smith on May 15th for 3 hours
```
ChatGPT will call `book_unicorn` and render the **booking confirmation widget** — a card with booking ID, confirmation status, customer details, and total charged.

> **Note:** Write tools (like `book_unicorn`) require manual confirmation in ChatGPT. You'll see the tool call payload and need to click **Confirm** before it executes.

## Step 4: Verify Widgets Render

When tools execute, ChatGPT renders your widget HTML inside an iframe. The data flow is:

1. MCP server returns `structuredContent` (data) + `_meta` with widget URL
2. ChatGPT fetches the widget HTML from your CloudFront URL
3. ChatGPT passes `structuredContent` to the widget via `window.openai.toolOutput`
4. The widget renders the data as a rich UI card

If widgets aren't rendering, verify:
- Your CloudFront distribution is accessible: `curl -I https://<your-cloudfront-domain>/unicorn-list.html`
- The `WIDGET_BASE_URL` environment variable on the AgentCore Runtime matches your CloudFront domain
- Widget HTML files are uploaded to S3: `aws s3 ls s3://<your-bucket>/`

## How It Works Under the Hood

```
User types prompt in ChatGPT
    |
ChatGPT decides to call a tool (e.g., list_unicorns)
    |
ChatGPT sends MCP JSON-RPC POST to your Connector URL
    |
API Gateway receives the request
    |
Lambda Proxy calls invoke_agent_runtime() via AWS SDK (SigV4)
    |
AgentCore Runtime routes to your MCP Server container
    |
MCP Server executes the tool, returns:
  - structuredContent: { unicorns: [...], total: 6 }
  - _meta: { openai/outputTemplate: "https://<cloudfront>/unicorn-list.html" }
    |
Lambda Proxy parses SSE response, returns JSON to API Gateway
    |
ChatGPT receives the response
    |
ChatGPT loads widget HTML from CloudFront in an iframe
    |
Widget reads structuredContent via window.openai.toolOutput
    |
User sees rich UI card rendered inside ChatGPT
```

## Updating Your Connector

After making changes to your MCP server (adding tools, changing descriptions):

1. Redeploy: rebuild image, push to ECR, AgentCore will pick up the new image
2. In ChatGPT: **Settings > Connectors** > click your connector > click **Refresh**
3. Verify the tool list updates

## Authentication (Optional)

By default, the deployment uses `enable_cognito_auth = false` for simple demos. For production:

1. Set `enable_cognito_auth = true` in your Terraform variables
2. Redeploy: `terraform apply`
3. In the ChatGPT connector settings, configure OAuth 2.0:

| Field | Value |
|-------|-------|
| **Authorization URL** | `https://<project>-<account-id>.auth.<region>.amazoncognito.com/oauth2/authorize` |
| **Token URL** | `https://<project>-<account-id>.auth.<region>.amazoncognito.com/oauth2/token` |
| **Client ID** | From Terraform output: `cognito_client_id` |
| **Client Secret** | From AWS Console: Cognito > User Pool > App Client > Show client secret |
| **Scope** | `openid email profile` |
| **Callback URL** | `https://chat.openai.com/aip/callback` |

## Testing Without ChatGPT

You can verify the MCP server works before connecting to ChatGPT:

### Option A: MCP Inspector
```bash
npx @modelcontextprotocol/inspector@latest
# Enter your endpoint URL, click List Tools, Call Tool
```

### Option B: curl
```bash
# Initialize
curl -s -X POST "https://<your-api-gateway>/prod/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'

# List tools
curl -s -X POST "https://<your-api-gateway>/prod/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call list_unicorns
curl -s -X POST "https://<your-api-gateway>/prod/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_unicorns","arguments":{"unicorn_type":"all"}}}'
```

### Option C: OpenAI API Playground
1. Open [platform.openai.com/playground](https://platform.openai.com/playground)
2. Choose **Tools > Add > MCP Server**
3. Enter your HTTPS endpoint URL
4. Issue test prompts and inspect raw JSON

### Option D: Test script (boto3 direct)
```bash
python scripts/test-runtime.py <region> <runtime-arn>
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **Connector creation fails** | Verify your API Gateway URL is publicly reachable. Try `curl -X POST <url>` — you should get a JSON-RPC response, not a 403 or timeout. |
| **"Authorization method mismatch"** | You have Cognito auth enabled but ChatGPT isn't sending a token. Either disable auth (`enable_cognito_auth = false`) or configure OAuth in the connector settings. |
| **Tools list is empty** | The MCP server may still be starting. AgentCore cold starts can take 30-60 seconds. Wait and click **Refresh** in connector settings. |
| **Widget shows "Loading..."** | The widget HTML loaded but didn't receive data. Check that `WIDGET_BASE_URL` env var on the Runtime matches your CloudFront domain. |
| **Widget doesn't render at all** | Verify widgets are uploaded to S3 and accessible via CloudFront: `curl -I https://<cloudfront>/unicorn-list.html` should return 200. |
| **502 Gateway errors** | Check Lambda logs in CloudWatch. Common causes: Lambda timeout (increase from 30s), AgentCore Runtime not ready, IAM permissions missing. |
| **Session errors** | The `Mcp-Session-Id` header may not be passing through. Check API Gateway CORS configuration includes this header. |
