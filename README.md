# AgentCore MCP Apps

Enterprises building AI-powered experiences need a way to expose their backend services as interactive, conversational tools — without rewriting APIs or coupling to a single AI host. This project demonstrates how to do that using **[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)** — an extension to the Model Context Protocol that lets MCP servers deliver interactive HTML user interfaces rendered directly inside AI hosts like ChatGPT, Claude, and VS Code Copilot — deployed on **Amazon Bedrock AgentCore Runtime**.

The sample implements **Unicorn Rentals** — a conversational rental service with rich interactive widgets rendered inline. Because MCP Apps are host-agnostic, the same server works across any supporting client. Customers can:

- **List unicorns** — Browse the full fleet with details like name, speed, color, availability and hourly rate
- **Book a unicorn** — Reserve a unicorn at its hourly rate and receive a booking confirmation
- **View active rental** — Monitor the current booking status and elapsed time
- **Return a unicorn** — End the rental and receive an automatic duration-based invoice

> **Disclaimer:** This sample is provided for demonstration purposes and is not intended for production use without further security hardening, testing, and review appropriate to your environment.

---

This sample shows how to deploy an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server with [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) on [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) and connect it to AI hosts (ChatGPT, Claude, etc.) with rich interactive widget UI.

## Tech Stack

- **MCP Server**: Node.js 22 / TypeScript
- **Business Logic**: Python Lambda (DynamoDB access)
- **Proxy Lambda**: Node.js 22 / TypeScript
- **Infrastructure**: AWS CDK (TypeScript)
- **Runtime**: Amazon Bedrock AgentCore Runtime (NODEJS_22)

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
| Component | Purpose |
|-----------|---------|
| **MCP Server** (Node.js/TS) | Thin MCP protocol layer — receives JSON-RPC, resolves identity, invokes service Lambda, serves widget HTML as MCP resources |
| **Unicorn Rental Service** (Python) | Lambda function that implements business logic (list, book, view, return unicorns) with DynamoDB access |
| **AgentCore Runtime** | Managed runtime hosting the MCP server (Node.js 22) |
| **API Gateway** | Public HTTPS endpoint for MCP hosts to call |
| **API Gateway Proxy Lambda** (Node.js/TS) | Translates HTTPS from API Gateway into `InvokeAgentRuntime` calls |
| **S3 + CloudFront** | Serves unicorn images referenced by widgets |
| **DynamoDB** | Stores unicorn inventory and booking records |

### How It Works

#### Request Flow (Tool Calls)

1. **The MCP host** sends an MCP JSON-RPC request (e.g., `tools/call` with `list_unicorns`) to the API Gateway endpoint.
1. **API Gateway** receives the HTTPS request, applies WAF rules (IP allowlisting, rate limiting, common attack protection), and routes it to the Proxy Lambda.
1. **API Gateway Proxy Lambda** forwards the request to AgentCore Runtime.
1. **AgentCore Runtime (MCP Server)** receives the MCP request, resolves customer identity from the host context, and invokes the Unicorn Service Lambda.
1. **Unicorn Service Lambda** executes the business logic against DynamoDB and returns the results.
1. **AgentCore Runtime (MCP Server)** wraps the response in MCP structured output with widget resource references and returns it to the host.

#### Resource Flow (Widget Rendering)

1. **The MCP host** receives a `tools/call` response containing a widget resource URI (e.g., `ui://widget/unicorn-list`) in the tool's `_meta.ui.resourceUri` field.
1. **The MCP host** sends an MCP `resources/read` request for that URI to the API Gateway endpoint.
1. **API Gateway** routes the request through WAF and forwards it to the Proxy Lambda.
1. **API Gateway Proxy Lambda** forwards the request to AgentCore Runtime.
1. **AgentCore Runtime (MCP Server)** resolves the resource URI, loads the corresponding widget HTML (served as an MCP resource using `registerAppResource`) and returns it.
1. **The MCP host** renders the HTML widget in a sandboxed iframe, injecting the structured data from the original `tools/call` response via the MCP Apps lifecycle.
1. Images referenced by widgets are fetched directly from **CloudFront** (backed by S3).

#### Separation of Concerns

This project demonstrates a clean separation between the **MCP protocol layer** and the **business logic layer**:

- **MCP Server** (AgentCore Runtime) — Handles MCP protocol, tool definitions, structured output, widget resources (MCP Apps pattern), and customer identity resolution from host context. It delegates all business operations to the Unicorn Service Lambda.
- **Unicorn Rental Service Lambda** — Pure business logic that accepts JSON requests and returns JSON responses.

## Deployment

### Prerequisites

- AWS account with [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) enabled
- AWS CLI configured (`aws configure`)
- Node.js 22+ (for MCP server, proxy Lambda, and AWS CDK)
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Step 1: Build All Artifacts

A single build script handles both the API Gateway Proxy Lambda and MCP Server packaging:

```bash
chmod +x build.sh
./build.sh --clean
```

This script:
1. Builds the API Gateway Proxy Lambda (`src/lambda/api-gateway-proxy/dist/index.mjs`)
2. Installs MCP server dependencies (clean install via `--clean` flag for reproducible builds)
3. Bundles widget HTML files with Vite using `vite-plugin-singlefile` (inlines the MCP Apps SDK so widgets work on any host without external CDN dependencies)
4. Bundles the Node.js server with esbuild into a single `main.js`
5. Packages everything into `build/mcp-server-deployment.zip`

The `--clean` flag removes `node_modules` and `package-lock.json` before installing, ensuring a reproducible build. Omit it for faster local iteration when dependencies haven't changed.

The build output is pure JavaScript — no native modules — so it runs on ARM64 AgentCore Runtime regardless of the build host architecture.

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

The default project name is `unicorn-mcp`.

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
6. Deploy the API Gateway Proxy Lambda
7. Deploy API Gateway with WAF

Note the outputs printed after deployment — you'll need the `McpEndpointUrl` to connect an MCP host.

### Step 6: Connect to an MCP Host

After deployment, connect the MCP endpoint to your preferred host:

- **ChatGPT** — [ChatGPT Setup Guide](docs/chatgpt-setup.md)
- **Claude** — [Claude Setup Guide](docs/claude-setup.md)

Both guides cover configuration steps, demo prompts, and troubleshooting. You'll need the `McpEndpointUrl` from the CDK output.

## Security

This project implements multiple layers of security to protect the API endpoint and backend services:

### 1. WAF IP Allowlisting (API Gateway)

AWS WAF is attached to the API Gateway with a **default-deny** policy. Only requests originating from allowlisted IP ranges are permitted through. The deployed stack includes outbound IP ranges for both ChatGPT ([OpenAI outbound IPs](https://openai.com/chatgpt-actions.json)) and Claude ([Anthropic outbound IPs](https://docs.anthropic.com/en/api/ip-addresses)). To connect additional MCP hosts or for testing the MCP server directly using tools like MCP Inspector, add their outbound IP ranges to the WAF IP set.

### 2. WAF Managed Rules (Common Attack Protection)

- **AWS Managed Rules Common Rule Set** — Blocks requests matching common attack patterns
- **AWS Managed Rules Known Bad Inputs** — Blocks requests with payloads known to be associated with exploitation
- **Rate Limiting** — Blocks IPs exceeding 1,000 requests per 5-minute window

### 3. Resource-Based Policy (AgentCore Runtime)

A resource-based access policy is attached directly to the AgentCore Runtime. It explicitly allows only the API Gateway Proxy Lambda's execution role to invoke the runtime, and denies all other principals.

## Cleanup

To destroy all deployed resources:

```bash
cd infrastructure/cdk
npx cdk destroy
```
