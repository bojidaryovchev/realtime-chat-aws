import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";

export interface EcrOutputs {
  apiRepository: aws.ecr.Repository;
  realtimeRepository: aws.ecr.Repository;
}

/**
 * Creates ECR repositories for container images:
 * - API service image
 * - Realtime service image
 * 
 * Includes lifecycle policies to manage image retention
 */
export function createEcrRepositories(config: Config): EcrOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // API Repository
  const apiRepository = new aws.ecr.Repository(`${baseName}-api-repo`, {
    name: `${baseName}/api`,
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    imageTagMutability: "MUTABLE",
    encryptionConfigurations: [
      {
        encryptionType: "AES256",
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-api-repo`,
    },
  });

  // API Lifecycle Policy
  new aws.ecr.LifecyclePolicy(`${baseName}-api-lifecycle`, {
    repository: apiRepository.name,
    policy: JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: "Keep last 10 tagged images",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["v"],
            countType: "imageCountMoreThan",
            countNumber: 10,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 2,
          description: "Delete untagged images older than 7 days",
          selection: {
            tagStatus: "untagged",
            countType: "sinceImagePushed",
            countUnit: "days",
            countNumber: 7,
          },
          action: {
            type: "expire",
          },
        },
      ],
    }),
  });

  // Realtime Repository
  const realtimeRepository = new aws.ecr.Repository(`${baseName}-realtime-repo`, {
    name: `${baseName}/realtime`,
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    imageTagMutability: "MUTABLE",
    encryptionConfigurations: [
      {
        encryptionType: "AES256",
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-realtime-repo`,
    },
  });

  // Realtime Lifecycle Policy
  new aws.ecr.LifecyclePolicy(`${baseName}-realtime-lifecycle`, {
    repository: realtimeRepository.name,
    policy: JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: "Keep last 10 tagged images",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["v"],
            countType: "imageCountMoreThan",
            countNumber: 10,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 2,
          description: "Delete untagged images older than 7 days",
          selection: {
            tagStatus: "untagged",
            countType: "sinceImagePushed",
            countUnit: "days",
            countNumber: 7,
          },
          action: {
            type: "expire",
          },
        },
      ],
    }),
  });

  return {
    apiRepository,
    realtimeRepository,
  };
}
