# Deploy MCP Server on Amazon Bedrock AgentCore for ChatGPT

This sample shows how to deploy an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server on [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) and connect it to ChatGPT with rich widget UI support.

## Architecture

```
ChatGPT ──HTTPS──> API Gateway (/mcp) ──> Lambda Proxy ──> AgentCore Runtime (MCP Server)
ChatGPT ──HTTPS──> CloudFront (widgets/*.html)
```

**Components:**

| Component | Purpose |
|-----------|---------|
| **MCP Server** | Python or TypeScript server with tools (list, check availability, book) |
| **AgentCore Runtime** | Managed container runtime for the MCP server |
| **Lambda Proxy** | Translates HTTPS from API Gateway into `InvokeAgentRuntime` calls |
| **API Gateway** | Public HTTPS endpoint for ChatGPT to call |
| **S3 + CloudFront** | Serves widget HTML files rendered inside ChatGPT |
| **Cognito** | JWT authentication for the AgentCore Runtime |

## Prerequisites

- AWS account with [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) enabled
- AWS CLI configured
- Docker installed (for building container images)
- **Terraform >= 1.5** OR **AWS CDK >= 2.170** (choose one)
- Python 3.12+ (for Lambda proxy and Python MCP server)
- Node.js 22+ (for TypeScript MCP server and CDK)

## Quick Start

### 1. Deploy Infrastructure

**Option A: Terraform**

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your preferred region and project name
terraform init
terraform apply
```

**Option B: CDK**

```bash
cd infrastructure/cdk
npm install
npx cdk bootstrap   # First time only
npx cdk deploy
```

### 2. Build and Push MCP Server Image

```bash
# Python server
./scripts/build-push-image.sh python

# OR TypeScript server
./scripts/build-push-image.sh typescript
```

### 3. Upload Widgets to S3

```bash
# Get the S3 bucket name from Terraform/CDK outputs
./scripts/upload-widgets.sh <s3-bucket-name>
```

### 4. Test the Deployment

```bash
# Get the Runtime ARN from Terraform/CDK outputs
python scripts/test-runtime.py us-east-1 <runtime-arn>
```

### 5. Connect to ChatGPT

See [ChatGPT Setup Guide](docs/chatgpt-setup.md) for registering your MCP endpoint as a ChatGPT App.

## MCP Server Variants

| Variant | Path | Runtime | Widget Approach |
|---------|------|---------|-----------------|
| **Python** | `mcp-server/python/` | FastMCP + `structuredContent` in text | Hosted on S3/CloudFront via `openai/outputTemplate` |
| **TypeScript** | `mcp-server/typescript/` | `@modelcontextprotocol/sdk` + `ext-apps` | Bundled widgets + `RESOURCE_URI_META_KEY` |

## Project Structure

```
.
├── mcp-server/
│   ├── python/          # Python MCP server
│   └── typescript/      # TypeScript MCP server + widgets
├── lambda/              # Lambda proxy handler
├── scripts/             # Build, upload, and test scripts
├── sample-widgets/      # Widget HTML for S3 upload (Python server)
├── infrastructure/
│   ├── terraform/       # Terraform IaC
│   └── cdk/             # AWS CDK IaC
└── docs/                # Architecture and setup guides
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the Apache 2.0 License. See the LICENSE file.
