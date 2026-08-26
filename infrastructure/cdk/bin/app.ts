#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AgentCoreMcpStack } from "../lib/agentcore-mcp-stack";
import { EdgeWafStack } from "../lib/edge-waf-stack";

const app = new cdk.App();

const projectName = app.node.tryGetContext("projectName") || "unicorn-mcp";

// CLOUDFRONT-scope WAF Web ACLs can only be created in us-east-1, so the WAF
// lives in its own stack pinned there. crossRegionReferences lets the main
// stack consume the Web ACL ARN even when it deploys to another region.
const wafStack = new EdgeWafStack(app, "EdgeWafStack", {
  description: "CLOUDFRONT-scope WAF for the AgentCore Gateway front door.",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  crossRegionReferences: true,
  projectName,
});

new AgentCoreMcpStack(app, "AgentCoreMcpStack", {
  description: "AgentCore MCP Server stack for Unicorn Rentals (uksb-y11hag3nx1).",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  crossRegionReferences: true,
  projectName,
  webAclArn: wafStack.webAcl.attrArn,
});

// cdk-nag: apply AWS Solutions security checks at synth time.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
