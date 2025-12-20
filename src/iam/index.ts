import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";
import { RdsOutputs } from "../rds";
import { SqsOutputs } from "../sqs";

export interface IamOutputs {
  ecsTaskExecutionRole: aws.iam.Role;
  ecsApiTaskRole: aws.iam.Role;
  ecsRealtimeTaskRole: aws.iam.Role;
}

/**
 * Creates IAM roles for ECS:
 * - Task Execution Role: Allows ECS to pull images, write logs, access secrets
 * - API Task Role: Runtime permissions for API service
 * - Realtime Task Role: Runtime permissions for Realtime service
 */
export function createIamRoles(
  config: Config,
  sqsOutputs: SqsOutputs,
  rdsOutputs: RdsOutputs
): IamOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;
  const currentRegion = aws.getRegionOutput();
  const currentAccount = aws.getCallerIdentityOutput();

  // ECS Task Execution Role (shared by all services)
  const ecsTaskExecutionRole = new aws.iam.Role(
    `${baseName}-ecs-execution-role`,
    {
      name: `${baseName}-ecs-execution-role`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      tags: {
        ...tags,
        Name: `${baseName}-ecs-execution-role`,
      },
    }
  );

  // Attach managed policy for basic ECS task execution
  new aws.iam.RolePolicyAttachment(`${baseName}-ecs-execution-policy`, {
    role: ecsTaskExecutionRole.name,
    policyArn:
      "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  });

  // Custom policy for secrets access
  const secretsAccessPolicy = new aws.iam.Policy(
    `${baseName}-secrets-access-policy`,
    {
      name: `${baseName}-secrets-access-policy`,
      description: "Allow ECS tasks to access secrets",
      policy: pulumi.interpolate`{
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Action": [
              "secretsmanager:GetSecretValue"
            ],
            "Resource": [
              "${rdsOutputs.dbCredentialsSecret.arn}"
            ]
          },
          {
            "Effect": "Allow",
            "Action": [
              "ssm:GetParameters",
              "ssm:GetParameter"
            ],
            "Resource": "arn:aws:ssm:${currentRegion.name}:${currentAccount.accountId}:parameter/${baseName}/*"
          },
          {
            "Effect": "Allow",
            "Action": [
              "kms:Decrypt"
            ],
            "Resource": "*",
            "Condition": {
              "StringEquals": {
                "kms:ViaService": "secretsmanager.${currentRegion.name}.amazonaws.com"
              }
            }
          }
        ]
      }`,
      tags: {
        ...tags,
        Name: `${baseName}-secrets-access-policy`,
      },
    }
  );

  new aws.iam.RolePolicyAttachment(`${baseName}-secrets-access-attachment`, {
    role: ecsTaskExecutionRole.name,
    policyArn: secretsAccessPolicy.arn,
  });

  // API Task Role - Runtime permissions
  const ecsApiTaskRole = new aws.iam.Role(`${baseName}-api-task-role`, {
    name: `${baseName}-api-task-role`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
          Action: "sts:AssumeRole",
        },
      ],
    }),
    tags: {
      ...tags,
      Name: `${baseName}-api-task-role`,
    },
  });

  // API Task Policy - SQS send, CloudWatch metrics
  const apiTaskPolicy = new aws.iam.Policy(`${baseName}-api-task-policy`, {
    name: `${baseName}-api-task-policy`,
    description: "Runtime permissions for API service",
    policy: pulumi.interpolate`{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": [
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl"
          ],
          "Resource": [
            "${sqsOutputs.pushNotificationQueue.arn}",
            "${sqsOutputs.offlineMessageQueue.arn}"
          ]
        },
        {
          "Effect": "Allow",
          "Action": [
            "cloudwatch:PutMetricData"
          ],
          "Resource": "*",
          "Condition": {
            "StringEquals": {
              "cloudwatch:namespace": "${baseName}"
            }
          }
        },
        {
          "Effect": "Allow",
          "Action": [
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          "Resource": "*"
        }
      ]
    }`,
    tags: {
      ...tags,
      Name: `${baseName}-api-task-policy`,
    },
  });

  new aws.iam.RolePolicyAttachment(`${baseName}-api-task-policy-attachment`, {
    role: ecsApiTaskRole.name,
    policyArn: apiTaskPolicy.arn,
  });

  // Realtime Task Role - Runtime permissions
  const ecsRealtimeTaskRole = new aws.iam.Role(
    `${baseName}-realtime-task-role`,
    {
      name: `${baseName}-realtime-task-role`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      tags: {
        ...tags,
        Name: `${baseName}-realtime-task-role`,
      },
    }
  );

  // Realtime Task Policy - SQS send/receive, CloudWatch metrics
  const realtimeTaskPolicy = new aws.iam.Policy(
    `${baseName}-realtime-task-policy`,
    {
      name: `${baseName}-realtime-task-policy`,
      description: "Runtime permissions for Realtime service",
      policy: pulumi.interpolate`{
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Action": [
              "sqs:SendMessage",
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl"
            ],
            "Resource": [
              "${sqsOutputs.pushNotificationQueue.arn}",
              "${sqsOutputs.offlineMessageQueue.arn}"
            ]
          },
          {
            "Effect": "Allow",
            "Action": [
              "cloudwatch:PutMetricData"
            ],
            "Resource": "*",
            "Condition": {
              "StringEquals": {
                "cloudwatch:namespace": "${baseName}"
              }
            }
          },
          {
            "Effect": "Allow",
            "Action": [
              "logs:CreateLogStream",
              "logs:PutLogEvents"
            ],
            "Resource": "*"
          }
        ]
      }`,
      tags: {
        ...tags,
        Name: `${baseName}-realtime-task-policy`,
      },
    }
  );

  new aws.iam.RolePolicyAttachment(
    `${baseName}-realtime-task-policy-attachment`,
    {
      role: ecsRealtimeTaskRole.name,
      policyArn: realtimeTaskPolicy.arn,
    }
  );

  return {
    ecsTaskExecutionRole,
    ecsApiTaskRole,
    ecsRealtimeTaskRole,
  };
}
