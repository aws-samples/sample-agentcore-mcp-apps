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

<< GIF or SCREENSHOTS >>

You will be able to interact with the app with requests like - 
1. List all unicorns
1. I would like to book Stardust unicorn
1. Show me my unicorn bookings
1. I would like to return my unicorn


## Architecture

```
ChatGPT ──HTTPS──> API Gateway (/mcp) ──> Lambda Proxy ──> AgentCore Runtime (MCP Server) ──> Unicorn Service Lambda ──> DynamoDB
                                                                                                        │
ChatGPT ──HTTPS──> CloudFront (widgets/*.html) ──> S3                                                   ▼
                                                                                              Unicorns Table / Bookings Table
```

**Separation of Concerns:**

This project demonstrates a clean separation between the **MCP protocol layer** and the **business logic layer**:

- **MCP Server** (AgentCore Runtime) — Handles MCP protocol, tool definitions, structured output, widget resources, and customer identity resolution from ChatGPT context. It delegates all business operations to the Unicorn Service Lambda.
- **Unicorn Rental Service Lambda** — Pure business logic that accepts JSON requests and returns JSON responses.

**Components:**

| Component | Purpose |
|-----------|---------|
| **MCP Server** | Thin MCP protocol layer — receives JSON-RPC, resolves identity, invokes service Lambda |
| **Unicorn Rental Service** | Lambda function that implements business logic (list, book, view, return unicorns) with DynamoDB access |
| **AgentCore Runtime** | Managed runtime hosting the MCP server |
| **API Gateway** | Public HTTPS endpoint for ChatGPT to call |
| **API Gateway Proxy Lambda** | Translates HTTPS from API Gateway into `InvokeAgentRuntime` calls |
| **S3 + CloudFront** | Serves widget HTML files rendered inside ChatGPT |
| **DynamoDB** | Stores unicorn inventory and booking records |

## Prerequisites

- AWS account with [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html) enabled
- AWS CLI configured (`aws configure`)
- Python 3.13+ with `pip` (for packaging the MCP server)
- Node.js 22+ (for AWS CDK)
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

## Deployment

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
1. Set the values - 
   1. `name` : UnicornRentals
   1. `description` : Allows you to list unicorns, rent unicorns, view rented unicorns and return unicorns 
   1. `McpEndpointUrl` : Get from the CDK output variable "AgentCoreMcpStack.McpEndpointUrl".
1. Set authentication to None.
1. Create the App.
1. After the app gets created, open a new chat, click **+ > More**, select your connector, and try: *"Show me all unicorns"*

See the full [ChatGPT Setup Guide](docs/chatgpt-setup.md) for detailed instructions, demo prompts, OAuth setup, and troubleshooting.

## How It Works

### Request Flow

1. **ChatGPT** sends an MCP JSON-RPC request (e.g., `tools/call` with `list_unicorns`) to the API Gateway endpoint.
1. **API Gateway Proxy Lambda** forwards the request to AgentCore Runtime.
1. **MCP Server** running on AgentCore receives the MCP request, resolves customer identity from ChatGPT context, and invokes the Unicorn Service Lambda
1. **Unicorn Service Lambda** executes the business logic against DynamoDB and returns the results
1. **MCP Server** wraps the response in MCP structured output with widget references and returns it to ChatGPT.

## Cleanup

To destroy all deployed resources:

```bash
cd infrastructure/cdk
npx cdk destroy
```

## Widget Previews

When tools execute, ChatGPT renders rich UI widgets inside the chat:

| Unicorn List | Availability Check | Booking Confirmation |
|:---:|:---:|:---:|
| ![Unicorn List](screenshots/widget-unicorn-list-rendered.png) | ![Availability](screenshots/widget-availability-rendered.png) | ![Booking](screenshots/widget-booking-confirmation-rendered.png) |
| `list_unicorns` tool | `check_availability` tool | `book_unicorn` tool |


## License

This library is licensed under the Apache 2.0 License. See the LICENSE file.
