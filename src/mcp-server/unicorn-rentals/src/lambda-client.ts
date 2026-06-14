/**
 * Lambda client for invoking the Unicorn Service Lambda.
 *
 * The MCP server delegates all business logic to this Lambda function,
 * maintaining a clean separation between protocol handling and business logic.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const UNICORN_SERVICE_FUNCTION = process.env.UNICORN_SERVICE_FUNCTION || "unicorn-mcp-service";

const lambdaClient = new LambdaClient({});

export interface ServiceResponse {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

/**
 * Invoke the Unicorn Service Lambda and return the parsed response.
 */
export async function invokeService(action: string, params: Record<string, unknown>): Promise<ServiceResponse> {
  const payload = JSON.stringify({ action, params });

  try {
    const command = new InvokeCommand({
      FunctionName: UNICORN_SERVICE_FUNCTION,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(payload, "utf-8"),
    });

    const response = await lambdaClient.send(command);

    // Check for Lambda-level errors (unhandled exception or timeout)
    if (response.FunctionError) {
      const errorPayload = response.Payload
        ? Buffer.from(response.Payload).toString("utf-8")
        : "Unknown error";
      console.error(`[invokeService] Lambda function error for action '${action}': ${errorPayload}`);
      return { success: false, error: "Something went wrong. Please try again later." };
    }

    const responsePayload = response.Payload
      ? JSON.parse(Buffer.from(response.Payload).toString("utf-8"))
      : {};

    // The Lambda returns {"statusCode": ..., "body": "..."}
    if (responsePayload.body) {
      return JSON.parse(responsePayload.body);
    }
    return responsePayload;
  } catch (error) {
    console.error(`[invokeService] Error invoking Lambda for action '${action}':`, error);
    return { success: false, error: "Something went wrong. Please try again later." };
  }
}
