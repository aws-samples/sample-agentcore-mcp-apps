# Connecting to Claude

This MCP server uses the **MCP Apps** extension (`io.modelcontextprotocol/ui`) — an open standard for rendering rich interactive widgets inline. Both Claude and ChatGPT support this, so you get the same card-based UI experience across both platforms.

## What Works

| Feature | Claude (claude.ai / Desktop) | Claude Code (CLI) |
|---------|------------------------------|-------------------|
| Tool calls (list, book, view, return) | Yes | Yes |
| Rich widget UI (HTML cards) | Yes — via MCP Apps | No (text-only) |
| Structured text responses | Yes | Yes |
| Customer identity resolution | Explicit `customer_id` param | Explicit `customer_id` param |

The widgets use the standard MCP Apps `postMessage` protocol (JSON-RPC with `structuredContent`), which Claude renders inline in a sandboxed iframe — the same way ChatGPT does.

## Option A: Claude.ai (Web) — Custom Connector

### 1. Get your MCP endpoint URL

After deploying with CDK, note the `McpEndpointUrl` output:
```
https://abc123.execute-api.us-east-1.amazonaws.com/prod/mcp
```

### 2. Add as a Custom Connector

1. Open [claude.ai](https://claude.ai)
2. Go to **Customize > Connectors**
3. Click **Add connector**
4. Enter your `McpEndpointUrl` as the remote MCP server URL
5. Give it a name (e.g. "Unicorn Rentals")
6. Save

> **Requires:** Claude Pro, Max, or Team plan.

### 3. Try it

Open a new conversation, enable the connector, and try:

```
Show me all available unicorns
```

Claude will call `list_unicorns` and render the **unicorn list widget** inline — the same card grid with images, type badges, hourly rates, and availability status that you see in ChatGPT.

Follow up with:
```
Book the Zephyr unicorn for me (customer ID: demo-user-1)
```

> **Note:** Claude doesn't automatically provide a user identity like ChatGPT does via `openai/subject`. You need to provide a `customer_id` explicitly (any string — it's used to track bookings per user).

## Option B: Claude Desktop

> **WAF Note:** Claude Desktop connects from your local machine's IP, not from Anthropic's servers. You must add your outbound IP to the WAF allowlist for requests to succeed. See [WAF Considerations](#waf-considerations) below.

### 1. Update Claude Desktop config

Open your configuration file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the server:

```json
{
  "mcpServers": {
    "unicorn-rentals": {
      "url": "https://abc123.execute-api.us-east-1.amazonaws.com/prod/mcp"
    }
  }
}
```

### 2. Restart Claude Desktop

Restart the app. You should see the MCP tools icon (hammer) in the chat input. Click it to verify the four tools are listed:
- `list_unicorns`
- `book_unicorn`
- `view_bookings`
- `return_unicorn`

### 3. Use it

The same prompts work here. Widget cards render inline when tools return structured content with a `ui://` resource reference.

## Option C: Claude Code (CLI)

Claude Code connects to remote MCP servers but renders text-only responses (no widget iframe support in the terminal). The tools are still fully functional.

> **WAF Note:** Claude Code connects from your local machine's IP. You must add your outbound IP to the WAF allowlist. See [WAF Considerations](#waf-considerations) below.

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "unicorn-rentals": {
      "type": "url",
      "url": "https://abc123.execute-api.us-east-1.amazonaws.com/prod/mcp"
    }
  }
}
```

Then start Claude Code — it will discover the tools automatically.

## Option D: Anthropic API with Tool Use

You can call the deployed MCP server programmatically via the Anthropic API's tool use feature.

> **WAF Note:** Requests originate from wherever you run this script. Add your outbound IP to the WAF allowlist. See [WAF Considerations](#waf-considerations) below.

```python
import json
import requests
import anthropic

MCP_URL = "https://abc123.execute-api.us-east-1.amazonaws.com/prod/mcp"

# 1. Fetch tools from MCP server
resp = requests.post(MCP_URL, json={
    "jsonrpc": "2.0", "id": 1,
    "method": "tools/list", "params": {}
})
mcp_tools = resp.json()["result"]["tools"]

# 2. Convert MCP tool format to Anthropic tool format
anthropic_tools = [
    {
        "name": tool["name"],
        "description": tool["description"],
        "input_schema": tool["inputSchema"],
    }
    for tool in mcp_tools
]

# 3. Call Claude with tools
client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=anthropic_tools,
    messages=[{"role": "user", "content": "Show me all available unicorns"}],
)

# 4. If Claude wants to call a tool, forward to MCP server
for block in response.content:
    if block.type == "tool_use":
        tool_result = requests.post(MCP_URL, json={
            "jsonrpc": "2.0", "id": 2,
            "method": "tools/call",
            "params": {"name": block.name, "arguments": block.input},
        })
        print(json.dumps(tool_result.json(), indent=2))
```

## How Widget Rendering Works (Technical)

See [widget-rendering.md](widget-rendering.md) for the full technical explanation of how MCP Apps widgets are rendered across clients.

## WAF Considerations

The API Gateway is protected by a WAF with an IP allowlist. Both ChatGPT's outbound IPs (`chatGptIpSet`) and Anthropic/Claude's outbound IPs are already included by default, so Claude (via claude.ai) and ChatGPT can reach the endpoint without any changes.

> **Important:** The ChatGPT outbound IP ranges may change over time. Always check the latest values from OpenAI's official documentation before deploying to production.

### For development/demo

To test from your own machine (Claude Desktop, Claude Code, or the Anthropic API), you need to add your machine's **outbound IP** to the WAF allowlist. Find your outbound IP (e.g. via `curl ifconfig.me`) and then either:

**Option 1: Update the CDK stack and redeploy**

Add your IP to the `claudeIpSet` addresses array in `infrastructure/cdk/lib/agentcore-mcp-stack.ts`:

```bash
cd infrastructure/cdk
npx cdk deploy
```

**Option 2: Add the IP directly in the AWS WAF console**

1. Open the [AWS WAF console](https://console.aws.amazon.com/wafv2/)
2. Navigate to **IP sets** (Regional)
3. Select the `unicorn-mcp-claude-ips` IP set
4. Click **Add IP address** and enter your outbound IP in CIDR notation (e.g. `203.0.113.42/32`)

## Differences from ChatGPT

| Behaviour | ChatGPT | Claude |
|-----------|---------|--------|
| Widget rendering | Yes (MCP Apps + legacy `openai` API) | Yes (MCP Apps standard) |
| Customer identity | Auto-resolved from `openai/subject` context | Must provide `customer_id` explicitly |
| Tool confirmation | Visual confirm button | Claude asks permission in chat |
| Session management | `Mcp-Session-Id` header | Handled by MCP client automatically |
| CLI support | N/A | Claude Code (text-only, no widgets) |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **403 Forbidden** | Your IP isn't in the WAF allowlist. See WAF Considerations above. |
| **Widgets not rendering** | Ensure you're using claude.ai or Claude Desktop (not Claude Code). Check that the MCP server returns `_meta` with `ui.resourceUri` on tool results. |
| **Connection timeout** | Verify the API Gateway URL is correct and the stack is deployed. Try `curl -X POST <url>`. |
| **Tools not appearing** | In Claude Desktop: restart after config change, check logs via **Help > Debug > MCP**. On claude.ai: ensure connector is enabled for the conversation. |
| **"Unable to identify customer"** | Provide a `customer_id` argument explicitly — Claude doesn't send `openai/subject` context. |
| **Cold start delay** | First request after idle may take 30-60 seconds while AgentCore spins up. Retry. |
