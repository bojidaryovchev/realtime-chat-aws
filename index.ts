import * as pulumi from "@pulumi/pulumi";
import { loadConfig, validateConfig } from "./config";
import { createAcm } from "./src/acm";
import { createAlb } from "./src/alb";
import { createBackup } from "./src/backup";
import { createEcrRepositories } from "./src/ecr";
import { createEcsCluster } from "./src/ecs-cluster";
import { createEcsServices } from "./src/ecs-services";
import { createWorkersService } from "./src/ecs-services/workers";
import { createIamRoles } from "./src/iam";
import { createObservability } from "./src/observability";
import { createRds } from "./src/rds";
import { createRedis } from "./src/redis";
import { createRoute53 } from "./src/route53";
import { createSecurityGroups } from "./src/security-groups";
import { createSqsQueues } from "./src/sqs";
import { createVpc } from "./src/vpc";
import { createWaf } from "./src/waf";

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

// Load and validate configuration
const config = loadConfig();
validateConfig(config);

// ==================== VPC ====================
const vpcOutputs = createVpc(config);

// ==================== Security Groups = ===================
const securityGroupOutputs = createSecurityGroups(config, vpcOutputs);

// ==================== ACM Certificate (create BEFORE ALB) ====================
// Create ACM certificate first so it can be attached to the ALB HTTPS listener
// Only created when both domainName and hostedZoneId are provided
let acmOutputs: ReturnType<typeof createAcm> | undefined;

const dnsEnabled = config.domainName && config.hostedZoneId;

if (dnsEnabled) {
  acmOutputs = createAcm(config);
}

// ==================== ALB ====================
const albOutputs = createAlb(config, vpcOutputs, securityGroupOutputs, acmOutputs);

// ==================== Route 53 DNS Records (create AFTER ALB) ====================
if (dnsEnabled) {
  createRoute53(config, albOutputs);
}

// ==================== WAF (Optional - prod only) ====================
const wafOutputs = createWaf(config, albOutputs);

// ==================== ECS Cluster ====================
const ecsClusterOutputs = createEcsCluster(config);

// ==================== ECR Repositories ====================
const ecrOutputs = createEcrRepositories(config);

// ==================== RDS PostgreSQL ====================
const rdsOutputs = createRds(config, vpcOutputs, securityGroupOutputs);

// ==================== AWS Backup ====================
const backupOutputs = createBackup(config, rdsOutputs);

// ==================== ElastiCache Redis ====================
const redisOutputs = createRedis(config, vpcOutputs, securityGroupOutputs);

// ==================== SQS Queues ====================
const sqsOutputs = createSqsQueues(config);

// ==================== IAM Roles ====================
const iamOutputs = createIamRoles(config, sqsOutputs, rdsOutputs, redisOutputs);

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

// ==================== ECS Workers Service ====================
// Workers service consumes SQS queues for push notifications and offline messages.
const workersServiceOutputs = createWorkersService(
  config,
  vpcOutputs,
  securityGroupOutputs,
  ecsClusterOutputs,
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
  workersServiceOutputs,
  rdsOutputs,
  redisOutputs,
  albOutputs,
  sqsOutputs
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
export const workersServiceName = workersServiceOutputs.workersService.name;

// ECR Outputs
export const apiRepositoryUrl = ecrOutputs.apiRepository.repositoryUrl;
export const realtimeRepositoryUrl = ecrOutputs.realtimeRepository.repositoryUrl;
export const workersRepositoryUrl = ecrOutputs.workersRepository.repositoryUrl;

// RDS Outputs
export const rdsEndpoint = rdsOutputs.dbInstance.endpoint;
export const rdsPort = rdsOutputs.dbInstance.port;
export const rdsSecretArn = rdsOutputs.dbCredentialsSecret.arn;
export const rdsProxyEndpoint = rdsOutputs.rdsProxyEndpoint;
export const dbConnectionEndpoint = rdsOutputs.dbConnectionEndpoint;
// RDS Read Replica (when enabled)
export const rdsReadReplicaEndpoint = rdsOutputs.dbReadReplicaEndpoint;

// Redis Outputs
export const redisEndpoint = redisOutputs.redisCluster.primaryEndpointAddress;
export const redisPort = redisOutputs.redisCluster.port;
// Redis split mode (when enabled, these are separate clusters)
export const redisAdapterEndpoint = redisOutputs.adapterEndpoint;
export const redisStateEndpoint = redisOutputs.stateEndpoint;
// Redis AUTH secret for application configuration
export const redisAuthSecretArn = redisOutputs.redisAuthSecret.arn;

// SQS Outputs
export const pushNotificationQueueUrl = sqsOutputs.pushNotificationQueue.url;
export const pushNotificationQueueArn = sqsOutputs.pushNotificationQueue.arn;
export const offlineMessageQueueUrl = sqsOutputs.offlineMessageQueue.url;
export const offlineMessageQueueArn = sqsOutputs.offlineMessageQueue.arn;

// Observability Outputs
export const dashboardName = observabilityOutputs.dashboard.dashboardName;
export const alertTopicArn = observabilityOutputs.snsAlertTopic.arn;

// WAF Outputs (if enabled)
export const wafWebAclArn = wafOutputs.webAcl?.arn;
export const wafEnabled = config.enableWaf;

// Backup Outputs
export const backupVaultName = backupOutputs.backupVault.name;
export const backupVaultArn = backupOutputs.backupVault.arn;
export const backupPlanArn = backupOutputs.backupPlan.arn;

// Connection URLs (for application config)
// Web (Vercel) and Mobile (Expo) connect to api.domain.com
export const apiUrl = pulumi.interpolate`https://api.${config.domainName}/api`;
export const socketUrl = pulumi.interpolate`https://api.${config.domainName}`;
// Fallback to ALB DNS if no domain configured
export const apiUrlDirect = pulumi.interpolate`https://${albOutputs.alb.dnsName}/api`;
export const socketUrlDirect = pulumi.interpolate`https://${albOutputs.alb.dnsName}`;

// DNS Outputs (if enabled)
export const domainName = config.domainName;
export const hostedZoneId = config.hostedZoneId;
export const certificateArn = acmOutputs?.certificate.arn;
