import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";

export interface VpcOutputs {
  vpc: aws.ec2.Vpc;
  publicSubnets: aws.ec2.Subnet[];
  privateSubnets: aws.ec2.Subnet[];
  natGateways: aws.ec2.NatGateway[];
  internetGateway: aws.ec2.InternetGateway;
  publicRouteTable: aws.ec2.RouteTable;
  privateRouteTables: aws.ec2.RouteTable[];
}

/**
 * Creates a VPC with public and private subnets across multiple AZs
 * - Public subnets: ALB
 * - Private subnets: ECS, RDS, Redis
 * - Configurable NAT Gateway count (1 for dev, N for prod HA)
 */
// VPC CIDR is hardcoded because subnet calculations below assume 10.0.x.0/24 structure.
// Public subnets: 10.0.0.0/24, 10.0.1.0/24, 10.0.2.0/24
// Private subnets: 10.0.100.0/24, 10.0.101.0/24, 10.0.102.0/24
const VPC_CIDR = "10.0.0.0/16";

export function createVpc(config: Config): VpcOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Create VPC
  const vpc = new aws.ec2.Vpc(`${baseName}-vpc`, {
    cidrBlock: VPC_CIDR,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: {
      ...tags,
      Name: `${baseName}-vpc`,
    },
  });

  // ==================== VPC Flow Logs ====================
  // Capture network traffic for security analysis and troubleshooting

  const flowLogGroup = new aws.cloudwatch.LogGroup(`${baseName}-vpc-flow-logs`, {
    name: `/vpc/${baseName}/flow-logs`,
    retentionInDays: config.environment === "prod" ? 30 : 7,
    tags: {
      ...tags,
      Name: `${baseName}-vpc-flow-logs`,
    },
  });

  const flowLogRole = new aws.iam.Role(`${baseName}-vpc-flow-log-role`, {
    name: `${baseName}-vpc-flow-log-role`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "vpc-flow-logs.amazonaws.com",
          },
          Action: "sts:AssumeRole",
        },
      ],
    }),
    tags: {
      ...tags,
      Name: `${baseName}-vpc-flow-log-role`,
    },
  });

  new aws.iam.RolePolicy(`${baseName}-vpc-flow-log-policy`, {
    name: `${baseName}-vpc-flow-log-policy`,
    role: flowLogRole.id,
    policy: pulumi.interpolate`{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": [
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:DescribeLogGroups",
            "logs:DescribeLogStreams"
          ],
          "Resource": "${flowLogGroup.arn}:*"
        }
      ]
    }`,
  });

  new aws.ec2.FlowLog(`${baseName}-vpc-flow-log`, {
    vpcId: vpc.id,
    trafficType: "ALL",
    logDestinationType: "cloud-watch-logs",
    logDestination: flowLogGroup.arn,
    iamRoleArn: flowLogRole.arn,
    maxAggregationInterval: 60, // 1 minute aggregation
    tags: {
      ...tags,
      Name: `${baseName}-vpc-flow-log`,
    },
  });

  // Create Internet Gateway
  const internetGateway = new aws.ec2.InternetGateway(`${baseName}-igw`, {
    vpcId: vpc.id,
    tags: {
      ...tags,
      Name: `${baseName}-igw`,
    },
  });

  // Create public subnets (one per AZ)
  const publicSubnets: aws.ec2.Subnet[] = [];
  const privateSubnets: aws.ec2.Subnet[] = [];

  config.availabilityZones.forEach((az, index) => {
    // Public subnet - /24 gives us 256 addresses per subnet
    const publicSubnet = new aws.ec2.Subnet(`${baseName}-public-${index}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${index}.0/24`,
      availabilityZone: az,
      mapPublicIpOnLaunch: true,
      tags: {
        ...tags,
        Name: `${baseName}-public-${az}`,
        Type: "public",
      },
    });
    publicSubnets.push(publicSubnet);

    // Private subnet - /24 gives us 256 addresses per subnet
    const privateSubnet = new aws.ec2.Subnet(`${baseName}-private-${index}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${index + 100}.0/24`,
      availabilityZone: az,
      mapPublicIpOnLaunch: false,
      tags: {
        ...tags,
        Name: `${baseName}-private-${az}`,
        Type: "private",
      },
    });
    privateSubnets.push(privateSubnet);
  });

  // ==================== NAT Gateway(s) ====================
  // config.natGateways: 0 for dev (uses public subnets instead), 1+ for prod
  // When 0, ECS tasks run in public subnets with public IPs

  const natGateways: aws.ec2.NatGateway[] = [];
  const natGatewayCount = Math.min(config.natGateways, publicSubnets.length);

  for (let i = 0; i < natGatewayCount; i++) {
    // Create Elastic IP for each NAT Gateway
    const natEip = new aws.ec2.Eip(`${baseName}-nat-eip-${i}`, {
      domain: "vpc",
      tags: {
        ...tags,
        Name: `${baseName}-nat-eip-${i}`,
      },
    });

    // Create NAT Gateway in corresponding public subnet
    const natGateway = new aws.ec2.NatGateway(
      `${baseName}-nat-${i}`,
      {
        allocationId: natEip.id,
        subnetId: publicSubnets[i].id,
        tags: {
          ...tags,
          Name: `${baseName}-nat-${i}`,
        },
      },
      { dependsOn: [internetGateway] },
    );

    natGateways.push(natGateway);
  }

  // Create public route table
  const publicRouteTable = new aws.ec2.RouteTable(`${baseName}-public-rt`, {
    vpcId: vpc.id,
    tags: {
      ...tags,
      Name: `${baseName}-public-rt`,
    },
  });

  // Route to Internet Gateway for public subnets
  new aws.ec2.Route(`${baseName}-public-route`, {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: internetGateway.id,
  });

  // Associate public subnets with public route table
  publicSubnets.forEach((subnet, index) => {
    new aws.ec2.RouteTableAssociation(`${baseName}-public-rta-${index}`, {
      subnetId: subnet.id,
      routeTableId: publicRouteTable.id,
    });
  });

  // ==================== Private Route Tables ====================
  // If NAT gateways exist: one route table per NAT gateway with internet route
  // If no NAT gateways: single route table with no internet route (VPC endpoints only)

  const privateRouteTables: aws.ec2.RouteTable[] = [];

  if (natGateways.length > 0) {
    // Create a route table for each NAT gateway
    natGateways.forEach((natGateway, natIndex) => {
      const privateRouteTable = new aws.ec2.RouteTable(`${baseName}-private-rt-${natIndex}`, {
        vpcId: vpc.id,
        tags: {
          ...tags,
          Name: `${baseName}-private-rt-${natIndex}`,
        },
      });

      // Route to this NAT Gateway
      new aws.ec2.Route(`${baseName}-private-route-${natIndex}`, {
        routeTableId: privateRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        natGatewayId: natGateway.id,
      });

      privateRouteTables.push(privateRouteTable);
    });
  } else {
    // No NAT gateways - create a single route table with no internet route
    // In dev, ECS tasks run in public subnets instead, so this is unused
    const privateRouteTable = new aws.ec2.RouteTable(`${baseName}-private-rt-0`, {
      vpcId: vpc.id,
      tags: {
        ...tags,
        Name: `${baseName}-private-rt-isolated`,
      },
    });
    privateRouteTables.push(privateRouteTable);
  }

  // Associate each private subnet with its corresponding route table
  // Round-robin if fewer route tables than subnets
  privateSubnets.forEach((subnet, index) => {
    const routeTableIndex = index % privateRouteTables.length;
    new aws.ec2.RouteTableAssociation(`${baseName}-private-rta-${index}`, {
      subnetId: subnet.id,
      routeTableId: privateRouteTables[routeTableIndex].id,
    });
  });

  // S3 Gateway Endpoint (free) - useful for ECR image layers
  const region = aws.getRegionOutput().region;

  new aws.ec2.VpcEndpoint(`${baseName}-s3-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.s3`,
    vpcEndpointType: "Gateway",
    routeTableIds: [publicRouteTable.id, ...privateRouteTables.map((rt) => rt.id)],
    tags: {
      ...tags,
      Name: `${baseName}-s3-endpoint`,
    },
  });

  return {
    vpc,
    publicSubnets,
    privateSubnets,
    natGateways,
    internetGateway,
    publicRouteTable,
    privateRouteTables,
  };
}
