# ChatGPT App + AgentCore MCP Server — Full Stack
#
# Architecture:
#   ChatGPT --HTTPS--> API Gateway (/mcp) --> Lambda Proxy --> AgentCore Runtime (MCP Server)
#   ChatGPT --HTTPS--> CloudFront (widgets/*.html, images/*.png)

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.70.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ============================================================
# 1. S3 + CloudFront for Widgets
# ============================================================

resource "aws_s3_bucket" "widgets" {
  bucket        = "${var.project}-widgets-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "widgets" {
  bucket                  = aws_s3_bucket.widgets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_identity" "widgets" {
  comment = "${var.project} widgets OAI"
}

resource "aws_s3_bucket_policy" "widgets" {
  bucket = aws_s3_bucket.widgets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = aws_cloudfront_origin_access_identity.widgets.iam_arn }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.widgets.arn}/*"
    }]
  })
}

resource "aws_cloudfront_distribution" "widgets" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.project} widgets CDN"

  origin {
    domain_name = aws_s3_bucket.widgets.bucket_regional_domain_name
    origin_id   = "S3-widgets"
    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.widgets.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-widgets"
    viewer_protocol_policy = "redirect-to-https"
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 3600
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ============================================================
# 2. ECR Repository
# ============================================================

resource "aws_ecr_repository" "mcp_server" {
  name                 = "${var.project}-server"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration { scan_on_push = false }
}

# ============================================================
# 3. IAM Role for AgentCore Runtime
# ============================================================

resource "aws_iam_role" "agentcore" {
  name = "${var.project}-agentcore-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["sts:AssumeRole"]
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "agentcore_ecr" {
  name = "ecr-access"
  role = aws_iam_role.agentcore.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = aws_ecr_repository.mcp_server.arn
      }
    ]
  })
}

# ============================================================
# 4. Cognito for JWT Authentication
# ============================================================

resource "aws_cognito_user_pool" "mcp" {
  name = "${var.project}-user-pool"
  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
  }
}

resource "aws_cognito_user_pool_client" "mcp" {
  depends_on                               = [aws_cognito_resource_server.mcp]
  name                                     = "${var.project}-client"
  user_pool_id                             = aws_cognito_user_pool.mcp.id
  generate_secret                          = true
  allowed_oauth_flows                      = ["client_credentials"]
  allowed_oauth_flows_user_pool_client     = true
  allowed_oauth_scopes                     = ["${var.project}/invoke"]
  explicit_auth_flows                      = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  supported_identity_providers             = ["COGNITO"]
}

resource "aws_cognito_resource_server" "mcp" {
  identifier   = var.project
  name         = "${var.project}-resource-server"
  user_pool_id = aws_cognito_user_pool.mcp.id
  scope {
    scope_name        = "invoke"
    scope_description = "Invoke MCP server"
  }
}

resource "aws_cognito_user_pool_domain" "mcp" {
  domain       = "${var.project}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.mcp.id
}

# ============================================================
# 5. AgentCore Runtime (MCP Server)
# ============================================================

resource "aws_bedrockagentcore_agent_runtime" "mcp_server" {
  agent_runtime_name = "${replace(var.project, "-", "_")}_runtime"
  description        = "${var.project} MCP Server on AgentCore Runtime"
  role_arn           = aws_iam_role.agentcore.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.mcp_server.repository_url}:latest"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "MCP"
  }

  environment_variables = {
    WIDGET_BASE_URL = "https://${aws_cloudfront_distribution.widgets.domain_name}"
  }

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url    = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.mcp.id}/.well-known/openid-configuration"
      allowed_audience = [aws_cognito_user_pool_client.mcp.id]
    }
  }
}

resource "aws_bedrockagentcore_agent_runtime_endpoint" "mcp_server" {
  name             = "${replace(var.project, "-", "_")}_endpoint"
  agent_runtime_id = aws_bedrockagentcore_agent_runtime.mcp_server.agent_runtime_id
  description      = "${var.project} MCP endpoint"
}

# ============================================================
# 6. Lambda Proxy
# ============================================================

resource "aws_iam_role" "lambda_proxy" {
  name = "${var.project}-proxy-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_proxy" {
  name = "${var.project}-proxy-policy"
  role = aws_iam_role.lambda_proxy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = "${aws_bedrockagentcore_agent_runtime.mcp_server.agent_runtime_arn}*"
      }
    ]
  })
}

data "archive_file" "lambda_proxy" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "proxy" {
  filename         = data.archive_file.lambda_proxy.output_path
  function_name    = "${var.project}-proxy"
  role             = aws_iam_role.lambda_proxy.arn
  handler          = "proxy.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  source_code_hash = data.archive_file.lambda_proxy.output_base64sha256

  environment {
    variables = {
      RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.mcp_server.agent_runtime_arn
    }
  }
}

# ============================================================
# 7. API Gateway
# ============================================================

resource "aws_api_gateway_rest_api" "mcp" {
  name        = "${var.project}-api"
  description = "ChatGPT MCP Proxy API"
  endpoint_configuration { types = ["REGIONAL"] }
}

resource "aws_api_gateway_resource" "mcp" {
  rest_api_id = aws_api_gateway_rest_api.mcp.id
  parent_id   = aws_api_gateway_rest_api.mcp.root_resource_id
  path_part   = "mcp"
}

resource "aws_api_gateway_method" "post" {
  rest_api_id   = aws_api_gateway_rest_api.mcp.id
  resource_id   = aws_api_gateway_resource.mcp.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "lambda" {
  rest_api_id             = aws_api_gateway_rest_api.mcp.id
  resource_id             = aws_api_gateway_resource.mcp.id
  http_method             = aws_api_gateway_method.post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.proxy.invoke_arn
}

resource "aws_api_gateway_method" "options" {
  rest_api_id   = aws_api_gateway_rest_api.mcp.id
  resource_id   = aws_api_gateway_resource.mcp.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options" {
  rest_api_id = aws_api_gateway_rest_api.mcp.id
  resource_id = aws_api_gateway_resource.mcp.id
  http_method = aws_api_gateway_method.options.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options" {
  rest_api_id = aws_api_gateway_rest_api.mcp.id
  resource_id = aws_api_gateway_resource.mcp.id
  http_method = aws_api_gateway_method.options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options" {
  rest_api_id = aws_api_gateway_rest_api.mcp.id
  resource_id = aws_api_gateway_resource.mcp.id
  http_method = aws_api_gateway_method.options.http_method
  status_code = aws_api_gateway_method_response.options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Mcp-Session-Id'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.proxy.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.mcp.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "mcp" {
  depends_on  = [aws_api_gateway_integration.lambda, aws_api_gateway_integration.options]
  rest_api_id = aws_api_gateway_rest_api.mcp.id
  lifecycle { create_before_destroy = true }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.mcp.id
  rest_api_id   = aws_api_gateway_rest_api.mcp.id
  stage_name    = "prod"
}
