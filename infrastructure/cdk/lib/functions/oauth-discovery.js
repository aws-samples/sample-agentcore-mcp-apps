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
 */
function handler(event) {
  var host = event.request.headers.host.value;
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'application/json' },
      'cache-control': { value: 'no-store' }
    },
    // This sample's Gateway uses No Auth inbound, so only the resource URL is
    // returned. If your Gateway uses an OAuth authorizer, add its issuer here:
    //   authorization_servers: ['https://my-org.okta.com/oauth2/default']
    body: JSON.stringify({
      resource: 'https://' + host + '/mcp'
    })
  };
}
