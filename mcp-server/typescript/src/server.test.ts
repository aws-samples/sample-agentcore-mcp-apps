import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { execSync, ChildProcess, fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const PORT = 9876;

/**
 * Make a plain HTTP request (no MCP-specific headers).
 */
function makeRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path,
        method,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, data: raw });
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Make an MCP-compliant POST request with the required Accept header.
 * The MCP Streamable HTTP spec requires: Accept: application/json, text/event-stream
 *
 * The response may be application/json (for initialize) or text/event-stream (for
 * other methods). When SSE, we parse the "data:" lines to extract JSON-RPC messages.
 */
function makeMcpRequest(
  body: unknown
): Promise<{ status: number; contentType: string; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
      },
      (res) => {
        let raw = "";
        const contentType = res.headers["content-type"] || "";
        res.on("data", (chunk: Buffer) => (raw += chunk));
        res.on("end", () => {
          const messages: any[] = [];

          if (contentType.includes("text/event-stream")) {
            // Parse SSE: extract JSON from "data:" lines
            for (const line of raw.split("\n")) {
              if (line.startsWith("data:")) {
                const jsonStr = line.slice(5).trim();
                if (jsonStr) {
                  try {
                    messages.push(JSON.parse(jsonStr));
                  } catch {
                    // skip non-JSON data lines
                  }
                }
              }
            }
          } else {
            // Plain JSON response (may be single object or array)
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                messages.push(...parsed);
              } else {
                messages.push(parsed);
              }
            } catch {
              // not parseable
            }
          }

          resolve({ status: res.statusCode!, contentType, messages });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function waitForServer(port: number, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const req = http.request(
        { hostname: "localhost", port, path: "/health", method: "GET" },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 100);
        }
      });
      req.end();
    };
    tryConnect();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TypeScript compilation", () => {
  it("should compile without errors", () => {
    execSync("npx tsc --noEmit", { cwd: PROJECT_ROOT, timeout: 30000 });
  });
});

describe("Unicorn MCP Server - HTTP integration", () => {
  let serverProcess: ChildProcess;

  before(async () => {
    // Build so we have dist/index.js
    execSync("npx tsc", { cwd: PROJECT_ROOT, timeout: 30000 });

    serverProcess = fork(join(PROJECT_ROOT, "dist", "index.js"), [], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "pipe",
    });

    await waitForServer(PORT);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  });

  // -- Health endpoint ------------------------------------------------------

  describe("GET /health", () => {
    it("should return 200 with status ok", async () => {
      const { status, data } = await makeRequest("GET", "/health");
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(data, { status: "ok" });
    });
  });

  // -- Unknown routes -------------------------------------------------------

  describe("unknown routes", () => {
    it("should return 404 for GET /unknown", async () => {
      const { status } = await makeRequest("GET", "/unknown");
      assert.strictEqual(status, 404);
    });

    it("should return 404 for GET /", async () => {
      const { status } = await makeRequest("GET", "/");
      assert.strictEqual(status, 404);
    });

    it("should return 404 for POST /unknown", async () => {
      const { status } = await makeRequest("POST", "/unknown", {});
      assert.strictEqual(status, 404);
    });
  });

  // -- MCP Accept header requirement ----------------------------------------

  describe("POST /mcp - Accept header validation", () => {
    it("should return 406 when Accept header is missing text/event-stream", async () => {
      const { status } = await makeRequest("POST", "/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });
      assert.strictEqual(status, 406);
    });
  });

  // -- MCP initialize -------------------------------------------------------

  describe("POST /mcp - MCP initialize", () => {
    it("should return a valid JSON-RPC response for initialize", async () => {
      const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      };

      const { status, messages } = await makeMcpRequest(initRequest);
      assert.strictEqual(status, 200);
      assert.ok(messages.length > 0, "Should have at least one response message");

      const response = messages.find((m: any) => m.id === 1);
      assert.ok(response, "Should find response with id=1");
      assert.strictEqual(response.jsonrpc, "2.0");
      assert.ok(response.result, "Response should have a result field");
      assert.ok(response.result.serverInfo, "Result should contain serverInfo");
      assert.strictEqual(
        response.result.serverInfo.name,
        "anycompany-unicorn-rental"
      );
      assert.strictEqual(response.result.serverInfo.version, "1.0.0");
      assert.ok(
        response.result.protocolVersion,
        "Result should contain protocolVersion"
      );
    });
  });

  // -- MCP tools/list -------------------------------------------------------

  describe("POST /mcp - tools/list", () => {
    it("should return the 3 registered tools", async () => {
      // The server is stateless (new McpServer per request with
      // sessionIdGenerator: undefined). In stateless mode, each request
      // creates a fresh McpServer with all tools registered, so tools/list
      // works as a standalone request without prior initialization.
      const toolsListRequest = {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/list",
        params: {},
      };

      const { status, messages } = await makeMcpRequest(toolsListRequest);
      assert.strictEqual(status, 200);

      const toolsResponse = messages.find((m: any) => m.id === 20);
      assert.ok(toolsResponse, "Should find response with id=20");
      assert.ok(toolsResponse.result, "tools/list should have a result");
      assert.ok(
        Array.isArray(toolsResponse.result.tools),
        "result.tools should be an array"
      );

      const toolNames = toolsResponse.result.tools.map((t: any) => t.name);
      assert.ok(
        toolNames.includes("list_unicorns"),
        "Should include list_unicorns tool"
      );
      assert.ok(
        toolNames.includes("check_availability"),
        "Should include check_availability tool"
      );
      assert.ok(
        toolNames.includes("book_unicorn"),
        "Should include book_unicorn tool"
      );
      assert.strictEqual(
        toolsResponse.result.tools.length,
        3,
        "Should have exactly 3 tools"
      );
    });
  });

  // -- MCP invalid request --------------------------------------------------

  describe("POST /mcp - invalid JSON-RPC", () => {
    it("should handle malformed JSON-RPC gracefully without crashing", async () => {
      const { status } = await makeMcpRequest({ invalid: "not json-rpc" });
      // Server should respond (possibly with an error) but not crash
      assert.ok(
        [200, 400, 500].includes(status),
        `Expected 200, 400, or 500 but got ${status}`
      );
    });
  });
});
