// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * CloudFront Function (viewer-request) for /.well-known/oauth-protected-resource
 *
 * By default the Gateway returns a resource URL containing its own
 * *.gateway.bedrock-agentcore.* domain instead of the front-door domain, which
 * breaks OAuth clients when a custom domain (or the CloudFront domain) is used.
 * The AgentCore custom-domains guide works around this with a Lambda@Edge
 * ORIGIN_RESPONSE function; a CloudFront Function is cheaper, faster, and
 * simpler because it can generate the response directly at the edge — the
 * request never reaches the Gateway.
 *
 * The Host header is used so the answer is correct for both the default
 * *.cloudfront.net domain and any custom domain attached to the distribution.
 *
 * The AUTH_SERVERS placeholder below is substituted at synth time by the CDK
 * stack: it becomes [] when the Gateway uses No Auth inbound, and the Cognito
 * issuer URL array when deployed with -c auth=cognito.
 */
var AUTH_SERVERS = __AUTH_SERVERS__;

function handler(event) {
  var host = event.request.headers.host.value;
  var doc = {
    resource: 'https://' + host + '/mcp'
  };
  if (AUTH_SERVERS.length > 0) {
    doc.authorization_servers = AUTH_SERVERS;
  }
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'application/json' },
      'cache-control': { value: 'no-store' }
    },
    body: JSON.stringify(doc)
  };
}
