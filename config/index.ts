import * as pulumi from "@pulumi/pulumi";

/**
 * Configuration interface for the realtime chat infrastructure
 *
 * All values are required and must be explicitly set in Pulumi.<stack>.yaml
 * Use one of the pre-configured stacks: dev, 1k-dau, 5k-dau, 10k-dau, 25k-dau, 50k-dau, 100k-dau
 */
export interface Config {
  // General
  environment: string;
  projectName: string;
  domainName: string;
  hostedZoneId: string;

  // Auth0 Configuration
  auth0Domain: string;
  auth0Audience: string;

  // VPC
  availabilityZones: string[];
  natGateways: number; // 0 for dev (public subnets), 1+ for prod (private subnets)

  // ECS - API Service
  apiServiceDesiredCount: number;
  apiServiceCpu: number;
  apiServiceMemory: number;
  apiDeregistrationDelaySeconds: number;
  apiStopTimeoutSeconds: number;

  // ECS - Realtime Service
  realtimeServiceDesiredCount: number;
  realtimeServiceCpu: number;
  realtimeServiceMemory: number;
  realtimeMaxConnectionsPerTask: number;
  realtimeScaleOnEventLoopLagMs: number;
  realtimeScaleOnConnections: boolean;
  realtimeDeregistrationDelaySeconds: number;
  realtimeStopTimeoutSeconds: number;
  realtimeMinHealthyPercent: number;
  realtimeMaxPercent: number;
  realtimeStickyDurationSeconds: number;

  // ECS - Workers Service
  workerServiceDesiredCount: number;
  workerServiceCpu: number;
  workerServiceMemory: number;
  workerScaleOnQueueDepth: number;
  workerScaleOnOldestMessageAge: number;

  // ECS - Architecture
  enableGraviton: boolean; // Use ARM64/Graviton for up to 20% cost savings

  // RDS
  rdsInstanceClass: string;
  rdsAllocatedStorage: number;
  rdsMultiAz: boolean;
  rdsEngineVersion: string;
  enableRdsProxy: boolean;
  rdsProxyMaxConnectionsPercent: number;
  rdsProxyIdleClientTimeout: number;
  enableRdsReadReplica: boolean; // Read replica for read-heavy workloads (100k DAU)
  rdsReadReplicaInstanceClass?: string; // Only required when enableRdsReadReplica is true

  // ElastiCache Redis
  redisNodeType: string;
  redisNumCacheNodes: number;
  enableRedisSplit: boolean;
  redisAdapterNodeType?: string; // Only required when enableRedisSplit is true
  redisAdapterReplicas?: number;
  redisStateNodeType?: string;
  redisStateReplicas?: number;

  // WAF
  enableWaf: boolean;
  wafApiRateLimitPer5Min: number;
  wafSocketRateLimitPer5Min: number;

  // ECS Health Check
  healthCheckGracePeriodSeconds: number; // Grace period before health checks start

  // Optional
  certificateArn?: string;
}

/**
 * Load configuration from Pulumi config
 * All values must be explicitly set - no fallbacks
 */
export function loadConfig(): Config {
  const config = new pulumi.Config();

  return {
    // General
    environment: config.require("environment"),
    projectName: pulumi.getProject(),
    domainName: config.require("domainName"),
    hostedZoneId: config.require("hostedZoneId"),

    // Auth0 Configuration
    auth0Domain: config.require("auth0Domain"),
    auth0Audience: config.require("auth0Audience"),

    // VPC
    availabilityZones: JSON.parse(config.require("availabilityZones")),
    natGateways: config.requireNumber("natGateways"),

    // ECS - API Service
    apiServiceDesiredCount: config.requireNumber("apiServiceDesiredCount"),
    apiServiceCpu: config.requireNumber("apiServiceCpu"),
    apiServiceMemory: config.requireNumber("apiServiceMemory"),
    apiDeregistrationDelaySeconds: config.requireNumber("apiDeregistrationDelaySeconds"),
    apiStopTimeoutSeconds: config.requireNumber("apiStopTimeoutSeconds"),

    // ECS - Realtime Service
    realtimeServiceDesiredCount: config.requireNumber("realtimeServiceDesiredCount"),
    realtimeServiceCpu: config.requireNumber("realtimeServiceCpu"),
    realtimeServiceMemory: config.requireNumber("realtimeServiceMemory"),
    realtimeMaxConnectionsPerTask: config.requireNumber("realtimeMaxConnectionsPerTask"),
    realtimeScaleOnEventLoopLagMs: config.requireNumber("realtimeScaleOnEventLoopLagMs"),
    realtimeScaleOnConnections: config.requireBoolean("realtimeScaleOnConnections"),
    realtimeDeregistrationDelaySeconds: config.requireNumber("realtimeDeregistrationDelaySeconds"),
    realtimeStopTimeoutSeconds: config.requireNumber("realtimeStopTimeoutSeconds"),
    realtimeMinHealthyPercent: config.requireNumber("realtimeMinHealthyPercent"),
    realtimeMaxPercent: config.requireNumber("realtimeMaxPercent"),
    realtimeStickyDurationSeconds: config.requireNumber("realtimeStickyDurationSeconds"),

    // ECS - Workers Service
    // NOTE: Workers service is currently DISABLED in index.ts pending application implementation.
    // These config values use defaults and are only needed when you uncomment the workers service.
    // See: src/ecs-services/workers.ts for the workers service implementation.
    workerServiceDesiredCount: config.getNumber("workerServiceDesiredCount") || 1,
    workerServiceCpu: config.getNumber("workerServiceCpu") || 256,
    workerServiceMemory: config.getNumber("workerServiceMemory") || 512,
    workerScaleOnQueueDepth: config.getNumber("workerScaleOnQueueDepth") || 100,
    workerScaleOnOldestMessageAge: config.getNumber("workerScaleOnOldestMessageAge") || 300,

    // ECS - Architecture
    enableGraviton: config.requireBoolean("enableGraviton"),

    // RDS
    rdsInstanceClass: config.require("rdsInstanceClass"),
    rdsAllocatedStorage: config.requireNumber("rdsAllocatedStorage"),
    rdsMultiAz: config.requireBoolean("rdsMultiAz"),
    rdsEngineVersion: config.get("rdsEngineVersion") || "16.1", // Default to 16.1 (latest stable)
    enableRdsProxy: config.requireBoolean("enableRdsProxy"),
    rdsProxyMaxConnectionsPercent: config.requireNumber("rdsProxyMaxConnectionsPercent"),
    rdsProxyIdleClientTimeout: config.requireNumber("rdsProxyIdleClientTimeout"),
    enableRdsReadReplica: config.requireBoolean("enableRdsReadReplica"),
    rdsReadReplicaInstanceClass: config.get("rdsReadReplicaInstanceClass"), // Only required when enableRdsReadReplica

    // ElastiCache Redis
    redisNodeType: config.require("redisNodeType"),
    redisNumCacheNodes: config.requireNumber("redisNumCacheNodes"),
    enableRedisSplit: config.requireBoolean("enableRedisSplit"),
    // Split mode config - only required when enableRedisSplit is true
    redisAdapterNodeType: config.get("redisAdapterNodeType"),
    redisStateNodeType: config.get("redisStateNodeType"),
    redisAdapterReplicas: config.getNumber("redisAdapterReplicas"),
    redisStateReplicas: config.getNumber("redisStateReplicas"),

    // WAF
    enableWaf: config.requireBoolean("enableWaf"),
    wafApiRateLimitPer5Min: config.requireNumber("wafApiRateLimitPer5Min"),
    wafSocketRateLimitPer5Min: config.requireNumber("wafSocketRateLimitPer5Min"),

    // ECS Health Check
    healthCheckGracePeriodSeconds: config.getNumber("healthCheckGracePeriodSeconds") || 60,

    // Optional
    certificateArn: config.get("certificateArn"),
  };
}

/**
 * Validates configuration values and throws descriptive errors for invalid combinations
 */
export function validateConfig(config: Config): void {
  // Validate environment
  if (!["dev", "prod"].includes(config.environment)) {
    throw new Error(`Invalid environment "${config.environment}". Must be "dev" or "prod".`);
  }

  // Validate AZs
  if (config.availabilityZones.length < 2) {
    throw new Error("At least 2 availability zones are required for high availability.");
  }

  // Validate NAT gateway count
  if (config.natGateways < 0 || config.natGateways > config.availabilityZones.length) {
    throw new Error(
      `NAT gateway count (${config.natGateways}) must be between 0 and ${config.availabilityZones.length} (number of AZs).`,
    );
  }

  // Validate ECS service counts
  if (config.apiServiceDesiredCount < 1) {
    throw new Error("API service must have at least 1 desired task.");
  }
  if (config.realtimeServiceDesiredCount < 1) {
    throw new Error("Realtime service must have at least 1 desired task.");
  }
  // Worker service validation skipped - workers are disabled in index.ts
  // When enabling workers, uncomment the createWorkersService() call in index.ts

  // Validate CPU/Memory combinations (valid Fargate combinations)
  const validFargateCombinations: Record<number, number[]> = {
    256: [512, 1024, 2048],
    512: [1024, 2048, 3072, 4096],
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    2048: [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384],
    4096: [
      8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384, 17408, 18432, 19456, 20480, 21504, 22528, 23552,
      24576, 25600, 26624, 27648, 28672, 29696, 30720,
    ],
    8192: [16384, 20480, 24576, 28672, 32768, 36864, 40960, 45056, 49152, 53248, 57344, 61440],
    16384: [32768, 40960, 49152, 57344, 65536, 73728, 81920, 90112, 98304, 106496, 114688, 122880],
  };

  const validateCpuMemory = (cpu: number, memory: number, serviceName: string) => {
    const validMemoryValues = validFargateCombinations[cpu];
    if (!validMemoryValues) {
      throw new Error(
        `${serviceName}: Invalid CPU value ${cpu}. Valid values: ${Object.keys(validFargateCombinations).join(", ")}`,
      );
    }
    if (!validMemoryValues.includes(memory)) {
      throw new Error(
        `${serviceName}: Invalid memory ${memory} for CPU ${cpu}. Valid memory values: ${validMemoryValues.join(", ")}`,
      );
    }
  };

  validateCpuMemory(config.apiServiceCpu, config.apiServiceMemory, "API Service");
  validateCpuMemory(config.realtimeServiceCpu, config.realtimeServiceMemory, "Realtime Service");
  validateCpuMemory(config.workerServiceCpu, config.workerServiceMemory, "Worker Service");

  // Validate RDS instance class format
  if (!config.rdsInstanceClass.startsWith("db.")) {
    throw new Error(
      `Invalid RDS instance class "${config.rdsInstanceClass}". Must start with "db." (e.g., "db.t3.micro").`,
    );
  }

  // Validate RDS read replica configuration
  if (config.enableRdsReadReplica) {
    if (!config.rdsReadReplicaInstanceClass || !config.rdsReadReplicaInstanceClass.startsWith("db.")) {
      throw new Error(
        `Invalid RDS read replica instance class "${config.rdsReadReplicaInstanceClass}". Must start with "db." and be provided when enableRdsReadReplica is true.`,
      );
    }
  }

  // Validate PostgreSQL version format (major.minor)
  const pgVersionMatch = config.rdsEngineVersion.match(/^(\d+)\.(\d+)$/);
  if (!pgVersionMatch) {
    throw new Error(
      `Invalid PostgreSQL version "${config.rdsEngineVersion}". Must be in format "major.minor" (e.g., "15.4", "16.1").`,
    );
  }
  const pgMajorVersion = parseInt(pgVersionMatch[1], 10);
  if (pgMajorVersion < 13 || pgMajorVersion > 17) {
    throw new Error(
      `PostgreSQL version ${pgMajorVersion} is not supported. Supported major versions: 13, 14, 15, 16, 17.`,
    );
  }

  // Validate Redis node type format
  if (!config.redisNodeType.startsWith("cache.")) {
    throw new Error(
      `Invalid Redis node type "${config.redisNodeType}". Must start with "cache." (e.g., "cache.t3.micro").`,
    );
  }

  // Validate Redis cluster ID length (AWS limit is 20 characters)
  // Format: ${projectName}-${environment}-redis-adapter (longest suffix)
  const baseName = `${config.projectName}-${config.environment}`;
  const longestRedisId = `${baseName}-redis-adapter`; // 14 chars suffix
  if (longestRedisId.length > 20) {
    throw new Error(
      `Redis cluster ID "${longestRedisId}" exceeds 20 character AWS limit. ` +
        `Shorten your project name or environment. Current length: ${longestRedisId.length}`,
    );
  }

  // Validate Redis split mode configuration
  if (config.enableRedisSplit) {
    if (!config.redisAdapterNodeType) {
      throw new Error("redisAdapterNodeType is required when enableRedisSplit is true.");
    }
    if (!config.redisStateNodeType) {
      throw new Error("redisStateNodeType is required when enableRedisSplit is true.");
    }
    if (!config.redisAdapterNodeType.startsWith("cache.")) {
      throw new Error(`Invalid Redis adapter node type "${config.redisAdapterNodeType}". Must start with "cache.".`);
    }
    if (!config.redisStateNodeType.startsWith("cache.")) {
      throw new Error(`Invalid Redis state node type "${config.redisStateNodeType}". Must start with "cache.".`);
    }
    if (config.redisAdapterReplicas === undefined) {
      throw new Error("redisAdapterReplicas is required when enableRedisSplit is true.");
    }
    if (config.redisStateReplicas === undefined) {
      throw new Error("redisStateReplicas is required when enableRedisSplit is true.");
    }
  }

  // Validate storage
  if (config.rdsAllocatedStorage < 20) {
    throw new Error("RDS allocated storage must be at least 20 GB.");
  }

  // Validate deregistration delays
  if (config.apiDeregistrationDelaySeconds < 0 || config.apiDeregistrationDelaySeconds > 3600) {
    throw new Error("API deregistration delay must be between 0 and 3600 seconds.");
  }
  if (config.realtimeDeregistrationDelaySeconds < 0 || config.realtimeDeregistrationDelaySeconds > 3600) {
    throw new Error("Realtime deregistration delay must be between 0 and 3600 seconds.");
  }

  // Validate WAF rate limits
  if (config.enableWaf) {
    if (config.wafApiRateLimitPer5Min < 100) {
      throw new Error("WAF API rate limit must be at least 100 requests per 5 minutes.");
    }
    if (config.wafSocketRateLimitPer5Min < 100) {
      throw new Error("WAF Socket.IO rate limit must be at least 100 requests per 5 minutes.");
    }
  }

  // Warn about potentially expensive configurations
  if (config.environment === "dev" && config.rdsMultiAz) {
    console.warn("⚠️ Warning: RDS Multi-AZ is enabled in dev environment. This doubles database costs.");
  }
  if (config.environment === "dev" && config.enableRdsProxy) {
    console.warn("⚠️ Warning: RDS Proxy is enabled in dev environment. Consider disabling to reduce costs.");
  }
  if (config.environment === "dev" && config.enableWaf) {
    console.warn("⚠️ Warning: WAF is enabled in dev environment. Consider disabling to reduce costs.");
  }
  if (config.environment === "dev" && config.enableRdsReadReplica) {
    console.warn("⚠️ Warning: RDS Read Replica is enabled in dev environment. Consider disabling to reduce costs.");
  }
}

/**
 * Common tags for all resources
 */
export function getTags(config: Config, additionalTags?: Record<string, string>): Record<string, string> {
  return {
    Project: config.projectName,
    Environment: config.environment,
    ManagedBy: "pulumi",
    ...additionalTags,
  };
}
