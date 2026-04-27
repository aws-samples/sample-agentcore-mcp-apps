# Connecting to ChatGPT

After deploying the infrastructure and MCP server, follow these steps to register it as a ChatGPT App.

## Prerequisites

- A deployed MCP endpoint URL (from Terraform/CDK outputs: `mcp_endpoint_url`)
- A ChatGPT Plus, Team, or Enterprise account
- Access to the ChatGPT App Store (developer mode)

## Steps

1. **Go to ChatGPT Settings** > Actions > Create new action
2. **Set the MCP endpoint**: Use the `mcp_endpoint_url` output from your deployment
3. **Authentication**: Set to "None" (the Lambda proxy is public; the AgentCore Runtime handles auth via Cognito)
4. **Test the connection**: Send an `initialize` request to verify the endpoint responds
5. **Publish**: Follow ChatGPT's app publishing flow

## Widget Configuration

Your widgets are served from the CloudFront URL (`widget_base_url` output). ChatGPT will automatically load widget HTML when the MCP server returns `_meta` with `openai/outputTemplate` pointing to your CloudFront domain.

Ensure your CloudFront distribution is accessible and the widget HTML files are uploaded to S3.

## Troubleshooting

- **502 errors**: Check Lambda logs in CloudWatch for `invoke_agent_runtime` errors
- **Widget not rendering**: Verify the `WIDGET_BASE_URL` environment variable matches your CloudFront domain
- **Session issues**: Ensure the `Mcp-Session-Id` header is being passed through correctly
