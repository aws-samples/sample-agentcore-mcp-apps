# How Widget Rendering Works

The MCP server implements the **MCP Apps** extension (`@modelcontextprotocol/ext-apps`), an open standard for rendering rich interactive widgets inline. Any MCP Apps-compatible client (ChatGPT, Claude, etc.) renders widgets the same way.

## Data Flow

1. The client sends a `tools/call` request to the MCP server (e.g., `list_unicorns`)
2. MCP server returns `structuredContent` (the data payload) + a text `content` fallback + `_meta: { ui: { resourceUri } }` identifying the widget to render
3. The client sends a `resources/read` request for the widget resource URI from `_meta`
4. MCP server returns the widget HTML (which bundles the `@modelcontextprotocol/ext-apps` App SDK)
5. The client renders the HTML in a **sandboxed iframe** and establishes a `postMessage` bridge with the widget
6. The widget's `app.ontoolresult` callback receives `result.structuredContent` and renders the data as a rich UI card

## Resource URIs

| Widget | Resource URI | Used by |
|--------|-------------|---------|
| Unicorn list (card grid) | `ui://widget/unicorn-list` | `list_unicorns` |
| Booking confirmation | `ui://widget/booking-confirmation` | `book_unicorn` |

## Implementation

The widgets in this project use the **MCP Apps standard** exclusively — they bundle the `@modelcontextprotocol/ext-apps` App SDK which handles the `postMessage` bridge with the host client.

Tools declare their widget association via `_meta.ui.resourceUri`. Resources at those `ui://` URIs serve HTML with MIME type `text/html;profile=mcp-app`.

## Troubleshooting Widgets

If widgets aren't rendering:
- Ensure you're using a client that supports MCP Apps (claude.ai, Claude Desktop, or ChatGPT — not Claude Code, which is text-only)
- Verify the `resources/read` request works by calling it via curl
- Check that CloudFront is accessible: `curl -I https://<your-cloudfront-domain>/images/stardust.png`
- Check CloudWatch logs for the proxy Lambda
