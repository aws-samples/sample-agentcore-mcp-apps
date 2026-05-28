# Architecture Diagram

```mermaid
flowchart TB
    %% External
    User["👤 User"]
    ChatGPT["🤖 ChatGPT"]

    %% AWS Cloud
    subgraph AWS["☁️ AWS Cloud"]

        subgraph API["API Layer"]
            APIGW["API Gateway\n(REST API)\n/mcp POST"]
        end

        subgraph Compute["Compute Layer"]
            Lambda["Lambda Proxy\n(Python 3.12)\nTranslates HTTPS → InvokeAgentRuntime"]
            AgentCore["Bedrock AgentCore Runtime\n(MCP Server - Python 3.13)\nDirect Code Deploy"]
        end

        subgraph Data["Data Layer"]
            DDB_Unicorns["DynamoDB\nunicorn-mcp-unicorns"]
            DDB_Bookings["DynamoDB\nunicorn-mcp-bookings"]
        end

        subgraph Auth["Authentication"]
            Cognito["Cognito User Pool\n+ Resource Server\n(JWT / Client Credentials)"]
        end

        subgraph CDN["Widget Hosting"]
            CF["CloudFront\nDistribution"]
            S3_Widgets["S3 Bucket\n(Widget HTML + Images)"]
        end

        subgraph Deploy["Deployment Artifacts"]
            S3_Deploy["S3 Bucket\n(MCP Server ZIP)"]
        end

    end

    %% Data Flow - Main Request Path
    User -->|"Prompt"| ChatGPT
    ChatGPT -->|"MCP JSON-RPC\n(POST /mcp)"| APIGW
    APIGW -->|"Invoke"| Lambda
    Lambda -->|"InvokeAgentRuntime\n(SSE response)"| AgentCore
    AgentCore -->|"Scan/GetItem/PutItem"| DDB_Unicorns
    AgentCore -->|"PutItem/Query"| DDB_Bookings

    %% Widget Flow
    ChatGPT -->|"Fetch widget HTML\n(iframe)"| CF
    CF -->|"Origin"| S3_Widgets

    %% Auth Flow
    Cognito -.->|"JWT validation\n(OIDC discovery)"| AgentCore

    %% Deployment Flow
    S3_Deploy -.->|"Code artifact"| AgentCore

    %% Response Path
    AgentCore -->|"structuredContent\n+ widget URL"| Lambda
    Lambda -->|"JSON response\n+ Mcp-Session-Id"| APIGW
    APIGW -->|"JSON-RPC response"| ChatGPT
    ChatGPT -->|"Rendered widget UI"| User

    %% Styling
    classDef aws fill:#FF9900,stroke:#232F3E,color:#232F3E
    classDef external fill:#4A90D9,stroke:#2C5F8A,color:#fff
    classDef data fill:#3B48CC,stroke:#232F3E,color:#fff
    classDef auth fill:#DD344C,stroke:#232F3E,color:#fff
    classDef cdn fill:#8C4FFF,stroke:#232F3E,color:#fff

    class APIGW,Lambda,AgentCore aws
    class User,ChatGPT external
    class DDB_Unicorns,DDB_Bookings,S3_Deploy data
    class Cognito auth
    class CF,S3_Widgets cdn
```

## Component Summary

| Component | Service | Purpose |
|-----------|---------|---------|
| API Gateway | Amazon API Gateway (REST) | Public HTTPS endpoint for ChatGPT MCP connector |
| Lambda Proxy | AWS Lambda (Python 3.12) | Translates HTTP POST into `InvokeAgentRuntime` calls, parses SSE |
| AgentCore Runtime | Amazon Bedrock AgentCore | Hosts the MCP server container (direct code deploy from S3 ZIP) |
| MCP Server | Python 3.13 (FastMCP) | Implements `list_unicorns`, `check_availability`, `book_unicorn` tools |
| DynamoDB (Unicorns) | Amazon DynamoDB | Stores unicorn inventory (6 seeded records) |
| DynamoDB (Bookings) | Amazon DynamoDB | Stores booking records |
| Cognito | Amazon Cognito | Issues JWTs for AgentCore Runtime authentication (client credentials flow) |
| CloudFront | Amazon CloudFront | CDN for widget HTML and unicorn images |
| S3 (Widgets) | Amazon S3 | Origin bucket for widget assets and images |
| S3 (Deployment) | Amazon S3 | Stores the MCP server deployment ZIP artifact |

## Request Flow (Sequence)

```mermaid
sequenceDiagram
    participant User
    participant ChatGPT
    participant APIGW as API Gateway
    participant Lambda as Lambda Proxy
    participant AgentCore as AgentCore Runtime
    participant MCP as MCP Server
    participant DDB as DynamoDB
    participant CF as CloudFront

    User->>ChatGPT: "Show me available unicorns"
    ChatGPT->>APIGW: POST /mcp (JSON-RPC: tools/call)
    APIGW->>Lambda: Invoke (event)
    Lambda->>AgentCore: InvokeAgentRuntime(payload, sessionId)
    AgentCore->>MCP: Forward MCP request
    MCP->>DDB: Scan unicorns table
    DDB-->>MCP: Unicorn records
    MCP-->>AgentCore: structuredContent + _meta (widget URL)
    AgentCore-->>Lambda: SSE response stream
    Lambda-->>APIGW: JSON response + Mcp-Session-Id header
    APIGW-->>ChatGPT: 200 OK (JSON-RPC result)
    ChatGPT->>CF: Fetch widget HTML (iframe)
    CF-->>ChatGPT: Widget HTML
    ChatGPT-->>User: Rendered widget with unicorn cards
```
