import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";
import { VpcOutputs } from "../vpc";

export interface SecurityGroupOutputs {
  albSecurityGroup: aws.ec2.SecurityGroup;
  ecsApiSecurityGroup: aws.ec2.SecurityGroup;
  ecsRealtimeSecurityGroup: aws.ec2.SecurityGroup;
  rdsSecurityGroup: aws.ec2.SecurityGroup;
  redisSecurityGroup: aws.ec2.SecurityGroup;
}

/**
 * Creates security groups with proper isolation:
 * - ALB: Accepts HTTPS from internet
 * - ECS API: Accepts traffic from ALB only
 * - ECS Realtime: Accepts traffic from ALB only (WebSocket)
 * - RDS: Accepts traffic from ECS only
 * - Redis: Accepts traffic from ECS only
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
        fromPort: 3000,
        toPort: 3000,
        protocol: "tcp",
        securityGroups: [albSecurityGroup.id],
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
          fromPort: 3001,
          toPort: 3001,
          protocol: "tcp",
          securityGroups: [albSecurityGroup.id],
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
        Name: `${baseName}-ecs-realtime-sg`,
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

  // Redis Security Group - Accepts traffic from ECS Realtime only
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
    rdsSecurityGroup,
    redisSecurityGroup,
  };
}
