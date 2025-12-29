# Security Groups Module Documentation

> **File**: `src/security-groups/index.ts`  
> **Purpose**: Creates network-level access control for all AWS resources

---

## Table of Contents

1. [Overview](#overview)
2. [Security Architecture](#security-architecture)
3. [Code Walkthrough](#code-walkthrough)
4. [Design Decisions](#design-decisions)
5. [Traffic Flow Matrix](#traffic-flow-matrix)

---

## Overview

Security Groups act as virtual firewalls for AWS resources. This module creates a layered security model where each component can only communicate with its direct dependencies.

### What This Module Creates

| Security Group | Protects | Inbound From | Outbound To |
|----------------|----------|--------------|-------------|
| ALB SG | Load Balancer | Internet (80, 443) | ECS services |
| ECS API SG | API containers | ALB only (3001) | Internet (all) |
| ECS Realtime SG | WebSocket containers | ALB only (3002) | Internet (all) |
| ECS Workers SG | Worker containers | None | Internet (all) |
| RDS SG | PostgreSQL | ECS services (5432) | None |
| Redis SG | ElastiCache | ECS services (6379) | None |

---

## Security Architecture

```
                    INTERNET
                        │
                        │ HTTPS (443) / HTTP (80)
                        ▼
            ┌───────────────────────┐
            │      ALB SG           │
            │   Inbound: 0.0.0.0/0  │
            │   Ports: 80, 443      │
            └───────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          │                           │
          ▼ Port 3001                 ▼ Port 3002
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│    ECS API SG       │     │  ECS Realtime SG    │     │  ECS Workers SG     │
│  Inbound: ALB only  │     │  Inbound: ALB only  │     │  Inbound: NONE      │
│  Port: 3001         │     │  Port: 3002         │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
          │                           │                           │
          │ ┌─────────────────────────┼───────────────────────────┘
          │ │                         │
          ▼ ▼ Port 5432               ▼ Port 6379
┌─────────────────────┐     ┌─────────────────────┐
│      RDS SG         │     │     Redis SG        │
│ Inbound: ECS only   │     │ Inbound: ECS only   │
│ Port: 5432          │     │ Port: 6379          │
└─────────────────────┘     └─────────────────────┘
```

---

## Code Walkthrough

### 1. Interface Definition

```typescript
export interface SecurityGroupOutputs {
  albSecurityGroup: aws.ec2.SecurityGroup;
  ecsApiSecurityGroup: aws.ec2.SecurityGroup;
  ecsRealtimeSecurityGroup: aws.ec2.SecurityGroup;
  ecsWorkersSecurityGroup: aws.ec2.SecurityGroup;
  rdsSecurityGroup: aws.ec2.SecurityGroup;
  redisSecurityGroup: aws.ec2.SecurityGroup;
}
```

**Why 6 separate security groups:**
- **Principle of least privilege**: Each component only allows traffic it needs
- **Blast radius reduction**: Compromised API can't directly access Workers
- **Audit clarity**: Easy to see what each component can access
- **Separate scaling**: Different ports for different services

---

### 2. ALB Security Group

```typescript
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
});
```

**Why port 443 (HTTPS) from 0.0.0.0/0:**
- ALB is public-facing, needs to accept traffic from anywhere
- Users connect from any IP address
- WAF (optional) provides additional filtering at application layer

**Why port 80 (HTTP) from 0.0.0.0/0:**
- HTTP requests are redirected to HTTPS by ALB
- Some clients/crawlers still try HTTP first
- Redirect ensures they get to HTTPS version

**Why egress 0.0.0.0/0:**
- ALB needs to forward traffic to ECS tasks
- ECS tasks could be in any subnet
- Health checks require ALB to reach targets

**Why protocol "-1" for egress:**
- `-1` means all protocols (TCP, UDP, ICMP)
- ALB health checks use TCP
- Simplifies rule, no security downside for outbound

---

### 3. ECS API Security Group

```typescript
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
      description: "Allow outbound for AWS services and external APIs",
      fromPort: 0,
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});
```

**Why port 3001:**
- Fastify API server listens on port 3001
- Non-standard port (not 80/443) for clarity in logs
- Each service gets unique port for easier debugging

**Why ingress from `securityGroups: [albSecurityGroup.id]`:**
- **Security group reference** (not CIDR) is more secure
- Only traffic FROM resources in ALB SG is allowed
- If ALB IP changes, rule still works
- Impossible to bypass ALB (can't spoof security group membership)

**Why egress 0.0.0.0/0:**
- API needs to reach external services:
  - **Auth0**: JWT verification, user info
  - **AWS services**: Secrets Manager, CloudWatch Logs, ECR
  - **Webhooks**: Third-party integrations
- In dev: Direct internet via public IP
- In prod: Through NAT Gateway

**Why not restrict egress to specific IPs:**
- Auth0 IPs change, maintaining list is error-prone
- AWS service IPs are dynamic (use VPC endpoints for restriction)
- Outbound restrictions have limited security value (egress filtering is better done at application level)

---

### 4. ECS Realtime Security Group

```typescript
const ecsRealtimeSecurityGroup = new aws.ec2.SecurityGroup(`${baseName}-ecs-realtime-sg`, {
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
  egress: [...], // Same as API
});
```

**Why separate from API security group:**
- Different scaling characteristics
- WebSocket connections are long-lived
- Easier to audit what has WebSocket access
- Could have different security requirements in future

**Why port 3002:**
- Distinct from API (3001) for:
  - ALB routing rules
  - Log filtering
  - Metrics separation
  - Independent scaling targets

**Why TCP (not "websocket" protocol):**
- WebSocket runs over TCP
- HTTP upgrade happens at application layer
- Security group only sees TCP traffic

---

### 5. ECS Workers Security Group

```typescript
const ecsWorkersSecurityGroup = new aws.ec2.SecurityGroup(`${baseName}-ecs-workers-sg`, {
  name: `${baseName}-ecs-workers-sg`,
  description: "Security group for ECS Workers service (SQS consumers)",
  vpcId: vpcOutputs.vpc.id,
  ingress: [],  // NO INBOUND RULES
  egress: [
    {
      description: "Allow outbound for SQS, RDS, Redis, push services",
      fromPort: 0,
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});
```

**Why empty ingress:**
- Workers are pull-based (poll SQS)
- Nothing needs to connect TO workers
- Maximum attack surface reduction
- Workers initiate ALL connections

**Why egress 0.0.0.0/0:**
Workers need outbound access for:
- **SQS**: Poll for messages (HTTPS to AWS endpoint)
- **RDS**: Write to database
- **Redis**: Caching, rate limiting
- **Push services**: Send notifications (APNs, FCM)
- **External APIs**: Webhooks, third-party integrations

**This is the most secure service:**
- No network path IN to workers
- Only compromise vector is through SQS message content or dependencies

---

### 6. RDS Security Group

```typescript
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
});
```

**Why 3 separate ingress rules (not combined):**
- **Audit clarity**: Logs show which SG initiated connection
- **Future flexibility**: Can revoke one service's access without affecting others
- **Documentation**: Self-documenting who accesses database

**Why port 5432:**
- Standard PostgreSQL port
- RDS listens on this port by default
- No benefit to changing it (security through obscurity doesn't work)

**Why security group reference (not CIDR):**
- ECS task IPs are dynamic (Fargate assigns randomly)
- Can't maintain CIDR list of task IPs
- Security group membership is guaranteed by AWS

**Why egress 0.0.0.0/0:**
- RDS needs to reach AWS services (CloudWatch, monitoring)
- Multi-AZ replication requires outbound
- Read replica sync requires outbound
- RDS manages its own outbound connections

**Why no internet ingress:**
- Database is NEVER directly accessible from internet
- Even with credentials, can't connect from outside VPC
- Bastion host or VPN required for admin access (not implemented here)

---

### 7. Redis Security Group

```typescript
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
  egress: [...], // Same as RDS
});
```

**Why all 3 ECS services can access Redis:**

| Service | Redis Usage |
|---------|-------------|
| Realtime | Socket.IO adapter (pub/sub), presence |
| API | Session cache, query cache, rate limiting |
| Workers | Distributed locks, rate limiting, cache |

**Why port 6379:**
- Standard Redis port
- ElastiCache default

**Why egress 0.0.0.0/0:**
- Redis cluster nodes need to communicate with each other
- CloudWatch metrics publishing
- Managed by AWS, we don't restrict it

---

## Design Decisions

### Decision 1: Separate SG for Each ECS Service

**Choice**: 3 ECS security groups (API, Realtime, Workers) instead of 1 shared

**Reasoning**:
- **Least privilege**: Workers don't need ALB ingress
- **Audit trail**: Clear which service accessed what
- **Independent policies**: Can add service-specific rules later
- **Blast radius**: Compromised API can't directly access Workers network

**Trade-off**: More security groups to manage, but better security posture.

---

### Decision 2: No Bastion Host / VPN

**Choice**: No admin access path to RDS/Redis from outside VPC

**Reasoning**:
- Admin access is rare (use AWS Console, CLI, or ECS Exec)
- Bastion hosts are attack vectors
- VPN adds complexity and cost
- For debugging, use `aws ecs execute-command` to shell into tasks

**Trade-off**: Can't directly connect to database from laptop. Must use ECS Exec or add bastion later if needed.

---

### Decision 3: Egress 0.0.0.0/0 for ECS

**Choice**: Allow all outbound traffic from ECS services

**Reasoning**:
- Applications need external API access (Auth0, webhooks)
- AWS service IPs are dynamic
- Restricting egress is complex (need VPC endpoints for every AWS service)
- Real security comes from application-level controls

**Alternative considered**: VPC endpoints for all AWS services + explicit egress CIDRs
- Rejected due to complexity and cost (~$7.20/month per interface endpoint)

**Trade-off**: Less restrictive egress, but simpler and cheaper. If a container is compromised, it can make outbound connections.

---

### Decision 4: Security Group Reference (not CIDR)

**Choice**: `securityGroups: [albSecurityGroup.id]` instead of `cidrBlocks: ["10.0.x.x/24"]`

**Reasoning**:
- ECS Fargate assigns random IPs from subnet
- ALB IPs are managed by AWS, can change
- Security group membership is AWS-enforced, can't be spoofed
- Survives IP changes, scaling, replacements

**This is an AWS best practice.**

---

## Traffic Flow Matrix

### Allowed Traffic (Summary)

| Source | Destination | Port | Protocol | Why |
|--------|-------------|------|----------|-----|
| Internet | ALB | 443 | TCP | HTTPS access |
| Internet | ALB | 80 | TCP | HTTP → HTTPS redirect |
| ALB | ECS API | 3001 | TCP | API requests |
| ALB | ECS Realtime | 3002 | TCP | WebSocket/polling |
| ECS API | RDS | 5432 | TCP | Database queries |
| ECS API | Redis | 6379 | TCP | Caching |
| ECS Realtime | RDS | 5432 | TCP | User lookup |
| ECS Realtime | Redis | 6379 | TCP | Pub/sub, presence |
| ECS Workers | RDS | 5432 | TCP | Database writes |
| ECS Workers | Redis | 6379 | TCP | Rate limiting |

### Denied Traffic (Implicit)

| Source | Destination | Why Denied |
|--------|-------------|------------|
| Internet | ECS API | Must go through ALB |
| Internet | RDS | No internet access |
| Internet | Redis | No internet access |
| ECS API | ECS Realtime | No direct communication |
| ALB | RDS | ALB doesn't need database |
| ALB | Redis | ALB doesn't need cache |
| Any | ECS Workers | No inbound needed |

---

## Security Best Practices Applied

1. **Defense in depth**: Multiple layers (ALB → SG → private subnet)
2. **Least privilege**: Each SG only allows necessary traffic
3. **No public database**: RDS/Redis unreachable from internet
4. **Explicit allow**: Default deny, only allow what's needed
5. **Security group references**: Not CIDR blocks for dynamic resources
6. **Descriptive names**: Easy to audit and understand
7. **Documentation in code**: `description` field on every rule
