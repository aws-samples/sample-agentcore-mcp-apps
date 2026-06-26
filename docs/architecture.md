# Architecture

## Overview

This solution deploys an MCP server as a containerized application on Amazon Bedrock AgentCore Runtime. A Lambda proxy bridges the gap between ChatGPT's HTTPS requests and AgentCore's `InvokeAgentRuntime` API. Widgets served via CloudFront provide rich UI inside ChatGPT.

## Data Flow

1. **ChatGPT** sends an MCP JSON-RPC request (e.g., `tools/call`) to the API Gateway endpoint
2. **API Gateway** forwards the request to the **Lambda Proxy**
3. **Lambda Proxy** calls `invoke_agent_runtime` on **AgentCore Runtime**, passing the MCP payload and session ID
4. **AgentCore Runtime** routes the request to the **MCP Server** container
5. **MCP Server** executes the tool and returns `structuredContent` + `_meta` (pointing to a widget URL)
6. **Lambda Proxy** parses the SSE response and returns JSON to API Gateway
7. **ChatGPT** renders the widget HTML (fetched from **CloudFront**) with the structured data

## Widget Mechanism

ChatGPT Apps support rendering custom UI via widgets. The MCP server returns:

- `structuredContent`: Data the widget reads (e.g., list of unicorns, booking details)
- `_meta.openai/outputTemplate`: URL of the widget HTML hosted on CloudFront

ChatGPT loads the widget HTML in an iframe and passes `structuredContent` via:
- `window.openai.toolOutput` (polling)
- `openai:set_globals` custom event
- `postMessage` bridge

## Authentication

The AgentCore Runtime uses Cognito JWT authentication:
- A Cognito User Pool issues JWTs
- The Runtime validates tokens via the OIDC discovery URL
- The Lambda proxy does not require authentication (API Gateway is public) -- ChatGPT calls it directly

## Session Management

MCP sessions are maintained via the `Mcp-Session-Id` header:
- The Lambda proxy passes the session ID to `invoke_agent_runtime` as `runtimeSessionId`
- AgentCore maintains session state within the container
- This enables stateful operations (e.g., booking depends on prior availability check)
