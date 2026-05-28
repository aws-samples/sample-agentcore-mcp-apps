"""
CloudFormation Custom Resource handler for managing AgentCore Runtime resource policies.

Uses botocore SigV4 signing + urllib to call the REST API directly, since the
Lambda runtime's bundled boto3 may not include the bedrock-agentcore-control client.
"""

import json
import os
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from botocore.session import Session
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


def get_region():
    return os.environ.get("AWS_REGION", "us-east-1")


def signed_request(method, url, body=None):
    """Make a SigV4-signed HTTP request to the AgentCore Control Plane API."""
    region = get_region()
    session = Session()
    credentials = session.get_credentials()

    headers = {"Content-Type": "application/json"}
    data = body.encode("utf-8") if body else None

    aws_request = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(credentials, "bedrock-agentcore", region).add_auth(aws_request)

    req = Request(
        url=str(aws_request.url),
        data=data,
        headers=dict(aws_request.headers),
        method=method,
    )

    try:
        with urlopen(req) as resp:
            resp_body = resp.read().decode("utf-8")
            return resp.status, resp_body
    except HTTPError as e:
        error_body = e.read().decode("utf-8")
        return e.code, error_body


def lambda_handler(event, context):
    """Handle CloudFormation Create/Update/Delete events via CDK cr.Provider."""
    request_type = event["RequestType"]
    properties = event["ResourceProperties"]
    resource_arn = properties["ResourceArn"]
    policy = properties.get("Policy", "")
    region = get_region()

    encoded_arn = quote(resource_arn, safe="")
    base_url = f"https://bedrock-agentcore-control.{region}.amazonaws.com"
    url = f"{base_url}/resourcepolicy/{encoded_arn}"

    if request_type in ("Create", "Update"):
        body = json.dumps({"policy": policy})
        status, resp_body = signed_request("PUT", url, body)
        if status not in (200, 201):
            raise RuntimeError(f"PutResourcePolicy failed (HTTP {status}): {resp_body}")
        return {
            "PhysicalResourceId": f"resource-policy-{resource_arn}",
            "Data": {"ResourceArn": resource_arn},
        }

    elif request_type == "Delete":
        status, resp_body = signed_request("DELETE", url)
        if status not in (204, 404):
            raise RuntimeError(f"DeleteResourcePolicy failed (HTTP {status}): {resp_body}")
        return {
            "PhysicalResourceId": event.get("PhysicalResourceId", ""),
        }
