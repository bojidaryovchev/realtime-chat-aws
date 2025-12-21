import * as pulumi from "@pulumi/pulumi";

/**
 * Configuration interface for the realtime chat infrastructure
 */
export interface Config {
  // General
  environment: string;
  projectName: string;
  domainName: string; // Domain name (e.g., thepersonforme.com)
  hostedZoneId: string; // Existing Route53 hosted zone ID - if both domainName and hostedZoneId are set, ACM cert and DNS records are created

  // VPC
  vpcCidr: string;
  availabilityZones: string[];

  // ECS - API Service
  apiServiceDesiredCount: number;
  apiServiceCpu: number;
  apiServiceMemory: number;

  // ECS - Realtime Service
  realtimeServiceDesiredCount: number;
  realtimeServiceCpu: number;
  realtimeServiceMemory: number;

  // RDS
  rdsInstanceClass: string;
  rdsAllocatedStorage: number;
  rdsMultiAz: boolean;

  // ElastiCache Redis
  redisNodeType: string;
  redisNumCacheNodes: number;

  // Optional: Certificate ARN (if not creating ACM)
  certificateArn?: string;
}

/**
 * Load configuration from Pulumi config
 */
export function loadConfig(): Config {
  const config = new pulumi.Config();

  return {
    // General
    environment: config.require("environment"),
    projectName: pulumi.getProject(),
    domainName: config.get("domainName") || "",
    hostedZoneId: config.get("hostedZoneId") || "",

    // VPC
    vpcCidr: config.get("vpcCidr") || "10.0.0.0/16",
    availabilityZones: JSON.parse(
      config.get("availabilityZones") || '["us-east-1a", "us-east-1b"]'
    ),

    // ECS - API Service
    apiServiceDesiredCount: config.getNumber("apiServiceDesiredCount") || 1,
    apiServiceCpu: config.getNumber("apiServiceCpu") || 256,
    apiServiceMemory: config.getNumber("apiServiceMemory") || 512,

    // ECS - Realtime Service
    realtimeServiceDesiredCount:
      config.getNumber("realtimeServiceDesiredCount") || 2,
    realtimeServiceCpu: config.getNumber("realtimeServiceCpu") || 512,
    realtimeServiceMemory: config.getNumber("realtimeServiceMemory") || 1024,

    // RDS
    rdsInstanceClass: config.get("rdsInstanceClass") || "db.t3.micro",
    rdsAllocatedStorage: config.getNumber("rdsAllocatedStorage") || 20,
    rdsMultiAz: config.getBoolean("rdsMultiAz") ?? false,

    // ElastiCache Redis
    redisNodeType: config.get("redisNodeType") || "cache.t3.micro",
    redisNumCacheNodes: config.getNumber("redisNumCacheNodes") || 1,

    // Optional: Certificate ARN
    certificateArn: config.get("certificateArn"),
  };
}

/**
 * Common tags for all resources
 */
export function getTags(
  config: Config,
  additionalTags?: Record<string, string>
): Record<string, string> {
  return {
    Project: config.projectName,
    Environment: config.environment,
    ManagedBy: "pulumi",
    ...additionalTags,
  };
}
