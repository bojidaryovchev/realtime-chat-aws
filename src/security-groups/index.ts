import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";
import { VpcOutputs } from "../vpc";

export interface SecurityGroupOutputs {
  albSecurityGroup: aws.ec2.SecurityGroup;
  ecsApiSecurityGroup: aws.ec2.SecurityGroup;
  ecsRealtimeSecurityGroup: aws.ec2.SecurityGroup;
  ecsWorkersSecurityGroup: aws.ec2.SecurityGroup;
  rdsSecurityGroup: aws.ec2.SecurityGroup;
  redisSecurityGroup: aws.ec2.SecurityGroup;
}

/**
 * Creates security groups with proper isolation:
 * - ALB: Accepts HTTPS from internet
 * - ECS API: Accepts traffic from ALB only
 * - ECS Realtime: Accepts traffic from ALB only (WebSocket)
 * - ECS Workers: No inbound traffic (SQS consumers)
 * - RDS: Accepts traffic from ECS only
 * - Redis: Accepts traffic from ECS only
 * 
 * Security Model Notes:
 * - ECS egress is 0.0.0.0/0 intentionally to allow:
 *   - External API access (Auth0, webhooks, push notification services)
 *   - AWS service access (ECR, Secrets Manager, Logs, SQS)
 *   - DNS resolution
 * - Dev: ECS runs in public subnets with public IPs
 * - Prod: ECS runs in private subnets, egress via NAT Gateway
 * - RDS/Redis have no internet access (egress only to AWS services)
 */
export function createSecurityGroups(
  config: Config,
  vpcOutputs: VpcOutputs
): SecurityGroupOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // ALB Security Group - Accepts HTTPS from internet
  const albSecurityGroup = new aws.ec2.SecurityGroup(`${baseName}-alb-sg`, {
    name: `${baseName}-alb-sg`,
    description: "Security group for Application Load Balancer",
    vpcId: vpcOutputs.vpc.id,
    ingress: [
      {
        description: "HTTPS from internet",
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
      },
      {
        description: "HTTP from internet (redirect to HTTPS)",
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    egress: [
      {
        description: "Allow all outbound",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-alb-sg`,
    },
  });

  // ECS API Security Group - Accepts traffic from ALB only
  const ecsApiSecurityGroup = new aws.ec2.SecurityGroup(`${baseName}-ecs-api-sg`, {
    name: `${baseName}-ecs-api-sg`,
    description: "Security group for ECS API service",
    vpcId: vpcOutputs.vpc.id,
    ingress: [
      {
        description: "HTTP from ALB",
        fromPort: 3001,
        toPort: 3001,
        protocol: "tcp",
        securityGroups: [albSecurityGroup.id],
      },
    ],
    egress: [
      {
        // Intentionally 0.0.0.0/0 to allow external API calls (Auth0, webhooks)
        // and AWS service access. Dev uses public subnets, prod uses NAT.
        description: "Allow outbound for AWS services and external APIs",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-ecs-api-sg`,
    },
  });

  // ECS Realtime Security Group - Accepts traffic from ALB only (WebSocket)
  const ecsRealtimeSecurityGroup = new aws.ec2.SecurityGroup(
    `${baseName}-ecs-realtime-sg`,
    {
      name: `${baseName}-ecs-realtime-sg`,
      description: "Security group for ECS Realtime service (Socket.IO)",
      vpcId: vpcOutputs.vpc.id,
      ingress: [
        {
          description: "HTTP/WebSocket from ALB",
          fromPort: 3002,
          toPort: 3002,
          protocol: "tcp",
          securityGroups: [albSecurityGroup.id],
        },
      ],
      egress: [
        {
          // Intentionally 0.0.0.0/0 for WebSocket connections and Redis pub/sub
          description: "Allow outbound for AWS services and external APIs",
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      tags: {
        ...tags,
        Name: `${baseName}-ecs-realtime-sg`,
      },
    }
  );

  // ECS Workers Security Group - No inbound traffic (SQS consumers only need outbound)
  const ecsWorkersSecurityGroup = new aws.ec2.SecurityGroup(
    `${baseName}-ecs-workers-sg`,
    {
      name: `${baseName}-ecs-workers-sg`,
      description: "Security group for ECS Workers service (SQS consumers)",
      vpcId: vpcOutputs.vpc.id,
      // No ingress - workers don't receive inbound traffic
      ingress: [],
      egress: [
        {
          // Intentionally 0.0.0.0/0 for SQS polling, push notifications, external APIs
          description: "Allow outbound for SQS, RDS, Redis, push services",
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      tags: {
        ...tags,
        Name: `${baseName}-ecs-workers-sg`,
      },
    }
  );

  // RDS Security Group - Accepts traffic from ECS services only
  const rdsSecurityGroup = new aws.ec2.SecurityGroup(`${baseName}-rds-sg`, {
    name: `${baseName}-rds-sg`,
    description: "Security group for RDS PostgreSQL",
    vpcId: vpcOutputs.vpc.id,
    ingress: [
      {
        description: "PostgreSQL from ECS API",
        fromPort: 5432,
        toPort: 5432,
        protocol: "tcp",
        securityGroups: [ecsApiSecurityGroup.id],
      },
      {
        description: "PostgreSQL from ECS Realtime",
        fromPort: 5432,
        toPort: 5432,
        protocol: "tcp",
        securityGroups: [ecsRealtimeSecurityGroup.id],
      },
      {
        description: "PostgreSQL from ECS Workers",
        fromPort: 5432,
        toPort: 5432,
        protocol: "tcp",
        securityGroups: [ecsWorkersSecurityGroup.id],
      },
    ],
    egress: [
      {
        description: "Allow all outbound",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-rds-sg`,
    },
  });

  // Redis Security Group - Accepts traffic from ECS services
  const redisSecurityGroup = new aws.ec2.SecurityGroup(`${baseName}-redis-sg`, {
    name: `${baseName}-redis-sg`,
    description: "Security group for ElastiCache Redis",
    vpcId: vpcOutputs.vpc.id,
    ingress: [
      {
        description: "Redis from ECS Realtime",
        fromPort: 6379,
        toPort: 6379,
        protocol: "tcp",
        securityGroups: [ecsRealtimeSecurityGroup.id],
      },
      {
        description: "Redis from ECS API (for caching)",
        fromPort: 6379,
        toPort: 6379,
        protocol: "tcp",
        securityGroups: [ecsApiSecurityGroup.id],
      },
      {
        description: "Redis from ECS Workers (for rate limiting/caching)",
        fromPort: 6379,
        toPort: 6379,
        protocol: "tcp",
        securityGroups: [ecsWorkersSecurityGroup.id],
      },
    ],
    egress: [
      {
        description: "Allow all outbound",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-redis-sg`,
    },
  });

  return {
    albSecurityGroup,
    ecsApiSecurityGroup,
    ecsRealtimeSecurityGroup,
    ecsWorkersSecurityGroup,
    rdsSecurityGroup,
    redisSecurityGroup,
  };
}
