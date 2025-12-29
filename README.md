# Realtime Chat AWS Infrastructure

Production-ready AWS infrastructure for a realtime chat application using **Pulumi (TypeScript)**, with pre-configured stacks for **1k to 100k DAU**.

## Quick Start

```bash
# Install dependencies
pnpm install

# Choose your scale (see Available Stacks below)
pulumi stack init 1k-dau
# Or: dev, 5k-dau, 10k-dau, 25k-dau, 50k-dau, 100k-dau

# Edit Pulumi.<stack>.yaml with your domain, Auth0 config, etc.

# Deploy
pulumi up
```

## Available Stacks

| Stack      | DAU     | Concurrent Connections | Est. Cost           | Use Case                    |
| ---------- | ------- | ---------------------- | ------------------- | --------------------------- |
| `dev`      | -       | ~50-100                | **$50-80/mo**       | Development, testing, CI/CD |
| `1k-dau`   | 1,000   | ~100-300               | **$150-200/mo**     | MVP launch, beta testing    |
| `5k-dau`   | 5,000   | ~500-1,500             | **$250-350/mo**     | Post-launch growth          |
| `10k-dau`  | 10,000  | ~1k-3k                 | **$350-500/mo**     | Series A startups           |
| `25k-dau`  | 25,000  | ~2.5k-7.5k             | **$500-700/mo**     | Series A/B startups         |
| `50k-dau`  | 50,000  | ~5k-15k                | **$800-1,100/mo**   | Series B+ / Enterprise      |
| `100k-dau` | 100,000 | ~10k-30k               | **$1,200-1,500/mo** | Large scale production      |

### 💡 Key Cost Savings

- **Dev stack uses public subnets** → No NAT Gateway needed (~$35/month saved)
- **No VPC Interface Endpoints** → Saves ~$115/month vs endpoint-heavy approach
- **All stacks use explicit configs** → No hidden defaults, you control every resource
- **Features are opt-in** → RDS Proxy, Redis Split, WAF only enabled at higher tiers

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Internet                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    AWS WAF (5k+ DAU stacks)                             │
│   • Managed Rules (Common, Bad Inputs, Bot Control)                     │
│   • Rate Limiting: /api/* and /socket.io/*                              │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Application Load Balancer (HTTPS)                    │
│    /api/*  →  API Target Group       /socket.io/*  →  Realtime TG      │
│    • 300s idle timeout (WebSocket)    • Sticky sessions (3600s)        │
└─────────────────────────────────────────────────────────────────────────┘
              │                          │
  ┌───────────┴───────────┐  ┌───────────┴───────────┐  ┌─────────────────┐
  │   ECS Fargate (API)   │  │ ECS Fargate (Realtime)│  │ ECS (Workers)*  │
  │   • Node.js/Fastify   │  │   • Socket.IO         │  │ • SQS Consumer  │
  │   • REST/GraphQL      │  │   • Redis Adapter     │  │ • Push Notifs   │
  │   • Auto-scaling      │  │   • Custom Metrics    │  │ • Queue Scaling │
  └───────────┬───────────┘  └───────────┬───────────┘  └────────┬────────┘
              │                          │                       │
              └──────────────┬───────────┴───────────────────────┘
                             │
         ┌───────────────────┼───────────────────────────────────┐
         ▼                   ▼                                   ▼
 ┌───────────────┐   ┌───────────────────────────┐       ┌───────────────┐
 │RDS PostgreSQL │   │   ElastiCache Redis       │       │     SQS       │
 │ • Multi-AZ    │   │ • Adapter Cluster (pub/sub)│      │ • Push Queue  │
 │ • RDS Proxy   │   │ • State Cluster (sessions) │      │ • Offline Q   │
 └───────────────┘   └───────────────────────────┘       └───────────────┘

*Workers service is currently disabled pending application implementation. SQS queues are provisioned and the API sends messages to the push queue - the workers app needs to be built to consume these.
```

### Network Architecture

| Environment | Subnet Type     | Internet Access    | Cost            |
| ----------- | --------------- | ------------------ | --------------- |
| **Dev**     | Public subnets  | Direct (public IP) | $0              |
| **Prod**    | Private subnets | Via NAT Gateway    | ~$35/mo per NAT |

## Stack Comparison

### Infrastructure Features by Stack

| Feature                | dev   | 1k    | 5k    | 10k     | 25k     | 50k     | 100k    |
| ---------------------- | ----- | ----- | ----- | ------- | ------- | ------- | ------- |
| **NAT Gateways**       | 0     | 1     | 1     | 2       | 2       | 2       | 3       |
| **Availability Zones** | 2     | 2     | 2     | 2       | 2       | 3       | 3       |
| **WAF Protection**     | ❌    | ❌    | ✅    | ✅      | ✅      | ✅      | ✅      |
| **RDS Proxy**          | ❌    | ❌    | ❌    | ✅      | ✅      | ✅      | ✅      |
| **RDS Multi-AZ**       | ❌    | ❌    | ❌    | ❌      | ❌      | ✅      | ✅      |
| **RDS Read Replica**   | ❌    | ❌    | ❌    | ❌      | ❌      | ❌      | ✅      |
| **Redis Split**        | ❌    | ❌    | ❌    | ❌      | ❌      | ❌      | ✅      |
| **Graviton (ARM64)**   | ❌    | ❌    | ❌    | ❌      | ❌      | ❌      | ✅      |
| **Auto-Scaling**       | Basic | Basic | Basic | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

> **Auto-Scaling Note:** "Basic" = CPU/memory-based scaling only. "Full" = Includes custom metrics scaling (ActiveConnections, EventLoopLagMs) for realtime service and SQS queue depth scaling for workers.
>
> **Graviton Note:** ARM64-based Fargate tasks offer up to 20% cost savings. Requires ARM-compatible container images (multi-arch builds recommended).

### Compute Resources by Stack

| Service      | dev       | 1k         | 5k         | 10k        | 25k         | 50k         | 100k        |
| ------------ | --------- | ---------- | ---------- | ---------- | ----------- | ----------- | ----------- |
| **API**      | 1×256/512 | 1×256/512  | 2×256/512  | 2×512/1024 | 2×512/1024  | 3×512/1024  | 4×1024/2048 |
| **Realtime** | 1×256/512 | 1×512/1024 | 2×512/1024 | 2×512/1024 | 3×1024/2048 | 4×1024/2048 | 6×1024/2048 |
| **Workers**  | 1×256/512 | 1×256/512  | 1×256/512  | 1×256/512  | 2×256/512   | 2×512/1024  | 3×512/1024  |

### Database & Cache by Stack

| Resource        | dev        | 1k         | 5k          | 10k         | 25k         | 50k        | 100k       |
| --------------- | ---------- | ---------- | ----------- | ----------- | ----------- | ---------- | ---------- |
| **RDS**         | t3.micro   | t3.small   | t3.small    | t3.medium   | t3.large    | r6g.large  | r6g.xlarge |
| **RDS Storage** | 20GB       | 20GB       | 30GB        | 50GB        | 100GB       | 150GB      | 200GB      |
| **Redis**       | t3.micro×1 | t3.small×1 | t3.medium×1 | t3.medium×2 | t3.medium×2 | t3.large×2 | m6g Split  |

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Pulumi CLI** installed (`npm install -g @pulumi/pulumi`)
3. **Node.js** 18+ and pnpm
4. **Domain** with Route53 hosted zone (for SSL certificate)

## Configuration

### 1. Choose Your Stack

```bash
# List available stacks
ls Pulumi.*.yaml

# Initialize your chosen stack
pulumi stack init 1k-dau  # Or: dev, 5k-dau, 10k-dau, etc.
```

### ⚠️ Important: Encryption Salt

Each Pulumi stack YAML file contains an `encryptionsalt` that is used to encrypt secrets in that stack. This value is:

- **Auto-generated** when you run `pulumi stack init`
- **Required** to decrypt config secrets - never delete or modify it
- **Stack-specific** - each stack has its own unique salt
- **NOT a secret itself** - it's safe to commit to source control

```yaml
# Example: Pulumi.dev.yaml
encryptionsalt: v1:abc123xyz... # Don't modify this!
config:
  realtime-chat-aws:domainName: "example.com"
```

If you're using the pre-configured stack files (e.g., copying `Pulumi.10k-dau.yaml`), you should either:

1. **Create a new stack**: `pulumi stack init my-stack` (generates new salt automatically)
2. **Or regenerate the salt**: Delete the `encryptionsalt` line and run `pulumi config set` on any value

To set secrets that will be encrypted with this salt:

```bash
# Secrets are encrypted with the stack's encryptionsalt
pulumi config set --secret auth0ClientSecret "your-secret-value"
```

### 2. Edit Stack Configuration

Open `Pulumi.<stack>.yaml` and update these required values:

```yaml
config:
  # Your domain
  realtime-chat-aws:domainName: "your-domain.com"
  realtime-chat-aws:hostedZoneId: "YOUR_HOSTED_ZONE_ID"

  # Auth0 configuration
  realtime-chat-aws:auth0Domain: "your-tenant.auth0.com"
  realtime-chat-aws:auth0Audience: "https://api.your-domain.com"
```

### 3. Deploy

```bash
# Preview changes
pulumi preview

# Deploy
pulumi up

# Get outputs
pulumi stack output
```

## Configuration Reference

All configuration values are **required** and must be explicitly set in the stack YAML file. There are no hidden defaults.

### General

| Config Key      | Description                            |
| --------------- | -------------------------------------- |
| `environment`   | Environment name (`dev` or `prod`)     |
| `domainName`    | Your domain (e.g., `chat.example.com`) |
| `hostedZoneId`  | Route53 hosted zone ID                 |
| `auth0Domain`   | Auth0 tenant domain                    |
| `auth0Audience` | Auth0 API identifier                   |

### VPC

| Config Key          | Description                                      |
| ------------------- | ------------------------------------------------ |
| `availabilityZones` | JSON array of AZs                                |
| `natGateways`       | Number of NAT gateways (0 for dev, 1-3 for prod) |

> **Note:** VPC CIDR is fixed at `10.0.0.0/16` - subnet calculations depend on this structure.
>
> - Public subnets: `10.0.0.0/24`, `10.0.1.0/24`, `10.0.2.0/24`
> - Private subnets: `10.0.100.0/24`, `10.0.101.0/24`, `10.0.102.0/24`
>
> **Dev uses public subnets** with public IPs for ECS tasks (no NAT needed).
> **Prod uses private subnets** with NAT Gateway for outbound internet access.

### ECS Services

#### API Service

| Config Key                      | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `apiServiceDesiredCount`        | API service task count                         |
| `apiServiceCpu`                 | API CPU units (256, 512, 1024, etc.)           |
| `apiServiceMemory`              | API memory MB (512, 1024, 2048, etc.)          |
| `apiDeregistrationDelaySeconds` | ALB deregistration delay for graceful shutdown |
| `apiStopTimeoutSeconds`         | Container stop timeout for SIGTERM handling    |

#### Realtime Service

| Config Key                           | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `realtimeServiceDesiredCount`        | Realtime service task count                       |
| `realtimeServiceCpu`                 | Realtime CPU units                                |
| `realtimeServiceMemory`              | Realtime memory MB                                |
| `realtimeMaxConnectionsPerTask`      | Max WebSocket connections per task (for scaling)  |
| `realtimeScaleOnEventLoopLagMs`      | Event loop lag threshold (ms) for scale-out       |
| `realtimeScaleOnConnections`         | Enable connection-based auto-scaling              |
| `realtimeDeregistrationDelaySeconds` | ALB deregistration delay for WebSocket draining   |
| `realtimeStopTimeoutSeconds`         | Container stop timeout for connection migration   |
| `realtimeMinHealthyPercent`          | Min healthy percent during deployments            |
| `realtimeMaxPercent`                 | Max percent during rolling deployments            |
| `realtimeStickyDurationSeconds`      | ALB sticky session duration for Socket.IO polling |

#### Workers Service

| Config Key                      | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `workerServiceDesiredCount`     | Workers service task count                       |
| `workerServiceCpu`              | Workers CPU units                                |
| `workerServiceMemory`           | Workers memory MB                                |
| `workerScaleOnQueueDepth`       | Target SQS queue depth per worker for scaling    |
| `workerScaleOnOldestMessageAge` | Message age threshold (seconds) for step scaling |

#### Architecture

| Config Key                      | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `enableGraviton`                | Use ARM64 (Graviton) for ECS tasks (~20% cost savings) |
| `healthCheckGracePeriodSeconds` | Grace period before health checks start (default: 60s) |

### RDS

| Config Key                      | Description                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `rdsInstanceClass`              | Instance type (e.g., `db.t3.small`)                                                           |
| `rdsAllocatedStorage`           | Storage in GB                                                                                 |
| `rdsEngineVersion`              | PostgreSQL version (e.g., `15.4`, `16.1`). Supported: **13, 14, 15, 16, 17**. Default: `16.1` |
| `rdsMultiAz`                    | Enable Multi-AZ deployment                                                                    |
| `enableRdsProxy`                | Enable RDS Proxy for connection pooling                                                       |
| `rdsProxyMaxConnectionsPercent` | Max connections percent for RDS Proxy pool                                                    |
| `rdsProxyIdleClientTimeout`     | Idle client timeout (seconds) for proxy connections                                           |
| `enableRdsReadReplica`          | Enable RDS Read Replica for read scaling (100k DAU)                                           |
| `rdsReadReplicaInstanceClass`   | Read replica instance type (only required when `enableRdsReadReplica: true`)                  |

### Redis

| Config Key             | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `redisNodeType`        | Node type (e.g., `cache.t3.small`)                                      |
| `redisNumCacheNodes`   | Number of cache nodes                                                   |
| `enableRedisSplit`     | Split into adapter/state clusters                                       |
| `redisAdapterNodeType` | Adapter cluster node type (only required when `enableRedisSplit: true`) |
| `redisAdapterReplicas` | Number of replicas for adapter cluster (only required when split)       |
| `redisStateNodeType`   | State cluster node type (only required when split)                      |
| `redisStateReplicas`   | Number of replicas for state cluster (only required when split)         |

> **Note:** Redis cluster IDs have a 20-character AWS limit. The infrastructure uses the format `${projectName}-${environment}-redis-adapter` for the longest ID. Ensure your project name and environment are short enough to stay within this limit.

### Security

| Config Key                  | Description                        |
| --------------------------- | ---------------------------------- |
| `enableWaf`                 | Enable AWS WAF                     |
| `wafApiRateLimitPer5Min`    | API rate limit per 5 minutes       |
| `wafSocketRateLimitPer5Min` | Socket.IO rate limit per 5 minutes |

## Project Structure

```
realtime-chat-aws/
├── index.ts                 # Main Pulumi program
├── config/
│   └── index.ts             # Configuration loader (all values required)
├── src/
│   ├── acm/                 # ACM certificate + DNS validation
│   ├── alb/                 # ALB, listeners, target groups, access logs
│   ├── backup/              # AWS Backup (vault, plan, retention policies)
│   ├── ecr/                 # ECR repositories
│   ├── ecs-cluster/         # ECS cluster with capacity providers
│   ├── ecs-services/        # ECS services (API, Realtime, Workers)
│   ├── iam/                 # IAM roles and policies
│   ├── observability/       # CloudWatch dashboard + 20+ alarms
│   ├── rds/                 # RDS PostgreSQL + RDS Proxy + Secrets Manager
│   ├── redis/               # ElastiCache Redis (single or split)
│   ├── route53/             # DNS records
│   ├── security-groups/     # Security groups
│   ├── sqs/                 # SQS queues + DLQs
│   ├── vpc/                 # VPC, subnets, NAT, S3 gateway endpoint
│   └── waf/                 # AWS WAF Web ACL
├── docs/
│   └── runbook.md           # Operational runbook for incident response
├── .github/
│   └── workflows/
│       └── deploy.yml       # CI/CD pipeline example
├── apps/
│   ├── api/                 # API service application (deployed to ECS)
│   ├── realtime/            # Realtime service application (deployed to ECS)
│   └── web/                 # Web frontend (deployed to Vercel)
├── packages/
│   ├── auth/                # Auth0 integration
│   └── database/            # Prisma schema + client
├── Pulumi.yaml              # Pulumi project file
├── Pulumi.dev.yaml          # Dev stack (~$50-80/mo)
├── Pulumi.1k-dau.yaml       # 1k DAU (~$150-200/mo)
├── Pulumi.5k-dau.yaml       # 5k DAU (~$250-350/mo)
├── Pulumi.10k-dau.yaml      # 10k DAU (~$350-500/mo)
├── Pulumi.25k-dau.yaml      # 25k DAU (~$500-700/mo)
├── Pulumi.50k-dau.yaml      # 50k DAU (~$800-1,100/mo)
└── Pulumi.100k-dau.yaml     # 100k DAU (~$1,200-1,500/mo)
```

## Features

### Infrastructure

- **VPC** with public/private subnets across multiple AZs
- **Dev: Public subnets** with public IPs for ECS (no NAT costs)
- **Prod: Private subnets** with NAT Gateway for security
- **Multi-NAT Gateway** support for production HA
- **S3 Gateway Endpoint** (free) for ECR image layers
- **VPC Flow Logs** to CloudWatch for network traffic analysis

### Load Balancing

- **ALB** with HTTPS (ACM certificate with DNS validation)
- **Path-based routing**: `/api/*`, `/socket.io/*`, `/ws/*`
- **WebSocket support** with 300s idle timeout
- **Sticky sessions** for Socket.IO polling fallback
- **Graceful draining** with configurable deregistration delays
- **Access logs** to S3 for security analysis
- **Health check grace period** configurable per service

### Security

- **AWS WAF** (5k+ DAU stacks) with managed rules, bot control, and rate limiting
  - Note: Bot Control rule set costs ~$10/mo + $1/million requests (COMMON inspection level)
- **Security groups** with least-privilege access:
  - ALB: HTTPS ingress from internet only
  - ECS: Ingress only from ALB (API/Realtime) or none (Workers)
  - RDS/Redis: Ingress only from ECS security groups
  - ECS egress is 0.0.0.0/0 for external APIs (Auth0, push services)
- **Prod: Private subnets** with NAT Gateway (defense in depth)
- **Dev: Public subnets** with security groups only (cost optimized)
- **Secrets Manager** for database and Redis credentials
- **Redis AUTH token** for defense-in-depth authentication
- **IAM roles** with minimal permissions
- **Encryption at rest** for all data stores
- **TLS 1.3** on ALB
- **ECS Exec** enabled for debugging (see [Security Note](#ecs-exec-security) below)

### Compute

- **ECS Fargate** with FARGATE/FARGATE_SPOT capacity providers
- **Three services**: API, Realtime, Workers
- **Container Insights** enabled
- **ECS Exec** enabled for container shell access
- **Auto-scaling** (10k+ DAU stacks):
  - API: CPU, memory, request count
  - Realtime: CPU, memory, connections, event loop lag
  - Workers: SQS queue depth, oldest message age
- **Graceful shutdown** with configurable stop timeouts

### Database

- **RDS PostgreSQL 16** with optional Multi-AZ
- **RDS Proxy** for connection pooling (10k+ DAU)
- **Optimized parameter group** for chat workloads
- **Performance Insights** enabled
- **AWS Backup** for automated disaster recovery:
  - Daily backups at 3 AM UTC (all environments)
  - Weekly backups on Sundays at 4 AM UTC (production only)
  - Retention: 7 days (dev) / 35 days daily + 90 days weekly (prod)
  - Point-in-time recovery enabled for production
  - Centralized backup vault with encryption

### Cache

- **ElastiCache Redis 7** with optional cluster split (50k+ DAU):
  - **Adapter cluster**: High throughput pub/sub for Socket.IO
  - **State cluster**: Presence, sessions, rate limits
- **Encryption** in transit and at rest
- **Automatic failover** with Multi-AZ

### Messaging

- **SQS queues** for push notifications and offline messages
- **Dead letter queues** for failed messages
- **Server-side encryption**

### Observability

- **CloudWatch Dashboard** with comprehensive metrics
- **20+ CloudWatch Alarms** for ECS, RDS, Redis, SQS, ALB
- **SNS Topic** for alert notifications
- **Operational Runbook** (`docs/runbook.md`) with incident response procedures

### DevOps

- **CI/CD Pipeline** example (`.github/workflows/deploy.yml`)
- **Multi-arch Docker builds** support (AMD64 + ARM64)
- **Automated health checks** with rollback capability

### Architecture Notes

**Why no CloudFront?** CloudFront does not support WebSocket connections. For realtime chat applications using Socket.IO/WebSockets, ALB is the correct choice.

**Frontend Architecture:**

- **Web**: Hosted on Vercel at your root domain (e.g., `chat.example.com`)
- **Mobile**: Expo app distributed via App Store / Google Play
- **API + WebSocket**: This infrastructure at `api.chat.example.com`

Vercel manages the DNS for your root domain. This infrastructure creates only the `api.*` subdomain record pointing to the ALB.

**Service-to-Service Communication**: Currently, all services are internet-facing through the ALB. If you need internal service-to-service calls (e.g., API → Realtime for targeted notifications), consider:

1. **ECS Service Connect** (recommended): AWS-managed service mesh with automatic service discovery, load balancing, and observability. Add to your ECS services:

   ```typescript
   serviceConnectConfiguration: {
     enabled: true,
     namespace: "chat.local",
     services: [{
       portName: "api",
       discoveryName: "api",
       clientAliases: [{ port: 3000 }]
     }]
   }
   ```

2. **Cloud Map**: Lower-level service discovery using DNS. Services register automatically and can be found via `api.chat.local`.

3. **Internal ALB**: Add a second, internal ALB for service-to-service traffic. More expensive but familiar pattern.

The current architecture works well when all external traffic flows through the ALB and internal coordination happens via Redis pub/sub (which is the Socket.IO adapter pattern).

## Deploying Your Application

> **Important:** The infrastructure deploys with placeholder containers that do nothing. You must build and push your actual application images before ECS services will work properly.

### First-Time Deployment (Infrastructure + Images)

#### Step 1: Deploy Infrastructure First

```bash
# Select your stack
pulumi stack select dev  # or 1k-dau, 10k-dau, etc.

# Deploy infrastructure (creates ECR repos, but services will have placeholder images)
pulumi up
```

The ECS services will start but won't serve real traffic yet - they're running placeholder containers.

#### Step 2: Get ECR Repository URLs

```bash
# Get the repository URLs from Pulumi outputs
pulumi stack output apiRepositoryUrl
pulumi stack output realtimeRepositoryUrl
pulumi stack output workersRepositoryUrl

# Example output:
# 123456789.dkr.ecr.eu-central-1.amazonaws.com/realtime-chat-dev/api
```

#### Step 3: Build and Push Your Images

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region eu-central-1 | \
  docker login --username AWS --password-stdin $(pulumi stack output apiRepositoryUrl | cut -d'/' -f1)

# Build and push API image
docker build -t $(pulumi stack output apiRepositoryUrl):v1 ./apps/api
docker push $(pulumi stack output apiRepositoryUrl):v1

# Build and push Realtime image
docker build -t $(pulumi stack output realtimeRepositoryUrl):v1 ./apps/realtime
docker push $(pulumi stack output realtimeRepositoryUrl):v1

# Build and push Workers image
docker build -t $(pulumi stack output workersRepositoryUrl):v1 ./apps/workers
docker push $(pulumi stack output workersRepositoryUrl):v1
```

#### Step 4: Update Task Definitions with Real Images

Edit `src/ecs-services/index.ts` and `src/ecs-services/workers.ts` to use your ECR images:

```typescript
// Before (placeholder):
image: "node:20-alpine",
command: ["sh", "-c", "echo 'Replace with your API image' && sleep infinity"],

// After (real image):
image: pulumi.interpolate`${ecrOutputs.apiRepository.repositoryUrl}:v1`,
// Remove the 'command' field entirely - let the container use its default CMD
```

#### Step 5: Redeploy with Real Images

```bash
pulumi up
```

### Subsequent Deployments (Image Updates Only)

Once infrastructure is set up, deploy new versions with:

```bash
# Build and push new version
docker build -t $(pulumi stack output apiRepositoryUrl):v2 ./apps/api
docker push $(pulumi stack output apiRepositoryUrl):v2

# Update image tag in code and redeploy
# (or use AWS CLI to update service directly)
aws ecs update-service \
  --cluster $(pulumi stack output ecsClusterName) \
  --service $(pulumi stack output apiServiceName) \
  --force-new-deployment
```

### Verify Deployment

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster $(pulumi stack output ecsClusterName) \
  --services $(pulumi stack output apiServiceName) \
  --query 'services[0].{running:runningCount,desired:desiredCount,status:status}'

# Check health endpoint
curl https://$(pulumi stack output -j | jq -r '.domainName // .albDnsName')/api/health

# View logs
aws logs tail /ecs/realtime-chat-dev/api --follow
```

## Application Integration

### Socket.IO with Redis Adapter

```typescript
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";

// Adapter Redis for pub/sub
const adapterRedis = new Redis({
  host: process.env.REDIS_ADAPTER_HOST,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
});

// State Redis for presence/sessions (separate in 50k+ stacks)
const stateRedis = new Redis({
  host: process.env.REDIS_STATE_HOST,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
});

// Configure CORS for Vercel web frontend and Expo mobile app
const io = new Server(server, {
  cors: {
    origin: [
      process.env.WEB_URL, // Vercel: https://chat.example.com
      "exp://*", // Expo development
      "https://*.expo.dev", // Expo preview
    ],
    credentials: true,
  },
});

io.adapter(createAdapter(adapterRedis, adapterRedis.duplicate()));
```

### Custom Metrics for Auto-Scaling

```typescript
import { CloudWatch } from "@aws-sdk/client-cloudwatch";

const cloudwatch = new CloudWatch({ region: process.env.AWS_REGION });

setInterval(async () => {
  await cloudwatch.putMetricData({
    Namespace: process.env.METRICS_NAMESPACE,
    MetricData: [
      { MetricName: "ActiveConnections", Value: io.engine.clientsCount },
      { MetricName: "EventLoopLagMs", Value: getEventLoopLag() },
    ],
  });
}, 60000);
```

### Graceful Shutdown

```typescript
process.on("SIGTERM", async () => {
  io.engine.close(); // Stop accepting connections
  await redis.quit(); // Cleanup
  process.exit(0);
});
```

## Scaling Strategy

| Metric                 | Threshold         | Action    |
| ---------------------- | ----------------- | --------- |
| ActiveConnections/Task | > 3,000           | Scale out |
| EventLoopLagMs (p95)   | > 100ms for 3 min | Scale out |
| CPU                    | > 60%             | Scale out |
| Memory                 | > 70%             | Scale out |

> ⚠️ **Reality Check**: Real-world chat apps typically achieve **1k-5k connections per task** depending on message rate and features, not the 10k+ you see in synthetic benchmarks.

## Cost Breakdown

### Dev (~$50-80/month)

- ALB: ~$18
- **NAT Gateway: $0** (uses public subnets)
- ECS Fargate (3 minimal tasks): ~$15
- RDS (t3.micro): ~$13
- Redis (t3.micro): ~$12
- **VPC Endpoints: $0** (removed)
- VPC Flow Logs: ~$2-5
- ALB Access Logs (S3): ~$1-5
- CloudWatch + misc: ~$5-15

### 1k DAU (~$150-200/month)

- ALB: ~$20
- NAT Gateway (1): ~$35
- ECS Fargate (3 small tasks): ~$40
- RDS (t3.small): ~$25
- Redis (t3.small): ~$25
- AWS Backup: ~$5
- CloudWatch + misc: ~$10-30

### 10k DAU (~$350-500/month)

- ALB: ~$30
- NAT Gateway (2): ~$70
- ECS Fargate (5 tasks): ~$100
- RDS (t3.medium): ~$60
- RDS Proxy: ~$25
- Redis (t3.medium × 2): ~$50
- WAF: ~$20
- AWS Backup: ~$10
- CloudWatch + misc: ~$30-50

### 100k DAU (~$1,200-1,500/month)

- ALB: ~$50
- NAT Gateway (3): ~$105
- ECS Fargate (13 tasks): ~$400
- RDS (r6g.xlarge, Multi-AZ): ~$400
- RDS Proxy: ~$50
- Redis Split (adapter: 3×m6g.large + state: 3×m6g.medium): ~$300
- WAF (including Bot Control): ~$35
- AWS Backup: ~$20-30
- CloudWatch + misc: ~$50-100

### Cost Optimization Tips

1. **ARM64/Graviton (up to 20% savings)**: AWS Graviton processors offer better price-performance. To enable:

   ```typescript
   // In ECS task definitions
   runtimePlatform: {
     cpuArchitecture: "ARM64",
     operatingSystemFamily: "LINUX"
   }
   ```

   **Requirements**: Build multi-arch Docker images (`docker buildx build --platform linux/amd64,linux/arm64`) and use ARM-compatible base images (most `node:` images support both).

2. **FARGATE_SPOT (up to 70% savings)**: Already configured in all stacks. Adjust the weight:

   ```yaml
   fargateSpotWeight: 80 # 80% spot, 20% on-demand
   ```

3. **Reserved Capacity**: For predictable workloads, consider Compute Savings Plans (up to 50% savings on Fargate).

4. **Right-sizing**: Monitor CloudWatch metrics and adjust task CPU/memory. Over-provisioning is common.

5. **Dev Environment**: Dev stack uses public subnets (no NAT) to save ~$35/month.

## Cleanup

```bash
# Destroy all resources
pulumi destroy

# Remove stack
pulumi stack rm <stack-name>
```

## Troubleshooting

### ECS Tasks Not Starting

- Check CloudWatch Logs for container errors
- Verify secrets are accessible
- For dev stack: ensure tasks have public IPs assigned

### WebSocket Connections Dropping

- Verify ALB idle timeout is 300s
- Check Redis connectivity
- Review WAF rate limits (if enabled)

### Database Connection Issues

- Check security group rules
- Verify RDS Proxy health (if enabled)
- Check Secrets Manager access

### High Event Loop Lag

- Review message payload sizes
- Consider upgrading to higher DAU stack
- Verify Redis adapter isn't bottlenecked

### Debugging with ECS Exec

ECS Exec is enabled on all services, allowing shell access to running containers:

```bash
# Get a shell in a running API container
aws ecs execute-command \
  --cluster $(pulumi stack output ecsClusterName) \
  --task <task-id> \
  --container api \
  --interactive \
  --command "/bin/sh"

# Find task IDs
aws ecs list-tasks --cluster $(pulumi stack output ecsClusterName) --service-name $(pulumi stack output apiServiceName)
```

## Security Notes

### ECS Exec Security

ECS Exec provides interactive shell access to containers (similar to `kubectl exec`). This is useful for debugging but has security implications:

- **Access is controlled by IAM** - Users need `ecs:ExecuteCommand` permission
- **Sessions are logged** to CloudWatch Logs (audit trail)
- **Consider disabling in production** if not needed

To disable ECS Exec, set `enableExecuteCommand: false` in [src/ecs-services/index.ts](src/ecs-services/index.ts) and [src/ecs-services/workers.ts](src/ecs-services/workers.ts).

## License

MIT
