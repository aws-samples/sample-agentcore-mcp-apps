# Deploy MCP Server on Amazon Bedrock AgentCore for ChatGPT

Enterprises building AI-powered experiences need a way to expose their backend services and data to LLM-based interfaces like ChatGPT — without rewriting their APIs or tightly coupling to a single AI provider. This project demonstrates how to solve that problem using the **Model Context Protocol (MCP)** standard, deployed on **Amazon Bedrock AgentCore Runtime**.

The sample implements **Unicorn Rentals** — a conversational rental service driven through natural language in ChatGPT, with rich interactive widgets rendered inline for each step. Customers can:

- **List unicorns** — Browse the full fleet with details like name, speed, color, availability and hourly rate
- **Book a unicorn** — Reserve a unicorn at its hourly rate and receive a booking confirmation
- **View active rental** — Monitor the current booking status and elapsed time
- **Return a unicorn** — End the rental and receive an automatic duration-based invoice

---

This sample shows how to deploy an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server on [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) and connect it to ChatGPT with rich widget UI support.

## Demo

| Action | Screenshot |
|-----------|---------|
| List Unicorns: | <a href="docs/images/list.png"><img src="docs/images/list.png" width="150" alt="Unicorn List" style="margin-right:10px;" /></a> |
| Book Unicorns: | <a href="docs/images/book.png"><img src="docs/images/book.png" width="150" alt="Book a unicorn" style="margin-right:10px;" /></a> |
| Show bookings: | <a href="docs/images/show.png"><img src="docs/images/show.png" width="150" alt="Show bookings" style="margin-right:10px;" /></a> |
| Return unicorn: | <a href="docs/images/return.png"><img src="docs/images/return.png" width="150" alt="Return unicorns" /></a> |

You will be able to interact with the app with requests like:
1. List all unicorns
1. I would like to book Stardust unicorn
1. Show me my unicorn bookings
1. I would like to return my unicorn

## Architecture

![Architecture Diagram](docs/architecture-diagram.png)

**How it works:**

- **User → ChatGPT** — The user sends natural language prompts (e.g. "Show me available unicorns") via ChatGPT, which translates them into MCP tool calls.
- **AWS WAF** — Protects the API Gateway with a ChatGPT IP allowlist, AWS Managed Rules (XSS, SQLi, Log4j), and rate limiting (1000 req/5 min).
- **API Gateway → Proxy Lambda** — Receives the MCP JSON-RPC POST request and the Lambda translates it into an `InvokeAgentRuntime` call to Bedrock AgentCore.
- **Bedrock AgentCore Runtime** — Hosts the MCP server (Python 3.13, direct code deploy from S3). Handles MCP protocol, tool definitions, structured output, and customer identity resolution. A resource-based policy restricts invocation to the Proxy Lambda only.
- **Unicorn Service Lambda** — Pure business logic layer invoked by the MCP server. Implements list, book, view, and return operations against DynamoDB.
- **DynamoDB** — Two tables store unicorn inventory (`unicorns`) and booking records (`bookings`). Atomic conditional updates prevent double-booking race conditions.
- **CloudFront → S3** — Serves widget HTML templates and unicorn images that ChatGPT renders inline as rich interactive UI cards.
- **S3 (Deployment)** — Stores the MCP server ZIP artifact used by AgentCore Runtime's direct code deploy mechanism.

### How It Works

#### Request Flow (Tool Calls)

1. **ChatGPT** sends an MCP JSON-RPC request (e.g., `tools/call` with `list_unicorns`) to the API Gateway endpoint.
1. **API Gateway** receives the HTTPS request, applies WAF rules (IP allowlisting, rate limiting, common attack protection), and routes it to the Proxy Lambda.
1. **API Gateway Proxy Lambda** forwards the request to AgentCore Runtime.
1. **AgentCore Runtime (MCP Server)** receives the MCP request, resolves customer identity from ChatGPT context, and invokes the Unicorn Service Lambda.
1. **Unicorn Service Lambda** executes the business logic against DynamoDB and returns the results.
1. **AgentCore Runtime (MCP Server)** wraps the response in MCP structured output with widget references and returns it to ChatGPT.

#### Resource Flow (Widget Rendering)

1. **ChatGPT** receives a `tools/call` response containing a widget resource URI (e.g., `ui://widget/unicorn-list.html`) in the `_meta.openai/outputTemplate` field.
1. **ChatGPT** sends an MCP `resources/read` request for that URI to the API Gateway endpoint.
1. **API Gateway** routes the request through WAF and forwards it to the Proxy Lambda.
1. **API Gateway Proxy Lambda** forwards the request to AgentCore Runtime.
1. **AgentCore Runtime (MCP Server)** resolves the resource URI, loads the corresponding widget HTML and returns it.
1. **ChatGPT** renders the HTML widget inline, injecting the structured data from the original `tools/call` response into the template.
1. Images needed are directly fetched from **CloudFront** (backed by S3).

#### Separation of Concerns

This project demonstrates a clean separation between the **MCP protocol layer** and the **business logic layer**:

- **MCP Server** (AgentCore Runtime) — Handles MCP protocol, tool definitions, structured output, widget resources, and customer identity resolution from ChatGPT context. It delegates all business operations to the Unicorn Service Lambda.
- **Unicorn Rental Service Lambda** — Pure business logic that accepts JSON requests and returns JSON responses.

## Deployment

### Prerequisites

- AWS account with [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) enabled
- AWS CLI configured (`aws configure`)
- Python 3.13+ with `pip` (for packaging the MCP server)
- Node.js 22+ (for AWS CDK)
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Step 1: Package the MCP Server

The shell script installs Python dependencies and bundles them with the server code into a zip file for AgentCore Runtime direct code deployment.

```bash
chmod +x src/scripts/package-mcp-server.sh
./src/scripts/package-mcp-server.sh
```

This produces `build/mcp-server-deployment.zip`.

### Step 2: Install CDK Dependencies

```bash
cd infrastructure/cdk
npm install
```

### Step 3: Bootstrap CDK (first time only)

If this is the first time deploying CDK in your AWS account/region, you need to bootstrap:

```bash
npx cdk bootstrap
```

### Step 4: Synthesize the CloudFormation Template

Verify the stack synthesizes without errors:

```bash
npx cdk synth
```

You can optionally pass a custom project name via context:

```bash
npx cdk synth -c projectName=unicorn-rentals
```

The default project name is `unicorn-rentals`.

### Step 5: Deploy

```bash
npx cdk deploy
```

CDK will:
1. Create the S3 deployment bucket and upload the MCP server zip
2. Create DynamoDB tables and seed them with unicorn data
3. Deploy the **Unicorn Service Lambda** with DynamoDB permissions
4. Create the IAM role for AgentCore with S3 read and Lambda invoke permissions
5. Create the AgentCore Runtime (MCP Server) pointing to the service Lambda
6. Deploy the API Gateway Proxy Lambda and API Gateway

Note the outputs printed after deployment — you'll need the `McpEndpointUrl` for ChatGPT.

### Step 6: Connect to ChatGPT

1. In ChatGPT, go to **Settings > Apps > Advanced settings** and enable **Developer mode**
1. Go to **Settings > Apps > Create app**
1. Set the values:
   1. `name` : UnicornRentals
   1. `description` : Allows you to list unicorns, rent unicorns, view rented unicorns and return unicorns
   1. `McpEndpointUrl` : Get from the CDK output variable "AgentCoreMcpStack.McpEndpointUrl".
1. Set authentication to None.
1. Create the App.
1. After the app gets created, open a new chat, click **+ > More**, select your connector, and try: *"Show me all unicorns"*

See the full [ChatGPT Setup Guide](docs/chatgpt-setup.md) for detailed instructions, demo prompts, and troubleshooting.

### Using with Claude

This MCP server uses the **MCP Apps** open standard for widget rendering, which means the same rich interactive UI cards work in both ChatGPT and Claude. Add it as a Custom Connector on claude.ai or configure Claude Desktop — you get the full experience including widget cards. See the [Claude Setup Guide](docs/claude-setup.md) for configuration instructions.

## Security

This project implements multiple layers of security to protect the API endpoint and backend services:

### 1. WAF IP Allowlisting (API Gateway)

AWS WAF is attached to the API Gateway with a **default-deny** policy. Only requests originating from [ChatGPT's published outbound IP ranges](https://openai.com/chatgpt-actions.json) are allowed through. This ensures no arbitrary internet traffic can reach your endpoint.

> **Warning:** OpenAI updates the ChatGPT Actions IP list periodically (typically every few months). If ChatGPT requests start failing with 403 errors, check [https://openai.com/chatgpt-actions.json](https://openai.com/chatgpt-actions.json) for updated CIDR ranges and update the `chatGptIpSet` addresses in `infrastructure/cdk/lib/agentcore-mcp-stack.ts`.

### 2. WAF Managed Rules (Common Attack Protection)

In addition to IP allowlisting, the WAF Web ACL includes:

- **AWS Managed Rules Common Rule Set** — Blocks requests matching common attack patterns (XSS, SQL injection, path traversal, etc.)
- **AWS Managed Rules Known Bad Inputs** — Blocks requests with payloads known to be associated with exploitation (Log4j/Log4Shell, Java deserialization, etc.)
- **Rate Limiting** — Blocks IPs exceeding 1,000 requests per 5-minute window to prevent abuse

### 3. Resource-Based Policy (AgentCore Runtime)

A resource-based access policy is attached directly to the AgentCore Runtime. It explicitly allows only the API Gateway Proxy Lambda's execution role to invoke the runtime, and denies all other principals. Even if an attacker bypasses the API Gateway layer, they cannot directly call the AgentCore Runtime without the correct IAM credentials.

## Cleanup

To destroy all deployed resources:

```bash
cd infrastructure/cdk
npx cdk destroy
```
