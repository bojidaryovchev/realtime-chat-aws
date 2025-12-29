import { SQSClient } from "@aws-sdk/client-sqs";

if (!process.env.AWS_REGION) {
  throw new Error("AWS_REGION environment variable is required");
}

export const sqsClient = new SQSClient({
  region: process.env.AWS_REGION,
});
