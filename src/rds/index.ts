import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { Config, getTags } from "../../config";
import { SecurityGroupOutputs } from "../security-groups";
import { VpcOutputs } from "../vpc";

export interface RdsOutputs {
  dbInstance: aws.rds.Instance;
  dbSubnetGroup: aws.rds.SubnetGroup;
  dbParameterGroup: aws.rds.ParameterGroup;
  dbCredentialsSecret: aws.secretsmanager.Secret;
  dbCredentialsSecretVersion: aws.secretsmanager.SecretVersion;
}

/**
 * Creates RDS PostgreSQL instance with:
 * - Multi-AZ deployment (production)
 * - Subnet group in private subnets
 * - Parameter group optimized for chat workload
 * - Credentials stored in Secrets Manager
 * - Encryption at rest
 * - Automated backups
 */
export function createRds(
  config: Config,
  vpcOutputs: VpcOutputs,
  securityGroupOutputs: SecurityGroupOutputs
): RdsOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Generate random password for RDS
  const dbPassword = new random.RandomPassword(`${baseName}-db-password`, {
    length: 32,
    special: true,
    overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
  });

  // Create Secrets Manager secret for DB credentials
  const dbCredentialsSecret = new aws.secretsmanager.Secret(
    `${baseName}-db-credentials`,
    {
      name: `${baseName}/db-credentials`,
      description: "PostgreSQL database credentials",
      tags: {
        ...tags,
        Name: `${baseName}-db-credentials`,
      },
    }
  );

  // Store credentials in the secret
  const dbCredentialsSecretVersion = new aws.secretsmanager.SecretVersion(
    `${baseName}-db-credentials-version`,
    {
      secretId: dbCredentialsSecret.id,
      secretString: pulumi.interpolate`{
        "username": "chatadmin",
        "password": "${dbPassword.result}",
        "database": "chatdb"
      }`,
    }
  );

  // Create DB Subnet Group
  const dbSubnetGroup = new aws.rds.SubnetGroup(`${baseName}-db-subnet-group`, {
    name: `${baseName}-db-subnet-group`,
    subnetIds: vpcOutputs.privateSubnets.map((subnet) => subnet.id),
    description: "Subnet group for RDS PostgreSQL",
    tags: {
      ...tags,
      Name: `${baseName}-db-subnet-group`,
    },
  });

  // Create Parameter Group optimized for chat workload
  const dbParameterGroup = new aws.rds.ParameterGroup(
    `${baseName}-db-param-group`,
    {
      family: "postgres15",
      name: `${baseName}-db-param-group`,
      description: "Parameter group optimized for chat application",
      parameters: [
        // Connection settings
        {
          name: "max_connections",
          value: "200",
        },
        // Logging for debugging
        {
          name: "log_statement",
          value: "ddl",
        },
        {
          name: "log_min_duration_statement",
          value: "1000", // Log queries taking > 1 second
        },
        // Performance settings
        {
          name: "shared_buffers",
          value: "{DBInstanceClassMemory/32768}", // 1/4 of memory in 8KB pages
          applyMethod: "pending-reboot",
        },
        {
          name: "effective_cache_size",
          value: "{DBInstanceClassMemory*3/32768}", // 3/4 of memory in 8KB pages
          applyMethod: "pending-reboot",
        },
        // Write-ahead log settings
        {
          name: "wal_buffers",
          value: "64MB",
          applyMethod: "pending-reboot",
        },
        // Connection timeout
        {
          name: "idle_in_transaction_session_timeout",
          value: "300000", // 5 minutes in ms
        },
      ],
      tags: {
        ...tags,
        Name: `${baseName}-db-param-group`,
      },
    }
  );

  // Create RDS Instance
  const dbInstance = new aws.rds.Instance(`${baseName}-db`, {
    identifier: `${baseName}-db`,
    engine: "postgres",
    engineVersion: "15.4",
    instanceClass: config.rdsInstanceClass,
    allocatedStorage: config.rdsAllocatedStorage,
    maxAllocatedStorage: config.rdsAllocatedStorage * 2, // Auto-scaling storage
    storageType: "gp3",
    storageEncrypted: true,

    // Database configuration
    dbName: "chatdb",
    username: "chatadmin",
    password: dbPassword.result,
    port: 5432,

    // Network configuration
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [securityGroupOutputs.rdsSecurityGroup.id],
    publiclyAccessible: false,

    // High availability
    multiAz: config.rdsMultiAz,

    // Parameter group
    parameterGroupName: dbParameterGroup.name,

    // Backup configuration
    backupRetentionPeriod: config.environment === "prod" ? 7 : 1,
    backupWindow: "03:00-04:00", // UTC
    maintenanceWindow: "Mon:04:00-Mon:05:00", // UTC

    // Monitoring
    performanceInsightsEnabled: config.environment === "prod",
    performanceInsightsRetentionPeriod: config.environment === "prod" ? 7 : 0,
    enabledCloudwatchLogsExports: ["postgresql", "upgrade"],

    // Deletion protection
    deletionProtection: config.environment === "prod",
    skipFinalSnapshot: config.environment !== "prod",
    finalSnapshotIdentifier:
      config.environment === "prod" ? `${baseName}-db-final-snapshot` : undefined,

    // Apply changes immediately in dev, during maintenance window in prod
    applyImmediately: config.environment !== "prod",

    tags: {
      ...tags,
      Name: `${baseName}-db`,
    },
  });

  return {
    dbInstance,
    dbSubnetGroup,
    dbParameterGroup,
    dbCredentialsSecret,
    dbCredentialsSecretVersion,
  };
}
