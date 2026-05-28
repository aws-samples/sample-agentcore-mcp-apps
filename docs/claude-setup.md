# Connecting to Claude

This MCP server speaks standard Streamable HTTP, which means it works with any MCP-compatible client — including Claude Desktop, Claude Code, and the Anthropic API with tool use.

## What Works

| Feature | Claude Support |
|---------|---------------|
| Tool calls (list, book, view, return) | Yes |
| Structured text responses | Yes |
| Rich widget UI (HTML cards) | No — widgets use ChatGPT-specific rendering |

Claude will receive the plain text responses from each tool (e.g. "Found 6 unicorns", "Booked! Stardust for customer abc123"). The tools are fully functional — you just won't get the visual widget cards that ChatGPT renders.

## Option A: Claude Desktop

Add the MCP server to your Claude Desktop configuration.

### 1. Get your MCP endpoint URL

After deploying with CDK, note the `McpEndpointUrl` output:
```
https://abc123.execute-api.us-east-1.amazonaws.com/prod/mcp
```

### 2. Update Claude Desktop config

Open your Claude Desktop configuration file:
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

### 3. Restart Claude Desktop

Restart the app. You should see the MCP tools icon (hammer) appear in the chat input. Click it to verify the four tools are listed:
- `list_unicorns`
- `book_unicorn`
- `view_bookings`
- `return_unicorn`

### 4. Try it

```
Show me all available unicorns
```

Claude will call `list_unicorns` and display the results as text. You can then follow up with:
```
Book the Zephyr unicorn for me (customer ID: demo-user-1)
```

> **Note:** Since there's no automatic identity resolution from Claude context, you'll need to provide a `customer_id` explicitly (any string works — it's used to track bookings).

## Option B: Claude Code (CLI)

Claude Code can connect to remote MCP servers. Add it to your project's `.mcp.json`:

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

## Option C: Anthropic API with Tool Use

You can call the deployed MCP server programmatically via the Anthropic API's tool use feature. First fetch the tool definitions from the MCP server, then pass them to Claude as tools.

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

## WAF Considerations

The API Gateway is protected by a WAF that only allows ChatGPT's outbound IPs by default. To use with Claude, you have two options:

### Option 1: Add your IP to the allowlist (development/demo)

Update the `chatGptIpSet` in `infrastructure/cdk/lib/agentcore-mcp-stack.ts` to include your IP or CIDR range, then redeploy:

```bash
npx cdk deploy
```

### Option 2: Add a separate WAF rule (production)

Add a second IP set and allow rule for Claude/Anthropic IPs, or switch the WAF to use API key validation instead of IP allowlisting.

## Differences from ChatGPT

| Behaviour | ChatGPT | Claude |
|-----------|---------|--------|
| Widget rendering | HTML cards via `resources/read` | Text-only responses |
| Customer identity | Auto-resolved from `openai/subject` in MCP context | Must provide `customer_id` parameter explicitly |
| Tool confirmation | Visual confirm button | Claude asks for permission in chat |
| Session management | `Mcp-Session-Id` header | Handled by MCP client automatically |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **403 Forbidden** | Your IP isn't in the WAF allowlist. Add it to the CDK stack (see WAF Considerations above). |
| **Connection timeout** | Check that the API Gateway URL is correct and the stack is deployed. Try `curl -X POST <url>`. |
| **Tools not appearing in Claude Desktop** | Restart Claude Desktop after editing the config. Check the MCP logs via **Help > Debug > MCP**. |
| **"Unable to identify customer"** | Provide a `customer_id` argument explicitly — Claude doesn't send `openai/subject` context. |
| **Cold start delay** | First request after idle may take 30-60 seconds while AgentCore spins up. Retry after a moment. |
