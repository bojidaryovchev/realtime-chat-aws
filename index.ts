import * as pulumi from "@pulumi/pulumi";
import { getTags, loadConfig } from "./config";
import { createAlb } from "./src/alb";
import { createEcrRepositories } from "./src/ecr";
import { createEcsCluster } from "./src/ecs-cluster";
import { createEcsServices } from "./src/ecs-services";
import { createIamRoles } from "./src/iam";
import { createObservability } from "./src/observability";
import { createRds } from "./src/rds";
import { createRedis } from "./src/redis";
import { createSecurityGroups } from "./src/security-groups";
import { createSqsQueues } from "./src/sqs";
import { createVpc } from "./src/vpc";

/**
 * Main Pulumi program for Realtime Chat Infrastructure
 * 
 * Architecture Overview:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                           Internet                              │
 * └─────────────────────────────────────────────────────────────────┘
 *                                  │
 *                                  ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    Application Load Balancer                    │
 * │                    (HTTPS, Path Routing)                        │
 * │               /api/* → API    /socket.io/* → Realtime           │
 * └─────────────────────────────────────────────────────────────────┘
 *                     │                          │
 *         ┌──────────────────────┐    ┌──────────────────────┐
 *         │   Public Subnets    │    │   Public Subnets     │
 *         │        (ALB)         │    │   (NAT Gateway)      │
 *         └──────────────────────┘    └──────────────────────┘
 *                     │                          │
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                       Private Subnets                           │
 * │  ┌─────────────┐  ┌─────────────────┐  ┌─────────┐  ┌─────────┐│
 * │  │ ECS Fargate │  │  ECS Fargate    │  │   RDS   │  │  Redis  ││
 * │  │    API      │  │   Realtime      │  │Postgres │  │Cluster  ││
 * │  │  (Fastify)  │  │(Fastify+Socket) │  │Multi-AZ │  │         ││
 * │  └─────────────┘  └─────────────────┘  └─────────┘  └─────────┘│
 * │                            │                    ▲        ▲     │
 * │                            │                    │        │     │
 * │                            └────────────────────┴────────┘     │
 * │                                 (Redis Adapter)                │
 * └─────────────────────────────────────────────────────────────────┘
 *                     │
 *         ┌──────────────────────┐
 *         │         SQS          │
 *         │  Push Notifications  │
 *         │  Offline Messages    │
 *         └──────────────────────┘
 */

// Load configuration
const config = loadConfig();
const tags = getTags(config);

// ==================== VPC ====================
const vpcOutputs = createVpc(config);

// ==================== Security Groups ====================
const securityGroupOutputs = createSecurityGroups(config, vpcOutputs);

// ==================== ALB ====================
const albOutputs = createAlb(config, vpcOutputs, securityGroupOutputs);

// ==================== ECS Cluster ====================
const ecsClusterOutputs = createEcsCluster(config);

// ==================== ECR Repositories ====================
const ecrOutputs = createEcrRepositories(config);

// ==================== RDS PostgreSQL ====================
const rdsOutputs = createRds(config, vpcOutputs, securityGroupOutputs);

// ==================== ElastiCache Redis ====================
const redisOutputs = createRedis(config, vpcOutputs, securityGroupOutputs);

// ==================== SQS Queues ====================
const sqsOutputs = createSqsQueues(config);

// ==================== IAM Roles ====================
const iamOutputs = createIamRoles(config, sqsOutputs, rdsOutputs);

// ==================== ECS Services ====================
const ecsServicesOutputs = createEcsServices(
  config,
  vpcOutputs,
  securityGroupOutputs,
  ecsClusterOutputs,
  albOutputs,
  iamOutputs,
  rdsOutputs,
  redisOutputs,
  sqsOutputs
);

// ==================== Observability ====================
const observabilityOutputs = createObservability(
  config,
  ecsClusterOutputs,
  ecsServicesOutputs,
  rdsOutputs,
  redisOutputs,
  albOutputs
);

// ==================== Stack Outputs ====================

// VPC Outputs
export const vpcId = vpcOutputs.vpc.id;
export const publicSubnetIds = vpcOutputs.publicSubnets.map((s) => s.id);
export const privateSubnetIds = vpcOutputs.privateSubnets.map((s) => s.id);

// ALB Outputs
export const albDnsName = albOutputs.alb.dnsName;
export const albZoneId = albOutputs.alb.zoneId;
export const albArn = albOutputs.alb.arn;

// ECS Outputs
export const ecsClusterName = ecsClusterOutputs.cluster.name;
export const ecsClusterArn = ecsClusterOutputs.cluster.arn;
export const apiServiceName = ecsServicesOutputs.apiService.name;
export const realtimeServiceName = ecsServicesOutputs.realtimeService.name;

// ECR Outputs
export const apiRepositoryUrl = ecrOutputs.apiRepository.repositoryUrl;
export const realtimeRepositoryUrl = ecrOutputs.realtimeRepository.repositoryUrl;

// RDS Outputs
export const rdsEndpoint = rdsOutputs.dbInstance.endpoint;
export const rdsPort = rdsOutputs.dbInstance.port;
export const rdsSecretArn = rdsOutputs.dbCredentialsSecret.arn;

// Redis Outputs
export const redisEndpoint = redisOutputs.redisCluster.primaryEndpointAddress;
export const redisPort = redisOutputs.redisCluster.port;

// SQS Outputs
export const pushNotificationQueueUrl = sqsOutputs.pushNotificationQueue.url;
export const pushNotificationQueueArn = sqsOutputs.pushNotificationQueue.arn;
export const offlineMessageQueueUrl = sqsOutputs.offlineMessageQueue.url;
export const offlineMessageQueueArn = sqsOutputs.offlineMessageQueue.arn;

// Observability Outputs
export const dashboardName = observabilityOutputs.dashboard.dashboardName;
export const alertTopicArn = observabilityOutputs.snsAlertTopic.arn;

// Connection URLs (for application config)
export const apiUrl = pulumi.interpolate`https://${albOutputs.alb.dnsName}/api`;
export const socketUrl = pulumi.interpolate`https://${albOutputs.alb.dnsName}`;
