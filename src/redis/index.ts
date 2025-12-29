import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { Config, getTags } from "../../config";
import { SecurityGroupOutputs } from "../security-groups";
import { VpcOutputs } from "../vpc";

export interface RedisOutputs {
  // Primary cluster (used in both single and split mode)
  redisCluster: aws.elasticache.ReplicationGroup;
  redisSubnetGroup: aws.elasticache.SubnetGroup;
  redisParameterGroup: aws.elasticache.ParameterGroup;
  // Split mode clusters (optional)
  redisAdapterCluster?: aws.elasticache.ReplicationGroup;
  redisStateCluster?: aws.elasticache.ReplicationGroup;
  // Endpoints for application use
  adapterEndpoint: pulumi.Output<string>;
  stateEndpoint: pulumi.Output<string>;
  // AUTH token for Redis authentication
  redisAuthSecret: aws.secretsmanager.Secret;
}

/**
 * Creates ElastiCache Redis cluster(s) with:
 * - Single cluster mode: One cluster for all workloads (dev)
 * - Split cluster mode: Separate clusters for Socket.IO adapter and state (prod)
 * - Replication group for high availability
 * - Subnet group in private subnets
 * - Parameter group optimized for Socket.IO pub/sub
 * - Encryption in transit and at rest
 */
export function createRedis(
  config: Config,
  vpcOutputs: VpcOutputs,
  securityGroupOutputs: SecurityGroupOutputs,
): RedisOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // ==================== Redis AUTH Token ====================
  // Generate a random AUTH token for Redis authentication (defense-in-depth)
  // This adds authentication on top of security group rules
  const redisAuthToken = new random.RandomPassword(`${baseName}-redis-auth-token`, {
    length: 32,
    special: false, // ElastiCache AUTH tokens can only contain printable ASCII chars, no special chars for simplicity
  });

  // Store AUTH token in Secrets Manager for ECS tasks to retrieve
  const redisAuthSecret = new aws.secretsmanager.Secret(`${baseName}-redis-auth`, {
    name: `${baseName}/redis-auth`,
    description: "Redis AUTH token for ElastiCache authentication",
    tags: {
      ...tags,
      Name: `${baseName}-redis-auth`,
    },
  });

  new aws.secretsmanager.SecretVersion(`${baseName}-redis-auth-version`, {
    secretId: redisAuthSecret.id,
    secretString: redisAuthToken.result,
  });

  // Create Redis Subnet Group (shared by all clusters)
  const redisSubnetGroup = new aws.elasticache.SubnetGroup(`${baseName}-redis-subnet-group`, {
    name: `${baseName}-redis-subnet-group`,
    subnetIds: vpcOutputs.privateSubnets.map((subnet) => subnet.id),
    description: "Subnet group for ElastiCache Redis",
    tags: {
      ...tags,
      Name: `${baseName}-redis-subnet-group`,
    },
  });

  // Create Parameter Group optimized for Socket.IO (shared settings)
  const redisParameterGroup = new aws.elasticache.ParameterGroup(`${baseName}-redis-param-group`, {
    family: "redis7",
    name: `${baseName}-redis-param-group`,
    description: "Parameter group optimized for Socket.IO pub/sub",
    parameters: [
      // Memory management
      {
        name: "maxmemory-policy",
        value: "volatile-lru", // Evict keys with TTL using LRU
      },
      // Pub/Sub optimization
      {
        name: "notify-keyspace-events",
        value: "Ex", // Enable expired events for presence
      },
      // Timeout settings
      {
        name: "timeout",
        value: "0", // No timeout - keep connections alive
      },
      // TCP keepalive
      {
        name: "tcp-keepalive",
        value: "300", // 5 minutes
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-redis-param-group`,
    },
  });

  // ==================== Split Mode (Production) ====================
  if (config.enableRedisSplit) {
    // Adapter Cluster - High throughput pub/sub for Socket.IO
    // Handles message fanout across instances, needs high network throughput
    const redisAdapterCluster = new aws.elasticache.ReplicationGroup(`${baseName}-redis-adapter`, {
      replicationGroupId: `${baseName}-redis-adapter`,
      description: "Redis cluster for Socket.IO adapter pub/sub (high throughput)",

      // Node configuration - larger for pub/sub throughput
      nodeType: config.redisAdapterNodeType,
      numCacheClusters: config.redisAdapterReplicas! + 1, // primary + replicas (validated in config)

      // Engine configuration
      engine: "redis",
      engineVersion: "7.1",
      port: 6379,
      parameterGroupName: redisParameterGroup.name,

      // Network configuration
      subnetGroupName: redisSubnetGroup.name,
      securityGroupIds: [securityGroupOutputs.redisSecurityGroup.id],

      // High availability
      automaticFailoverEnabled: true,
      multiAzEnabled: true,

      // Security
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      authToken: redisAuthToken.result, // AUTH token for defense-in-depth

      // Maintenance
      maintenanceWindow: "sun:05:00-sun:06:00", // UTC
      snapshotWindow: "03:00-04:00", // UTC
      snapshotRetentionLimit: 7,

      // Apply changes during maintenance window
      applyImmediately: false,

      // Auto minor version upgrade
      autoMinorVersionUpgrade: true,

      tags: {
        ...tags,
        Name: `${baseName}-redis-adapter`,
        Purpose: "socket-io-adapter",
      },
    });

    // State Cluster - Presence, sessions, rate-limit counters
    // Handles high read workloads, less pub/sub traffic
    const redisStateCluster = new aws.elasticache.ReplicationGroup(`${baseName}-redis-state`, {
      replicationGroupId: `${baseName}-redis-state`,
      description: "Redis cluster for presence/sessions/rate-limits (high read)",

      // Node configuration - can be smaller than adapter
      nodeType: config.redisStateNodeType,
      numCacheClusters: config.redisStateReplicas! + 1, // primary + replicas (validated in config)

      // Engine configuration
      engine: "redis",
      engineVersion: "7.1",
      port: 6379,
      parameterGroupName: redisParameterGroup.name,

      // Network configuration
      subnetGroupName: redisSubnetGroup.name,
      securityGroupIds: [securityGroupOutputs.redisSecurityGroup.id],

      // High availability
      automaticFailoverEnabled: true,
      multiAzEnabled: true,

      // Security
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      authToken: redisAuthToken.result, // AUTH token for defense-in-depth

      // Maintenance (offset from adapter cluster)
      maintenanceWindow: "sun:06:00-sun:07:00", // UTC
      snapshotWindow: "04:00-05:00", // UTC
      snapshotRetentionLimit: 7,

      // Apply changes during maintenance window
      applyImmediately: false,

      // Auto minor version upgrade
      autoMinorVersionUpgrade: true,

      tags: {
        ...tags,
        Name: `${baseName}-redis-state`,
        Purpose: "presence-sessions",
      },
    });

    return {
      // Return adapter as primary for backward compatibility
      redisCluster: redisAdapterCluster,
      redisSubnetGroup,
      redisParameterGroup,
      // Split mode specific
      redisAdapterCluster,
      redisStateCluster,
      // Endpoints for application use
      adapterEndpoint: redisAdapterCluster.primaryEndpointAddress,
      stateEndpoint: redisStateCluster.primaryEndpointAddress,
      // AUTH token secret for ECS tasks
      redisAuthSecret,
    };
  }

  // ==================== Single Mode (Development) ====================
  // Create single Redis Replication Group for all workloads
  const redisCluster = new aws.elasticache.ReplicationGroup(`${baseName}-redis`, {
    replicationGroupId: `${baseName}-redis`,
    description: "Redis cluster for Socket.IO adapter and caching",

    // Node configuration
    nodeType: config.redisNodeType,
    numCacheClusters: config.redisNumCacheNodes,

    // Engine configuration
    engine: "redis",
    engineVersion: "7.1",
    port: 6379,
    parameterGroupName: redisParameterGroup.name,

    // Network configuration
    subnetGroupName: redisSubnetGroup.name,
    securityGroupIds: [securityGroupOutputs.redisSecurityGroup.id],

    // High availability
    automaticFailoverEnabled: config.redisNumCacheNodes > 1,
    multiAzEnabled: config.redisNumCacheNodes > 1,

    // Security
    atRestEncryptionEnabled: true,
    transitEncryptionEnabled: true,
    authToken: redisAuthToken.result, // AUTH token for defense-in-depth

    // Maintenance
    maintenanceWindow: "sun:05:00-sun:06:00", // UTC
    snapshotWindow: "03:00-04:00", // UTC
    snapshotRetentionLimit: config.environment === "prod" ? 7 : 1,

    // Apply changes immediately in dev
    applyImmediately: config.environment !== "prod",

    // Auto minor version upgrade
    autoMinorVersionUpgrade: true,

    tags: {
      ...tags,
      Name: `${baseName}-redis`,
    },
  });

  return {
    redisCluster,
    redisSubnetGroup,
    redisParameterGroup,
    // Single mode - same endpoint for both
    adapterEndpoint: redisCluster.primaryEndpointAddress,
    stateEndpoint: redisCluster.primaryEndpointAddress,
    // AUTH token secret for ECS tasks
    redisAuthSecret,
  };
}
