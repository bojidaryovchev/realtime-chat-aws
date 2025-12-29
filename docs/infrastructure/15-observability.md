# Observability Module Documentation

> **File**: `src/observability/index.ts`  
> **Purpose**: Creates CloudWatch dashboard, alarms, and SNS alert topic

---

## Overview

This is the largest module (~1063 lines) providing comprehensive monitoring:
- **Dashboard**: 20+ widgets covering all services
- **Alarms**: 20+ alerts for critical conditions
- **SNS Topic**: Centralized alert delivery

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Observability Architecture                        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                   CloudWatch Dashboard                           ││
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       ││
│  │  │ECS Services│ │   ALB     │ │RDS/Redis  │ │ Custom    │       ││
│  │  │CPU/Memory │ │Requests   │ │Connections│ │WebSocket  │       ││
│  │  │Task Count │ │Latency    │ │IOPS       │ │Event Loop │       ││
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                   CloudWatch Alarms                              ││
│  │  [API CPU] [Realtime CPU] [RDS CPU] [Redis Memory] [ALB 5xx]   ││
│  │  [DLQ Messages] [Old Messages] [Unhealthy Targets] [Replica]   ││
│  └──────────────────────────┬──────────────────────────────────────┘│
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                     SNS Alert Topic                              ││
│  │           ↓             ↓             ↓                         ││
│  │       [Email]      [PagerDuty]    [Slack]                       ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## SNS Alert Topic

```typescript
const snsAlertTopic = new aws.sns.Topic(`${baseName}-alerts`, {
  name: `${baseName}-alerts`,
});
```

**Subscriptions added manually** (or via config):
- Email: For on-call engineers
- PagerDuty/OpsGenie: For incident management
- Slack/Teams: For team visibility

**Why centralized topic?** 
- Single point to manage alert routing
- Easy to add/remove subscribers
- Consistent alarm actions

---

## Alarm Categories

### 1. ECS Service Alarms

#### API High CPU

```typescript
const apiHighCpuAlarm = new aws.cloudwatch.MetricAlarm({
  comparisonOperator: "GreaterThanThreshold",
  evaluationPeriods: 3,
  metricName: "CPUUtilization",
  namespace: "AWS/ECS",
  period: 60,
  statistic: "Average",
  threshold: 80,
  dimensions: {
    ClusterName: cluster.name,
    ServiceName: apiService.name,
  },
  alarmActions: [snsAlertTopic.arn],
  okActions: [snsAlertTopic.arn],  // Notify when resolved
});
```

| Service | Threshold | Why Different |
|---------|-----------|---------------|
| API | 80% | Stateless, can handle brief spikes |
| Realtime | 75% | WebSocket more CPU-sensitive |
| Workers | 80% | Queue processing can batch |

**`evaluationPeriods: 3`**: Requires 3 consecutive minutes above threshold to prevent alert flapping.

#### Workers CPU (Conditional)

```typescript
const workersHighCpuAlarm = workersServiceOutputs
  ? new aws.cloudwatch.MetricAlarm({ ... })
  : undefined;
```

Only created when workers service exists.

---

### 2. Database Alarms

#### RDS High CPU

```typescript
threshold: 80,
dimensions: {
  DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
},
```

#### RDS High Connections

```typescript
const rdsConnectionsThreshold = Math.floor(rdsOutputs.maxConnections * 0.8);
```

**Dynamic threshold**: 80% of instance's max connections (varies by instance class).

| Instance | Max Connections | Alert Threshold |
|----------|-----------------|-----------------|
| db.t3.micro | 112 | 89 |
| db.t3.small | 225 | 180 |
| db.r6g.large | 1700 | 1360 |

#### RDS Low Memory

```typescript
threshold: 100 * 1024 * 1024,  // 100MB
comparisonOperator: "LessThanThreshold",
```

**Critical alert**: 100MB free memory indicates imminent OOM.

#### RDS Latency Alerts

```typescript
// Read latency
threshold: 0.02,  // 20ms (value is in seconds)

// Write latency  
threshold: 0.05,  // 50ms
```

| Metric | Threshold | Typical Value |
|--------|-----------|---------------|
| ReadLatency | 20ms | 1-5ms |
| WriteLatency | 50ms | 2-10ms |

**Why asymmetric?** Writes involve WAL, fsync → inherently slower.

#### RDS Low Storage

```typescript
threshold: 5 * 1024 * 1024 * 1024,  // 5GB
period: 300,  // 5-minute periods (storage changes slowly)
```

#### RDS Replica Lag (Conditional)

```typescript
if (rdsOutputs.dbReadReplica) {
  rdsReplicaLagAlarm = new aws.cloudwatch.MetricAlarm({
    metricName: "ReplicaLag",
    threshold: 30,  // 30 seconds
  });
}
```

Only created when read replica exists. 30-second lag is concerning for read-after-write consistency.

---

### 3. Redis Alarms

#### Redis High Memory

```typescript
metricName: "DatabaseMemoryUsagePercentage",
threshold: 80,
```

**Why 80%?** Redis reserves memory for:
- Background save operations
- Client output buffers
- Fragmentation

#### Redis Split Mode Alarms

```typescript
if (config.enableRedisSplit && redisOutputs.redisAdapterCluster) {
  // Adapter cluster: Lower CPU threshold (70%)
  // State cluster: Standard threshold (80%)
}
```

| Cluster | CPU Threshold | Why |
|---------|---------------|-----|
| Adapter | 70% | Pub/sub is CPU-intensive |
| State | 80% | Key-value is more balanced |

#### Redis High Connections

```typescript
threshold: 5000,
```

ElastiCache node limits vary by instance. 5000 is safe for most instances.

---

### 4. ALB Alarms

#### 5xx Errors

```typescript
const alb5xxAlarm = new aws.cloudwatch.MetricAlarm({
  metricName: "HTTPCode_ELB_5XX_Count",
  threshold: 10,
  statistic: "Sum",
  treatMissingData: "notBreaching",
});
```

**`treatMissingData: notBreaching`**: No data = no errors = OK.

#### Unhealthy Targets

```typescript
metricName: "UnHealthyHostCount",
threshold: 0,  // Any unhealthy target
dimensions: {
  LoadBalancer: alb.arnSuffix,
  TargetGroup: targetGroup.arnSuffix,
},
```

Separate alarms for API and Realtime target groups.

---

### 5. SQS Alarms

#### DLQ Messages

```typescript
const sqsPushDlqAlarm = new aws.cloudwatch.MetricAlarm({
  metricName: "ApproximateNumberOfMessagesVisible",
  namespace: "AWS/SQS",
  threshold: 0,  // ANY message in DLQ
  dimensions: {
    QueueName: sqsOutputs.pushNotificationDlq.name,
  },
});
```

**Zero threshold**: DLQ messages indicate processing failures requiring investigation.

#### Old Messages

```typescript
metricName: "ApproximateAgeOfOldestMessage",
threshold: 300,  // 5 minutes
statistic: "Maximum",
```

Messages older than 5 minutes suggest worker problems.

---

### 6. Custom Realtime Metrics Alarms

```typescript
if (config.realtimeScaleOnConnections) {
  // High connections alarm
  threshold: Math.floor(config.realtimeMaxConnectionsPerTask * 0.8),
  
  // High event loop lag alarm
  extendedStatistic: "p95",
  threshold: config.realtimeScaleOnEventLoopLagMs * 2,
}
```

**Requires application to publish metrics** to CloudWatch namespace `{baseName}`.

---

## CloudWatch Dashboard

### Dashboard Layout

```
Row 0: [Header: ECS Services]
Row 1: [API CPU/Mem][Realtime CPU/Mem][Workers CPU/Mem][Task Count]
Row 7: [Header: ALB]
Row 8: [Request Count][Response Time p50/p95/p99][HTTP Errors]
Row 14: [Header: Database & Cache]
Row 15: [RDS CPU/Connections][RDS IOPS][Redis Memory/CPU]
Row 21: [Header: WebSocket Metrics]
Row 22: [ALB TCP Connections][ALB New Connections][Custom WS Connections]
Row 28: [Header: Realtime Performance]
Row 29: [Event Loop Lag][Messages/Sec][Heap Memory]
```

### Key Widgets

#### ECS Service Metrics

```typescript
{
  title: "API Service - CPU & Memory",
  metrics: [
    ["AWS/ECS", "CPUUtilization", "ClusterName", clusterName, "ServiceName", apiServiceName],
    [".", "MemoryUtilization", ".", ".", ".", "."],
  ],
}
```

**Shorthand notation**: `"."` repeats previous value.

#### Response Time Percentiles

```typescript
{
  title: "Response Time",
  metrics: [
    ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", albArnSuffix, { stat: "p50" }],
    ["...", { stat: "p95" }],
    ["...", { stat: "p99" }],
  ],
}
```

Shows distribution: p50 (typical), p95 (slow), p99 (outliers).

#### Event Loop Lag with Threshold Line

```typescript
{
  title: "Event Loop Lag (ms)",
  annotations: {
    horizontal: [{
      label: "Scale Threshold",
      value: config.realtimeScaleOnEventLoopLagMs,
      color: "#ff7f0e",
    }],
  },
}
```

Visual indicator of when auto-scaling triggers.

### Conditional Workers Widget

```typescript
const workersWidget = workersServiceName
  ? [{ type: "metric", ... }]
  : [];

// In widgets array:
...workersWidget,
```

Dashboard adapts when workers service is disabled.

---

## Cost Breakdown

### CloudWatch Pricing

| Resource | Price |
|----------|-------|
| Dashboard | $3/month |
| Alarm (standard) | $0.10/month each |
| Alarm (high-res) | $0.30/month each |
| Metrics (custom) | $0.30 per metric/month |
| Logs ingestion | $0.50/GB |
| Logs storage | $0.03/GB/month |

### Estimated Monthly Cost

| Component | Count | Monthly |
|-----------|-------|---------|
| Dashboard | 1 | $3 |
| Alarms | ~20 | $2 |
| Custom metrics (if enabled) | ~5 | $1.50 |
| **Total** | | **~$6.50** |

---

## Exports

```typescript
return {
  dashboard,
  snsAlertTopic,
  // Core alarms
  apiHighCpuAlarm,
  realtimeHighCpuAlarm,
  rdsHighCpuAlarm,
  redisHighMemoryAlarm,
  alb5xxAlarm,
  // Extended alarms
  rdsHighConnectionsAlarm,
  rdsLowMemoryAlarm,
  rdsHighReadLatencyAlarm,
  rdsHighWriteLatencyAlarm,
  rdsLowStorageAlarm,
  rdsReplicaLagAlarm,          // Optional
  sqsPushDlqAlarm,
  sqsOfflineDlqAlarm,
  sqsOldMessageAlarm,
  realtimeUnhealthyTargetsAlarm,
  apiUnhealthyTargetsAlarm,
  // Custom metrics alarms
  realtimeHighConnectionsAlarm, // Optional
  realtimeHighEventLoopLagAlarm, // Optional
  // Redis split mode alarms
  redisAdapterHighCpuAlarm,     // Optional
  redisStateHighCpuAlarm,       // Optional
  redisAdapterHighConnectionsAlarm, // Optional
  redisStateHighConnectionsAlarm,   // Optional
  workersHighCpuAlarm,          // Optional
};
```

---

## Setting Up Notifications

After deployment, add SNS subscriptions:

### Email

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789:chat-prod-alerts \
  --protocol email \
  --notification-endpoint alerts@example.com
```

### PagerDuty

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789:chat-prod-alerts \
  --protocol https \
  --notification-endpoint https://events.pagerduty.com/integration/{key}/enqueue
```

### Slack (via Lambda or Chatbot)

Use AWS Chatbot for native Slack integration, or Lambda for custom formatting.
