variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "unicorn-mcp"
}

variable "enable_cognito_auth" {
  description = "Enable Cognito JWT authentication on the AgentCore Runtime"
  type        = bool
  default     = true
}
