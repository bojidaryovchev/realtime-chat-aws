import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";
import { AlbOutputs } from "../alb";
import { EcsClusterOutputs } from "../ecs-cluster";
import { IamOutputs } from "../iam";
import { RdsOutputs } from "../rds";
import { RedisOutputs } from "../redis";
import { SecurityGroupOutputs } from "../security-groups";
import { SqsOutputs } from "../sqs";
import { VpcOutputs } from "../vpc";

export interface EcsServicesOutputs {
  apiService: aws.ecs.Service;
  apiTaskDefinition: aws.ecs.TaskDefinition;
  realtimeService: aws.ecs.Service;
  realtimeTaskDefinition: aws.ecs.TaskDefinition;
  apiLogGroup: aws.cloudwatch.LogGroup;
  realtimeLogGroup: aws.cloudwatch.LogGroup;
  apiAutoScaling: aws.appautoscaling.Target;
  realtimeAutoScaling: aws.appautoscaling.Target;
}

/**
 * Creates ECS Fargate services:
 * - API service (Fastify REST/GraphQL)
 * - Realtime service (Fastify + Socket.IO)
 * 
 * Both services include:
 * - Task definitions with container definitions
 * - Service auto-scaling
 * - CloudWatch log groups
 * - Environment variables from secrets
 */
export function createEcsServices(
  config: Config,
  vpcOutputs: VpcOutputs,
  securityGroupOutputs: SecurityGroupOutputs,
  ecsClusterOutputs: EcsClusterOutputs,
  albOutputs: AlbOutputs,
  iamOutputs: IamOutputs,
  rdsOutputs: RdsOutputs,
  redisOutputs: RedisOutputs,
  sqsOutputs: SqsOutputs
): EcsServicesOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;
  const currentRegion = aws.getRegionOutput();

  // ==================== CloudWatch Log Groups ====================
  
  const apiLogGroup = new aws.cloudwatch.LogGroup(`${baseName}-api-logs`, {
    name: `/ecs/${baseName}/api`,
    retentionInDays: config.environment === "prod" ? 30 : 7,
    tags: {
      ...tags,
      Name: `${baseName}-api-logs`,
    },
  });

  const realtimeLogGroup = new aws.cloudwatch.LogGroup(
    `${baseName}-realtime-logs`,
    {
      name: `/ecs/${baseName}/realtime`,
      retentionInDays: config.environment === "prod" ? 30 : 7,
      tags: {
        ...tags,
        Name: `${baseName}-realtime-logs`,
      },
    }
  );

  // ==================== API Service ====================

  // API Task Definition
  const apiTaskDefinition = new aws.ecs.TaskDefinition(
    `${baseName}-api-task`,
    {
      family: `${baseName}-api`,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: config.apiServiceCpu.toString(),
      memory: config.apiServiceMemory.toString(),
      executionRoleArn: iamOutputs.ecsTaskExecutionRole.arn,
      taskRoleArn: iamOutputs.ecsApiTaskRole.arn,
      containerDefinitions: pulumi
        .all([
          rdsOutputs.dbInstance.endpoint,
          rdsOutputs.dbCredentialsSecret.arn,
          redisOutputs.redisCluster.primaryEndpointAddress,
          sqsOutputs.pushNotificationQueue.url,
          sqsOutputs.offlineMessageQueue.url,
          currentRegion.name,
          apiLogGroup.name,
        ])
        .apply(
          ([
            dbEndpoint,
            dbSecretArn,
            redisEndpoint,
            pushQueueUrl,
            offlineQueueUrl,
            region,
            logGroupName,
          ]) =>
            JSON.stringify([
              {
                name: "api",
                // Use placeholder image - replace with your ECR image
                image: "node:20-alpine",
                command: ["sh", "-c", "echo 'Replace with your API image' && sleep infinity"],
                essential: true,
                portMappings: [
                  {
                    containerPort: 3000,
                    hostPort: 3000,
                    protocol: "tcp",
                  },
                ],
                environment: [
                  { name: "NODE_ENV", value: config.environment },
                  { name: "PORT", value: "3000" },
                  { name: "DATABASE_HOST", value: dbEndpoint.split(":")[0] },
                  { name: "DATABASE_PORT", value: "5432" },
                  { name: "DATABASE_NAME", value: "chatdb" },
                  { name: "REDIS_HOST", value: redisEndpoint },
                  { name: "REDIS_PORT", value: "6379" },
                  { name: "REDIS_TLS", value: "true" },
                  { name: "SQS_PUSH_QUEUE_URL", value: pushQueueUrl },
                  { name: "SQS_OFFLINE_QUEUE_URL", value: offlineQueueUrl },
                  { name: "AWS_REGION", value: region },
                  { name: "LOG_LEVEL", value: config.environment === "prod" ? "info" : "debug" },
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
                ],
                logConfiguration: {
                  logDriver: "awslogs",
                  options: {
                    "awslogs-group": logGroupName,
                    "awslogs-region": region,
                    "awslogs-stream-prefix": "api",
                  },
                },
                healthCheck: {
                  command: ["CMD-SHELL", "wget -q --spider http://localhost:3000/health || exit 1"],
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
        Name: `${baseName}-api-task`,
      },
    }
  );

  // API Service
  const apiService = new aws.ecs.Service(`${baseName}-api-service`, {
    name: `${baseName}-api`,
    cluster: ecsClusterOutputs.cluster.arn,
    taskDefinition: apiTaskDefinition.arn,
    desiredCount: config.apiServiceDesiredCount,
    launchType: "FARGATE",
    platformVersion: "LATEST",

    networkConfiguration: {
      subnets: vpcOutputs.privateSubnets.map((s) => s.id),
      securityGroups: [securityGroupOutputs.ecsApiSecurityGroup.id],
      assignPublicIp: false,
    },

    loadBalancers: [
      {
        targetGroupArn: albOutputs.apiTargetGroup.arn,
        containerName: "api",
        containerPort: 3000,
      },
    ],

    deploymentMaximumPercent: 200,
    deploymentMinimumHealthyPercent: 100,
    deploymentCircuitBreaker: {
      enable: true,
      rollback: true,
    },

    // Enable service discovery for internal communication
    enableExecuteCommand: true,

    propagateTags: "SERVICE",

    tags: {
      ...tags,
      Name: `${baseName}-api-service`,
    },
  }, { dependsOn: [albOutputs.httpsListener] });

  // ==================== Realtime Service ====================

  // Realtime Task Definition
  const realtimeTaskDefinition = new aws.ecs.TaskDefinition(
    `${baseName}-realtime-task`,
    {
      family: `${baseName}-realtime`,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: config.realtimeServiceCpu.toString(),
      memory: config.realtimeServiceMemory.toString(),
      executionRoleArn: iamOutputs.ecsTaskExecutionRole.arn,
      taskRoleArn: iamOutputs.ecsRealtimeTaskRole.arn,
      containerDefinitions: pulumi
        .all([
          rdsOutputs.dbInstance.endpoint,
          rdsOutputs.dbCredentialsSecret.arn,
          redisOutputs.redisCluster.primaryEndpointAddress,
          sqsOutputs.pushNotificationQueue.url,
          sqsOutputs.offlineMessageQueue.url,
          currentRegion.name,
          realtimeLogGroup.name,
        ])
        .apply(
          ([
            dbEndpoint,
            dbSecretArn,
            redisEndpoint,
            pushQueueUrl,
            offlineQueueUrl,
            region,
            logGroupName,
          ]) =>
            JSON.stringify([
              {
                name: "realtime",
                // Use placeholder image - replace with your ECR image
                image: "node:20-alpine",
                command: ["sh", "-c", "echo 'Replace with your Realtime image' && sleep infinity"],
                essential: true,
                portMappings: [
                  {
                    containerPort: 3001,
                    hostPort: 3001,
                    protocol: "tcp",
                  },
                ],
                environment: [
                  { name: "NODE_ENV", value: config.environment },
                  { name: "PORT", value: "3001" },
                  { name: "DATABASE_HOST", value: dbEndpoint.split(":")[0] },
                  { name: "DATABASE_PORT", value: "5432" },
                  { name: "DATABASE_NAME", value: "chatdb" },
                  { name: "REDIS_HOST", value: redisEndpoint },
                  { name: "REDIS_PORT", value: "6379" },
                  { name: "REDIS_TLS", value: "true" },
                  { name: "SQS_PUSH_QUEUE_URL", value: pushQueueUrl },
                  { name: "SQS_OFFLINE_QUEUE_URL", value: offlineQueueUrl },
                  { name: "AWS_REGION", value: region },
                  { name: "LOG_LEVEL", value: config.environment === "prod" ? "info" : "debug" },
                  // Socket.IO specific
                  { name: "SOCKET_IO_ADAPTER", value: "redis" },
                  { name: "SOCKET_IO_PING_TIMEOUT", value: "30000" },
                  { name: "SOCKET_IO_PING_INTERVAL", value: "25000" },
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
                ],
                logConfiguration: {
                  logDriver: "awslogs",
                  options: {
                    "awslogs-group": logGroupName,
                    "awslogs-region": region,
                    "awslogs-stream-prefix": "realtime",
                  },
                },
                healthCheck: {
                  command: ["CMD-SHELL", "wget -q --spider http://localhost:3001/health || exit 1"],
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
        Name: `${baseName}-realtime-task`,
      },
    }
  );

  // Realtime Service
  const realtimeService = new aws.ecs.Service(
    `${baseName}-realtime-service`,
    {
      name: `${baseName}-realtime`,
      cluster: ecsClusterOutputs.cluster.arn,
      taskDefinition: realtimeTaskDefinition.arn,
      desiredCount: config.realtimeServiceDesiredCount,
      launchType: "FARGATE",
      platformVersion: "LATEST",

      networkConfiguration: {
        subnets: vpcOutputs.privateSubnets.map((s) => s.id),
        securityGroups: [securityGroupOutputs.ecsRealtimeSecurityGroup.id],
        assignPublicIp: false,
      },

      loadBalancers: [
        {
          targetGroupArn: albOutputs.realtimeTargetGroup.arn,
          containerName: "realtime",
          containerPort: 3001,
        },
      ],

      deploymentMaximumPercent: 200,
      deploymentMinimumHealthyPercent: 100,
      deploymentCircuitBreaker: {
        enable: true,
        rollback: true,
      },

      enableExecuteCommand: true,

      propagateTags: "SERVICE",

      tags: {
        ...tags,
        Name: `${baseName}-realtime-service`,
      },
    },
    { dependsOn: [albOutputs.httpsListener] }
  );

  // ==================== Auto Scaling ====================

  // API Auto Scaling Target
  const apiAutoScaling = new aws.appautoscaling.Target(
    `${baseName}-api-autoscaling`,
    {
      maxCapacity: config.environment === "prod" ? 20 : 4,
      minCapacity: config.apiServiceDesiredCount,
      resourceId: pulumi.interpolate`service/${ecsClusterOutputs.cluster.name}/${apiService.name}`,
      scalableDimension: "ecs:service:DesiredCount",
      serviceNamespace: "ecs",
      tags: {
        ...tags,
        Name: `${baseName}-api-autoscaling`,
      },
    }
  );

  // API CPU Scaling Policy
  new aws.appautoscaling.Policy(`${baseName}-api-cpu-scaling`, {
    name: `${baseName}-api-cpu-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: apiAutoScaling.resourceId,
    scalableDimension: apiAutoScaling.scalableDimension,
    serviceNamespace: apiAutoScaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      predefinedMetricSpecification: {
        predefinedMetricType: "ECSServiceAverageCPUUtilization",
      },
      targetValue: 70,
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  // API Request Count Scaling Policy
  new aws.appautoscaling.Policy(`${baseName}-api-request-scaling`, {
    name: `${baseName}-api-request-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: apiAutoScaling.resourceId,
    scalableDimension: apiAutoScaling.scalableDimension,
    serviceNamespace: apiAutoScaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      predefinedMetricSpecification: {
        predefinedMetricType: "ALBRequestCountPerTarget",
        resourceLabel: pulumi.interpolate`${albOutputs.alb.arnSuffix}/${albOutputs.apiTargetGroup.arnSuffix}`,
      },
      targetValue: 1000, // Requests per target
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  // Realtime Auto Scaling Target
  const realtimeAutoScaling = new aws.appautoscaling.Target(
    `${baseName}-realtime-autoscaling`,
    {
      maxCapacity: config.environment === "prod" ? 30 : 6,
      minCapacity: config.realtimeServiceDesiredCount,
      resourceId: pulumi.interpolate`service/${ecsClusterOutputs.cluster.name}/${realtimeService.name}`,
      scalableDimension: "ecs:service:DesiredCount",
      serviceNamespace: "ecs",
      tags: {
        ...tags,
        Name: `${baseName}-realtime-autoscaling`,
      },
    }
  );

  // Realtime CPU Scaling Policy
  new aws.appautoscaling.Policy(`${baseName}-realtime-cpu-scaling`, {
    name: `${baseName}-realtime-cpu-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: realtimeAutoScaling.resourceId,
    scalableDimension: realtimeAutoScaling.scalableDimension,
    serviceNamespace: realtimeAutoScaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      predefinedMetricSpecification: {
        predefinedMetricType: "ECSServiceAverageCPUUtilization",
      },
      targetValue: 60, // Lower threshold for realtime - connections are CPU intensive
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  // Realtime Memory Scaling Policy
  new aws.appautoscaling.Policy(`${baseName}-realtime-memory-scaling`, {
    name: `${baseName}-realtime-memory-scaling`,
    policyType: "TargetTrackingScaling",
    resourceId: realtimeAutoScaling.resourceId,
    scalableDimension: realtimeAutoScaling.scalableDimension,
    serviceNamespace: realtimeAutoScaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      predefinedMetricSpecification: {
        predefinedMetricType: "ECSServiceAverageMemoryUtilization",
      },
      targetValue: 70, // Socket connections consume memory
      scaleInCooldown: 300,
      scaleOutCooldown: 60,
    },
  });

  return {
    apiService,
    apiTaskDefinition,
    realtimeService,
    realtimeTaskDefinition,
    apiLogGroup,
    realtimeLogGroup,
    apiAutoScaling,
    realtimeAutoScaling,
  };
}
