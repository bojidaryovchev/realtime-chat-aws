import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";
import { AlbOutputs } from "../alb";
import { EcsClusterOutputs } from "../ecs-cluster";
import { EcsServicesOutputs } from "../ecs-services";
import { WorkersServiceOutputs } from "../ecs-services/workers";
import { RdsOutputs } from "../rds";
import { RedisOutputs } from "../redis";
import { SqsOutputs } from "../sqs";

export interface ObservabilityOutputs {
  dashboard: aws.cloudwatch.Dashboard;
  apiHighCpuAlarm: aws.cloudwatch.MetricAlarm;
  realtimeHighCpuAlarm: aws.cloudwatch.MetricAlarm;
  rdsHighCpuAlarm: aws.cloudwatch.MetricAlarm;
  redisHighMemoryAlarm: aws.cloudwatch.MetricAlarm;
  alb5xxAlarm: aws.cloudwatch.MetricAlarm;
  snsAlertTopic: aws.sns.Topic;
  // Custom metrics alarms (only when enabled)
  realtimeHighConnectionsAlarm?: aws.cloudwatch.MetricAlarm;
  realtimeHighEventLoopLagAlarm?: aws.cloudwatch.MetricAlarm;
  // Redis split mode alarms (only when split enabled)
  redisAdapterHighCpuAlarm?: aws.cloudwatch.MetricAlarm;
  redisStateHighCpuAlarm?: aws.cloudwatch.MetricAlarm;
  redisAdapterHighConnectionsAlarm?: aws.cloudwatch.MetricAlarm;
  redisStateHighConnectionsAlarm?: aws.cloudwatch.MetricAlarm;
  // Extended observability alarms
  rdsHighConnectionsAlarm: aws.cloudwatch.MetricAlarm;
  rdsLowMemoryAlarm: aws.cloudwatch.MetricAlarm;
  rdsHighReadLatencyAlarm: aws.cloudwatch.MetricAlarm;
  rdsHighWriteLatencyAlarm: aws.cloudwatch.MetricAlarm;
  rdsLowStorageAlarm: aws.cloudwatch.MetricAlarm;
  rdsReplicaLagAlarm?: aws.cloudwatch.MetricAlarm;
  sqsPushDlqAlarm: aws.cloudwatch.MetricAlarm;
  sqsOfflineDlqAlarm: aws.cloudwatch.MetricAlarm;
  sqsOldMessageAlarm: aws.cloudwatch.MetricAlarm;
  realtimeUnhealthyTargetsAlarm: aws.cloudwatch.MetricAlarm;
  apiUnhealthyTargetsAlarm: aws.cloudwatch.MetricAlarm;
  workersHighCpuAlarm?: aws.cloudwatch.MetricAlarm;
}

/**
 * Creates CloudWatch observability resources:
 * - Dashboard with key metrics
 * - Alarms for critical thresholds
 * - SNS topic for alert notifications
 */
export function createObservability(
  config: Config,
  ecsClusterOutputs: EcsClusterOutputs,
  ecsServicesOutputs: EcsServicesOutputs,
  workersServiceOutputs: WorkersServiceOutputs | undefined,
  rdsOutputs: RdsOutputs,
  redisOutputs: RedisOutputs,
  albOutputs: AlbOutputs,
  sqsOutputs: SqsOutputs,
): ObservabilityOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // ==================== SNS Topic for Alerts ====================

  const snsAlertTopic = new aws.sns.Topic(`${baseName}-alerts`, {
    name: `${baseName}-alerts`,
    tags: {
      ...tags,
      Name: `${baseName}-alerts`,
    },
  });

  // ==================== CloudWatch Alarms ====================

  // API Service High CPU Alarm
  const apiHighCpuAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-api-high-cpu`, {
    name: `${baseName}-api-high-cpu`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "CPUUtilization",
    namespace: "AWS/ECS",
    period: 60,
    statistic: "Average",
    threshold: 80,
    alarmDescription: "API service CPU utilization is high",
    dimensions: {
      ClusterName: ecsClusterOutputs.cluster.name,
      ServiceName: ecsServicesOutputs.apiService.name,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-api-high-cpu`,
    },
  });

  // Realtime Service High CPU Alarm
  const realtimeHighCpuAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-realtime-high-cpu`, {
    name: `${baseName}-realtime-high-cpu`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "CPUUtilization",
    namespace: "AWS/ECS",
    period: 60,
    statistic: "Average",
    threshold: 75, // Lower threshold for realtime service
    alarmDescription: "Realtime service CPU utilization is high",
    dimensions: {
      ClusterName: ecsClusterOutputs.cluster.name,
      ServiceName: ecsServicesOutputs.realtimeService.name,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-realtime-high-cpu`,
    },
  });

  // Workers Service High CPU Alarm (only when workers service is enabled)
  const workersHighCpuAlarm = workersServiceOutputs
    ? new aws.cloudwatch.MetricAlarm(`${baseName}-workers-high-cpu`, {
        name: `${baseName}-workers-high-cpu`,
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 3,
        metricName: "CPUUtilization",
        namespace: "AWS/ECS",
        period: 60,
        statistic: "Average",
        threshold: 80,
        alarmDescription: "Workers service CPU utilization is high",
        dimensions: {
          ClusterName: ecsClusterOutputs.cluster.name,
          ServiceName: workersServiceOutputs.workersService.name,
        },
        alarmActions: [snsAlertTopic.arn],
        okActions: [snsAlertTopic.arn],
        tags: {
          ...tags,
          Name: `${baseName}-workers-high-cpu`,
        },
      })
    : undefined;

  // RDS High CPU Alarm
  const rdsHighCpuAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-high-cpu`, {
    name: `${baseName}-rds-high-cpu`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "CPUUtilization",
    namespace: "AWS/RDS",
    period: 60,
    statistic: "Average",
    threshold: 80,
    alarmDescription: "RDS CPU utilization is high",
    dimensions: {
      DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-rds-high-cpu`,
    },
  });

  // Redis High Memory Alarm
  const redisHighMemoryAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-redis-high-memory`, {
    name: `${baseName}-redis-high-memory`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "DatabaseMemoryUsagePercentage",
    namespace: "AWS/ElastiCache",
    period: 60,
    statistic: "Average",
    threshold: 80,
    alarmDescription: "Redis memory usage is high",
    dimensions: {
      ReplicationGroupId: redisOutputs.redisCluster.id,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-redis-high-memory`,
    },
  });

  // ALB 5xx Error Rate Alarm
  const alb5xxAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-alb-5xx`, {
    name: `${baseName}-alb-5xx`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "HTTPCode_ELB_5XX_Count",
    namespace: "AWS/ApplicationELB",
    period: 60,
    statistic: "Sum",
    threshold: 10,
    alarmDescription: "ALB 5xx error count is high",
    dimensions: {
      LoadBalancer: albOutputs.alb.arnSuffix,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-alb-5xx`,
    },
  });

  // ==================== Custom Realtime Metrics Alarms ====================
  // These alarms fire on custom metrics published by the realtime service

  let realtimeHighConnectionsAlarm: aws.cloudwatch.MetricAlarm | undefined;
  let realtimeHighEventLoopLagAlarm: aws.cloudwatch.MetricAlarm | undefined;

  if (config.realtimeScaleOnConnections) {
    // Alert when connections per task approach threshold (80% warning)
    realtimeHighConnectionsAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-realtime-high-connections`, {
      name: `${baseName}-realtime-high-connections`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 3,
      metricName: "ActiveConnections",
      namespace: baseName,
      period: 60,
      statistic: "Average",
      threshold: Math.floor(config.realtimeMaxConnectionsPerTask * 0.8), // 80% of max
      alarmDescription: `Realtime connections approaching max (${config.realtimeMaxConnectionsPerTask})`,
      dimensions: {
        ServiceName: `${baseName}-realtime`,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      treatMissingData: "notBreaching",
      tags: {
        ...tags,
        Name: `${baseName}-realtime-high-connections`,
      },
    });

    // Alert when event loop lag is high
    realtimeHighEventLoopLagAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-realtime-high-eventloop`, {
      name: `${baseName}-realtime-high-eventloop`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 5, // 5 minutes of high lag
      metricName: "EventLoopLagMs",
      namespace: baseName,
      period: 60,
      extendedStatistic: "p95", // Use extendedStatistic for percentiles
      threshold: config.realtimeScaleOnEventLoopLagMs * 2, // Alert at 2x scaling threshold
      alarmDescription: `Realtime event loop lag is critically high (>${config.realtimeScaleOnEventLoopLagMs * 2}ms)`,
      dimensions: {
        ServiceName: `${baseName}-realtime`,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      treatMissingData: "notBreaching",
      tags: {
        ...tags,
        Name: `${baseName}-realtime-high-eventloop`,
      },
    });
  }

  // ==================== Redis Split Mode Alarms ====================
  // When Redis split is enabled, monitor both clusters separately

  let redisAdapterHighCpuAlarm: aws.cloudwatch.MetricAlarm | undefined;
  let redisStateHighCpuAlarm: aws.cloudwatch.MetricAlarm | undefined;
  let redisAdapterHighConnectionsAlarm: aws.cloudwatch.MetricAlarm | undefined;
  let redisStateHighConnectionsAlarm: aws.cloudwatch.MetricAlarm | undefined;

  if (config.enableRedisSplit && redisOutputs.redisAdapterCluster && redisOutputs.redisStateCluster) {
    // Redis Adapter Cluster - CPU (pub/sub is CPU intensive)
    redisAdapterHighCpuAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-redis-adapter-high-cpu`, {
      name: `${baseName}-redis-adapter-high-cpu`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 3,
      metricName: "EngineCPUUtilization",
      namespace: "AWS/ElastiCache",
      period: 60,
      statistic: "Average",
      threshold: 70, // Lower threshold for pub/sub workload
      alarmDescription: "Redis adapter cluster CPU utilization is high (pub/sub bottleneck)",
      dimensions: {
        ReplicationGroupId: redisOutputs.redisAdapterCluster.id,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      tags: {
        ...tags,
        Name: `${baseName}-redis-adapter-high-cpu`,
      },
    });

    // Redis State Cluster - CPU
    redisStateHighCpuAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-redis-state-high-cpu`, {
      name: `${baseName}-redis-state-high-cpu`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 3,
      metricName: "EngineCPUUtilization",
      namespace: "AWS/ElastiCache",
      period: 60,
      statistic: "Average",
      threshold: 80,
      alarmDescription: "Redis state cluster CPU utilization is high",
      dimensions: {
        ReplicationGroupId: redisOutputs.redisStateCluster.id,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      tags: {
        ...tags,
        Name: `${baseName}-redis-state-high-cpu`,
      },
    });

    // Redis Adapter Cluster - Connections (important for pub/sub fanout)
    redisAdapterHighConnectionsAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-redis-adapter-high-connections`, {
      name: `${baseName}-redis-adapter-high-connections`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 3,
      metricName: "CurrConnections",
      namespace: "AWS/ElastiCache",
      period: 60,
      statistic: "Average",
      threshold: 5000, // Alert when approaching connection limits
      alarmDescription: "Redis adapter cluster connections are high",
      dimensions: {
        ReplicationGroupId: redisOutputs.redisAdapterCluster.id,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      tags: {
        ...tags,
        Name: `${baseName}-redis-adapter-high-connections`,
      },
    });

    // Redis State Cluster - Connections
    redisStateHighConnectionsAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-redis-state-high-connections`, {
      name: `${baseName}-redis-state-high-connections`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 3,
      metricName: "CurrConnections",
      namespace: "AWS/ElastiCache",
      period: 60,
      statistic: "Average",
      threshold: 5000,
      alarmDescription: "Redis state cluster connections are high",
      dimensions: {
        ReplicationGroupId: redisOutputs.redisStateCluster.id,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      tags: {
        ...tags,
        Name: `${baseName}-redis-state-high-connections`,
      },
    });
  }

  // ==================== Extended Observability Alarms ====================

  // RDS - Database Connections approaching max (80% of instance class limit)
  const rdsConnectionsThreshold = Math.floor(rdsOutputs.maxConnections * 0.8);
  const rdsHighConnectionsAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-high-connections`, {
    name: `${baseName}-rds-high-connections`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "DatabaseConnections",
    namespace: "AWS/RDS",
    period: 60,
    statistic: "Average",
    threshold: rdsConnectionsThreshold,
    alarmDescription: `RDS database connections are approaching limit (${rdsConnectionsThreshold}/${rdsOutputs.maxConnections})`,
    dimensions: {
      DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-rds-high-connections`,
    },
  });

  // RDS - Low Freeable Memory
  const rdsLowMemoryAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-low-memory`, {
    name: `${baseName}-rds-low-memory`,
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 3,
    metricName: "FreeableMemory",
    namespace: "AWS/RDS",
    period: 60,
    statistic: "Average",
    threshold: 100 * 1024 * 1024, // 100MB threshold
    alarmDescription: "RDS freeable memory is critically low",
    dimensions: {
      DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-rds-low-memory`,
    },
  });

  // RDS - High Read Latency
  const rdsHighReadLatencyAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-high-read-latency`, {
    name: `${baseName}-rds-high-read-latency`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 5,
    metricName: "ReadLatency",
    namespace: "AWS/RDS",
    period: 60,
    statistic: "Average",
    threshold: 0.02, // 20ms threshold (latency is in seconds)
    alarmDescription: "RDS read latency is high",
    dimensions: {
      DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-rds-high-read-latency`,
    },
  });

  // RDS - High Write Latency
  const rdsHighWriteLatencyAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-high-write-latency`, {
    name: `${baseName}-rds-high-write-latency`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 5,
    metricName: "WriteLatency",
    namespace: "AWS/RDS",
    period: 60,
    statistic: "Average",
    threshold: 0.05, // 50ms threshold
    alarmDescription: "RDS write latency is high",
    dimensions: {
      DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-rds-high-write-latency`,
    },
  });

  // RDS - Low Free Storage Space (alert before storage exhaustion)
  const rdsLowStorageAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-low-storage`, {
    name: `${baseName}-rds-low-storage`,
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 3,
    metricName: "FreeStorageSpace",
    namespace: "AWS/RDS",
    period: 300, // 5-minute periods for storage (doesn't change rapidly)
    statistic: "Average",
    threshold: 5 * 1024 * 1024 * 1024, // 5GB threshold
    alarmDescription: "RDS free storage space is critically low - consider increasing allocated storage",
    dimensions: {
      DBInstanceIdentifier: rdsOutputs.dbInstance.identifier,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    tags: {
      ...tags,
      Name: `${baseName}-rds-low-storage`,
    },
  });

  // RDS - Replica Lag (only when read replica is enabled)
  // Monitors replication delay between primary and replica
  let rdsReplicaLagAlarm: aws.cloudwatch.MetricAlarm | undefined;

  if (rdsOutputs.dbReadReplica) {
    rdsReplicaLagAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-rds-replica-lag`, {
      name: `${baseName}-rds-replica-lag`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 3,
      metricName: "ReplicaLag",
      namespace: "AWS/RDS",
      period: 60,
      statistic: "Average",
      threshold: 30, // 30 seconds lag threshold
      alarmDescription: "RDS read replica lag is high - replica may be falling behind primary",
      dimensions: {
        DBInstanceIdentifier: rdsOutputs.dbReadReplica.identifier,
      },
      alarmActions: [snsAlertTopic.arn],
      okActions: [snsAlertTopic.arn],
      treatMissingData: "notBreaching",
      tags: {
        ...tags,
        Name: `${baseName}-rds-replica-lag`,
      },
    });
  }

  // SQS - Push Notification DLQ has messages (indicates failures)
  const sqsPushDlqAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-sqs-push-dlq`, {
    name: `${baseName}-sqs-push-dlq`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    metricName: "ApproximateNumberOfMessagesVisible",
    namespace: "AWS/SQS",
    period: 60,
    statistic: "Sum",
    threshold: 0, // Any message in DLQ is concerning
    alarmDescription: "Push notification DLQ has messages - processing failures occurring",
    dimensions: {
      QueueName: sqsOutputs.pushNotificationDlq.name,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-sqs-push-dlq`,
    },
  });

  // SQS - Offline Message DLQ has messages
  const sqsOfflineDlqAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-sqs-offline-dlq`, {
    name: `${baseName}-sqs-offline-dlq`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    metricName: "ApproximateNumberOfMessagesVisible",
    namespace: "AWS/SQS",
    period: 60,
    statistic: "Sum",
    threshold: 0,
    alarmDescription: "Offline message DLQ has messages - processing failures occurring",
    dimensions: {
      QueueName: sqsOutputs.offlineMessageDlq.name,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-sqs-offline-dlq`,
    },
  });

  // SQS - Old messages in queue (backlog building up)
  const sqsOldMessageAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-sqs-old-message`, {
    name: `${baseName}-sqs-old-message`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "ApproximateAgeOfOldestMessage",
    namespace: "AWS/SQS",
    period: 60,
    statistic: "Maximum",
    threshold: 300, // 5 minutes - messages shouldn't sit this long
    alarmDescription: "SQS queue has old messages - workers may be failing or underprovisioned",
    dimensions: {
      QueueName: sqsOutputs.pushNotificationQueue.name,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-sqs-old-message`,
    },
  });

  // ALB Target Group - Realtime Unhealthy Targets
  const realtimeUnhealthyTargetsAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-realtime-unhealthy`, {
    name: `${baseName}-realtime-unhealthy`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "UnHealthyHostCount",
    namespace: "AWS/ApplicationELB",
    period: 60,
    statistic: "Average",
    threshold: 0, // Any unhealthy target is concerning
    alarmDescription: "Realtime service has unhealthy targets",
    dimensions: {
      LoadBalancer: albOutputs.alb.arnSuffix,
      TargetGroup: albOutputs.realtimeTargetGroup.arnSuffix,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-realtime-unhealthy`,
    },
  });

  // ALB Target Group - API Unhealthy Targets
  const apiUnhealthyTargetsAlarm = new aws.cloudwatch.MetricAlarm(`${baseName}-api-unhealthy`, {
    name: `${baseName}-api-unhealthy`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "UnHealthyHostCount",
    namespace: "AWS/ApplicationELB",
    period: 60,
    statistic: "Average",
    threshold: 0,
    alarmDescription: "API service has unhealthy targets",
    dimensions: {
      LoadBalancer: albOutputs.alb.arnSuffix,
      TargetGroup: albOutputs.apiTargetGroup.arnSuffix,
    },
    alarmActions: [snsAlertTopic.arn],
    okActions: [snsAlertTopic.arn],
    treatMissingData: "notBreaching",
    tags: {
      ...tags,
      Name: `${baseName}-api-unhealthy`,
    },
  });

  // ==================== CloudWatch Dashboard ====================

  // Add workers service name if available
  const workersServiceNameOutput = workersServiceOutputs
    ? workersServiceOutputs.workersService.name
    : pulumi.output("");

  const dashboard = new aws.cloudwatch.Dashboard(`${baseName}-dashboard`, {
    dashboardName: `${baseName}-dashboard`,
    dashboardBody: pulumi
      .all([
        ecsClusterOutputs.cluster.name,
        ecsServicesOutputs.apiService.name,
        ecsServicesOutputs.realtimeService.name,
        workersServiceNameOutput,
        rdsOutputs.dbInstance.identifier,
        redisOutputs.redisCluster.id,
        albOutputs.alb.arnSuffix,
      ])
      .apply(
        ([
          clusterName,
          apiServiceName,
          realtimeServiceName,
          workersServiceName,
          rdsIdentifier,
          redisId,
          albArnSuffix,
        ]) => {
          // Build workers widget only if workers service exists
          const workersWidget = workersServiceName
            ? [
                {
                  type: "metric",
                  x: 12,
                  y: 1,
                  width: 6,
                  height: 6,
                  properties: {
                    title: "Workers Service",
                    metrics: [
                      [
                        "AWS/ECS",
                        "CPUUtilization",
                        "ClusterName",
                        clusterName,
                        "ServiceName",
                        workersServiceName,
                        { label: "CPU" },
                      ],
                      [".", "MemoryUtilization", ".", ".", ".", ".", { label: "Memory" }],
                    ],
                    period: 60,
                    stat: "Average",
                  },
                },
              ]
            : [];

          // Build running task count metrics
          const taskCountMetrics: unknown[][] = [
            [
              "ECS/ContainerInsights",
              "RunningTaskCount",
              "ClusterName",
              clusterName,
              "ServiceName",
              apiServiceName,
              { label: "API Tasks" },
            ],
            [".", ".", ".", ".", ".", realtimeServiceName, { label: "Realtime Tasks" }],
          ];
          if (workersServiceName) {
            taskCountMetrics.push([".", ".", ".", ".", ".", workersServiceName, { label: "Workers Tasks" }]);
          }

          return JSON.stringify({
            widgets: [
              // Row 1: ECS Services
              {
                type: "text",
                x: 0,
                y: 0,
                width: 24,
                height: 1,
                properties: {
                  markdown: "# ECS Services",
                },
              },
              {
                type: "metric",
                x: 0,
                y: 1,
                width: 6,
                height: 6,
                properties: {
                  title: "API Service - CPU & Memory",
                  metrics: [
                    [
                      "AWS/ECS",
                      "CPUUtilization",
                      "ClusterName",
                      clusterName,
                      "ServiceName",
                      apiServiceName,
                      { label: "CPU" },
                    ],
                    [".", "MemoryUtilization", ".", ".", ".", ".", { label: "Memory" }],
                  ],
                  period: 60,
                  stat: "Average",
                },
              },
              {
                type: "metric",
                x: 6,
                y: 1,
                width: 6,
                height: 6,
                properties: {
                  title: "Realtime Service - CPU & Memory",
                  metrics: [
                    [
                      "AWS/ECS",
                      "CPUUtilization",
                      "ClusterName",
                      clusterName,
                      "ServiceName",
                      realtimeServiceName,
                      { label: "CPU" },
                    ],
                    [".", "MemoryUtilization", ".", ".", ".", ".", { label: "Memory" }],
                  ],
                  period: 60,
                  stat: "Average",
                },
              },
              // Conditionally include workers widget
              ...workersWidget,
              {
                type: "metric",
                x: workersServiceName ? 18 : 12,
                y: 1,
                width: 6,
                height: 6,
                properties: {
                  title: "ECS Running Task Count",
                  metrics: taskCountMetrics,
                  period: 60,
                  stat: "Average",
                },
              },

              // Row 2: ALB
              {
                type: "text",
                x: 0,
                y: 7,
                width: 24,
                height: 1,
                properties: {
                  markdown: "# Application Load Balancer",
                },
              },
              {
                type: "metric",
                x: 0,
                y: 8,
                width: 8,
                height: 6,
                properties: {
                  title: "Request Count",
                  metrics: [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", albArnSuffix]],
                  period: 60,
                  stat: "Sum",
                },
              },
              {
                type: "metric",
                x: 8,
                y: 8,
                width: 8,
                height: 6,
                properties: {
                  title: "Response Time",
                  metrics: [
                    [
                      "AWS/ApplicationELB",
                      "TargetResponseTime",
                      "LoadBalancer",
                      albArnSuffix,
                      { stat: "p50", label: "p50" },
                    ],
                    ["...", { stat: "p95", label: "p95" }],
                    ["...", { stat: "p99", label: "p99" }],
                  ],
                  period: 60,
                },
              },
              {
                type: "metric",
                x: 16,
                y: 8,
                width: 8,
                height: 6,
                properties: {
                  title: "HTTP Error Codes",
                  metrics: [
                    ["AWS/ApplicationELB", "HTTPCode_ELB_4XX_Count", "LoadBalancer", albArnSuffix, { label: "4xx" }],
                    [".", "HTTPCode_ELB_5XX_Count", ".", ".", { label: "5xx" }],
                  ],
                  period: 60,
                  stat: "Sum",
                },
              },

              // Row 3: RDS & Redis
              {
                type: "text",
                x: 0,
                y: 14,
                width: 24,
                height: 1,
                properties: {
                  markdown: "# Database & Cache",
                },
              },
              {
                type: "metric",
                x: 0,
                y: 15,
                width: 8,
                height: 6,
                properties: {
                  title: "RDS CPU & Connections",
                  metrics: [
                    ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", rdsIdentifier, { label: "CPU %" }],
                    [".", "DatabaseConnections", ".", ".", { label: "Connections", yAxis: "right" }],
                  ],
                  period: 60,
                  stat: "Average",
                },
              },
              {
                type: "metric",
                x: 8,
                y: 15,
                width: 8,
                height: 6,
                properties: {
                  title: "RDS I/O",
                  metrics: [
                    ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", rdsIdentifier, { label: "Read IOPS" }],
                    [".", "WriteIOPS", ".", ".", { label: "Write IOPS" }],
                  ],
                  period: 60,
                  stat: "Average",
                },
              },
              {
                type: "metric",
                x: 16,
                y: 15,
                width: 8,
                height: 6,
                properties: {
                  title: "Redis Memory & CPU",
                  metrics: [
                    [
                      "AWS/ElastiCache",
                      "DatabaseMemoryUsagePercentage",
                      "ReplicationGroupId",
                      redisId,
                      { label: "Memory %" },
                    ],
                    [".", "EngineCPUUtilization", ".", ".", { label: "CPU %" }],
                  ],
                  period: 60,
                  stat: "Average",
                },
              },

              // Row 4: WebSocket Specific
              {
                type: "text",
                x: 0,
                y: 21,
                width: 24,
                height: 1,
                properties: {
                  markdown: "# WebSocket / Realtime Metrics",
                },
              },
              {
                type: "metric",
                x: 0,
                y: 22,
                width: 8,
                height: 6,
                properties: {
                  title: "Active TCP Connections (ALB)",
                  metrics: [["AWS/ApplicationELB", "ActiveConnectionCount", "LoadBalancer", albArnSuffix]],
                  period: 60,
                  stat: "Sum",
                },
              },
              {
                type: "metric",
                x: 8,
                y: 22,
                width: 8,
                height: 6,
                properties: {
                  title: "New TCP Connections (ALB)",
                  metrics: [["AWS/ApplicationELB", "NewConnectionCount", "LoadBalancer", albArnSuffix]],
                  period: 60,
                  stat: "Sum",
                },
              },
              {
                type: "metric",
                x: 16,
                y: 22,
                width: 8,
                height: 6,
                properties: {
                  title: "WebSocket Connections (Custom)",
                  metrics: [
                    [
                      baseName,
                      "ActiveConnections",
                      "ServiceName",
                      `${baseName}-realtime`,
                      { label: "Active Connections" },
                    ],
                  ],
                  period: 60,
                  stat: "Average",
                },
              },

              // Row 5: Custom Realtime Performance Metrics
              {
                type: "text",
                x: 0,
                y: 28,
                width: 24,
                height: 1,
                properties: {
                  markdown: "# Realtime Performance (Custom Metrics)",
                },
              },
              {
                type: "metric",
                x: 0,
                y: 29,
                width: 8,
                height: 6,
                properties: {
                  title: "Event Loop Lag (ms)",
                  metrics: [
                    [baseName, "EventLoopLagMs", "ServiceName", `${baseName}-realtime`, { stat: "p50", label: "p50" }],
                    ["...", { stat: "p95", label: "p95" }],
                    ["...", { stat: "p99", label: "p99" }],
                  ],
                  period: 60,
                  annotations: {
                    horizontal: [
                      {
                        label: "Scale Threshold",
                        value: config.realtimeScaleOnEventLoopLagMs,
                        color: "#ff7f0e",
                      },
                    ],
                  },
                },
              },
              {
                type: "metric",
                x: 8,
                y: 29,
                width: 8,
                height: 6,
                properties: {
                  title: "Messages Per Second",
                  metrics: [[baseName, "MessagesPerSecond", "ServiceName", `${baseName}-realtime`]],
                  period: 60,
                  stat: "Average",
                },
              },
              {
                type: "metric",
                x: 16,
                y: 29,
                width: 8,
                height: 6,
                properties: {
                  title: "Heap Memory Usage (MB)",
                  metrics: [[baseName, "HeapUsedMb", "ServiceName", `${baseName}-realtime`]],
                  period: 60,
                  stat: "Average",
                },
              },
            ],
          });
        },
      ),
  });

  return {
    dashboard,
    apiHighCpuAlarm,
    realtimeHighCpuAlarm,
    workersHighCpuAlarm,
    rdsHighCpuAlarm,
    redisHighMemoryAlarm,
    alb5xxAlarm,
    snsAlertTopic,
    realtimeHighConnectionsAlarm,
    realtimeHighEventLoopLagAlarm,
    // Redis split mode alarms
    redisAdapterHighCpuAlarm,
    redisStateHighCpuAlarm,
    redisAdapterHighConnectionsAlarm,
    redisStateHighConnectionsAlarm,
    // Extended observability alarms
    rdsHighConnectionsAlarm,
    rdsLowMemoryAlarm,
    rdsHighReadLatencyAlarm,
    rdsHighWriteLatencyAlarm,
    rdsLowStorageAlarm,
    rdsReplicaLagAlarm,
    sqsPushDlqAlarm,
    sqsOfflineDlqAlarm,
    sqsOldMessageAlarm,
    realtimeUnhealthyTargetsAlarm,
    apiUnhealthyTargetsAlarm,
  };
}
