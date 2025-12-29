import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";

export interface EcrOutputs {
  apiRepository: aws.ecr.Repository;
  realtimeRepository: aws.ecr.Repository;
  workersRepository: aws.ecr.Repository;
}

/**
 * Creates ECR repositories for container images:
 * - API service image
 * - Realtime service image
 * - Workers service image
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
    // IMMUTABLE in prod prevents accidental tag overwrites
    imageTagMutability: config.environment === "prod" ? "IMMUTABLE" : "MUTABLE",
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
          description: "Keep last 20 version-tagged images (v*, sha-*)",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["v", "sha-"],
            countType: "imageCountMoreThan",
            countNumber: 20,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 2,
          description: "Keep last 5 branch-tagged images (latest, main, dev)",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["latest", "main", "dev"],
            countType: "imageCountMoreThan",
            countNumber: 5,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 3,
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
    imageTagMutability: config.environment === "prod" ? "IMMUTABLE" : "MUTABLE",
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
          description: "Keep last 20 version-tagged images (v*, sha-*)",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["v", "sha-"],
            countType: "imageCountMoreThan",
            countNumber: 20,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 2,
          description: "Keep last 5 branch-tagged images (latest, main, dev)",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["latest", "main", "dev"],
            countType: "imageCountMoreThan",
            countNumber: 5,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 3,
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

  // Workers Repository
  const workersRepository = new aws.ecr.Repository(`${baseName}-workers-repo`, {
    name: `${baseName}/workers`,
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    imageTagMutability: config.environment === "prod" ? "IMMUTABLE" : "MUTABLE",
    encryptionConfigurations: [
      {
        encryptionType: "AES256",
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-workers-repo`,
    },
  });

  // Workers Lifecycle Policy
  new aws.ecr.LifecyclePolicy(`${baseName}-workers-lifecycle`, {
    repository: workersRepository.name,
    policy: JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: "Keep last 20 version-tagged images (v*, sha-*)",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["v", "sha-"],
            countType: "imageCountMoreThan",
            countNumber: 20,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 2,
          description: "Keep last 5 branch-tagged images (latest, main, dev)",
          selection: {
            tagStatus: "tagged",
            tagPrefixList: ["latest", "main", "dev"],
            countType: "imageCountMoreThan",
            countNumber: 5,
          },
          action: {
            type: "expire",
          },
        },
        {
          rulePriority: 3,
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
    workersRepository,
  };
}
