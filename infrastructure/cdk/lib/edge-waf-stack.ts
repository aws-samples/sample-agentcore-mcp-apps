// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * WAF stack for the CloudFront front door.
 *
 * CLOUDFRONT-scoped WAF Web ACLs must be created in us-east-1 regardless of
 * where the rest of the application deploys, so the Web ACL lives in its own
 * stack pinned to us-east-1 and is passed to the main stack via a
 * cross-region reference.
 *
 * Rules (same policy the sample previously attached directly to the Gateway):
 *   - Default action: BLOCK
 *   - Allow ChatGPT Actions egress IPs
 *   - Allow Anthropic/Claude egress IPs
 *   - AWS Managed Rules: Common Rule Set + Known Bad Inputs
 *   - Rate limit: 1000 requests / 5 min / IP
 */

import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

interface EdgeWafStackProps extends cdk.StackProps {
  projectName: string;
}

export class EdgeWafStack extends cdk.Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: EdgeWafStackProps) {
    super(scope, id, props);

    const project = props.projectName;

    // ChatGPT Actions outbound IP ranges (source: https://openai.com/chatgpt-actions.json)
    const chatGptIpSet = new wafv2.CfnIPSet(this, "ChatGptIpSet", {
      name: `${project}-chatgpt-ips`,
      scope: "CLOUDFRONT",
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
      scope: "CLOUDFRONT",
      ipAddressVersion: "IPV4",
      addresses: [
        "160.79.104.0/21",
      ],
    });

    // Web ACL with IP allowlist + AWS Managed Rules for common threats
    this.webAcl = new wafv2.CfnWebACL(this, "GatewayFrontDoorWafAcl", {
      name: `${project}-gateway-waf`,
      scope: "CLOUDFRONT",
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

    new cdk.CfnOutput(this, "WebAclArn", {
      description: "CLOUDFRONT-scope WAF Web ACL ARN (associated with the gateway front-door distribution)",
      value: this.webAcl.attrArn,
    });
  }
}
