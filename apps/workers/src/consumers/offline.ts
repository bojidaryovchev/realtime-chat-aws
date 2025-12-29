import { Consumer } from "sqs-consumer";
import { logger } from "../lib/logger.js";
import { sqsClient } from "../lib/sqs.js";

interface OfflineMessagePayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientIds: string[];
  content: string;
  createdAt: string;
}

export function createOfflineConsumer(): Consumer {
  const queueUrl = process.env.SQS_OFFLINE_QUEUE_URL;

  if (!queueUrl) {
    logger.warn("SQS_OFFLINE_QUEUE_URL not set - offline consumer disabled");
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
    visibilityTimeout: 30,
    waitTimeSeconds: 20,
    handleMessageBatch: async (messages) => {
      logger.info({ count: messages.length }, "Processing offline message batch");

      await Promise.all(
        messages.map(async (message) => {
          try {
            const payload: OfflineMessagePayload = JSON.parse(message.Body || "{}");
            await processOfflineMessage(payload);
            logger.debug({ messageId: payload.messageId }, "Offline message processed");
          } catch (error) {
            logger.error({ error, messageId: message.MessageId }, "Failed to process offline message");
            throw error; // Re-throw to trigger retry/DLQ
          }
        })
      );
    },
  });

  consumer.on("error", (err) => {
    logger.error({ error: err }, "Offline consumer error");
  });

  consumer.on("processing_error", (err) => {
    logger.error({ error: err }, "Offline consumer processing error");
  });

  consumer.on("started", () => {
    logger.info("Offline consumer started");
  });

  consumer.on("stopped", () => {
    logger.info("Offline consumer stopped");
  });

  return consumer;
}

async function processOfflineMessage(payload: OfflineMessagePayload): Promise<void> {
  // TODO: Implement offline message processing
  // This could:
  // 1. Store undelivered messages for later sync
  // 2. Send push notifications to offline users
  // 3. Update unread counts in database
  // 4. Send email notifications for important messages
  //
  // Example:
  // for (const recipientId of payload.recipientIds) {
  //   const user = await prisma.user.findUnique({ where: { id: recipientId } });
  //   if (!user.isOnline) {
  //     await prisma.unreadMessage.create({ ... });
  //     await sendPushNotification({ userId: recipientId, ... });
  //   }
  // }

  logger.info(
    { messageId: payload.messageId, recipientCount: payload.recipientIds.length },
    "Offline message would be processed (not implemented)"
  );
}
