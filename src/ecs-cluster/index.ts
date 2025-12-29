import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";

export interface EcsClusterOutputs {
  cluster: aws.ecs.Cluster;
  clusterCapacityProviders: aws.ecs.ClusterCapacityProviders;
}

/**
 * Creates ECS Cluster with Fargate capacity providers
 * - FARGATE for on-demand capacity
 * - FARGATE_SPOT for cost-optimized workloads (optional)
 * - Container Insights enabled for observability
 */
export function createEcsCluster(config: Config): EcsClusterOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Create ECS Cluster
  const cluster = new aws.ecs.Cluster(`${baseName}-cluster`, {
    name: `${baseName}-cluster`,
    settings: [
      {
        name: "containerInsights",
        value: "enabled",
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-cluster`,
    },
  });

  // Configure capacity providers
  const clusterCapacityProviders = new aws.ecs.ClusterCapacityProviders(`${baseName}-cluster-cp`, {
    clusterName: cluster.name,
    capacityProviders: ["FARGATE", "FARGATE_SPOT"],
    defaultCapacityProviderStrategies: [
      {
        // Use FARGATE for reliability in production
        capacityProvider: "FARGATE",
        weight: config.environment === "prod" ? 100 : 50,
        base: 1,
      },
      {
        // Use FARGATE_SPOT for cost savings in dev
        capacityProvider: "FARGATE_SPOT",
        weight: config.environment === "prod" ? 0 : 50,
        base: 0,
      },
    ],
  });

  return {
    cluster,
    clusterCapacityProviders,
  };
}
