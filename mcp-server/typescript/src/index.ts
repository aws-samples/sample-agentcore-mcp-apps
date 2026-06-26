import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer, IncomingMessage, ServerResponse } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDGET_BASE_URL = process.env.WIDGET_BASE_URL || "http://localhost:8080";
const PORT = parseInt(process.env.PORT || "8000");

function loadWidget(name: string): string {
  try { return readFileSync(join(__dirname, "..", "widgets", name), "utf8"); }
  catch { return `<html><body>Widget ${name} not found</body></html>`; }
}

const UNICORNS = [
  { unicorn_id: "uc-001", name: "Stardust", type: "Classic", description: "A gentle, silver-maned unicorn perfect for beginners.", hourly_rate: 75, image_url: `${WIDGET_BASE_URL}/images/stardust.png`, available: true },
  { unicorn_id: "uc-002", name: "Moonbeam", type: "Classic", description: "An elegant white unicorn with a pearlescent horn.", hourly_rate: 85, image_url: `${WIDGET_BASE_URL}/images/moonbeam.png`, available: true },
  { unicorn_id: "uc-003", name: "Prism", type: "Rainbow", description: "A dazzling rainbow-maned unicorn that shimmers in sunlight.", hourly_rate: 120, image_url: `${WIDGET_BASE_URL}/images/prism.png`, available: true },
  { unicorn_id: "uc-004", name: "Aurora", type: "Rainbow", description: "A majestic unicorn with aurora-colored flowing mane.", hourly_rate: 130, image_url: `${WIDGET_BASE_URL}/images/aurora.png`, available: false },
  { unicorn_id: "uc-005", name: "Zephyr", type: "Winged", description: "A rare winged unicorn capable of short flights.", hourly_rate: 200, image_url: `${WIDGET_BASE_URL}/images/zephyr.png`, available: true },
  { unicorn_id: "uc-006", name: "Tempest", type: "Winged", description: "A powerful winged unicorn with storm-grey coat.", hourly_rate: 250, image_url: `${WIDGET_BASE_URL}/images/tempest.png`, available: true },
];
const BOOKINGS: Record<string, any> = {};

const UI_RESOURCE_META = {
  ui: {
    prefersBorder: true,
    domain: WIDGET_BASE_URL,
    csp: {
      resourceDomains: [WIDGET_BASE_URL],
    },
  },
};

function registerAll(s: McpServer) {
  for (const [name, uri, file] of [
    ["unicorn-list-widget", "ui://widget/unicorn-list.html", "unicorn-list.html"],
    ["availability-widget", "ui://widget/availability.html", "availability.html"],
    ["booking-widget", "ui://widget/booking-confirmation.html", "booking-confirmation.html"],
  ] as const) {
    registerAppResource(s, name, uri, {}, async () => ({
      contents: [{
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: loadWidget(file),
        _meta: UI_RESOURCE_META,
      }],
    }));
  }

  registerAppTool(s, "list_unicorns", {
    title: "List Unicorns",
    description: "List available unicorns for rental. Filter by type: Classic, Rainbow, or Winged.",
    inputSchema: { unicorn_type: z.string().default("all") },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: "ui://widget/unicorn-list.html" } },
  }, async ({ unicorn_type }: any) => {
    const t = (unicorn_type || "all").toLowerCase();
    const results = t === "all" ? UNICORNS : UNICORNS.filter(u => u.type.toLowerCase() === t);
    return {
      structuredContent: { unicorns: results, total: results.length, filter: unicorn_type },
      content: [{ type: "text" as const, text: `Found ${results.length} unicorns.` }],
      _meta: { [RESOURCE_URI_META_KEY]: "ui://widget/unicorn-list.html" },
    };
  });

  registerAppTool(s, "check_availability", {
    title: "Check Availability",
    description: "Check if a unicorn is available. Max 24 hours.",
    inputSchema: { unicorn_id: z.string(), date: z.string(), duration_hours: z.number().int().min(1).max(24).default(1) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: "ui://widget/availability.html" } },
  }, async ({ unicorn_id, date, duration_hours }: any) => {
    const unicorn = UNICORNS.find(u => u.unicorn_id === unicorn_id);
    if (!unicorn) return { content: [{ type: "text" as const, text: "Unicorn not found." }] };
    const h = duration_hours || 1;
    return {
      structuredContent: { unicorn, date, duration_hours: h, available: unicorn.available, total_cost: unicorn.hourly_rate * h },
      content: [{ type: "text" as const, text: `${unicorn.available ? "Available" : "Not available"}: ${unicorn.name} - $${(unicorn.hourly_rate * h).toFixed(2)}` }],
      _meta: { [RESOURCE_URI_META_KEY]: "ui://widget/availability.html" },
    };
  });

  registerAppTool(s, "book_unicorn", {
    title: "Book Unicorn",
    description: "Book a unicorn. Max 24h.",
    inputSchema: { unicorn_id: z.string(), customer_name: z.string(), date: z.string(), duration_hours: z.number().int().min(1).max(24).default(1) },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { resourceUri: "ui://widget/booking-confirmation.html" } },
  }, async ({ unicorn_id, customer_name, date, duration_hours }: any) => {
    const unicorn = UNICORNS.find(u => u.unicorn_id === unicorn_id);
    if (!unicorn) return { content: [{ type: "text" as const, text: "Not found." }] };
    if (!unicorn.available) return { content: [{ type: "text" as const, text: "Not available." }] };
    const h = duration_hours || 1;
    const booking_id = `BK-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const total_cost = unicorn.hourly_rate * h;
    const booking = { booking_id, unicorn, customer_name, date, duration_hours: h, total_cost, status: "confirmed", booked_at: new Date().toISOString() };
    BOOKINGS[booking_id] = booking;
    return {
      structuredContent: booking,
      content: [{ type: "text" as const, text: `Booked! ${unicorn.name} for ${customer_name}, $${total_cost.toFixed(2)}. ID: ${booking_id}` }],
      _meta: { [RESOURCE_URI_META_KEY]: "ui://widget/booking-confirmation.html" },
    };
  });
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const s = new McpServer({ name: "anycompany-unicorn-rental", version: "1.0.0" });
    registerAll(s);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined as any });
    await s.connect(transport);
    await transport.handleRequest(req, res);
    await s.close();
  } catch (e: any) {
    console.error("Error:", e.message);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: e.message } }));
    }
  }
}

const httpServer = createServer(async (req, res) => {
  if (req.method === "POST" && (req.url === "/mcp" || req.url === "/mcp/")) {
    await handleMcpRequest(req, res);
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Unicorn MCP Server running on http://0.0.0.0:${PORT}/mcp`);
});
