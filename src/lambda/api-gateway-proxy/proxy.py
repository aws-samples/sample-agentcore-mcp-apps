"""Lambda proxy: API Gateway -> AgentCore Runtime.

Translates MCP JSON-RPC from ChatGPT into InvokeAgentRuntime calls.
Handles SSE response format from AgentCore Runtime.
"""

import json
import os
import boto3

client = boto3.client("bedrock-agentcore", region_name=os.environ.get("AWS_REGION"))
RUNTIME_ARN = os.environ["RUNTIME_ARN"]
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
]


def _get_cors_origin(event):
    """Return the request Origin if it's in the allowed list, else empty string."""
    headers = event.get("headers", {}) or {}
    origin = headers.get("origin") or headers.get("Origin", "")
    if origin in CORS_ALLOWED_ORIGINS:
        return origin
    return ""


def lambda_handler(event, context):
    body = event.get("body", "{}")
    if isinstance(body, str):
        body_str = body
    else:
        body_str = json.dumps(body)

    try:
        parsed = json.loads(body_str)
        print(f"MCP method: {parsed.get('method', 'unknown')} | id: {parsed.get('id', 'none')}")
    except (json.JSONDecodeError, TypeError) as e:
        print(f"Invalid JSON body: {body_str[:200]}")
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": _get_cors_origin(event)},
            "body": json.dumps({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {str(e)}"},
            }),
        }

    headers = event.get("headers", {}) or {}
    mcp_session_id = headers.get("mcp-session-id") or headers.get("Mcp-Session-Id", "")

    try:
        kwargs = {
            "agentRuntimeArn": RUNTIME_ARN,
            "contentType": "application/json",
            "accept": "application/json, text/event-stream",
            "payload": body_str.encode("utf-8"),
        }
        if mcp_session_id:
            kwargs["runtimeSessionId"] = mcp_session_id

        response = client.invoke_agent_runtime(**kwargs)

        result_bytes = response["response"].read()
        result_str = result_bytes.decode("utf-8")

        runtime_session_id = response.get("runtimeSessionId", "")

        json_data = None
        for line in result_str.split("\n"):
            if line.startswith("data: "):
                json_data = line[6:]
                break

        response_body = json_data if json_data else result_str

        resp_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": _get_cors_origin(event),
            "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        }
        if runtime_session_id:
            resp_headers["Mcp-Session-Id"] = runtime_session_id

        return {"statusCode": 200, "headers": resp_headers, "body": response_body}

    except Exception as e:
        print(f"Runtime error: {e}")
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": _get_cors_origin(event)},
            "body": json.dumps({
                "jsonrpc": "2.0",
                "id": parsed.get("id", 1),
                "error": {"code": -32603, "message": f"Internal error: {str(e)}"},
            }),
        }
