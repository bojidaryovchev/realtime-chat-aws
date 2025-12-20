import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";
import { AlbOutputs } from "../alb";
import { EcsClusterOutputs } from "../ecs-cluster";
import { EcsServicesOutputs } from "../ecs-services";
import { RdsOutputs } from "../rds";
import { RedisOutputs } from "../redis";

export interface ObservabilityOutputs {
  dashboard: aws.cloudwatch.Dashboard;
  apiHighCpuAlarm: aws.cloudwatch.MetricAlarm;
  realtimeHighCpuAlarm: aws.cloudwatch.MetricAlarm;
  rdsHighCpuAlarm: aws.cloudwatch.MetricAlarm;
  redisHighMemoryAlarm: aws.cloudwatch.MetricAlarm;
  alb5xxAlarm: aws.cloudwatch.MetricAlarm;
  snsAlertTopic: aws.sns.Topic;
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
  rdsOutputs: RdsOutputs,
  redisOutputs: RedisOutputs,
  albOutputs: AlbOutputs
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
  const apiHighCpuAlarm = new aws.cloudwatch.MetricAlarm(
    `${baseName}-api-high-cpu`,
    {
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
    }
  );

  // Realtime Service High CPU Alarm
  const realtimeHighCpuAlarm = new aws.cloudwatch.MetricAlarm(
    `${baseName}-realtime-high-cpu`,
    {
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
    }
  );

  // RDS High CPU Alarm
  const rdsHighCpuAlarm = new aws.cloudwatch.MetricAlarm(
    `${baseName}-rds-high-cpu`,
    {
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
    }
  );

  // Redis High Memory Alarm
  const redisHighMemoryAlarm = new aws.cloudwatch.MetricAlarm(
    `${baseName}-redis-high-memory`,
    {
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
    }
  );

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

  // ==================== CloudWatch Dashboard ====================

  const dashboard = new aws.cloudwatch.Dashboard(`${baseName}-dashboard`, {
    dashboardName: `${baseName}-dashboard`,
    dashboardBody: pulumi
      .all([
        ecsClusterOutputs.cluster.name,
        ecsServicesOutputs.apiService.name,
        ecsServicesOutputs.realtimeService.name,
        rdsOutputs.dbInstance.identifier,
        redisOutputs.redisCluster.id,
        albOutputs.alb.arnSuffix,
      ])
      .apply(
        ([
          clusterName,
          apiServiceName,
          realtimeServiceName,
          rdsIdentifier,
          redisId,
          albArnSuffix,
        ]) =>
          JSON.stringify({
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
                width: 8,
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
                    [
                      ".",
                      "MemoryUtilization",
                      ".",
                      ".",
                      ".",
                      ".",
                      { label: "Memory" },
                    ],
                  ],
                  period: 60,
                  stat: "Average",
                  region: "${AWS::Region}",
                },
              },
              {
                type: "metric",
                x: 8,
                y: 1,
                width: 8,
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
                    [
                      ".",
                      "MemoryUtilization",
                      ".",
                      ".",
                      ".",
                      ".",
                      { label: "Memory" },
                    ],
                  ],
                  period: 60,
                  stat: "Average",
                  region: "${AWS::Region}",
                },
              },
              {
                type: "metric",
                x: 16,
                y: 1,
                width: 8,
                height: 6,
                properties: {
                  title: "ECS Running Task Count",
                  metrics: [
                    [
                      "ECS/ContainerInsights",
                      "RunningTaskCount",
                      "ClusterName",
                      clusterName,
                      "ServiceName",
                      apiServiceName,
                      { label: "API Tasks" },
                    ],
                    [
                      ".",
                      ".",
                      ".",
                      ".",
                      ".",
                      realtimeServiceName,
                      { label: "Realtime Tasks" },
                    ],
                  ],
                  period: 60,
                  stat: "Average",
                  region: "${AWS::Region}",
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
                  metrics: [
                    [
                      "AWS/ApplicationELB",
                      "RequestCount",
                      "LoadBalancer",
                      albArnSuffix,
                    ],
                  ],
                  period: 60,
                  stat: "Sum",
                  region: "${AWS::Region}",
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
                  region: "${AWS::Region}",
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
                    [
                      "AWS/ApplicationELB",
                      "HTTPCode_ELB_4XX_Count",
                      "LoadBalancer",
                      albArnSuffix,
                      { label: "4xx" },
                    ],
                    [
                      ".",
                      "HTTPCode_ELB_5XX_Count",
                      ".",
                      ".",
                      { label: "5xx" },
                    ],
                  ],
                  period: 60,
                  stat: "Sum",
                  region: "${AWS::Region}",
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
                    [
                      "AWS/RDS",
                      "CPUUtilization",
                      "DBInstanceIdentifier",
                      rdsIdentifier,
                      { label: "CPU %" },
                    ],
                    [
                      ".",
                      "DatabaseConnections",
                      ".",
                      ".",
                      { label: "Connections", yAxis: "right" },
                    ],
                  ],
                  period: 60,
                  stat: "Average",
                  region: "${AWS::Region}",
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
                    [
                      "AWS/RDS",
                      "ReadIOPS",
                      "DBInstanceIdentifier",
                      rdsIdentifier,
                      { label: "Read IOPS" },
                    ],
                    [".", "WriteIOPS", ".", ".", { label: "Write IOPS" }],
                  ],
                  period: 60,
                  stat: "Average",
                  region: "${AWS::Region}",
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
                    [
                      ".",
                      "EngineCPUUtilization",
                      ".",
                      ".",
                      { label: "CPU %" },
                    ],
                  ],
                  period: 60,
                  stat: "Average",
                  region: "${AWS::Region}",
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
                width: 12,
                height: 6,
                properties: {
                  title: "Active TCP Connections",
                  metrics: [
                    [
                      "AWS/ApplicationELB",
                      "ActiveConnectionCount",
                      "LoadBalancer",
                      albArnSuffix,
                    ],
                  ],
                  period: 60,
                  stat: "Sum",
                  region: "${AWS::Region}",
                },
              },
              {
                type: "metric",
                x: 12,
                y: 22,
                width: 12,
                height: 6,
                properties: {
                  title: "New TCP Connections",
                  metrics: [
                    [
                      "AWS/ApplicationELB",
                      "NewConnectionCount",
                      "LoadBalancer",
                      albArnSuffix,
                    ],
                  ],
                  period: 60,
                  stat: "Sum",
                  region: "${AWS::Region}",
                },
              },
            ],
          })
      ),
  });

  return {
    dashboard,
    apiHighCpuAlarm,
    realtimeHighCpuAlarm,
    rdsHighCpuAlarm,
    redisHighMemoryAlarm,
    alb5xxAlarm,
    snsAlertTopic,
  };
}
