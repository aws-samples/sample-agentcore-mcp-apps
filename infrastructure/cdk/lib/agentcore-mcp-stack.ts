/**
 * CDK Stack for deploying the Unicorn Rentals MCP Server on AgentCore Runtime.
 *
 * Resources created:
 *   1. S3 + CloudFront for widget hosting
 *   2. S3 bucket for MCP server deployment package
 *   3. DynamoDB tables for unicorn and booking data
 *   4. IAM Role for AgentCore Runtime
 *   5. AgentCore Runtime (MCP Server) via direct code deploy
 *   6. Lambda proxy function
 *   7. API Gateway for ChatGPT connector
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
    // 1. S3 + CloudFront for Widgets
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
    // 5. AgentCore Runtime (MCP Server) — Direct Code Deploy
    // ----------------------------------------------------------------
    // ----------------------------------------------------------------
    // NOTE: As of CDK 2.170+, AgentCore resources use CfnResource.
    // When L2 constructs are available, replace this.
    const agentCoreRuntime = new cdk.CfnResource(this, "McpRuntime", {
      type: "AWS::BedrockAgentCore::Runtime",
      properties: {
        AgentRuntimeName: `${project.replace(/-/g, "_")}_runtime`,
        Description: `${project} MCP Server on AgentCore Runtime`,
        RoleArn: agentCoreRole.roleArn,
        AgentRuntimeArtifact: {
          CodeConfiguration: {
            Code: {
              S3: {
                Bucket: deploymentBucket.bucketName,
                Prefix: mcpServerZipKey,
              },
            },
            EntryPoint: ["main.py"],
            Runtime: "PYTHON_3_13",
          },
        },
        NetworkConfiguration: {
          NetworkMode: "PUBLIC",
        },
        ProtocolConfiguration: "MCP",
        EnvironmentVariables: {
          UNICORN_SERVICE_FUNCTION: unicornServiceFn.functionName,
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
    // 6. Lambda Proxy
    // ----------------------------------------------------------------
    const proxyFn = new lambda.Function(this, "ProxyFunction", {
      functionName: `${project}-proxy`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "proxy.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "..", "src", "lambda", "api-gateway-proxy")),
      timeout: cdk.Duration.seconds(30),
      environment: {
        RUNTIME_ARN: runtimeArn,
      },
    });

    proxyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [`${runtimeArn}*`],
      })
    );

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
    // Outputs
    // ----------------------------------------------------------------
    new cdk.CfnOutput(this, "McpEndpointUrl", {
      description: "MCP endpoint URL for ChatGPT connector",
      value: `${api.url}mcp`,
    });
    new cdk.CfnOutput(this, "WidgetBaseUrl", {
      description: "CloudFront URL for widgets",
      value: `https://${widgetsCdn.domainName}`,
    });
    new cdk.CfnOutput(this, "RuntimeArn", {
      description: "S3 bucket for widgets",
      value: widgetsBucket.bucketName,
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
