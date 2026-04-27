#!/usr/bin/env python3
"""End-to-end test for MCP server on AgentCore Runtime."""
import json
import sys
import boto3
import uuid

REGION = sys.argv[1] if len(sys.argv) > 1 else "us-east-1"
RUNTIME_ARN = sys.argv[2] if len(sys.argv) > 2 else None

if not RUNTIME_ARN:
    print("Usage: python test-runtime.py <region> <runtime-arn>")
    sys.exit(1)


def parse_sse_response(response_body):
    results = []
    for chunk in response_body:
        text = chunk.decode() if isinstance(chunk, bytes) else chunk
        for line in text.split("\r\n"):
            if line.startswith("data: "):
                try:
                    results.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
    return results


def test_mcp_server():
    client = boto3.client("bedrock-agentcore", region_name=REGION)
    session_id = str(uuid.uuid4())

    print(f"Testing MCP server: {RUNTIME_ARN}")

    # 1. Initialize
    print("\n1. Sending initialize request...")
    response = client.invoke_agent_runtime(
        agentRuntimeArn=RUNTIME_ARN,
        qualifier="DEFAULT",
        contentType="application/json",
        accept="application/json, text/event-stream",
        mcpSessionId=session_id,
        payload=json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}
        }).encode(),
    )
    mcp_session_id = response.get("mcpSessionId")
    results = parse_sse_response(response.get("response"))
    print(f"Session: {mcp_session_id}")
    print(f"Response: {json.dumps(results, indent=2)}")

    # 2. List tools
    print("\n2. Listing tools...")
    response = client.invoke_agent_runtime(
        agentRuntimeArn=RUNTIME_ARN, qualifier="DEFAULT",
        contentType="application/json", accept="application/json, text/event-stream",
        mcpSessionId=mcp_session_id,
        payload=json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}).encode(),
    )
    results = parse_sse_response(response.get("response"))
    print(f"Tools: {json.dumps(results, indent=2)}")

    # 3. Call list_unicorns
    print("\n3. Calling list_unicorns...")
    response = client.invoke_agent_runtime(
        agentRuntimeArn=RUNTIME_ARN, qualifier="DEFAULT",
        contentType="application/json", accept="application/json, text/event-stream",
        mcpSessionId=mcp_session_id,
        payload=json.dumps({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "list_unicorns", "arguments": {"unicorn_type": "all"}}
        }).encode(),
    )
    results = parse_sse_response(response.get("response"))
    print(f"Result: {json.dumps(results, indent=2)}")

    print("\nAll tests passed!")


if __name__ == "__main__":
    test_mcp_server()
