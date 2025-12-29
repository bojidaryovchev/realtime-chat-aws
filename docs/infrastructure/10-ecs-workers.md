# ECS Workers Module Documentation

> **File**: `src/ecs-services/workers.ts`  
> **Purpose**: Creates background worker service for SQS queue processing

---

## Overview

Workers service processes asynchronous tasks:
- Push notifications
- Offline message delivery
- Any future background jobs

Unlike API/Realtime, workers:
- Don't connect to ALB (no HTTP traffic)
- Scale based on queue depth, not CPU/memory
- Process messages in batches

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ECS Cluster                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Workers Service                               ││
│  │  ┌─────────────────────┐  ┌─────────────────────┐               ││
│  │  │   Task (Fargate)    │  │   Task (Fargate)    │  ...          ││
│  │  │  ┌───────────────┐  │  │  ┌───────────────┐  │               ││
│  │  │  │Workers Cont.  │  │  │  │Workers Cont.  │  │               ││
│  │  │  │  Port 3003    │  │  │  │  Port 3003    │  │               ││
│  │  │  └───────────────┘  │  └──└───────────────┘──┘               ││
│  │  └─────────────────────┘                                         ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
           │                           │
           ↓                           ↓
    ┌──────────────┐            ┌──────────────┐
    │ Push Queue   │            │ Offline Queue│
    │    (SQS)     │            │    (SQS)     │
    └──────────────┘            └──────────────┘
           │                           │
           ↓                           ↓
    ┌──────────────┐            ┌──────────────┐
    │  Push DLQ    │            │ Offline DLQ  │
    └──────────────┘            └──────────────┘
```

---

## Task Definition

### Worker-Specific Environment

```typescript
environment: [
  // SQS Queue URLs
  { name: "SQS_PUSH_QUEUE_URL", value: pushQueueUrl },
  { name: "SQS_OFFLINE_QUEUE_URL", value: offlineQueueUrl },
  { name: "SQS_PUSH_DLQ_URL", value: pushDlqUrl },
  { name: "SQS_OFFLINE_DLQ_URL", value: offlineDlqUrl },
  // Worker behavior
  { name: "WORKER_POLL_INTERVAL_MS", value: "1000" },
  { name: "WORKER_BATCH_SIZE", value: "10" },
  { name: "WORKER_VISIBILITY_TIMEOUT", value: "60" },
]
```

| Variable | Value | Purpose |
|----------|-------|---------|
| `POLL_INTERVAL_MS` | 1000 | Poll every second when no messages |
| `BATCH_SIZE` | 10 | Receive up to 10 messages per poll |
| `VISIBILITY_TIMEOUT` | 60s | Time to process before message reappears |

**Why DLQ URLs?** Workers may need to:
- Inspect failed messages
- Manually replay messages
- Monitor DLQ depth

### Port 3003 - Health Endpoint Only

```typescript
portMappings: [
  { containerPort: 3003, hostPort: 3003, protocol: "tcp" },
],
```

No ALB routes here. Port exposed only for:
- ECS container health checks
- Internal debugging

---

## Service Configuration

### No Load Balancer

```typescript
// Note: No loadBalancers block
```

Workers pull from SQS, they don't receive HTTP requests.

### No Health Check Grace Period

```typescript
// Note: healthCheckGracePeriodSeconds is NOT set
```

**Why?** This setting only applies to services with load balancers. ECS uses the container health check directly.

---

## Auto Scaling Strategies

### 1. Queue Depth Scaling (Target Tracking)

```typescript
new aws.appautoscaling.Policy(`${baseName}-workers-push-queue-scaling`, {
  targetTrackingScalingPolicyConfiguration: {
    customizedMetricSpecification: {
      metricName: "ApproximateNumberOfMessagesVisible",
      namespace: "AWS/SQS",
      dimensions: [{ name: "QueueName", value: sqsOutputs.pushNotificationQueue.name }],
    },
    targetValue: config.workerScaleOnQueueDepth,  // e.g., 100
  },
});
```

**How it works**:
- Target: 100 messages per worker task
- 500 messages → 5 tasks
- 50 messages → 1 task (min)

**Why both queues?** Each queue gets its own policy:
- Push notifications might spike independently
- Offline messages might have different patterns

### 2. Message Age Scaling (Step Scaling)

```typescript
stepAdjustments: [
  {
    metricIntervalLowerBound: "0",
    metricIntervalUpperBound: String(config.workerScaleOnOldestMessageAge),
    scalingAdjustment: 0,  // No change
  },
  {
    metricIntervalLowerBound: String(config.workerScaleOnOldestMessageAge),
    metricIntervalUpperBound: String(config.workerScaleOnOldestMessageAge * 2),
    scalingAdjustment: 1,  // Add 1 task
  },
  {
    metricIntervalLowerBound: String(config.workerScaleOnOldestMessageAge * 2),
    scalingAdjustment: 2,  // Add 2 tasks
  },
],
```

**Why message age?**

Queue depth alone can be misleading:
- 100 messages arriving now = handled quickly
- 100 messages that have been waiting 5 minutes = backlog problem

**Scaling table** (assuming threshold = 300 seconds):

| Oldest Message Age | Action |
|-------------------|--------|
| 0-300s | No change |
| 300-600s | +1 task |
| >600s | +2 tasks |

### CloudWatch Alarm Trigger

```typescript
new aws.cloudwatch.MetricAlarm(`${baseName}-workers-message-age-alarm`, {
  comparisonOperator: "GreaterThanThreshold",
  evaluationPeriods: 2,  // 2 consecutive breaches
  metricName: "ApproximateAgeOfOldestMessage",
  namespace: "AWS/SQS",
  period: 60,
  statistic: "Maximum",
  threshold: config.workerScaleOnOldestMessageAge,
  alarmActions: [scaleOnMessageAge.arn],
});
```

**Why Maximum statistic?** We care about the oldest message, not average.

---

## Capacity Limits

```typescript
maxCapacity: config.environment === "prod" ? 10 : 3,
minCapacity: config.workerServiceDesiredCount,
```

| Environment | Min | Max | Rationale |
|-------------|-----|-----|-----------|
| dev | 1 | 3 | Light testing, cost savings |
| prod | 1-2 | 10 | Handle notification spikes |

**Why lower max than API/Realtime?**
- Workers are I/O bound, not CPU bound
- SQS has built-in batching (10 messages/poll)
- Each worker can process many messages/second

---

## Design Decisions

### Why Separate Workers Service?

| Approach | Pros | Cons |
|----------|------|------|
| **Process in API** | Simpler architecture | Blocks HTTP requests |
| **Background thread** | No extra infra | Can't scale independently |
| **Lambda** | Serverless, pay-per-use | 15 min timeout, cold starts |
| **Dedicated service** ✓ | Independent scaling, reliable | Extra service to manage |

### Worker Implementation Pattern

Your application should:

```typescript
// Pseudocode for worker implementation
async function processMessages() {
  while (running) {
    const messages = await sqs.receiveMessage({
      QueueUrl: process.env.SQS_PUSH_QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,  // Long polling
      VisibilityTimeout: 60,
    });
    
    for (const msg of messages) {
      try {
        await processMessage(msg);
        await sqs.deleteMessage({ QueueUrl, ReceiptHandle: msg.ReceiptHandle });
      } catch (error) {
        // Let visibility timeout expire - message returns to queue
        // After 3 failures, moves to DLQ
        logger.error('Processing failed', { error, messageId: msg.MessageId });
      }
    }
  }
}
```

---

## Cost Implications

### Workers Pricing

Same as other Fargate tasks. Typical configuration:

| Config | CPU | Memory | Monthly (1 task) |
|--------|-----|--------|------------------|
| Dev | 256 | 512 | ~$9 |
| Prod | 512 | 1024 | ~$36 |

### Cost Optimization

1. **Use Spot instances in dev**: Workers are fault-tolerant (messages retry)
2. **Right-size based on throughput**: Start small, monitor queue depth
3. **Scale to zero?**: Not natively, but min=1 is fine for most cases

---

## Exports

```typescript
return {
  workersService,
  workersTaskDefinition,
  workersLogGroup,
  workersAutoScaling,
};
```

Used by: Observability module for alarms/dashboards
