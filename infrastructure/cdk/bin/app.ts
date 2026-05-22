#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AgentCoreMcpStack } from "../lib/agentcore-mcp-stack";

const app = new cdk.App();

new AgentCoreMcpStack(app, "AgentCoreMcpStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  projectName: app.node.tryGetContext("projectName") || "unicorn-mcp",
});
