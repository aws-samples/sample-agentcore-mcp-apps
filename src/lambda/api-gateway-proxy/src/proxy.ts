/**
 * Lambda proxy: API Gateway -> AgentCore Runtime.
 *
 * Forwards MCP JSON-RPC requests from clients (ChatGPT, Claude, etc.)
 * to the AgentCore Runtime via InvokeAgentRuntime, and returns the response.
 *
 * Key responsibilities:
 * - Pass through MCP session ID for session continuity
 * - Read the streaming response body fully
 * - Forward CORS headers
 */

import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const RUNTIME_ARN = process.env.RUNTIME_ARN;
if (!RUNTIME_ARN) {
  throw new Error("RUNTIME_ARN environment variable is required");
}
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const client = new BedrockAgentCoreClient({});

function getCorsOrigin(event: APIGatewayProxyEvent): string {
  const headers = event.headers || {};
  const origin = headers["origin"] || headers["Origin"] || "";
  if (CORS_ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return "";
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const bodyStr = event.body || "{}";
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(bodyStr);
    console.log(`MCP method: ${parsed.method || "unknown"} | id: ${parsed.id || "none"}`);
  } catch (e) {
    console.error("JSON parse error:", e);
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": getCorsOrigin(event),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }),
    };
  }

  // Extract MCP session ID from incoming request headers (case-insensitive)
  const incomingHeaders = event.headers || {};
  const mcpSessionId =
    incomingHeaders["mcp-session-id"] ||
    incomingHeaders["Mcp-Session-Id"] ||
    "";

  try {
    // Forward content-type and accept from the incoming request, with sensible defaults
    const incomingContentType = incomingHeaders["content-type"] || incomingHeaders["Content-Type"] || "application/json";
    const incomingAccept = incomingHeaders["accept"] || incomingHeaders["Accept"] || "application/json, text/event-stream";

    const commandInput: Record<string, unknown> = {
      agentRuntimeArn: RUNTIME_ARN,
      contentType: incomingContentType,
      accept: incomingAccept,
      payload: Buffer.from(bodyStr, "utf-8"),
    };

    // Pass MCP session ID to AgentCore Runtime if present
    if (mcpSessionId) {
      commandInput.mcpSessionId = mcpSessionId;
    }

    const command = new InvokeAgentRuntimeCommand(commandInput as any);
    const response = await client.send(command);

    // Read the full response body
    let resultStr = "";
    const responseBody = response.response;

    if (responseBody) {
      if (typeof (responseBody as any).transformToString === "function") {
        resultStr = await (responseBody as any).transformToString("utf-8");
      } else if (typeof (responseBody as any).transformToByteArray === "function") {
        const bytes = await (responseBody as any).transformToByteArray();
        resultStr = Buffer.from(bytes).toString("utf-8");
      } else if (responseBody instanceof Uint8Array) {
        resultStr = Buffer.from(responseBody).toString("utf-8");
      } else if (typeof responseBody === "string") {
        resultStr = responseBody;
      } else {
        // Try reading as async iterable (streaming response)
        const chunks: Buffer[] = [];
        for await (const chunk of responseBody as any) {
          if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk));
          } else if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk, "utf-8"));
          }
        }
        resultStr = Buffer.concat(chunks).toString("utf-8");
      }
    }

    console.log(`Response length: ${resultStr.length} chars`);

    // If the response is SSE format, extract the JSON data payload
    let responsePayload = resultStr;
    if (resultStr.includes("data: ")) {
      const dataLines: string[] = [];
      for (const line of resultStr.split("\n")) {
        if (line.startsWith("data: ")) {
          dataLines.push(line.slice(6));
        }
      }
      if (dataLines.length > 0) {
        responsePayload = dataLines.join("");
      }
    }

    // Build response headers
    const respHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": getCorsOrigin(event),
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    };

    // Forward MCP session ID from AgentCore response back to client
    const responseMcpSessionId = (response as any).mcpSessionId || "";
    if (responseMcpSessionId) {
      respHeaders["Mcp-Session-Id"] = responseMcpSessionId;
    }

    return {
      statusCode: 200,
      headers: respHeaders,
      body: responsePayload,
    };
  } catch (e) {
    console.error(`Runtime invocation error:`, e);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": getCorsOrigin(event),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (parsed as any).id || 1,
        error: { code: -32603, message: "Internal error" },
      }),
    };
  }
}
