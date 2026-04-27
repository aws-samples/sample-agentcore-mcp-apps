output "mcp_endpoint_url" {
  description = "MCP endpoint URL for ChatGPT connector"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/mcp"
}

output "widget_base_url" {
  description = "CloudFront URL for widgets"
  value       = "https://${aws_cloudfront_distribution.widgets.domain_name}"
}

output "runtime_arn" {
  description = "AgentCore Runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.mcp_server.agent_runtime_arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for MCP server image"
  value       = aws_ecr_repository.mcp_server.repository_url
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.mcp.id
}

output "cognito_client_id" {
  description = "Cognito Client ID"
  value       = aws_cognito_user_pool_client.mcp.id
}

output "s3_bucket" {
  description = "S3 bucket name for widgets"
  value       = aws_s3_bucket.widgets.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.widgets.id
}
