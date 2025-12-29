import { Consumer } from "sqs-consumer";
import { logger } from "../lib/logger.js";
import { sqsClient } from "../lib/sqs.js";

interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  deviceTokens?: string[];
}

export function createPushConsumer(): Consumer {
  const queueUrl = process.env.SQS_PUSH_QUEUE_URL;

  if (!queueUrl) {
    logger.warn("SQS_PUSH_QUEUE_URL not set - push consumer disabled");
    // Return a no-op consumer
    return Consumer.create({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/000000000000/dummy",
      sqs: sqsClient,
      handleMessage: async () => {},
    });
  }

  const consumer = Consumer.create({
    queueUrl,
    sqs: sqsClient,
    batchSize: 10,
    visibilityTimeout: 60,
    waitTimeSeconds: 20,
    handleMessageBatch: async (messages) => {
      logger.info({ count: messages.length }, "Processing push notification batch");

      await Promise.all(
        messages.map(async (message) => {
          try {
            const payload: PushNotificationPayload = JSON.parse(message.Body || "{}");
            await sendPushNotification(payload);
            logger.debug({ userId: payload.userId }, "Push notification sent");
          } catch (error) {
            logger.error({ error, messageId: message.MessageId }, "Failed to process push notification");
            throw error; // Re-throw to trigger retry/DLQ
          }
        }),
      );
    },
  });

  consumer.on("error", (err) => {
    logger.error({ error: err }, "Push consumer error");
  });

  consumer.on("processing_error", (err) => {
    logger.error({ error: err }, "Push consumer processing error");
  });

  consumer.on("started", () => {
    logger.info("Push consumer started");
  });

  consumer.on("stopped", () => {
    logger.info("Push consumer stopped");
  });

  return consumer;
}

async function sendPushNotification(payload: PushNotificationPayload): Promise<void> {
  // TODO: Implement actual push notification logic
  // This would integrate with:
  // - Firebase Cloud Messaging (FCM) for Android
  // - Apple Push Notification service (APNs) for iOS
  //
  // Example with firebase-admin:
  // import admin from 'firebase-admin';
  // await admin.messaging().sendEachForMulticast({
  //   tokens: payload.deviceTokens,
  //   notification: { title: payload.title, body: payload.body },
  //   data: payload.data,
  // });

  logger.info({ userId: payload.userId, title: payload.title }, "Push notification would be sent (not implemented)");
}
