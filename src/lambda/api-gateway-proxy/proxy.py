"""Lambda proxy: API Gateway -> AgentCore Runtime.

Translates MCP JSON-RPC from ChatGPT into InvokeAgentRuntime calls.
Handles SSE response format from AgentCore Runtime.
"""

import json
import os
import boto3

client = boto3.client("bedrock-agentcore", region_name=os.environ.get("AWS_REGION"))
RUNTIME_ARN = os.environ["RUNTIME_ARN"]


def lambda_handler(event, context):
    body = event.get("body", "{}")
    if isinstance(body, str):
        body_str = body
    else:
        body_str = json.dumps(body)

    try:
        parsed = json.loads(body_str)
        print(f"MCP method: {parsed.get('method', 'unknown')} | id: {parsed.get('id', 'none')}")
    except Exception:
        parsed = {}
        print(f"Non-JSON body: {body_str[:200]}")

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
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        }
        if runtime_session_id:
            resp_headers["Mcp-Session-Id"] = runtime_session_id

        return {"statusCode": 200, "headers": resp_headers, "body": response_body}

    except Exception as e:
        print(f"Runtime error: {e}")
        body_parsed = json.loads(body_str)
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({
                "jsonrpc": "2.0",
                "id": body_parsed.get("id", 1),
                "error": {"code": -32603, "message": f"Internal error: {str(e)}"},
            }),
        }
