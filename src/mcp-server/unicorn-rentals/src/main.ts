// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unicorn Rental MCP Server (Node.js/TypeScript).
 *
 * A thin MCP protocol layer that delegates business logic to the Unicorn Service Lambda.
 * Demonstrates separation of concerns: MCP protocol handling vs. business logic.
 *
 * The MCP server:
 * - Handles JSON-RPC/MCP protocol (tool definitions, resources, structured output)
 * - Resolves customer identity from ChatGPT context
 * - Invokes the Unicorn Service Lambda for actual business operations
 * - Serves widget HTML as MCP resources (MCP Apps pattern via registerAppTool/registerAppResource)
 *
 * Tools:
 * - list_unicorns: List available unicorns, optionally filtered by type.
 * - book_unicorn: Book a unicorn for a customer.
 * - view_bookings: View active rental for a customer.
 * - return_unicorn: Return a booked unicorn and calculate rental cost.
 *
 * Resources:
 * - ui://widget/unicorn-list — Unicorn list widget
 * - ui://widget/booking-confirmation — Booking confirmation widget
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { invokeService } from "./lambda-client.js";
import { loadWidget } from "./widgets.js";

const PORT = parseInt(process.env.PORT || "8000", 10);

const DEFAULT_ALLOWED_ORIGINS = "https://chatgpt.com,https://chat.openai.com,https://claude.ai,https://www.claude.ai,http://localhost:8000";
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// --- Resource URIs ---

const UNICORN_LIST_RESOURCE_URI = "ui://widget/unicorn-list";
const BOOKING_CONFIRMATION_RESOURCE_URI = "ui://widget/booking-confirmation";

// --- CSP configuration for widget resources (allows CloudFront image loading) ---

const WIDGET_UI_META = {
  ui: {
    csp: {
      resourceDomains: ["https://*.cloudfront.net"],
    },
  },
};

// --- Helper: resolve customer ID from context. Works only for ChatGpt. ---

function resolveCustomerId(customerId: string, meta?: Record<string, unknown>): string {
  if (customerId) return customerId;
  if (meta) {
    const subject = (meta as Record<string, unknown>)["openai/subject"];
    if (typeof subject === "string") return subject;
  }
  return "";
}

// --- MCP Server Factory (one instance per session to avoid transport conflicts) ---

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "unicorn-rentals",
    version: "1.0.0",
  });

  // --- Register MCP App Resources (widget HTML served via resources/read) ---

  registerAppResource(
    server,
    "unicorn-list-widget",
    UNICORN_LIST_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: UNICORN_LIST_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadWidget("unicorn-list.html"),
          _meta: WIDGET_UI_META,
        },
      ],
    })
  );

  registerAppResource(
    server,
    "booking-widget",
    BOOKING_CONFIRMATION_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: BOOKING_CONFIRMATION_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadWidget("booking-confirmation.html"),
          _meta: WIDGET_UI_META,
        },
      ],
    })
  );

  // --- Register MCP App Tools ---

  registerAppTool(
    server,
    "list_unicorns",
    {
      title: "List Unicorns",
      description: "List available unicorns for rental. Filter by type: Classic, Rainbow, or Winged.",
      inputSchema: {
        unicorn_type: z
          .string()
          .default("all")
          .describe("Filter by unicorn type: Classic, Rainbow, or Winged. Use 'all' for no filter."),
      },
      _meta: { ui: { resourceUri: UNICORN_LIST_RESOURCE_URI } },
    },
    async ({ unicorn_type }) => {
      const result = await invokeService("list_unicorns", { unicorn_type });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.error || "Unknown error" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Found ${result.data.total} unicorns.` }],
        structuredContent: result.data,
        isError: false,
      };
    }
  );

  registerAppTool(
    server,
    "book_unicorn",
    {
      title: "Book Unicorn",
      description:
        "Book a unicorn for rental. Requires unicorn ID. The logged-in user is automatically identified — no need to provide a customer ID.",
      inputSchema: {
        unicorn_id: z.string().describe("The ID of the unicorn to book."),
        customer_id: z
          .string()
          .default("")
          .describe(
            "Optional customer ID. If omitted, the logged-in ChatGPT user's ID is used automatically."
          ),
      },
      _meta: { ui: { resourceUri: BOOKING_CONFIRMATION_RESOURCE_URI } },
    },
    async ({ unicorn_id, customer_id }, extra) => {
      const meta = (extra as any)?._meta as Record<string, unknown> | undefined;
      const resolvedCustomerId = resolveCustomerId(customer_id, meta);

      const result = await invokeService("book_unicorn", {
        unicorn_id,
        customer_id: resolvedCustomerId,
      });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.error || "Unknown error" }],
          isError: true,
        };
      }

      const data = result.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Booked! ${data.unicorn_name} for customer ${data.customer_id}. Booking ID: ${data.booking_id}`,
          },
        ],
        structuredContent: data,
        isError: false,
      };
    }
  );

  registerAppTool(
    server,
    "view_bookings",
    {
      title: "View Bookings",
      description:
        "View the unicorn currently being rented by the customer. Shows duration and cost incurred so far.",
      inputSchema: {
        customer_id: z
          .string()
          .default("")
          .describe(
            "Optional customer ID. If omitted, the logged-in ChatGPT user's ID is used automatically."
          ),
      },
      _meta: { ui: {} },
    },
    async ({ customer_id }, extra) => {
      const meta = (extra as any)?._meta as Record<string, unknown> | undefined;
      const resolvedCustomerId = resolveCustomerId(customer_id, meta);

      const result = await invokeService("view_bookings", { customer_id: resolvedCustomerId });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.error || "Unknown error" }],
          isError: true,
        };
      }

      if (result.data === null) {
        return {
          content: [
            { type: "text" as const, text: result.message || "No active rentals found." },
          ],
          isError: false,
        };
      }

      const data = result.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Active rental: ${data.unicorn_name} (Booking ${data.booking_id}), ${data.duration}, $${data.cost_incurred.toFixed(2)} incurred so far.`,
          },
        ],
        structuredContent: data,
        isError: false,
      };
    }
  );

  registerAppTool(
    server,
    "return_unicorn",
    {
      title: "Return Unicorn",
      description:
        "Return a booked unicorn. The logged-in user is automatically identified. Calculates total rental cost based on duration and hourly rate.",
      inputSchema: {
        customer_id: z
          .string()
          .default("")
          .describe(
            "Optional customer ID. If omitted, the logged-in ChatGPT user's ID is used automatically."
          ),
      },
      _meta: { ui: {} },
    },
    async ({ customer_id }, extra) => {
      const meta = (extra as any)?._meta as Record<string, unknown> | undefined;
      const resolvedCustomerId = resolveCustomerId(customer_id, meta);

      const result = await invokeService("return_unicorn", { customer_id: resolvedCustomerId });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.error || "Unknown error" }],
          isError: true,
        };
      }

      if (result.data === null) {
        return {
          content: [
            { type: "text" as const, text: result.message || "No unicorns currently hired." },
          ],
          isError: false,
        };
      }

      const data = result.data;
      return {
        content: [
          {
            type: "text" as const,
            text: `Returned! Booking ${data.booking_id}: ${data.duration} × $${data.hourly_rate}/hr = $${data.total_cost.toFixed(2)}`,
          },
        ],
        structuredContent: data,
        isError: false,
      };
    }
  );

  return server;
}

// --- HTTP Server with Express ---

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
  })
);

app.use(express.json());

// Map to store transports by session ID
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        const timestamp = Date.now();
        const randomBytes = crypto.randomBytes(16).toString('hex');
        return `session-${timestamp}-${randomBytes}`;
      },
      onsessioninitialized: (newSessionId) => {
        transports.set(newSessionId, transport);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    // Create a new MCP server instance per session to avoid transport conflicts
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// Handle GET for SSE streams (if needed)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "unicorn-rentals-mcp" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Unicorn Rentals MCP Server running on port ${PORT}`);
});
