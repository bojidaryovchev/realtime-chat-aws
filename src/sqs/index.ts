import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";

export interface SqsOutputs {
  pushNotificationQueue: aws.sqs.Queue;
  pushNotificationDlq: aws.sqs.Queue;
  offlineMessageQueue: aws.sqs.Queue;
  offlineMessageDlq: aws.sqs.Queue;
}

/**
 * Creates SQS queues for:
 * - Push notifications (with DLQ)
 * - Offline message fanout (with DLQ)
 * 
 * All queues have:
 * - Server-side encryption
 * - Dead letter queues for failed messages
 * - Visibility timeout optimized for workers
 */
export function createSqsQueues(config: Config): SqsOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Push Notification Dead Letter Queue
  const pushNotificationDlq = new aws.sqs.Queue(`${baseName}-push-dlq`, {
    name: `${baseName}-push-dlq`,
    messageRetentionSeconds: 1209600, // 14 days
    sqsManagedSseEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-push-dlq`,
      Purpose: "push-notification-dlq",
    },
  });

  // Push Notification Queue
  const pushNotificationQueue = new aws.sqs.Queue(`${baseName}-push-queue`, {
    name: `${baseName}-push-queue`,
    visibilityTimeoutSeconds: 60, // Worker processing time
    messageRetentionSeconds: 345600, // 4 days
    receiveWaitTimeSeconds: 20, // Long polling
    sqsManagedSseEnabled: true,
    redrivePolicy: pulumi.interpolate`{
      "deadLetterTargetArn": "${pushNotificationDlq.arn}",
      "maxReceiveCount": 3
    }`,
    tags: {
      ...tags,
      Name: `${baseName}-push-queue`,
      Purpose: "push-notifications",
    },
  });

  // Offline Message Dead Letter Queue
  const offlineMessageDlq = new aws.sqs.Queue(`${baseName}-offline-dlq`, {
    name: `${baseName}-offline-dlq`,
    messageRetentionSeconds: 1209600, // 14 days
    sqsManagedSseEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-offline-dlq`,
      Purpose: "offline-message-dlq",
    },
  });

  // Offline Message Queue
  const offlineMessageQueue = new aws.sqs.Queue(`${baseName}-offline-queue`, {
    name: `${baseName}-offline-queue`,
    visibilityTimeoutSeconds: 30, // Worker processing time
    messageRetentionSeconds: 345600, // 4 days
    receiveWaitTimeSeconds: 20, // Long polling
    sqsManagedSseEnabled: true,
    redrivePolicy: pulumi.interpolate`{
      "deadLetterTargetArn": "${offlineMessageDlq.arn}",
      "maxReceiveCount": 3
    }`,
    tags: {
      ...tags,
      Name: `${baseName}-offline-queue`,
      Purpose: "offline-message-fanout",
    },
  });

  // ==================== Redrive Allow Policies ====================
  // Configure which source queues can use these DLQs.
  // This policy allows the main queue to send failed messages to the DLQ.
  // To redrive messages FROM the DLQ BACK to the source queue, use AWS Console or CLI:
  //   aws sqs start-message-move-task --source-arn <dlq-arn> --destination-arn <queue-arn>

  new aws.sqs.RedriveAllowPolicy(`${baseName}-push-dlq-redrive-allow`, {
    queueUrl: pushNotificationDlq.url,
    redriveAllowPolicy: pulumi.interpolate`{
      "redrivePermission": "byQueue",
      "sourceQueueArns": ["${pushNotificationQueue.arn}"]
    }`,
  });

  new aws.sqs.RedriveAllowPolicy(`${baseName}-offline-dlq-redrive-allow`, {
    queueUrl: offlineMessageDlq.url,
    redriveAllowPolicy: pulumi.interpolate`{
      "redrivePermission": "byQueue",
      "sourceQueueArns": ["${offlineMessageQueue.arn}"]
    }`,
  });

  return {
    pushNotificationQueue,
    pushNotificationDlq,
    offlineMessageQueue,
    offlineMessageDlq,
  };
}
