import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";
import { SecurityGroupOutputs } from "../security-groups";
import { VpcOutputs } from "../vpc";

export interface RedisOutputs {
  redisCluster: aws.elasticache.ReplicationGroup;
  redisSubnetGroup: aws.elasticache.SubnetGroup;
  redisParameterGroup: aws.elasticache.ParameterGroup;
}

/**
 * Creates ElastiCache Redis cluster with:
 * - Replication group for high availability
 * - Subnet group in private subnets
 * - Parameter group optimized for Socket.IO pub/sub
 * - Encryption in transit and at rest
 */
export function createRedis(
  config: Config,
  vpcOutputs: VpcOutputs,
  securityGroupOutputs: SecurityGroupOutputs
): RedisOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Create Redis Subnet Group
  const redisSubnetGroup = new aws.elasticache.SubnetGroup(
    `${baseName}-redis-subnet-group`,
    {
      name: `${baseName}-redis-subnet-group`,
      subnetIds: vpcOutputs.privateSubnets.map((subnet) => subnet.id),
      description: "Subnet group for ElastiCache Redis",
      tags: {
        ...tags,
        Name: `${baseName}-redis-subnet-group`,
      },
    }
  );

  // Create Parameter Group optimized for Socket.IO
  const redisParameterGroup = new aws.elasticache.ParameterGroup(
    `${baseName}-redis-param-group`,
    {
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
    }
  );

  // Create Redis Replication Group
  const redisCluster = new aws.elasticache.ReplicationGroup(
    `${baseName}-redis`,
    {
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
    }
  );

  return {
    redisCluster,
    redisSubnetGroup,
    redisParameterGroup,
  };
}
