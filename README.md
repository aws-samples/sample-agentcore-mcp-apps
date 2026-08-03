# AgentCore MCP Apps

Enterprises building AI-powered experiences need a way to expose their backend services as interactive, conversational tools — without rewriting APIs or coupling to a single AI host. This project demonstrates how to do that using **[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)** — an extension to the Model Context Protocol that lets MCP servers deliver interactive HTML user interfaces rendered directly inside AI hosts like ChatGPT, Claude, and VS Code Copilot — deployed on **Amazon Bedrock AgentCore Runtime**.

The sample implements **Unicorn Rentals** — a conversational rental service with rich interactive widgets rendered inline. Because MCP Apps are host-agnostic, the same server works across any supporting client. Customers can:

- **List unicorns** — Browse the full fleet with details like name, speed, color, availability and hourly rate
- **Book a unicorn** — Reserve a unicorn at its hourly rate and receive a booking confirmation
- **View active rental** — Monitor the current booking status and elapsed time
- **Return a unicorn** — End the rental and receive an automatic duration-based invoice

> **Disclaimer:** This sample is provided for demonstration purposes and is not intended for production use without further security hardening, testing, and review appropriate to your environment.

---

This sample shows how to deploy an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server with [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) on [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html), fronted by [Amazon Bedrock AgentCore Gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-core-concepts.html), and connect it to AI hosts (ChatGPT, Claude, etc.) with rich interactive widget UI.

## Tech Stack

- **MCP Server**: Node.js 22 / TypeScript
- **Business Logic**: Python Lambda (DynamoDB access)
- **Gateway**: Amazon Bedrock AgentCore Gateway (MCP protocol, No Auth inbound)
- **Infrastructure**: AWS CDK (TypeScript)
- **Runtime**: Amazon Bedrock AgentCore Runtime (NODEJS_22)

## Demo

The full **list unicorns** flow — from a natural-language request to the rendered widget:

![List Unicorns demo](docs/images/listUnicorns.gif)

Individual actions:

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
| **AgentCore Gateway** | Public MCP endpoint for AI hosts — aggregates MCP targets, handles tool discovery, and enforces WAF rules |
| **AgentCore Runtime (MCP Server)** | Managed runtime hosting the MCP server (Node.js 22) — handles MCP protocol, tool definitions, structured output, widget resources, and delegates business operations to the service Lambda |
| **Unicorn Rental Service** (Python) | Lambda function that implements business logic (list, book, view, return unicorns) with DynamoDB access |
| **DynamoDB** | Stores unicorn inventory and booking records |
| **S3 + CloudFront** | Serves unicorn images referenced by widgets |

### How It Works

#### Registration (Connecting the MCP App to an AI Host)

1. **You provide the App details** to the AI host (ChatGPT, Claude, etc.), including the MCP Server URL — the AgentCore Gateway endpoint.
2. **The AI host** sends MCP `tools/list` and `resources/list` requests to the Gateway URL to discover available capabilities.
3. **AgentCore Gateway** forwards the requests to the AgentCore Runtime via the configured MCP Server target (authenticated with IAM SigV4).
4. **AgentCore Runtime (MCP Server)** receives the requests. The MCP App hosted on it defines MCP tools (e.g., `list_unicorns`, `book_unicorn`) and MCP resources (e.g., widget HTML templates). It responds with the full list of tools and resources.
5. **The AI host** receives the tool and resource definitions and may cache them for future use, enabling tool invocation and widget rendering in subsequent interactions.

#### Request Flow (Tool Calls)

1. **The MCP host** (ChatGPT, Claude, etc.) sends an MCP JSON-RPC request (e.g., `tools/call` with `list_unicorns`) to the AgentCore Gateway URL.
1. **AgentCore Gateway** receives the request. The associated WAF Web ACL evaluates the request against IP allowlist rules, rate limiting, and managed rule sets. Blocked requests are rejected before reaching any target.
1. **AgentCore Gateway** forwards the MCP request to the AgentCore Runtime via the configured MCP Server target, authenticating with IAM (SigV4).
1. **AgentCore Runtime (MCP Server)** receives the MCP request and invokes the Unicorn Service Lambda.
1. **Unicorn Service Lambda** executes the business logic against DynamoDB and returns the results.
1. **AgentCore Runtime (MCP Server)** wraps the response in MCP structured output with widget resource references and returns it through the Gateway to the host.

#### Resource Flow (Widget Rendering)
1. If the tool has an associated resource URI (for example, ui://widget/unicorn-list), the AI host initiates this phase. Tools without an associated widget such as view_bookings and return_unicorn, return text-only content and skip this phase entirely. 
1. The host sends an MCP resources/read request for that URI. 
1. The request reaches the MCP App through the API Gateway and proxy AWS Lambda. 
1. The MCP App resolves the resource URI and returns the self-contained HTML of the widget. AI host might cache this data for better performance. 
1. The host renders the HTML in a sandboxed iframe, injecting the structured data from the tool response via the MCP Apps lifecycle. 
1. The widget fetches the images needed from Amazon CloudFront which uses Amazon S3 as the origin. 


## Deployment

### Prerequisites

- AWS account with [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) enabled
- AWS CLI configured (`aws configure`)
- Node.js 22+ (for MCP server and AWS CDK)
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Step 1: Build All Artifacts

The build script packages the MCP Server for AgentCore Runtime:

```bash
chmod +x build.sh
./build.sh --clean
```

This script:
1. Installs MCP server dependencies (clean install via `--clean` flag for reproducible builds)
2. Bundles widget HTML files with Vite using `vite-plugin-singlefile` (inlines the MCP Apps SDK so widgets work on any host without external CDN dependencies)
3. Bundles the Node.js server with esbuild into a single `main.js`
4. Packages everything into `build/mcp-server-deployment.zip`

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
6. Deploy the **AgentCore Gateway** with No Auth inbound and MCP Server target (IAM outbound auth)
7. Associate the **WAF Web ACL** with the Gateway (IP allowlist + managed rules)
8. Apply a **resource-based policy** restricting runtime invocation to the Gateway only

Note the outputs printed after deployment — you'll need the `GatewayResourceUrl` to connect an MCP host.

### Step 6: Connect to an MCP Host

After deployment, connect the Gateway endpoint to your preferred host:

- **ChatGPT** — [ChatGPT Setup Guide](docs/chatgpt-setup.md)
- **Claude** — [Claude Setup Guide](docs/claude-setup.md)

Both guides cover configuration steps, demo prompts, and troubleshooting. You'll need the `GatewayResourceUrl` from the CDK output.

## Security

This project implements multiple layers of security to protect the MCP endpoint and backend services:

### 1. WAF IP Allowlisting (AgentCore Gateway)

AWS WAF is associated with the AgentCore Gateway with a **default-deny** policy. Only requests originating from allowlisted IP ranges are permitted through. The deployed stack includes outbound IP ranges for both ChatGPT ([OpenAI outbound IPs](https://openai.com/chatgpt-actions.json)) and Claude ([Anthropic outbound IPs](https://docs.anthropic.com/en/api/ip-addresses)). To connect additional MCP hosts or for testing the MCP server directly using tools like MCP Inspector, add their outbound IP ranges to the WAF IP set.

### 2. WAF Managed Rules (Common Attack Protection)

- **AWS Managed Rules Common Rule Set** — Blocks requests matching common attack patterns
- **AWS Managed Rules Known Bad Inputs** — Blocks requests with payloads known to be associated with exploitation
- **Rate Limiting** — Blocks IPs exceeding 1,000 requests per 5-minute window

### 3. IAM Authentication (Gateway to Runtime)

The AgentCore Gateway authenticates to the AgentCore Runtime using IAM (SigV4 signing). The Gateway's execution role is granted `bedrock-agentcore:InvokeAgentRuntime` permission on the runtime ARN.

### 4. Resource-Based Policy (AgentCore Runtime)

A resource-based access policy is attached directly to the AgentCore Runtime. It explicitly allows only the AgentCore Gateway's execution role to invoke the runtime, and denies all other principals. This ensures the runtime cannot be accessed directly, bypassing the Gateway and its WAF protections.

## Cleanup

To destroy all deployed resources:

```bash
cd infrastructure/cdk
npx cdk destroy
```
