#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AgentCoreMcpStack } from "../lib/agentcore-mcp-stack";

const app = new cdk.App();

new AgentCoreMcpStack(app, "AgentCoreMcpStack", {
  description: "AgentCore MCP Server stack for Unicorn Rentals (uksb-y11hag3nx1).",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  projectName: app.node.tryGetContext("projectName") || "unicorn-mcp",
});

// cdk-nag: apply AWS Solutions security checks at synth time.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
