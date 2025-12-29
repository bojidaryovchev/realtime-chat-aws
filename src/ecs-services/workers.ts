import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";
import { EcsClusterOutputs } from "../ecs-cluster";
import { IamOutputs } from "../iam";
import { RdsOutputs } from "../rds";
import { RedisOutputs } from "../redis";
import { SecurityGroupOutputs } from "../security-groups";
import { SqsOutputs } from "../sqs";
import { VpcOutputs } from "../vpc";

export interface WorkersServiceOutputs {
  workersService: aws.ecs.Service;
  workersTaskDefinition: aws.ecs.TaskDefinition;
  workersLogGroup: aws.cloudwatch.LogGroup;
  workersAutoScaling: aws.appautoscaling.Target;
}

/**
 * Creates ECS Fargate Workers service for SQS queue processing:
 * - Consumes push notification queue
 * - Consumes offline message queue
 * - Auto-scales based on queue depth and message age
 * 
 * This separates background work from API/Realtime services
 * and provides proper DLQ handling and idempotency.
 */
export function createWorkersService(
  config: Config,
  vpcOutputs: VpcOutputs,
  securityGroupOutputs: SecurityGroupOutputs,
  ecsClusterOutputs: EcsClusterOutputs,
  iamOutputs: IamOutputs,
  rdsOutputs: RdsOutputs,
  redisOutputs: RedisOutputs,
  sqsOutputs: SqsOutputs
): WorkersServiceOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;
  const currentRegion = aws.getRegionOutput();

  // ==================== CloudWatch Log Group ====================

  const workersLogGroup = new aws.cloudwatch.LogGroup(`${baseName}-workers-logs`, {
    name: `/ecs/${baseName}/workers`,
    retentionInDays: config.environment === "prod" ? 30 : 7,
    tags: {
      ...tags,
      Name: `${baseName}-workers-logs`,
    },
  });

  // ==================== Workers Task Definition ====================

  // Runtime platform configuration (Graviton/ARM64 support)
  const runtimePlatform = config.enableGraviton
    ? {
        cpuArchitecture: "ARM64" as const,
        operatingSystemFamily: "LINUX" as const,
      }
    : {
        cpuArchitecture: "X86_64" as const,
        operatingSystemFamily: "LINUX" as const,
      };

  const workersTaskDefinition = new aws.ecs.TaskDefinition(
    `${baseName}-workers-task`,
    {
      family: `${baseName}-workers`,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: config.workerServiceCpu.toString(),
      memory: config.workerServiceMemory.toString(),
      executionRoleArn: iamOutputs.ecsTaskExecutionRole.arn,
      taskRoleArn: iamOutputs.ecsWorkersTaskRole.arn,
      runtimePlatform: runtimePlatform,
      containerDefinitions: pulumi
        .all([
          rdsOutputs.dbConnectionEndpoint,
          rdsOutputs.dbCredentialsSecret.arn,
          redisOutputs.stateEndpoint, // Workers use state cluster for caching/rate limiting
          redisOutputs.redisAuthSecret.arn,
          sqsOutputs.pushNotificationQueue.url,
          sqsOutputs.offlineMessageQueue.url,
          sqsOutputs.pushNotificationDlq.url,
          sqsOutputs.offlineMessageDlq.url,
          currentRegion.name,
          workersLogGroup.name,
        ])
        .apply(
          ([
            dbEndpoint,
            dbSecretArn,
            redisEndpoint,
            redisAuthSecretArn,
            pushQueueUrl,
            offlineQueueUrl,
            pushDlqUrl,
            offlineDlqUrl,
            region,
            logGroupName,
          ]) =>
            JSON.stringify([
              {
                name: "workers",
                // Use placeholder image - replace with your ECR image
                image: "node:20-alpine",
                command: ["sh", "-c", "echo 'Replace with your Workers image' && sleep infinity"],
                essential: true,
                // Port mapping for internal health checks (not exposed via ALB)
                portMappings: [
                  {
                    containerPort: 3002,
                    hostPort: 3002,
                    protocol: "tcp",
                  },
                ],
                environment: [
                  { name: "NODE_ENV", value: config.environment },
                  { name: "SERVICE_NAME", value: "workers" },
                  // Database
                  { name: "DATABASE_HOST", value: dbEndpoint.split(":")[0] },
                  { name: "DATABASE_PORT", value: "5432" },
                  { name: "DATABASE_NAME", value: "chatdb" },
                  // Redis (for caching/rate limiting)
                  { name: "REDIS_HOST", value: redisEndpoint },
                  { name: "REDIS_PORT", value: "6379" },
                  { name: "REDIS_TLS", value: "true" },
                  // SQS Queues
                  { name: "SQS_PUSH_QUEUE_URL", value: pushQueueUrl },
                  { name: "SQS_OFFLINE_QUEUE_URL", value: offlineQueueUrl },
                  { name: "SQS_PUSH_DLQ_URL", value: pushDlqUrl },
                  { name: "SQS_OFFLINE_DLQ_URL", value: offlineDlqUrl },
                  // Worker configuration
                  { name: "WORKER_POLL_INTERVAL_MS", value: "1000" },
                  { name: "WORKER_BATCH_SIZE", value: "10" },
                  { name: "WORKER_VISIBILITY_TIMEOUT", value: "60" },
                  // AWS
                  { name: "AWS_REGION", value: region },
                  { name: "LOG_LEVEL", value: config.environment === "prod" ? "info" : "debug" },
                  // Health check port (workers should expose a simple health endpoint)
                  { name: "HEALTH_PORT", value: "3002" },
                ],
                secrets: [
                  {
                    name: "DATABASE_USERNAME",
                    valueFrom: `${dbSecretArn}:username::`,
                  },
                  {
                    name: "DATABASE_PASSWORD",
                    valueFrom: `${dbSecretArn}:password::`,
                  },
                  {
                    name: "REDIS_PASSWORD",
                    valueFrom: redisAuthSecretArn,
                  },
                ],
                logConfiguration: {
                  logDriver: "awslogs",
                  options: {
                    "awslogs-group": logGroupName,
                    "awslogs-region": region,
                    "awslogs-stream-prefix": "workers",
                  },
                },
                // Health check - workers should expose HTTP health endpoint on HEALTH_PORT
                // The endpoint should verify connectivity to SQS, Redis, and database
                healthCheck: {
                  command: ["CMD-SHELL", "wget -q --spider http://localhost:3002/health || exit 1"],
                  interval: 30,
                  timeout: 5,
                  retries: 3,
                  startPeriod: 60,
                },
              },
            ])
        ),
      tags: {
        ...tags,
        Name: `${baseName}-workers-task`,
      },
    }
  );

  // ==================== Workers Service ====================

  const workersService = new aws.ecs.Service(`${baseName}-workers-service`, {
    name: `${baseName}-workers`,
    cluster: ecsClusterOutputs.cluster.arn,
    taskDefinition: workersTaskDefinition.arn,
    desiredCount: config.workerServiceDesiredCount,
    launchType: "FARGATE",
    platformVersion: "LATEST",

    networkConfiguration: {
      // Dev: public subnets with public IP (no NAT needed)
      // Prod: private subnets with NAT Gateway
      subnets: config.environment === "dev"
        ? vpcOutputs.publicSubnets.map((s) => s.id)
        : vpcOutputs.privateSubnets.map((s) => s.id),
      securityGroups: [securityGroupOutputs.ecsWorkersSecurityGroup.id],
      assignPublicIp: config.environment === "dev",
    },

    // No load balancer - workers don't receive HTTP traffic

    deploymentMaximumPercent: 200,
    deploymentMinimumHealthyPercent: 100,
    deploymentCircuitBreaker: {
      enable: true,
      rollback: true,
    },

    // Note: healthCheckGracePeriodSeconds is NOT set for workers because
    // it's only applicable to services with load balancers. ECS uses the
    // container health check directly for services without load balancers.

    enableExecuteCommand: true,

    propagateTags: "SERVICE",

    tags: {
      ...tags,
      Name: `${baseName}-workers-service`,
    },
  });

  // ==================== Auto Scaling ====================

  const workersAutoScaling = new aws.appautoscaling.Target(
    `${baseName}-workers-autoscaling`,
    {
      maxCapacity: config.environment === "prod" ? 10 : 3,
      minCapacity: config.workerServiceDesiredCount,
      resourceId: pulumi.interpolate`service/${ecsClusterOutputs.cluster.name}/${workersService.name}`,
      scalableDimension: "ecs:service:DesiredCount",
      serviceNamespace: "ecs",
      tags: {
        ...tags,
        Name: `${baseName}-workers-autoscaling`,
      },
    }
  );

  // Scale based on Push Queue depth
  new aws.appautoscaling.Policy(`${baseName}-workers-push-queue-scaling`, {
    name: `${baseName}-workers-push-queue-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: workersAutoScaling.resourceId,
    scalableDimension: workersAutoScaling.scalableDimension,
    serviceNamespace: workersAutoScaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      customizedMetricSpecification: {
        metricName: "ApproximateNumberOfMessagesVisible",
        namespace: "AWS/SQS",
        statistic: "Average",
        dimensions: [
          {
            name: "QueueName",
            value: sqsOutputs.pushNotificationQueue.name,
          },
        ],
      },
      targetValue: config.workerScaleOnQueueDepth,
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  // Scale based on Offline Queue depth
  new aws.appautoscaling.Policy(`${baseName}-workers-offline-queue-scaling`, {
    name: `${baseName}-workers-offline-queue-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: workersAutoScaling.resourceId,
    scalableDimension: workersAutoScaling.scalableDimension,
    serviceNamespace: workersAutoScaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      customizedMetricSpecification: {
        metricName: "ApproximateNumberOfMessagesVisible",
        namespace: "AWS/SQS",
        statistic: "Average",
        dimensions: [
          {
            name: "QueueName",
            value: sqsOutputs.offlineMessageQueue.name,
          },
        ],
      },
      targetValue: config.workerScaleOnQueueDepth,
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  // Step scaling based on oldest message age (for catching up on backlogs)
  const scaleOnMessageAge = new aws.appautoscaling.Policy(
    `${baseName}-workers-message-age-scaling`,
    {
      name: `${baseName}-workers-message-age-scaling`,
      policyType: "StepScaling",
      resourceId: workersAutoScaling.resourceId,
      scalableDimension: workersAutoScaling.scalableDimension,
      serviceNamespace: workersAutoScaling.serviceNamespace,
      stepScalingPolicyConfiguration: {
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        metricAggregationType: "Maximum",
        stepAdjustments: [
          {
            // 0 - threshold: no change
            metricIntervalLowerBound: "0",
            metricIntervalUpperBound: String(config.workerScaleOnOldestMessageAge),
            scalingAdjustment: 0,
          },
          {
            // threshold - 2x threshold: add 1 task
            metricIntervalLowerBound: String(config.workerScaleOnOldestMessageAge),
            metricIntervalUpperBound: String(config.workerScaleOnOldestMessageAge * 2),
            scalingAdjustment: 1,
          },
          {
            // > 2x threshold: add 2 tasks
            metricIntervalLowerBound: String(config.workerScaleOnOldestMessageAge * 2),
            scalingAdjustment: 2,
          },
        ],
      },
    }
  );

  // CloudWatch alarm to trigger step scaling on message age
  new aws.cloudwatch.MetricAlarm(`${baseName}-workers-message-age-alarm`, {
    name: `${baseName}-workers-message-age-alarm`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "ApproximateAgeOfOldestMessage",
    namespace: "AWS/SQS",
    period: 60,
    statistic: "Maximum",
    threshold: config.workerScaleOnOldestMessageAge, // Trigger when messages are older than threshold
    dimensions: {
      QueueName: sqsOutputs.pushNotificationQueue.name,
    },
    alarmActions: [scaleOnMessageAge.arn],
    tags: {
      ...tags,
      Name: `${baseName}-workers-message-age-alarm`,
    },
  });

  return {
    workersService,
    workersTaskDefinition,
    workersLogGroup,
    workersAutoScaling,
  };
}
