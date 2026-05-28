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
2. Go to **Settings > Connectors**
3. Click **Add custom connector**
4. Enter your `McpEndpointUrl` as the server URL
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

The MCP server implements the **MCP Apps** extension:

1. Tools declare `_meta.ui.resourceUri` (e.g. `ui://widget/unicorn-list.html`)
2. Resources at those `ui://` URIs serve HTML with MIME type `text/html;profile=mcp-app`
3. When Claude/ChatGPT calls a tool that has a `resourceUri`, it also fetches the widget HTML via `resources/read`
4. The client renders the HTML in a **sandboxed iframe** and sends the tool's `structuredContent` to the iframe via `postMessage` (JSON-RPC format)
5. The widget JavaScript listens for the message and renders the data

The widgets in this project handle both protocols for maximum compatibility:
- **MCP Apps standard** (`postMessage` with JSON-RPC `structuredContent`) — works with Claude and any MCP Apps-compatible client
- **ChatGPT legacy** (`window.openai.toolOutput` polling) — fallback for older ChatGPT behaviour

## WAF Considerations

The API Gateway is protected by a WAF that only allows ChatGPT's outbound IPs by default. To use with Claude, you need to add additional IPs.

### For development/demo

Add your IP (or `0.0.0.0/1` + `128.0.0.0/1` to allow all traffic temporarily) to the `chatGptIpSet` in `infrastructure/cdk/lib/agentcore-mcp-stack.ts`, then redeploy:

```bash
cd infrastructure/cdk
npx cdk deploy
```

### For production

Add a separate IP set with Anthropic's outbound IPs, or replace the WAF IP allowlist with API key-based authentication (e.g. a custom header validated in the Lambda proxy).

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
| **403 Forbidden** | Your IP (or Claude's outbound IP) isn't in the WAF allowlist. See WAF Considerations above. |
| **Widgets not rendering** | Ensure you're using claude.ai or Claude Desktop (not Claude Code). Check that the MCP server returns `_meta` with `ui.resourceUri` on tool results. |
| **Connection timeout** | Verify the API Gateway URL is correct and the stack is deployed. Try `curl -X POST <url>`. |
| **Tools not appearing** | In Claude Desktop: restart after config change, check logs via **Help > Debug > MCP**. On claude.ai: ensure connector is enabled for the conversation. |
| **"Unable to identify customer"** | Provide a `customer_id` argument explicitly — Claude doesn't send `openai/subject` context. |
| **Cold start delay** | First request after idle may take 30-60 seconds while AgentCore spins up. Retry. |
