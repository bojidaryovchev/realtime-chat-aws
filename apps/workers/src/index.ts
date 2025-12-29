import { createServer, IncomingMessage, ServerResponse } from "http";
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { logger } from "./lib/logger.js";
import { sqsClient } from "./lib/sqs.js";
import { createPushConsumer } from "./consumers/push.js";
import { createOfflineConsumer } from "./consumers/offline.js";

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "3003", 10);

// Health check handler
async function handleHealthCheck(req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/health") {
    // Basic health check for ALB
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "workers", timestamp: new Date().toISOString() }));
    return;
  }

  if (req.url === "/health/detailed") {
    // Detailed health check with SQS connectivity
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check SQS Push Queue connectivity
    if (process.env.SQS_PUSH_QUEUE_URL) {
      const sqsStart = Date.now();
      try {
        await sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: process.env.SQS_PUSH_QUEUE_URL,
            AttributeNames: ["ApproximateNumberOfMessages"],
          })
        );
        checks.sqsPushQueue = { status: "ok", latency: Date.now() - sqsStart };
      } catch (err) {
        checks.sqsPushQueue = {
          status: "error",
          latency: Date.now() - sqsStart,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    // Check SQS Offline Queue connectivity
    if (process.env.SQS_OFFLINE_QUEUE_URL) {
      const sqsStart = Date.now();
      try {
        await sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: process.env.SQS_OFFLINE_QUEUE_URL,
            AttributeNames: ["ApproximateNumberOfMessages"],
          })
        );
        checks.sqsOfflineQueue = { status: "ok", latency: Date.now() - sqsStart };
      } catch (err) {
        checks.sqsOfflineQueue = {
          status: "error",
          latency: Date.now() - sqsStart,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    const allHealthy = Object.values(checks).every((c) => c.status === "ok");

    res.writeHead(allHealthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: allHealthy ? "healthy" : "unhealthy",
        service: "workers",
        timestamp: new Date().toISOString(),
        checks,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end();
}

// Health check server (required for ECS)
const healthServer = createServer((req, res) => {
  handleHealthCheck(req, res).catch((err) => {
    logger.error({ err }, "Health check error");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", error: "Internal server error" }));
  });
});

healthServer.listen(HEALTH_PORT, () => {
  logger.info({ port: HEALTH_PORT }, "Health server listening");
});

// Create and start consumers
const pushConsumer = createPushConsumer();
const offlineConsumer = createOfflineConsumer();

pushConsumer.start();
offlineConsumer.start();

logger.info("Workers started - consuming SQS queues");

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down workers...");
  
  pushConsumer.stop();
  offlineConsumer.stop();
  healthServer.close();
  
  // Give consumers time to finish processing
  await new Promise((resolve) => setTimeout(resolve, 5000));
  
  logger.info("Workers shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
