# ECS Cluster Module Documentation

> **File**: `src/ecs-cluster/index.ts`  
> **Purpose**: Creates the Fargate cluster that runs all containers

---

## Overview

ECS Cluster is the logical grouping of container tasks. With Fargate, AWS manages the underlying infrastructure.

### What This Module Creates

| Resource | Purpose |
|----------|---------|
| ECS Cluster | Logical container for tasks/services |
| Capacity Providers | FARGATE and FARGATE_SPOT configuration |

---

## Complete Code Walkthrough

```typescript
const cluster = new aws.ecs.Cluster(`${baseName}-cluster`, {
  name: `${baseName}-cluster`,
  settings: [
    {
      name: "containerInsights",
      value: "enabled",
    },
  ],
});
```

### Container Insights

| Setting | Purpose |
|---------|---------|
| `containerInsights: enabled` | Collect CPU, memory, network metrics per container |

**Why enabled?** Default is disabled. Costs ~$0.30/container/month but essential for:
- Debugging performance issues
- Capacity planning
- Alerting on resource exhaustion

---

## Capacity Provider Strategy

```typescript
const capacityProviders = new aws.ecs.ClusterCapacityProviders(
  `${baseName}-capacity-providers`,
  {
    clusterName: cluster.name,
    capacityProviders: ["FARGATE", "FARGATE_SPOT"],
    defaultCapacityProviderStrategies: [
      {
        base: 1,
        weight: config.environment === "prod" ? 100 : 0,
        capacityProvider: "FARGATE",
      },
      {
        base: 0,
        weight: config.environment === "prod" ? 0 : 100,
        capacityProvider: "FARGATE_SPOT",
      },
    ],
  }
);
```

### Strategy Breakdown

| Environment | FARGATE Weight | FARGATE_SPOT Weight | Effect |
|-------------|----------------|---------------------|--------|
| **prod** | 100 | 0 | 100% on-demand (reliable) |
| **dev** | 0 | 100 | 100% spot (cheap) |

### Why `base: 1` for FARGATE?

```
base: 1  = At least 1 task always uses this provider
weight: X = Relative proportion for additional tasks
```

In production: `base: 1` ensures at least one task runs on reliable FARGATE even if strategy weights changed accidentally.

---

## FARGATE vs FARGATE_SPOT

| Aspect | FARGATE | FARGATE_SPOT |
|--------|---------|--------------|
| Cost | Full price | Up to 70% cheaper |
| Availability | Always available | Can be interrupted with 2-min warning |
| Use case | Production, critical services | Dev, batch processing, fault-tolerant |

### Spot Interruption Handling

ECS automatically:
1. Receives 2-minute warning from AWS
2. Attempts to launch replacement task on FARGATE (if allowed)
3. Drains connections from interrupted task

**For chat app**: Acceptable in dev (brief disconnects) but NOT in prod (user experience).

---

## Exports

```typescript
export const ecsClusterOutputs = {
  clusterId: cluster.id,
  clusterArn: cluster.arn,
  clusterName: cluster.name,
};
```

| Export | Used By |
|--------|---------|
| `clusterId` | Reference for other stacks |
| `clusterArn` | IAM policies, service definitions |
| `clusterName` | Service deployment, CloudWatch metrics |

---

## Cost

ECS Cluster itself is **free**. You pay for:
- Fargate tasks (vCPU + memory per second)
- Container Insights (~$0.30/container/month)
