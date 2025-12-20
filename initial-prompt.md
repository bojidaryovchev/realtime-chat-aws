You are a senior cloud engineer.

Your task is to design and implement a **production-ready MVP infrastructure** using **Pulumi (TypeScript)** on **AWS**, capable of scaling to **~100k DAU** with **realtime chat**, while keeping **full control over backend code** (no managed realtime abstractions).

## Core Requirements

### Runtime

- AWS only
- Infrastructure defined entirely in **Pulumi (TypeScript)**
- Stateless services, horizontally scalable
- No Kubernetes (do NOT use EKS)

### Backend Stack

- **ECS Fargate**

  - `api` service:
    - Node.js
    - Fastify
    - REST (or GraphQL)
  - `realtime` service:
    - Node.js
    - Fastify + **Socket.IO**
    - Handles chat + realtime notifications

- **Application Load Balancer (ALB)**
  - HTTPS (ACM)
  - Path routing:
    - `/api/*` → API service
    - `/socket.io/*` (or `/ws/*`) → Realtime service
  - WebSocket support
  - Increased idle timeout (e.g. 300s)

### Data Layer

- **Postgres**

  - **RDS PostgreSQL (Multi-AZ)**
  - Used for:
    - users
    - conversations
    - messages
    - delivery/read receipts
  - NOT Aurora Serverless
  - NOT Neon for production

- **Redis**
  - **ElastiCache Redis (managed, in-VPC)**
  - Used for:
    - Socket.IO Redis adapter (pub/sub across ECS tasks)
    - ephemeral realtime state (presence, rooms)
  - Do NOT self-host Redis
  - Do NOT use Upstash for critical realtime path

### Async / Background

- **SQS**
  - For:
    - push notifications
    - offline message fanout
  - Optional worker ECS service

### Networking

- **VPC**
  - Public subnets (ALB)
  - Private subnets (ECS, RDS, Redis)
  - NAT Gateway (single for MVP)
- Security groups:
  - ALB → ECS only
  - ECS → RDS/Redis only

### Secrets & Config

- Secrets via **SSM Parameter Store or Secrets Manager**
- Inject into ECS tasks securely
- No secrets in Pulumi plaintext

### Observability

- CloudWatch Logs
- CloudWatch Metrics + alarms
- Structured JSON logging

---

## Architecture Constraints

- Full control over realtime protocol (Socket.IO)
- No AppSync
- No API Gateway WebSockets
- No Vercel backend
- No serverless WebSocket providers
- No multi-region (single region is fine)

---

## Scaling Model

- ECS Service Auto Scaling:
  - CPU / memory
  - (API) ALB RequestCountPerTarget
- Redis enables cross-task socket fanout
- Design assumes:
  - chat + realtime notifications only
  - no live location streaming
  - no high-frequency presence

---

## Deliverables

1. Pulumi project structure (`dev`, `prod` stacks)
2. VPC
3. ALB with HTTPS + routing
4. ECS Cluster
5. ECS Fargate services (`api`, `realtime`)
6. RDS Postgres
7. ElastiCache Redis
8. SQS
9. IAM roles & security groups
10. Outputs (ALB DNS, etc.)

Build this as a clean, production-ready baseline that can realistically handle **100k DAU**.

END
