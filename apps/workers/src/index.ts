import { createServer } from "http";
import { logger } from "./lib/logger.js";
import { createPushConsumer } from "./consumers/push.js";
import { createOfflineConsumer } from "./consumers/offline.js";

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "3002", 10);

// Health check server (required for ECS)
const healthServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "workers" }));
  } else {
    res.writeHead(404);
    res.end();
  }
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
