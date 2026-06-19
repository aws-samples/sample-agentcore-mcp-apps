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
 *   6. Lambda proxy function (Node.js) + Resource-based policy on Runtime
 *   7. API Gateway for ChatGPT connector
 *   8. WAF Web ACL — ChatGPT IP allowlist + AWS Managed Rules
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import * as path from "path";

interface AgentCoreMcpStackProps extends cdk.StackProps {
  projectName: string;
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
      prune: true, // Delete old objects when new ones are deployed
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

    new cdk.CfnResource(this, "McpEndpoint", {
      type: "AWS::BedrockAgentCore::RuntimeEndpoint",
      properties: {
        Name: `${project.replace(/-/g, "_")}_endpoint`,
        AgentRuntimeId: agentCoreRuntime.getAtt("AgentRuntimeId").toString(),
        Description: `${project} MCP endpoint`,
      },
    });

    // ----------------------------------------------------------------
    // 6. Lambda Proxy (Node.js)
    // ----------------------------------------------------------------
    const proxyFn = new lambda.Function(this, "ProxyFunction", {
      functionName: `${project}-proxy`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "..", "src", "lambda", "api-gateway-proxy", "dist")),
      timeout: cdk.Duration.seconds(30),
      environment: {
        RUNTIME_ARN: runtimeArn,
        CORS_ALLOWED_ORIGINS: corsAllowedOriginsParam.valueAsString,
      },
    });

    proxyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [`${runtimeArn}*`],
      })
    );

    // ----------------------------------------------------------------
    // 6b. Resource-Based Policy — restrict runtime invocation to proxy Lambda only
    // Uses a custom Lambda (boto3) since the CDK AwsCustomResource SDK package
    // for BedrockAgentCoreControl is not yet available in the custom resource runtime.
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

    new cdk.CustomResource(this, "RuntimeResourcePolicy", {
      serviceToken: resourcePolicyProvider.serviceToken,
      properties: {
        ResourceArn: runtimeArn,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AllowProxyLambdaOnly",
              Effect: "Allow",
              Principal: {
                AWS: proxyFn.role!.roleArn,
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
                  "aws:PrincipalArn": proxyFn.role!.roleArn,
                },
              },
            },
          ],
        }),
      },
    });

    // ----------------------------------------------------------------
    // 7. API Gateway
    // ----------------------------------------------------------------
    const api = new apigateway.RestApi(this, "McpApi", {
      restApiName: `${project}-api`,
      description: "ChatGPT MCP Proxy API",
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Mcp-Session-Id"],
      },
    });

    const mcpResource = api.root.addResource("mcp");
    mcpResource.addMethod("POST", new apigateway.LambdaIntegration(proxyFn));

    // ----------------------------------------------------------------
    // 8. WAF — IP Allowlist + Basic Protection
    // ----------------------------------------------------------------

    // ChatGPT Actions outbound IP ranges (source: https://openai.com/chatgpt-actions.json)
    const chatGptIpSet = new wafv2.CfnIPSet(this, "ChatGptIpSet", {
      name: `${project}-chatgpt-ips`,
      scope: "REGIONAL",
      ipAddressVersion: "IPV4",
      addresses: [
        "104.210.139.192/28", "104.210.139.224/28", "13.65.138.112/28",
        "13.65.138.96/28", "13.67.72.16/28", "13.70.107.160/28",
        "13.71.2.208/28", "13.76.115.224/28", "13.76.116.80/28",
        "13.76.32.208/28", "13.83.237.176/28", "132.196.82.48/28",
        "135.119.134.128/28", "135.119.134.192/28", "135.220.73.208/28",
        "135.237.133.48/28", "137.135.191.176/28", "15.168.252.168/32",
        "172.170.8.208/28", "172.177.53.240/28", "172.183.143.224/28",
        "172.196.40.208/28", "172.202.102.112/28", "172.204.16.64/28",
        "172.212.159.64/28", "172.213.11.144/28", "191.233.1.128/28",
        "191.233.1.224/28", "191.233.196.112/28", "191.234.167.128/28",
        "191.235.98.144/28", "191.237.249.64/28", "20.0.53.96/28",
        "20.102.212.144/28", "20.113.218.16/28", "20.125.112.224/28",
        "20.168.7.192/28", "20.168.7.240/28", "20.169.72.112/28",
        "20.169.72.96/28", "20.169.78.208/28", "20.169.78.48/28",
        "20.169.78.64/28", "20.169.78.80/28", "20.169.78.96/28",
        "20.169.86.224/28", "20.17.108.96/28", "20.172.29.32/28",
        "20.193.50.32/28", "20.194.0.208/28", "20.194.157.176/28",
        "20.198.67.96/28", "20.203.245.32/28", "20.206.107.192/28",
        "20.210.154.128/28", "20.210.174.208/28", "20.215.187.208/28",
        "20.215.214.16/28", "20.215.219.208/28", "20.215.220.128/28",
        "20.215.220.144/28", "20.215.220.160/28", "20.215.220.64/28",
        "20.215.220.80/28", "20.227.140.32/28", "20.228.106.176/28",
        "20.235.75.208/28", "20.235.87.224/28", "20.249.63.208/28",
        "20.42.250.32/28", "20.44.100.224/28", "20.45.178.144/28",
        "20.55.229.144/28", "20.57.199.192/28", "20.63.221.64/28",
        "23.102.141.32/28", "23.97.109.224/28", "23.98.186.64/28",
        "23.98.186.96/28", "4.151.119.48/28", "4.151.71.176/28",
        "4.189.118.208/28", "4.196.198.80/28", "4.197.115.112/28",
        "4.197.19.176/28", "4.197.64.0/28", "4.197.64.48/28",
        "4.205.128.176/28", "4.226.226.32/28", "40.67.183.160/28",
        "40.67.183.176/28", "40.81.134.128/28", "40.84.181.32/28",
        "44.249.227.138/32", "48.193.44.32/28", "51.116.2.64/28",
        "52.148.129.32/28", "52.153.130.48/28", "52.165.212.48/28",
        "52.17.188.55/32", "52.172.129.160/28", "52.172.251.112/28",
        "52.173.123.0/28", "52.173.221.16/28", "52.173.234.16/28",
        "52.173.234.80/28", "52.176.139.176/28", "52.190.137.144/28",
        "52.190.137.16/28", "52.190.139.48/28", "52.190.142.64/28",
        "52.208.217.159/32", "52.231.30.48/28", "52.231.39.144/28",
        "52.231.39.192/28", "52.242.132.224/28", "52.242.132.240/28",
        "52.242.245.208/28", "52.252.113.240/28", "52.255.109.112/28",
        "52.255.109.128/28", "52.255.109.144/28", "52.255.109.80/28",
        "52.255.109.96/28", "52.255.111.0/28", "52.255.111.16/28",
        "52.255.111.32/28", "52.43.161.225/32", "56.155.71.179/32",
        "57.151.131.224/28", "57.154.174.112/28", "57.154.187.32/28",
        "68.154.28.96/28", "68.220.57.64/28", "68.221.67.160/28",
        "68.221.67.240/28", "68.221.75.16/28", "74.226.253.160/28",
        "74.249.86.176/28", "74.7.35.112/28", "74.7.35.48/28",
        "74.7.36.64/28", "74.7.36.80/28", "74.7.36.96/28",
        "9.160.163.224/28", "9.234.96.192/28",
      ],
    });

    // Anthropic/Claude outbound IP ranges (source: https://docs.anthropic.com/claude/reference/ip-addresses)
    const claudeIpSet = new wafv2.CfnIPSet(this, "ClaudeIpSet", {
      name: `${project}-claude-ips`,
      scope: "REGIONAL",
      ipAddressVersion: "IPV4",
      addresses: [
        "160.79.104.0/21",
      ],
    });

    // Web ACL with IP allowlist + AWS Managed Rules for common threats
    const webAcl = new wafv2.CfnWebACL(this, "ApiWafAcl", {
      name: `${project}-api-waf`,
      scope: "REGIONAL",
      defaultAction: { block: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${project}-waf-metrics`,
        sampledRequestsEnabled: true,
      },
      rules: [
        // Rule 1: Allow ChatGPT IPs
        {
          name: "AllowChatGptIPs",
          priority: 1,
          action: { allow: {} },
          statement: {
            ipSetReferenceStatement: {
              arn: chatGptIpSet.attrArn,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${project}-chatgpt-ip-allow`,
            sampledRequestsEnabled: true,
          },
        },
        // Rule 2: Allow Claude/Anthropic IPs
        {
          name: "AllowClaudeIPs",
          priority: 2,
          action: { allow: {} },
          statement: {
            ipSetReferenceStatement: {
              arn: claudeIpSet.attrArn,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${project}-claude-ip-allow`,
            sampledRequestsEnabled: true,
          },
        },
        // Rule 3: AWS Managed Rules — Common Rule Set
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${project}-common-rules`,
            sampledRequestsEnabled: true,
          },
        },
        // Rule 4: AWS Managed Rules — Known Bad Inputs
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 4,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${project}-known-bad-inputs`,
            sampledRequestsEnabled: true,
          },
        },
        // Rule 5: Rate limiting — 1000 requests per 5 minutes per IP
        {
          name: "RateLimitRule",
          priority: 5,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${project}-rate-limit`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate WAF Web ACL with API Gateway stage
    new wafv2.CfnWebACLAssociation(this, "ApiWafAssociation", {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: webAcl.attrArn,
    });

    // ----------------------------------------------------------------
    // Outputs
    // ----------------------------------------------------------------
    new cdk.CfnOutput(this, "McpEndpointUrl", {
      description: "MCP endpoint URL for ChatGPT connector",
      value: `${api.url}mcp`,
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
  }
}
