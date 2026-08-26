// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * CDK Stack for deploying the Unicorn Rentals MCP Server on AgentCore Runtime.
 *
 * Resources created:
 *   1. S3 + CloudFront for image hosting
 *   2. S3 bucket for MCP server deployment package
 *   3. DynamoDB tables for unicorn and booking data
 *   4. IAM Role for AgentCore Runtime
 *   5. AgentCore Runtime (MCP Server) via direct code deploy (Node.js 22)
 *   6. AgentCore Gateway (No Auth inbound, MCP target pointing to Runtime)
 *   7. CloudFront front door for the Gateway — WAF (CLOUDFRONT scope, from
 *      EdgeWafStack in us-east-1) + CloudFront Function that fixes the OAuth
 *      protected-resource discovery response (replaces Lambda@Edge)
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";

interface AgentCoreMcpStackProps extends cdk.StackProps {
  projectName: string;
  /** ARN of the CLOUDFRONT-scope WAF Web ACL (created in us-east-1 by EdgeWafStack). */
  webAclArn: string;
}

export class AgentCoreMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentCoreMcpStackProps) {
    super(scope, id, props);

    const project = props.projectName;

    // ----------------------------------------------------------------
    // CDK Parameters
    // ----------------------------------------------------------------
    const corsAllowedOriginsParam = new cdk.CfnParameter(this, "CorsAllowedOrigins", {
      type: "String",
      description: "Comma-separated list of allowed CORS origins",
      default: "https://chatgpt.com,https://chat.openai.com,https://claude.ai,https://www.claude.ai,http://localhost:8000",
    });

    // ----------------------------------------------------------------
    // 1. S3 + CloudFront for Images
    // ----------------------------------------------------------------
    const widgetsBucket = new s3.Bucket(this, "WidgetsBucket", {
      bucketName: `${project}-widgets-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const widgetsCdn = new cloudfront.Distribution(this, "WidgetsCdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(widgetsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      comment: `${project} widgets CDN`,
    });

    // Deploy unicorn images to the widgets bucket under /images/
    new s3deploy.BucketDeployment(this, "UnicornImagesDeployment", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "..", "..", "..", "src", "assets")),
      ],
      destinationBucket: widgetsBucket,
      destinationKeyPrefix: "images",
      distribution: widgetsCdn,
      distributionPaths: ["/images/*"],
    });

    // ----------------------------------------------------------------
    // 2. S3 Bucket for MCP Server Deployment Package
    // ----------------------------------------------------------------
    const deploymentBucket = new s3.Bucket(this, "DeploymentBucket", {
      bucketName: `${project}-deployment-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Upload the MCP server zip (built by src/scripts/package-mcp-server.sh)
    const mcpServerZipKey = "mcp-server/mcp-server-deployment.zip";
    const zipDeployment = new s3deploy.BucketDeployment(this, "McpServerZipDeployment", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "..", "..", "..", "build"), {
          exclude: ["deployment_package"],
        }),
      ],
      destinationBucket: deploymentBucket,
      destinationKeyPrefix: "mcp-server",
      prune: true,
    });

    // ----------------------------------------------------------------
    // 3. DynamoDB Tables
    // ----------------------------------------------------------------
    const unicornsTable = new dynamodb.Table(this, "UnicornsTable", {
      tableName: `${project}-unicorns`,
      partitionKey: { name: "unicorn_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bookingsTable = new dynamodb.Table(this, "BookingsTable", {
      tableName: `${project}-bookings`,
      partitionKey: { name: "booking_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Seed unicorn data into the table
    const widgetBaseUrl = `https://${widgetsCdn.domainName}`;
    const unicornsSeedData = [
      {
        unicorn_id: { S: "uc-001" },
        name: { S: "Stardust" },
        type: { S: "Classic" },
        description: { S: "A gentle, silver-maned unicorn perfect for beginners." },
        hourly_rate: { N: "75" },
        image_url: { S: `${widgetBaseUrl}/images/stardust.png` },
        available: { BOOL: true },
      },
      {
        unicorn_id: { S: "uc-002" },
        name: { S: "Moonbeam" },
        type: { S: "Classic" },
        description: { S: "An elegant white unicorn with a pearlescent horn." },
        hourly_rate: { N: "85" },
        image_url: { S: `${widgetBaseUrl}/images/moonbeam.png` },
        available: { BOOL: true },
      },
      {
        unicorn_id: { S: "uc-003" },
        name: { S: "Prism" },
        type: { S: "Rainbow" },
        description: { S: "A dazzling rainbow-maned unicorn that shimmers in sunlight." },
        hourly_rate: { N: "120" },
        image_url: { S: `${widgetBaseUrl}/images/prism.png` },
        available: { BOOL: true },
      },
      {
        unicorn_id: { S: "uc-004" },
        name: { S: "Aurora" },
        type: { S: "Rainbow" },
        description: { S: "A majestic unicorn with aurora-colored flowing mane." },
        hourly_rate: { N: "130" },
        image_url: { S: `${widgetBaseUrl}/images/aurora.png` },
        available: { BOOL: false },
      },
      {
        unicorn_id: { S: "uc-005" },
        name: { S: "Zephyr" },
        type: { S: "Winged" },
        description: { S: "A rare winged unicorn capable of short flights." },
        hourly_rate: { N: "200" },
        image_url: { S: `${widgetBaseUrl}/images/zephyr.png` },
        available: { BOOL: true },
      },
      {
        unicorn_id: { S: "uc-006" },
        name: { S: "Tempest" },
        type: { S: "Winged" },
        description: { S: "A powerful winged unicorn with storm-grey coat." },
        hourly_rate: { N: "250" },
        image_url: { S: `${widgetBaseUrl}/images/tempest.png` },
        available: { BOOL: true },
      },
    ];

    // BatchWriteItem supports max 25 items per call — we have 6, so one call is fine
    new cr.AwsCustomResource(this, "SeedUnicornsData", {
      onCreate: {
        service: "DynamoDB",
        action: "batchWriteItem",
        parameters: {
          RequestItems: {
            [unicornsTable.tableName]: unicornsSeedData.map((item) => ({
              PutRequest: { Item: item },
            })),
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of("seed-unicorns-v1"),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["dynamodb:BatchWriteItem"],
          resources: [unicornsTable.tableArn],
        }),
      ]),
    });

    // Seed a sample booking record
    new cr.AwsCustomResource(this, "SeedBookingsData", {
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        parameters: {
          TableName: bookingsTable.tableName,
          Item: {
            booking_id: { S: "BK-SAMPLE01" },
            unicorn: {
              M: {
                unicorn_id: { S: "uc-001" },
                name: { S: "Stardust" },
                type: { S: "Classic" },
                hourly_rate: { N: "75" },
                available: { BOOL: true },
              },
            },
            customer_name: { S: "Jane Doe" },
            date: { S: "2026-06-01" },
            duration_hours: { N: "2" },
            total_cost: { N: "150" },
            status: { S: "confirmed" },
            booked_at: { S: "2026-05-19T10:00:00" },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of("seed-bookings-v1"),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["dynamodb:PutItem"],
          resources: [bookingsTable.tableArn],
        }),
      ]),
    });

    // ----------------------------------------------------------------
    // 4a. Unicorn Service Lambda (business logic, no MCP awareness)
    // ----------------------------------------------------------------
    const unicornServiceFn = new lambda.Function(this, "UnicornServiceFunction", {
      functionName: `${project}-service`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "unicorn_service.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "..", "src", "lambda", "unicorn-rental-service")),
      timeout: cdk.Duration.seconds(30),
      environment: {
        UNICORNS_TABLE: unicornsTable.tableName,
        BOOKINGS_TABLE: bookingsTable.tableName,
      },
    });

    // Grant the service Lambda DynamoDB access
    unicornServiceFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
        ],
        resources: [unicornsTable.tableArn, bookingsTable.tableArn],
      })
    );

    // ----------------------------------------------------------------
    // 4b. IAM Role for AgentCore Runtime
    // ----------------------------------------------------------------
    const agentCoreRole = new iam.Role(this, "AgentCoreRole", {
      roleName: `${project}-agentcore-role`,
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
    });

    // S3 permissions to read the deployment zip
    agentCoreRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [`${deploymentBucket.bucketArn}/*`],
      })
    );

    // Lambda invoke permission — MCP server calls the service Lambda
    agentCoreRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [unicornServiceFn.functionArn],
      })
    );

    // ----------------------------------------------------------------
    // 5. AgentCore Runtime (MCP Server) — Direct Code Deploy (Node.js 22)
    // ----------------------------------------------------------------
    const agentCoreRuntime = new cdk.CfnResource(this, "McpRuntime", {
      type: "AWS::BedrockAgentCore::Runtime",
      properties: {
        AgentRuntimeName: `${project.replace(/-/g, "_")}_runtime`,
        Description: `${project} MCP Server on AgentCore Runtime (Node.js)`,
        RoleArn: agentCoreRole.roleArn,
        AgentRuntimeArtifact: {
          CodeConfiguration: {
            Code: {
              S3: {
                Bucket: deploymentBucket.bucketName,
                Prefix: mcpServerZipKey,
              },
            },
            EntryPoint: ["main.js"],
            Runtime: "NODE_22",
          },
        },
        NetworkConfiguration: {
          NetworkMode: "PUBLIC",
        },
        ProtocolConfiguration: "MCP",
        EnvironmentVariables: {
          UNICORN_SERVICE_FUNCTION: unicornServiceFn.functionName,
          CORS_ALLOWED_ORIGINS: corsAllowedOriginsParam.valueAsString,
        },
      },
    });
    agentCoreRuntime.node.addDependency(zipDeployment);

    const runtimeArn = agentCoreRuntime.getAtt("AgentRuntimeArn").toString();
    const runtimeId = agentCoreRuntime.getAtt("AgentRuntimeId").toString();

    new cdk.CfnResource(this, "McpEndpoint", {
      type: "AWS::BedrockAgentCore::RuntimeEndpoint",
      properties: {
        Name: `${project.replace(/-/g, "_")}_endpoint`,
        AgentRuntimeId: runtimeId,
        Description: `${project} MCP endpoint`,
      },
    });

    // ----------------------------------------------------------------
    // 6. AgentCore Gateway — No Auth inbound, MCP Server target
    // ----------------------------------------------------------------

    // The Gateway uses No Auth for inbound requests (WAF provides IP-based protection)
    const gateway = new agentcore.Gateway(this, "McpGateway", {
      gatewayName: `${project}-gateway`,
      description: "AgentCore Gateway for Unicorn Rentals MCP Server",
      protocolConfiguration: new agentcore.McpProtocolConfiguration({
        instructions: "Use this gateway to access the Unicorn Rentals MCP tools",
        searchType: agentcore.McpGatewaySearchType.SEMANTIC,
        supportedVersions: [agentcore.MCPProtocolVersion.MCP_2025_03_26],
      }),
      authorizerConfiguration: agentcore.GatewayAuthorizer.withNoAuth(),
    });

    // The MCP endpoint URL of the AgentCore Runtime
    // The endpoint requires URL-encoded ARN: https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<encoded-ARN>/invocations?qualifier=DEFAULT
    // Since runtimeArn is a CFN token, we use Fn.join to perform URL-encoding at deploy time.
    // ARN format: arn:aws:bedrock-agentcore:<region>:<account>:runtime/<id>
    // Encoded:    arn%3Aaws%3Abedrock-agentcore%3A<region>%3A<account>%3Aruntime%2F<id>
    const encodedRuntimeArn = cdk.Fn.join("", [
      "arn%3Aaws%3Abedrock-agentcore%3A",
      this.region,
      "%3A",
      this.account,
      "%3Aruntime%2F",
      runtimeId,
    ]);
    const runtimeMcpEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedRuntimeArn}/invocations?qualifier=DEFAULT`;

    // Add MCP Server target pointing to the AgentCore Runtime's MCP endpoint
    // Uses IAM (SigV4) authentication for outbound calls to the Runtime
    // Note: The L2 fromIamRole() doesn't pass service/region, but the service
    // requires them for MCP Server targets. Using L1 (CfnResource) directly.
    const runtimeMcpTarget = new cdk.CfnResource(this, "RuntimeMcpTarget", {
      type: "AWS::BedrockAgentCore::GatewayTarget",
      properties: {
        GatewayIdentifier: gateway.gatewayId,
        Name: `${project}-runtime-target`,
        Description: "AgentCore Runtime MCP Server target with IAM auth",
        TargetConfiguration: {
          Mcp: {
            McpServer: {
              Endpoint: runtimeMcpEndpoint,
            },
          },
        },
        CredentialProviderConfigurations: [
          {
            CredentialProviderType: "GATEWAY_IAM_ROLE",
            CredentialProvider: {
              IamCredentialProvider: {
                Service: "bedrock-agentcore",
                Region: this.region,
              },
            },
          },
        ],
      },
    });

    // Grant the Gateway's execution role permission to invoke the Runtime
    const gatewayPolicyGrant = gateway.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [`${runtimeArn}*`],
      })
    );

    // Ensure the target isn't created until the Gateway role's IAM policy has been applied.
    // Without this, CFN may create the target before IAM propagates, causing "Authorization error".
    if (gatewayPolicyGrant.policyDependable) {
      runtimeMcpTarget.node.addDependency(gatewayPolicyGrant.policyDependable);
    }

    // ----------------------------------------------------------------
    // 6b. Resource-Based Policy — restrict runtime invocation to Gateway only
    // ----------------------------------------------------------------
    const resourcePolicyFn = new lambda.Function(this, "ResourcePolicyFunction", {
      functionName: `${project}-resource-policy-cr`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "resource-policy-cr")),
      timeout: cdk.Duration.seconds(60),
    });

    resourcePolicyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:PutResourcePolicy",
          "bedrock-agentcore:GetResourcePolicy",
          "bedrock-agentcore:DeleteResourcePolicy",
        ],
        resources: ["*"],
      })
    );

    const resourcePolicyProvider = new cr.Provider(this, "ResourcePolicyProvider", {
      onEventHandler: resourcePolicyFn,
    });

    const runtimeResourcePolicy = new cdk.CustomResource(this, "RuntimeResourcePolicy", {
      serviceToken: resourcePolicyProvider.serviceToken,
      properties: {
        ResourceArn: runtimeArn,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AllowGatewayOnly",
              Effect: "Allow",
              Principal: {
                AWS: gateway.role.roleArn,
              },
              Action: "bedrock-agentcore:InvokeAgentRuntime",
              Resource: runtimeArn,
            },
            {
              Sid: "DenyAllOtherPrincipals",
              Effect: "Deny",
              Principal: "*",
              Action: "bedrock-agentcore:InvokeAgentRuntime",
              Resource: runtimeArn,
              Condition: {
                StringNotEquals: {
                  "aws:PrincipalArn": gateway.role.roleArn,
                },
              },
            },
          ],
        }),
      },
    });

    // Ensure the Gateway Target is not created until the resource policy is in place,
    // otherwise CFN's connectivity validation fails with "Authorization error".
    runtimeMcpTarget.node.addDependency(runtimeResourcePolicy);

    // ----------------------------------------------------------------
    // 7. CloudFront front door for the Gateway
    //
    // The Gateway keeps No Auth inbound; all edge protection moves to a
    // CloudFront distribution in front of it:
    //   - WAF Web ACL (CLOUDFRONT scope, from EdgeWafStack in us-east-1)
    //     with the ChatGPT/Claude IP allowlist, managed rules and rate limit
    //   - A CloudFront Function that generates the OAuth protected-resource
    //     discovery response with the front-door domain. The AgentCore
    //     custom-domains guide does this with Lambda@Edge; a CloudFront
    //     Function is cheaper and simpler since it never leaves the edge.
    //
    // To attach a custom domain later, add `domainNames` + `certificate`
    // to the distribution per the AgentCore custom-domains guide:
    // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-custom-domains.html
    // ----------------------------------------------------------------

    // gateway.gatewayUrl is "https://<id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp";
    // CloudFront origins need the bare hostname.
    const gatewayHostName = cdk.Fn.select(2, cdk.Fn.split("/", gateway.gatewayUrl!));

    const gatewayOrigin = new origins.HttpOrigin(gatewayHostName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    const oauthDiscoveryFn = new cloudfront.Function(this, "OauthDiscoveryFunction", {
      functionName: `${project}-oauth-discovery`,
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, "functions", "oauth-discovery.js"),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Returns the OAuth protected-resource discovery document with the front-door domain",
    });

    const gatewayCdn = new cloudfront.Distribution(this, "GatewayCdn", {
      defaultBehavior: {
        origin: gatewayOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        // A reverse proxy for a dynamic MCP endpoint must never cache...
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // ...but must forward everything else the MCP protocol needs
        // (Content-Type, Accept, Mcp-Session-Id, ...). The Host header is
        // excluded so the TLS handshake with the Gateway origin succeeds.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      additionalBehaviors: {
        // OAuth discovery is answered entirely at the edge by the CloudFront
        // Function — the request never reaches the Gateway.
        "/.well-known/oauth-protected-resource": {
          origin: gatewayOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          functionAssociations: [
            {
              function: oauthDiscoveryFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
      webAclId: props.webAclArn,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      comment: `${project} gateway front door (WAF + OAuth discovery rewrite)`,
    });

    // ----------------------------------------------------------------
    // Outputs
    // ----------------------------------------------------------------
    new cdk.CfnOutput(this, "GatewayResourceUrl", {
      description: "MCP Server URL (CloudFront front door) — copy and paste this into your AI host (ChatGPT, Claude, etc.)",
      value: `https://${gatewayCdn.domainName}/mcp`,
    });
    new cdk.CfnOutput(this, "GatewayDirectUrl", {
      description: "Raw AgentCore Gateway URL (bypasses CloudFront/WAF — do not distribute)",
      value: gateway.gatewayUrl!,
    });
    new cdk.CfnOutput(this, "GatewayCdnDistributionId", {
      description: "CloudFront distribution ID for the gateway front door",
      value: gatewayCdn.distributionId,
    });
    new cdk.CfnOutput(this, "GatewayArn", {
      description: "AgentCore Gateway ARN",
      value: gateway.gatewayArn,
    });
    new cdk.CfnOutput(this, "WidgetBaseUrl", {
      description: "CloudFront URL for images",
      value: `https://${widgetsCdn.domainName}`,
    });
    new cdk.CfnOutput(this, "RuntimeArn", {
      description: "AgentCore Runtime ARN",
      value: runtimeArn,
    });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      description: "CloudFront distribution ID",
      value: widgetsCdn.distributionId,
    });
    new cdk.CfnOutput(this, "UnicornServiceFunctionArn", {
      description: "Unicorn Service Lambda ARN",
      value: unicornServiceFn.functionArn,
    });

    // ----------------------------------------------------------------
    // cdk-nag Suppressions (per-resource)
    // ----------------------------------------------------------------

    // S3 Buckets — access logs not required for demo/sample application
    NagSuppressions.addResourceSuppressions(widgetsBucket, [
      { id: "AwsSolutions-S1", reason: "Demo app — access logs add cost with no benefit for sample code." },
    ]);
    NagSuppressions.addResourceSuppressions(deploymentBucket, [
      { id: "AwsSolutions-S1", reason: "Demo app — access logs add cost with no benefit for sample code." },
    ]);

    // S3 Bucket Policies — SSL enforcement: buckets accessed only via CloudFront OAC and CDK internals
    NagSuppressions.addResourceSuppressions(
      [widgetsBucket, deploymentBucket],
      [{ id: "AwsSolutions-S10", reason: "Buckets accessed only via CloudFront OAC or CDK-internal operations, not directly by users." }],
      true, // applyToChildren (catches the Policy/Resource child)
    );

    // CloudFront — demo serves public unicorn images, no custom domain
    NagSuppressions.addResourceSuppressions(widgetsCdn, [
      { id: "AwsSolutions-CFR1", reason: "Demo app requires global access; geo restrictions not applicable." },
      { id: "AwsSolutions-CFR2", reason: "Static image CDN for public assets; WAF protection is on the gateway front-door distribution instead." },
      { id: "AwsSolutions-CFR3", reason: "Demo app — CloudFront access logs not required for sample workload." },
      { id: "AwsSolutions-CFR4", reason: "No custom domain configured; cannot override default CloudFront viewer certificate TLS policy." },
    ]);

    // CloudFront gateway front door — WAF attached (CFR2 satisfied); demo has no custom domain
    NagSuppressions.addResourceSuppressions(gatewayCdn, [
      { id: "AwsSolutions-CFR1", reason: "Demo app requires global access; geo restrictions not applicable." },
      { id: "AwsSolutions-CFR3", reason: "Demo app — CloudFront access logs not required for sample workload." },
      { id: "AwsSolutions-CFR4", reason: "No custom domain configured; cannot override default CloudFront viewer certificate TLS policy." },
    ]);

    // DynamoDB — demo tables with seed data, easily recreated via CDK deploy
    NagSuppressions.addResourceSuppressions(unicornsTable, [
      { id: "AwsSolutions-DDB3", reason: "Demo tables with seed data — PITR not needed; data recreated on deploy." },
    ]);
    NagSuppressions.addResourceSuppressions(bookingsTable, [
      { id: "AwsSolutions-DDB3", reason: "Demo tables with seed data — PITR not needed; data recreated on deploy." },
    ]);

    // Lambda runtimes — CDK BucketDeployment uses its own internal runtime; others use Python 3.12
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/Resource",
      [{ id: "AwsSolutions-L1", reason: "CDK BucketDeployment internal Lambda — runtime managed by CDK, not user-configurable." }],
    );
    NagSuppressions.addResourceSuppressions(unicornServiceFn, [
      { id: "AwsSolutions-L1", reason: "Python 3.12 is the latest stable runtime supported by the service code." },
    ]);
    NagSuppressions.addResourceSuppressions(resourcePolicyFn, [
      { id: "AwsSolutions-L1", reason: "Python 3.12 is the latest stable runtime supported by the custom resource handler." },
    ]);

    // IAM4 — AWS managed policies: CDK-generated Lambda basic execution roles (standard CDK pattern)
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/Resource",
      [{ id: "AwsSolutions-IAM4", reason: "CDK BucketDeployment internal role — managed by CDK.", appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"] }],
    );
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource",
      [{ id: "AwsSolutions-IAM4", reason: "CDK AwsCustomResource internal role — managed by CDK.", appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"] }],
    );
    NagSuppressions.addResourceSuppressions(unicornServiceFn, [
      { id: "AwsSolutions-IAM4", reason: "Standard CDK Lambda execution role pattern.", appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"] },
    ], true);
    NagSuppressions.addResourceSuppressions(resourcePolicyFn, [
      { id: "AwsSolutions-IAM4", reason: "Standard CDK Lambda execution role pattern.", appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"] },
    ], true);
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/ResourcePolicyProvider/framework-onEvent/ServiceRole/Resource",
      [{ id: "AwsSolutions-IAM4", reason: "CDK Provider framework internal role — managed by CDK.", appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"] }],
    );

    // IAM5 — Wildcard permissions on CDK-managed and custom resource roles
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/AgentCoreRole/DefaultPolicy/Resource",
      [{ id: "AwsSolutions-IAM5", reason: "AgentCore role needs s3:GetObject on all objects in deployment bucket.", appliesTo: ["Resource::<DeploymentBucketC91A09DA.Arn>/*"] }],
    );
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy/Resource",
      [{
        id: "AwsSolutions-IAM5",
        reason: "CDK BucketDeployment requires broad S3 permissions to deploy assets — managed by CDK.",
        appliesTo: [
          "Action::s3:GetObject*",
          "Action::s3:GetBucket*",
          "Action::s3:List*",
          "Action::s3:DeleteObject*",
          "Action::s3:Abort*",
          { regex: "/^Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-.*/" },
          "Resource::<WidgetsBucket16C40FE1.Arn>/*",
          "Resource::<DeploymentBucketC91A09DA.Arn>/*",
          "Resource::*",
        ],
      }],
    );
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/ResourcePolicyFunction/ServiceRole/DefaultPolicy/Resource",
      [{ id: "AwsSolutions-IAM5", reason: "bedrock-agentcore:PutResourcePolicy does not support ARN-level scoping at deploy time (runtime ARN is a CFN token).", appliesTo: ["Resource::*"] }],
    );
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/ResourcePolicyProvider/framework-onEvent/ServiceRole/DefaultPolicy/Resource",
      [{ id: "AwsSolutions-IAM5", reason: "CDK Provider framework invokes the onEvent handler — wildcard qualifier is CDK-managed.", appliesTo: ["Resource::<ResourcePolicyFunction661A6B84.Arn>:*"] }],
    );

    // Gateway role — needs InvokeAgentRuntime with wildcard qualifier on the runtime ARN
    NagSuppressions.addResourceSuppressionsByPath(this,
      "/AgentCoreMcpStack/McpGateway/ServiceRole/DefaultPolicy/Resource",
      [{ id: "AwsSolutions-IAM5", reason: "Gateway role requires bedrock-agentcore:InvokeAgentRuntime on runtime ARN with wildcard qualifier for endpoint routing.", appliesTo: ["Resource::<McpRuntime.AgentRuntimeArn>*"] }],
    );
  }
}
