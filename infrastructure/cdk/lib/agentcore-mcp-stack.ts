import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import * as path from "path";

interface AgentCoreMcpStackProps extends cdk.StackProps {
  projectName: string;
}

export class AgentCoreMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentCoreMcpStackProps) {
    super(scope, id, props);

    const project = props.projectName;

    // 1. S3 + CloudFront for Widgets
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

    // 2. ECR Repository
    const ecrRepo = new ecr.Repository(this, "McpServerRepo", {
      repositoryName: `${project}-server`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
    });

    // 3. IAM Role for AgentCore Runtime
    const agentCoreRole = new iam.Role(this, "AgentCoreRole", {
      roleName: `${project}-agentcore-role`,
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
    });

    agentCoreRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      })
    );
    agentCoreRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
        resources: [ecrRepo.repositoryArn],
      })
    );

    // 4. Cognito for JWT Authentication
    const userPool = new cognito.UserPool(this, "McpUserPool", {
      userPoolName: `${project}-user-pool`,
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const resourceServer = new cognito.UserPoolResourceServer(this, "McpResourceServer", {
      userPool,
      identifier: project,
      userPoolResourceServerName: `${project}-resource-server`,
      scopes: [
        new cognito.ResourceServerScope({
          scopeName: "invoke",
          scopeDescription: "Invoke MCP server",
        }),
      ],
    });

    const userPoolClient = new cognito.UserPoolClient(this, "McpClient", {
      userPool,
      userPoolClientName: `${project}-client`,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [
          cognito.OAuthScope.custom(`${project}/invoke`),
        ],
      },
      authFlows: { userPassword: true },
    });
    userPoolClient.node.addDependency(resourceServer);

    userPool.addDomain("McpDomain", {
      cognitoDomain: {
        domainPrefix: `${project}-${this.account}`,
      },
    });

    // 5. AgentCore Runtime (MCP Server)
    // NOTE: As of CDK 2.170+, AgentCore resources use CfnResource.
    // When L2 constructs are available, replace this.
    const agentCoreRuntime = new cdk.CfnResource(this, "McpRuntime", {
      type: "AWS::BedrockAgentCore::AgentRuntime",
      properties: {
        AgentRuntimeName: `${project.replace(/-/g, "_")}_runtime`,
        Description: `${project} MCP Server on AgentCore Runtime`,
        RoleArn: agentCoreRole.roleArn,
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${ecrRepo.repositoryUri}:latest`,
          },
        },
        NetworkConfiguration: {
          NetworkMode: "PUBLIC",
        },
        ProtocolConfiguration: {
          ServerProtocol: "MCP",
        },
        EnvironmentVariables: {
          WIDGET_BASE_URL: `https://${widgetsCdn.domainName}`,
        },
        AuthorizerConfiguration: {
          CustomJwtAuthorizer: {
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
            AllowedAudience: [userPoolClient.userPoolClientId],
          },
        },
      },
    });

    const runtimeArn = agentCoreRuntime.getAtt("AgentRuntimeArn").toString();

    const agentCoreEndpoint = new cdk.CfnResource(this, "McpEndpoint", {
      type: "AWS::BedrockAgentCore::AgentRuntimeEndpoint",
      properties: {
        Name: `${project.replace(/-/g, "_")}_endpoint`,
        AgentRuntimeId: agentCoreRuntime.getAtt("AgentRuntimeId").toString(),
        Description: `${project} MCP endpoint`,
      },
    });

    // 6. Lambda Proxy
    const proxyFn = new lambda.Function(this, "ProxyFunction", {
      functionName: `${project}-proxy`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "proxy.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "..", "lambda")),
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

    // 7. API Gateway
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

    // Outputs
    new cdk.CfnOutput(this, "McpEndpointUrl", {
      description: "MCP endpoint URL for ChatGPT connector",
      value: `${api.url}mcp`,
    });
    new cdk.CfnOutput(this, "WidgetBaseUrl", {
      description: "CloudFront URL for widgets",
      value: `https://${widgetsCdn.domainName}`,
    });
    new cdk.CfnOutput(this, "RuntimeArn", {
      description: "AgentCore Runtime ARN",
      value: runtimeArn,
    });
    new cdk.CfnOutput(this, "EcrRepositoryUrl", {
      description: "ECR repository URL",
      value: ecrRepo.repositoryUri,
    });
    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      description: "Cognito User Pool ID",
      value: userPool.userPoolId,
    });
    new cdk.CfnOutput(this, "CognitoClientId", {
      description: "Cognito Client ID",
      value: userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "S3Bucket", {
      description: "S3 bucket for widgets",
      value: widgetsBucket.bucketName,
    });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      description: "CloudFront distribution ID",
      value: widgetsCdn.distributionId,
    });
  }
}
