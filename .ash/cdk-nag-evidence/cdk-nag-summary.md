# cdk-nag Evidence — AgentCoreMcpStack

Generated via `cdk synth` with `AwsSolutionsChecks` aspect (cdk-nag v2.38.2, aws-cdk-lib v2).
PCSR: D472644498

**Totals:** 37 errors, 4 warnings across 15 distinct rules.

## Findings by rule

| Rule | Count | Summary |
|---|---|---|
| AwsSolutions-IAM5 | 13 | The IAM entity contains wildcard permissions and does not have a cdk-nag rule suppression ... |
| AwsSolutions-IAM4 | 7 | The IAM user, role, or group uses AWS managed policies. An AWS managed policy is a standal... |
| AwsSolutions-S10 | 4 | The S3 Bucket or bucket policy does not require requests to use SSL. You can use HTTPS (TL... |
| AwsSolutions-L1 | 4 | The non-container Lambda function is not configured to use the latest runtime version. Use... |
| AwsSolutions-S1 | 2 | The S3 Bucket has server access logs disabled. The bucket should have server access loggin... |
| AwsSolutions-DDB3 | 2 | The DynamoDB table does not have Point-in-time Recovery enabled. DynamoDB continuous backu... |
| AwsSolutions-CFR3 | 1 | The CloudFront distribution does not have access logging enabled. Enabling access logs hel... |
| AwsSolutions-CFR4 | 1 | The CloudFront distribution allows for SSLv3 or TLSv1 for HTTPS viewer connections. Vulner... |
| AwsSolutions-APIG2 | 1 | The REST API does not have request validation enabled. The API should have basic request v... |
| AwsSolutions-APIG1 | 1 | The API does not have access logging enabled. Enabling access logs helps operators view wh... |
| AwsSolutions-APIG6 | 1 | The REST API Stage does not have CloudWatch logging enabled for all methods. Enabling Clou... |
| AwsSolutions-APIG4 | 1 | The API does not implement authorization. In most cases an API needs to have an authentica... |
| AwsSolutions-COG4 | 1 | The API GW method does not use a Cognito user pool authorizer. API Gateway validates the t... |
| AwsSolutions-CFR1 | 1 | The CloudFront distribution may require Geo restrictions. Geo restriction may need to be e... |
| AwsSolutions-CFR2 | 1 | The CloudFront distribution may require integration with AWS WAF. The Web Application Fire... |

## Disposition note

These findings are expected for a demonstration sample and align with the PCSR review:

- **APIG4 / COG4 (no API auth)** — intentional. Access control is WAF IP allowlisting; the README and blog explicitly recommend adding OAuth 2.0 for production.
- **IAM5 (wildcard permissions)** — on the resource-policy custom resource and CDK-managed roles; the bedrock-agentcore PutResourcePolicy action does not support ARN-level scoping at deploy time (noted in PCSR as acceptable).
- **IAM4 (AWS managed policies)** — CDK-generated Lambda basic-execution roles.
- **S1 / S10 / CFR / DDB3 / APIG (logging, TLS, PITR, access logs)** — hardening items appropriate to production, consistent with the not-for-production disclaimer now in the README.

Full raw output: see `cdk-nag-synth-output.txt` in this directory.