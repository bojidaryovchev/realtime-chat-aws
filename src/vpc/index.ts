import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";

export interface VpcOutputs {
  vpc: aws.ec2.Vpc;
  publicSubnets: aws.ec2.Subnet[];
  privateSubnets: aws.ec2.Subnet[];
  natGateway: aws.ec2.NatGateway;
  internetGateway: aws.ec2.InternetGateway;
  publicRouteTable: aws.ec2.RouteTable;
  privateRouteTable: aws.ec2.RouteTable;
  vpcEndpointSecurityGroup: aws.ec2.SecurityGroup;
}

/**
 * Creates a VPC with public and private subnets across multiple AZs
 * - Public subnets: ALB
 * - Private subnets: ECS, RDS, Redis
 * - Single NAT Gateway for MVP (cost optimization)
 */
export function createVpc(config: Config): VpcOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Create VPC
  const vpc = new aws.ec2.Vpc(`${baseName}-vpc`, {
    cidrBlock: config.vpcCidr,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: {
      ...tags,
      Name: `${baseName}-vpc`,
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

  // Create Elastic IP for NAT Gateway
  const natEip = new aws.ec2.Eip(`${baseName}-nat-eip`, {
    domain: "vpc",
    tags: {
      ...tags,
      Name: `${baseName}-nat-eip`,
    },
  });

  // Create NAT Gateway (single for MVP - place in first public subnet)
  const natGateway = new aws.ec2.NatGateway(`${baseName}-nat`, {
    allocationId: natEip.id,
    subnetId: publicSubnets[0].id,
    tags: {
      ...tags,
      Name: `${baseName}-nat`,
    },
  }, { dependsOn: [internetGateway] });

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

  // Create private route table
  const privateRouteTable = new aws.ec2.RouteTable(`${baseName}-private-rt`, {
    vpcId: vpc.id,
    tags: {
      ...tags,
      Name: `${baseName}-private-rt`,
    },
  });

  // Route to NAT Gateway for private subnets
  new aws.ec2.Route(`${baseName}-private-route`, {
    routeTableId: privateRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    natGatewayId: natGateway.id,
  });

  // Associate private subnets with private route table
  privateSubnets.forEach((subnet, index) => {
    new aws.ec2.RouteTableAssociation(`${baseName}-private-rta-${index}`, {
      subnetId: subnet.id,
      routeTableId: privateRouteTable.id,
    });
  });

  // Create VPC Endpoints for AWS services (reduces NAT costs)
  const region = aws.getRegionOutput().name;

  // S3 Gateway Endpoint (free)
  new aws.ec2.VpcEndpoint(`${baseName}-s3-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.s3`,
    vpcEndpointType: "Gateway",
    routeTableIds: [publicRouteTable.id, privateRouteTable.id],
    tags: {
      ...tags,
      Name: `${baseName}-s3-endpoint`,
    },
  });

  // Security group for VPC Interface Endpoints
  const vpcEndpointSecurityGroup = new aws.ec2.SecurityGroup(
    `${baseName}-vpce-sg`,
    {
      name: `${baseName}-vpce-sg`,
      description: "Security group for VPC Interface Endpoints",
      vpcId: vpc.id,
      ingress: [
        {
          description: "HTTPS from VPC",
          fromPort: 443,
          toPort: 443,
          protocol: "tcp",
          cidrBlocks: [config.vpcCidr],
        },
      ],
      egress: [
        {
          description: "Allow all outbound",
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      tags: {
        ...tags,
        Name: `${baseName}-vpce-sg`,
      },
    }
  );

  // ECR API Endpoint (for docker pull)
  new aws.ec2.VpcEndpoint(`${baseName}-ecr-api-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.ecr.api`,
    vpcEndpointType: "Interface",
    subnetIds: privateSubnets.map((s) => s.id),
    securityGroupIds: [vpcEndpointSecurityGroup.id],
    privateDnsEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-ecr-api-endpoint`,
    },
  });

  // ECR DKR Endpoint (for docker pull)
  new aws.ec2.VpcEndpoint(`${baseName}-ecr-dkr-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.ecr.dkr`,
    vpcEndpointType: "Interface",
    subnetIds: privateSubnets.map((s) => s.id),
    securityGroupIds: [vpcEndpointSecurityGroup.id],
    privateDnsEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-ecr-dkr-endpoint`,
    },
  });

  // Secrets Manager Endpoint
  new aws.ec2.VpcEndpoint(`${baseName}-secretsmanager-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.secretsmanager`,
    vpcEndpointType: "Interface",
    subnetIds: privateSubnets.map((s) => s.id),
    securityGroupIds: [vpcEndpointSecurityGroup.id],
    privateDnsEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-secretsmanager-endpoint`,
    },
  });

  // CloudWatch Logs Endpoint
  new aws.ec2.VpcEndpoint(`${baseName}-logs-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.logs`,
    vpcEndpointType: "Interface",
    subnetIds: privateSubnets.map((s) => s.id),
    securityGroupIds: [vpcEndpointSecurityGroup.id],
    privateDnsEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-logs-endpoint`,
    },
  });

  // SSM Parameter Store Endpoint (for secrets)
  new aws.ec2.VpcEndpoint(`${baseName}-ssm-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.ssm`,
    vpcEndpointType: "Interface",
    subnetIds: privateSubnets.map((s) => s.id),
    securityGroupIds: [vpcEndpointSecurityGroup.id],
    privateDnsEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-ssm-endpoint`,
    },
  });

  // SQS Endpoint
  new aws.ec2.VpcEndpoint(`${baseName}-sqs-endpoint`, {
    vpcId: vpc.id,
    serviceName: pulumi.interpolate`com.amazonaws.${region}.sqs`,
    vpcEndpointType: "Interface",
    subnetIds: privateSubnets.map((s) => s.id),
    securityGroupIds: [vpcEndpointSecurityGroup.id],
    privateDnsEnabled: true,
    tags: {
      ...tags,
      Name: `${baseName}-sqs-endpoint`,
    },
  });

  return {
    vpc,
    publicSubnets,
    privateSubnets,
    natGateway,
    internetGateway,
    publicRouteTable,
    privateRouteTable,
    vpcEndpointSecurityGroup,
  };
}
