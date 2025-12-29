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
  // RDS Proxy (only created when enableRdsProxy is true)
  rdsProxy?: aws.rds.Proxy;
  rdsProxyEndpoint?: pulumi.Output<string>;
  // RDS Read Replica (only created when enableRdsReadReplica is true)
  dbReadReplica?: aws.rds.Instance;
  dbReadReplicaEndpoint?: pulumi.Output<string>;
  // The endpoint to use for database connections (proxy if enabled, direct otherwise)
  dbConnectionEndpoint: pulumi.Output<string>;
  // Max connections for this instance class (for alarm thresholds)
  maxConnections: number;
}

/**
 * Creates RDS PostgreSQL instance with:
 * - Multi-AZ deployment (production)
 * - Subnet group in private subnets
 * - Parameter group optimized for chat workload
 * - Credentials stored in Secrets Manager
 * - Encryption at rest
 * - Automated backups
 * - Optional RDS Proxy for connection pooling (recommended for production)
 * - Optional Read Replica for read-heavy workloads (100k DAU)
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
  // Derive family from engine version (e.g., "15.4" -> "postgres15")
  const pgMajorVersion = config.rdsEngineVersion.split(".")[0];

  // Calculate max_connections based on instance class
  // AWS RDS formula: LEAST({DBInstanceClassMemory/9531392}, 5000)
  // We use a more conservative estimate based on instance type
  const maxConnectionsByInstanceClass: Record<string, number> = {
    "db.t3.micro": 87,      // ~1GB RAM
    "db.t3.small": 145,     // ~2GB RAM
    "db.t3.medium": 290,    // ~4GB RAM
    "db.t3.large": 580,     // ~8GB RAM
    "db.t3.xlarge": 1160,   // ~16GB RAM
    "db.t3.2xlarge": 2320,  // ~32GB RAM
    "db.r6g.large": 580,    // ~16GB RAM (Graviton)
    "db.r6g.xlarge": 1160,  // ~32GB RAM (Graviton)
    "db.r6g.2xlarge": 2320, // ~64GB RAM (Graviton)
    "db.r5.large": 580,     // ~16GB RAM
    "db.r5.xlarge": 1160,   // ~32GB RAM
    "db.r5.2xlarge": 2320,  // ~64GB RAM
  };
  
  // Default to 200 if instance class not in map (conservative fallback)
  const maxConnections = maxConnectionsByInstanceClass[config.rdsInstanceClass] || 200;

  const dbParameterGroup = new aws.rds.ParameterGroup(
    `${baseName}-db-param-group`,
    {
      family: `postgres${pgMajorVersion}`,
      name: `${baseName}-db-param-group`,
      description: "Parameter group optimized for chat application",
      parameters: [
        // Connection settings - dynamically calculated based on instance class
        {
          name: "max_connections",
          value: String(maxConnections),
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
        // Connection logging for debugging
        {
          name: "log_connections",
          value: config.environment === "prod" ? "0" : "1",
        },
        {
          name: "log_disconnections",
          value: config.environment === "prod" ? "0" : "1",
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
        // wal_buffers is auto-tuned by RDS based on shared_buffers
        // Explicitly setting it can cause issues; let RDS manage it
        {
          name: "wal_level",
          value: "replica", // Enable for read replicas if needed
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
    engineVersion: config.rdsEngineVersion,
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

  // ==================== RDS Proxy (Optional) ====================
  // RDS Proxy provides connection pooling and improved failover
  // Recommended for production to prevent connection storms during scaling

  let rdsProxy: aws.rds.Proxy | undefined;
  let rdsProxyEndpoint: pulumi.Output<string> | undefined;

  if (config.enableRdsProxy) {
    // IAM Role for RDS Proxy to access Secrets Manager
    const rdsProxyRole = new aws.iam.Role(`${baseName}-rds-proxy-role`, {
      name: `${baseName}-rds-proxy-role`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "rds.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      tags: {
        ...tags,
        Name: `${baseName}-rds-proxy-role`,
      },
    });

    // Policy to allow RDS Proxy to read secrets
    const rdsProxyPolicy = new aws.iam.Policy(`${baseName}-rds-proxy-policy`, {
      name: `${baseName}-rds-proxy-policy`,
      description: "Allow RDS Proxy to access database credentials",
      policy: pulumi.interpolate`{
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Action": [
              "secretsmanager:GetSecretValue"
            ],
            "Resource": "${dbCredentialsSecret.arn}"
          },
          {
            "Effect": "Allow",
            "Action": [
              "kms:Decrypt"
            ],
            "Resource": "*",
            "Condition": {
              "StringEquals": {
                "kms:ViaService": "secretsmanager.${aws.getRegionOutput().name}.amazonaws.com"
              }
            }
          }
        ]
      }`,
      tags: {
        ...tags,
        Name: `${baseName}-rds-proxy-policy`,
      },
    });

    new aws.iam.RolePolicyAttachment(`${baseName}-rds-proxy-policy-attachment`, {
      role: rdsProxyRole.name,
      policyArn: rdsProxyPolicy.arn,
    });

    // Security group for RDS Proxy
    const rdsProxySecurityGroup = new aws.ec2.SecurityGroup(
      `${baseName}-rds-proxy-sg`,
      {
        name: `${baseName}-rds-proxy-sg`,
        description: "Security group for RDS Proxy",
        vpcId: vpcOutputs.vpc.id,
        ingress: [
          {
            description: "PostgreSQL from ECS API",
            fromPort: 5432,
            toPort: 5432,
            protocol: "tcp",
            securityGroups: [securityGroupOutputs.ecsApiSecurityGroup.id],
          },
          {
            description: "PostgreSQL from ECS Realtime",
            fromPort: 5432,
            toPort: 5432,
            protocol: "tcp",
            securityGroups: [securityGroupOutputs.ecsRealtimeSecurityGroup.id],
          },
          {
            description: "PostgreSQL from ECS Workers",
            fromPort: 5432,
            toPort: 5432,
            protocol: "tcp",
            securityGroups: [securityGroupOutputs.ecsWorkersSecurityGroup.id],
          },
        ],
        egress: [
          {
            description: "Allow connection to RDS",
            fromPort: 5432,
            toPort: 5432,
            protocol: "tcp",
            securityGroups: [securityGroupOutputs.rdsSecurityGroup.id],
          },
        ],
        tags: {
          ...tags,
          Name: `${baseName}-rds-proxy-sg`,
        },
      }
    );

    // Add ingress rule to RDS security group to allow proxy
    new aws.ec2.SecurityGroupRule(`${baseName}-rds-from-proxy`, {
      type: "ingress",
      fromPort: 5432,
      toPort: 5432,
      protocol: "tcp",
      securityGroupId: securityGroupOutputs.rdsSecurityGroup.id,
      sourceSecurityGroupId: rdsProxySecurityGroup.id,
      description: "PostgreSQL from RDS Proxy",
    });

    // Create RDS Proxy
    rdsProxy = new aws.rds.Proxy(`${baseName}-rds-proxy`, {
      name: `${baseName}-rds-proxy`,
      debugLogging: config.environment !== "prod",
      engineFamily: "POSTGRESQL",
      idleClientTimeout: config.rdsProxyIdleClientTimeout,
      requireTls: true,
      roleArn: rdsProxyRole.arn,
      vpcSubnetIds: vpcOutputs.privateSubnets.map((s) => s.id),
      vpcSecurityGroupIds: [rdsProxySecurityGroup.id],
      auths: [
        {
          authScheme: "SECRETS",
          iamAuth: "DISABLED", // Use password auth via Secrets Manager
          secretArn: dbCredentialsSecret.arn,
        },
      ],
      tags: {
        ...tags,
        Name: `${baseName}-rds-proxy`,
      },
    });

    // RDS Proxy Default Target Group
    const rdsProxyDefaultTargetGroup = new aws.rds.ProxyDefaultTargetGroup(
      `${baseName}-rds-proxy-tg`,
      {
        dbProxyName: rdsProxy.name,
        connectionPoolConfig: {
          connectionBorrowTimeout: 120,
          maxConnectionsPercent: config.rdsProxyMaxConnectionsPercent,
          maxIdleConnectionsPercent: 50,
        },
      }
    );

    // RDS Proxy Target (the RDS instance)
    new aws.rds.ProxyTarget(`${baseName}-rds-proxy-target`, {
      dbProxyName: rdsProxy.name,
      targetGroupName: rdsProxyDefaultTargetGroup.name,
      dbInstanceIdentifier: dbInstance.identifier,
    });

    rdsProxyEndpoint = rdsProxy.endpoint;
  }

  // ==================== RDS Read Replica (Optional) ====================
  // Read replica for offloading read-heavy queries (100k DAU)
  // Provides horizontal read scaling and improved read latency

  let dbReadReplica: aws.rds.Instance | undefined;
  let dbReadReplicaEndpoint: pulumi.Output<string> | undefined;

  if (config.enableRdsReadReplica) {
    dbReadReplica = new aws.rds.Instance(`${baseName}-db-replica`, {
      identifier: `${baseName}-db-replica`,
      replicateSourceDb: dbInstance.identifier,
      instanceClass: config.rdsReadReplicaInstanceClass!,
      
      // Network configuration - inherits from source
      vpcSecurityGroupIds: [securityGroupOutputs.rdsSecurityGroup.id],
      publiclyAccessible: false,

      // Storage inherits from source, but can auto-scale
      maxAllocatedStorage: config.rdsAllocatedStorage * 2,
      storageType: "gp3",

      // No Multi-AZ for read replica (it's already redundancy)
      multiAz: false,

      // Parameter group same as primary
      parameterGroupName: dbParameterGroup.name,

      // Monitoring
      performanceInsightsEnabled: config.environment === "prod",
      performanceInsightsRetentionPeriod: config.environment === "prod" ? 7 : 0,

      // No backup for read replica (backups come from primary)
      backupRetentionPeriod: 0,

      // Deletion protection matches primary
      deletionProtection: config.environment === "prod",
      skipFinalSnapshot: true,

      // Apply changes immediately in dev
      applyImmediately: config.environment !== "prod",

      // Auto minor version upgrade
      autoMinorVersionUpgrade: true,

      tags: {
        ...tags,
        Name: `${baseName}-db-replica`,
        Role: "read-replica",
      },
    });

    dbReadReplicaEndpoint = dbReadReplica.endpoint;
  }

  // Determine which endpoint to use for database connections
  const dbConnectionEndpoint = config.enableRdsProxy && rdsProxyEndpoint
    ? rdsProxyEndpoint
    : dbInstance.endpoint;

  return {
    dbInstance,
    dbSubnetGroup,
    dbParameterGroup,
    dbCredentialsSecret,
    dbCredentialsSecretVersion,
    rdsProxy,
    rdsProxyEndpoint,
    dbReadReplica,
    dbReadReplicaEndpoint,
    dbConnectionEndpoint,
    maxConnections,
  };
}
