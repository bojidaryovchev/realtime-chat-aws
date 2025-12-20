# Realtime Chat AWS Infrastructure

Production-ready AWS infrastructure for a realtime chat application using **Pulumi (TypeScript)**, designed to scale to **~100k DAU**.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Internet                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Application Load Balancer (HTTPS)                    │
│                                                                         │
│    /api/*  →  API Target Group       /socket.io/*  →  Realtime TG      │
│                                                                         │
│    • 300s idle timeout (WebSocket)    • Sticky sessions enabled        │
│    • TLS 1.3                          • HTTP → HTTPS redirect          │
└─────────────────────────────────────────────────────────────────────────┘
                    │                                    │
        ┌───────────┴───────────┐            ┌───────────┴───────────┐
        │   ECS Fargate (API)   │            │ ECS Fargate (Realtime)│
        │                       │            │                       │
        │   • Node.js/Fastify   │            │   • Node.js/Fastify   │
        │   • REST/GraphQL      │            │   • Socket.IO         │
        │   • Auto-scaling      │            │   • Redis Adapter     │
        │     (CPU + Requests)  │            │   • Auto-scaling      │
        └───────────┬───────────┘            └───────────┬───────────┘
                    │                                    │
                    └──────────────┬─────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
    ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
    │ RDS PostgreSQL│      │ ElastiCache   │      │     SQS       │
    │               │      │    Redis      │      │               │
    │ • Multi-AZ    │      │               │      │ • Push Queue  │
    │ • Encrypted   │      │ • Pub/Sub     │      │ • Offline Q   │
    │ • Automated   │      │ • Presence    │      │ • DLQ         │
    │   backups     │      │ • Sessions    │      │               │
    └───────────────┘      └───────────────┘      └───────────────┘
```

## Features

### Infrastructure
- **VPC** with public/private subnets across multiple AZs
- **Single NAT Gateway** for MVP cost optimization
- **S3 VPC Endpoint** to reduce NAT costs

### Load Balancing
- **ALB** with HTTPS (ACM certificate)
- **Path-based routing**: `/api/*` and `/socket.io/*`
- **WebSocket support** with 300s idle timeout
- **Sticky sessions** for Socket.IO polling fallback

### Compute
- **ECS Fargate** with FARGATE/FARGATE_SPOT capacity providers
- **Container Insights** enabled
- **Auto-scaling** based on CPU, memory, and request count

### Database
- **RDS PostgreSQL 15** with Multi-AZ (production)
- **Optimized parameter group** for chat workloads
- **Performance Insights** enabled
- **Automated backups** with configurable retention

### Cache
- **ElastiCache Redis 7** for Socket.IO adapter
- **Encryption** in transit and at rest
- **Automatic failover** (production)
- **Optimized for pub/sub** workloads

### Messaging
- **SQS queues** for push notifications and offline messages
- **Dead letter queues** for failed messages
- **Server-side encryption**

### Security
- **Security groups** with least-privilege access
- **Secrets Manager** for database credentials
- **IAM roles** with minimal permissions
- **Encryption at rest** for all data stores

### Observability
- **CloudWatch Logs** with configurable retention
- **CloudWatch Dashboard** with key metrics
- **CloudWatch Alarms** for critical thresholds
- **SNS Topic** for alert notifications

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Pulumi CLI** installed (`npm install -g @pulumi/pulumi`)
3. **Node.js** 18+ and npm
4. **ACM Certificate** for HTTPS (create manually or via DNS validation)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Pulumi Stack

```bash
# Initialize dev stack
pulumi stack init dev

# Or for production
pulumi stack init prod
```

### 3. Set Required Configuration

```bash
# Set AWS region
pulumi config set aws:region us-east-1

# Set your ACM certificate ARN (required for HTTPS)
pulumi config set certificateArn arn:aws:acm:us-east-1:123456789:certificate/xxx

# Optional: Set custom domain
pulumi config set domainName chat.example.com
```

### 4. Deploy Infrastructure

```bash
# Preview changes
pulumi preview

# Deploy
pulumi up
```

### 5. Get Outputs

```bash
pulumi stack output
```

## Configuration Options

| Config Key | Default (dev) | Default (prod) | Description |
|------------|---------------|----------------|-------------|
| `environment` | dev | prod | Environment name |
| `vpcCidr` | 10.0.0.0/16 | 10.0.0.0/16 | VPC CIDR block |
| `availabilityZones` | 2 AZs | 3 AZs | Availability zones |
| `apiServiceDesiredCount` | 1 | 3 | API service task count |
| `apiServiceCpu` | 256 | 512 | API service CPU units |
| `apiServiceMemory` | 512 | 1024 | API service memory (MB) |
| `realtimeServiceDesiredCount` | 2 | 4 | Realtime service task count |
| `realtimeServiceCpu` | 512 | 1024 | Realtime service CPU units |
| `realtimeServiceMemory` | 1024 | 2048 | Realtime service memory (MB) |
| `rdsInstanceClass` | db.t3.micro | db.r6g.large | RDS instance class |
| `rdsAllocatedStorage` | 20 | 100 | RDS storage (GB) |
| `rdsMultiAz` | false | true | RDS Multi-AZ deployment |
| `redisNodeType` | cache.t3.micro | cache.r6g.large | Redis node type |
| `redisNumCacheNodes` | 1 | 2 | Redis replica count |

## Project Structure

```
realtime-chat-aws/
├── index.ts                 # Main Pulumi program
├── config/
│   └── index.ts             # Configuration loader
├── src/
│   ├── vpc/                 # VPC, subnets, NAT, IGW
│   ├── security-groups/     # Security groups
│   ├── alb/                 # ALB, listeners, target groups
│   ├── ecs-cluster/         # ECS cluster
│   ├── ecs-services/        # ECS services, task definitions
│   ├── ecr/                 # ECR repositories
│   ├── rds/                 # RDS PostgreSQL
│   ├── redis/               # ElastiCache Redis
│   ├── sqs/                 # SQS queues
│   ├── iam/                 # IAM roles and policies
│   └── observability/       # CloudWatch, alarms, dashboard
├── Pulumi.yaml              # Pulumi project file
├── Pulumi.dev.yaml          # Dev stack config
├── Pulumi.prod.yaml         # Prod stack config
├── package.json
└── tsconfig.json
```

## Deploying Your Application

### 1. Build and Push Container Images

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com

# Build and push API image
docker build -t <account>.dkr.ecr.us-east-1.amazonaws.com/realtime-chat-aws-dev/api:v1 ./api
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/realtime-chat-aws-dev/api:v1

# Build and push Realtime image
docker build -t <account>.dkr.ecr.us-east-1.amazonaws.com/realtime-chat-aws-dev/realtime:v1 ./realtime
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/realtime-chat-aws-dev/realtime:v1
```

### 2. Update Task Definitions

Update the container images in `src/ecs-services/index.ts` to use your ECR images instead of the placeholder `node:20-alpine`.

### 3. Deploy Updated Infrastructure

```bash
pulumi up
```

## Socket.IO Configuration

Your realtime service should configure Socket.IO with the Redis adapter:

```typescript
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const io = new Server(server, {
  path: '/socket.io',
  pingTimeout: parseInt(process.env.SOCKET_IO_PING_TIMEOUT || '30000'),
  pingInterval: parseInt(process.env.SOCKET_IO_PING_INTERVAL || '25000'),
});

// Redis adapter for cross-task communication
const pubClient = createClient({
  url: `rediss://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
});
```

## Scaling Considerations

### For ~100k DAU:
- **API Service**: 3-5 tasks (512 CPU, 1GB memory each)
- **Realtime Service**: 4-8 tasks (1024 CPU, 2GB memory each)
- **RDS**: db.r6g.large with Multi-AZ
- **Redis**: cache.r6g.large with 2 nodes

### Auto-Scaling Thresholds:
- **API**: CPU 70%, Request count 1000/target
- **Realtime**: CPU 60%, Memory 70%

### Estimated WebSocket Connections:
- ~10k concurrent connections per Realtime task
- Peak of ~40-80k concurrent connections with 4-8 tasks

## Cost Estimates (us-east-1)

### Dev Environment (~$150-200/month):
- ALB: ~$20
- NAT Gateway: ~$35
- ECS Fargate: ~$30
- RDS (t3.micro): ~$15
- Redis (t3.micro): ~$15
- CloudWatch: ~$10
- Data transfer: ~$20-50

### Production Environment (~$800-1200/month):
- ALB: ~$50
- NAT Gateway: ~$35
- ECS Fargate: ~$200-400
- RDS (r6g.large, Multi-AZ): ~$300
- Redis (r6g.large, 2 nodes): ~$200
- CloudWatch: ~$30
- Data transfer: ~$50-100

## Cleanup

```bash
# Destroy all resources
pulumi destroy

# Remove stack
pulumi stack rm dev
```

## Troubleshooting

### ECS Tasks Not Starting
1. Check CloudWatch Logs for container errors
2. Verify security groups allow required traffic
3. Ensure secrets are accessible by task execution role

### WebSocket Connections Dropping
1. Verify ALB idle timeout is set to 300s
2. Check Redis connectivity for Socket.IO adapter
3. Review security group rules for ECS → Redis

### Database Connection Issues
1. Verify ECS → RDS security group rules
2. Check Secrets Manager access in task execution role
3. Ensure RDS is in the correct subnet group

## License

MIT
