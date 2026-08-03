# Connecting to ChatGPT

Step-by-step guide to connect your deployed MCP server to ChatGPT as an App.

## Prerequisites

- Infrastructure deployed via CDK (`npx cdk deploy`) — you need the `GatewayResourceUrl` output
- A **ChatGPT Plus, Team, or Enterprise** account
- Developer mode enabled (see Step 1)

## Step 1: Enable Developer Mode

1. Open [ChatGPT](https://chatgpt.com)
2. Go to **Settings** (gear icon, bottom-left)
3. Navigate to **Apps**
4. Click **Advanced settings**
5. Toggle **Developer mode** on

> If you don't see this option, your organization may have restricted it. Contact your admin.

## Step 2: Create the App

1. Go to **Plugins**
2. Click **New Plugin**
3. Fill in the following:

| Field | Value |
|-------|-------|
| **Name** | `UnicornRentals` |
| **Description** | `Browse unicorns, book rentals, view active bookings, and return unicorns. Shows rich UI cards with pricing and booking confirmations.` |
| **Connection** | Your `GatewayResourceUrl` CDK output, e.g. `https://abc123.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp` |

4. Set **Authentication** to **No Auth**
5. Click **Create**

If the connection succeeds, ChatGPT will discover the tools your server advertises:
- `list_unicorns` — List available unicorns for rental
- `book_unicorn` — Book a unicorn
- `view_bookings` — View your active rental
- `return_unicorn` — Return a booked unicorn

If it fails, see [Troubleshooting](#troubleshooting) below.

## Step 3: Demo It

1. Open a **new chat** in ChatGPT
2. Click the **+** button near the message composer, then click **More**
3. Select **UnicornRentals** from the list
4. Try these prompts:

### Demo Prompt 1: List Unicorns
```
Show me all available unicorns
```
ChatGPT will call `list_unicorns` and render the **unicorn list widget** — a card grid showing all 6 unicorns with type badges (Classic, Rainbow, Winged), hourly rates, and availability.

### Demo Prompt 2: Book a Unicorn
```
I'd like to book the Stardust unicorn
```
ChatGPT will call `book_unicorn` and render the **booking confirmation widget** — a card with booking ID, unicorn name, hourly rate, and confirmation status.

> **Note:** Write tools require manual confirmation in ChatGPT. You'll see the tool call payload and need to click **Confirm** before it executes.

### Demo Prompt 3: View Active Rental
```
Show me my current unicorn booking
```
ChatGPT will call `view_bookings` and display your active rental with elapsed duration and cost incurred so far.

### Demo Prompt 4: Return the Unicorn
```
I'd like to return my unicorn
```
ChatGPT will call `return_unicorn` and show the final invoice — duration, hourly rate, and total cost.

## Step 4: Verify Widgets Render

When tools execute, ChatGPT renders your widget HTML inside an iframe. See [widget-rendering.md](widget-rendering.md) for the full technical explanation of the data flow.

If widgets aren't rendering, verify:
- Your CloudFront distribution is accessible: `curl -I https://<your-cloudfront-domain>/images/stardust.png`
- Widget HTML templates are loading correctly by testing with `resources/read` via curl (see below)

## Testing Without ChatGPT

You can verify the MCP server works before connecting to ChatGPT.

> **Important:** The API is protected by a WAF that only allows specific IP addresses. Before testing, add your machine's outbound IP to the WAF IP set — either by updating the `allowedIpSet` in the CDK stack and redeploying, or by adding the IP directly in the AWS WAF console. Without this, all requests from non-allowlisted IPs will receive a 403 Forbidden response.

### Option A: MCP Inspector
```bash
npx @modelcontextprotocol/inspector@latest
# Enter your GatewayResourceUrl, click List Tools, Call Tool
```

### Option B: curl
```bash
MCP_URL="https://<your-gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp"

# Initialize — capture the Mcp-Session-Id from the response header
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -D - \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'

# Copy the Mcp-Session-Id value from the response headers above
SESSION_ID="<paste-session-id-here>"

# List tools
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call list_unicorns
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_unicorns","arguments":{"unicorn_type":"all"}}}'

# Call book_unicorn
curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"book_unicorn","arguments":{"unicorn_id":"uc-001","customer_id":"demo-user-1"}}}'
```

### Option C: OpenAI API Playground
1. Open [platform.openai.com/playground](https://platform.openai.com/playground)
2. Choose **Tools > Add > MCP Server**
3. Enter your MCP endpoint URL
4. Issue test prompts and inspect raw JSON

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **App creation fails** | Verify your Gateway URL is publicly reachable. Try `curl -X POST <url>` — you should get a JSON-RPC response, not a 403 or timeout. |
| **403 Forbidden** | Your IP is not in the WAF allowlist. The WAF only allows ChatGPT's outbound IPs. For testing, temporarily add your IP to the `chatGptIpSet` in the CDK stack, or use the MCP Inspector approach above. |
| **Tools list is empty** | The MCP server may still be starting. AgentCore cold starts can take 30-60 seconds. Wait and click **Refresh** in app settings. |
| **Widget doesn't render** | Verify the `resources/read` request works by calling it via curl. Check CloudWatch logs for the AgentCore Runtime. |
| **502 Gateway errors** | Check AgentCore Runtime logs in CloudWatch. Common causes: runtime timeout, AgentCore Runtime not ready, IAM permissions missing. |
| **Session errors** | The `Mcp-Session-Id` header may not be passing through correctly. Verify the Gateway is in READY state. |
| **"Unicorn not available"** | Another session may have booked it. Use `list_unicorns` to check availability, or return a previously booked unicorn first. |
