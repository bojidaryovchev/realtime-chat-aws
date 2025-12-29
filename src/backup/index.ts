import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";
import { RdsOutputs } from "../rds";

export interface BackupOutputs {
  backupVault: aws.backup.Vault;
  backupPlan: aws.backup.Plan;
  backupSelection: aws.backup.Selection;
}

/**
 * Creates AWS Backup resources for automated disaster recovery:
 * - Backup vault with encryption
 * - Backup plan with retention policies (environment-aware)
 * - Backup selection targeting RDS instance
 * 
 * This supplements RDS native snapshots with AWS Backup for:
 * - Longer retention
 * - Centralized backup management
 * - Point-in-time recovery compliance
 */
export function createBackup(
  config: Config,
  rdsOutputs: RdsOutputs
): BackupOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // ==================== Backup Vault ====================
  // Encrypted vault to store backup recovery points
  const backupVault = new aws.backup.Vault(`${baseName}-backup-vault`, {
    name: `${baseName}-backup-vault`,
    // Use default AWS managed key (or specify a custom KMS key for stricter control)
    tags: {
      ...tags,
      Name: `${baseName}-backup-vault`,
    },
  });

  // ==================== IAM Role for AWS Backup ====================
  const backupRole = new aws.iam.Role(`${baseName}-backup-role`, {
    name: `${baseName}-backup-role`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "backup.amazonaws.com",
          },
          Action: "sts:AssumeRole",
        },
      ],
    }),
    tags: {
      ...tags,
      Name: `${baseName}-backup-role`,
    },
  });

  // Attach AWS managed policy for backup operations
  new aws.iam.RolePolicyAttachment(`${baseName}-backup-policy`, {
    role: backupRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
  });

  new aws.iam.RolePolicyAttachment(`${baseName}-backup-restore-policy`, {
    role: backupRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
  });

  // ==================== Backup Plan ====================
  // Environment-aware retention and schedule
  const isProduction = config.environment === "prod";

  const backupPlan = new aws.backup.Plan(`${baseName}-backup-plan`, {
    name: `${baseName}-backup-plan`,
    rules: [
      {
        ruleName: "daily-backup",
        targetVaultName: backupVault.name,
        // Schedule: Daily at 3 AM UTC (offset from RDS maintenance window)
        schedule: "cron(0 3 * * ? *)",
        // Start backup within 1 hour of scheduled time
        startWindow: 60,
        // Complete backup within 3 hours
        completionWindow: 180,
        lifecycle: {
          // Dev: 7 days retention, Prod: 35 days retention
          deleteAfter: isProduction ? 35 : 7,
        },
        // Enable continuous backup for point-in-time recovery (PITR)
        enableContinuousBackup: isProduction,
      },
      // Weekly backup with longer retention (production only)
      ...(isProduction
        ? [
            {
              ruleName: "weekly-backup",
              targetVaultName: backupVault.name,
              // Schedule: Every Sunday at 4 AM UTC
              schedule: "cron(0 4 ? * SUN *)",
              startWindow: 60,
              completionWindow: 180,
              lifecycle: {
                // 90 days retention for weekly backups
                deleteAfter: 90,
              },
            },
          ]
        : []),
    ],
    tags: {
      ...tags,
      Name: `${baseName}-backup-plan`,
    },
  });

  // ==================== Backup Selection ====================
  // Select RDS instance for backup
  const backupSelection = new aws.backup.Selection(`${baseName}-backup-selection`, {
    name: `${baseName}-rds-backup`,
    planId: backupPlan.id,
    iamRoleArn: backupRole.arn,
    // Select resources by ARN
    resources: [rdsOutputs.dbInstance.arn],
  });

  return {
    backupVault,
    backupPlan,
    backupSelection,
  };
}
