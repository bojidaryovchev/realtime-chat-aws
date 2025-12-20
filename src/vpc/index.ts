import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";

export interface VpcOutputs {
  vpc: aws.ec2.Vpc;
  publicSubnets: aws.ec2.Subnet[];
  privateSubnets: aws.ec2.Subnet[];
  natGateway: aws.ec2.NatGateway;
  internetGateway: aws.ec2.InternetGateway;
  publicRouteTable: aws.ec2.RouteTable;
  privateRouteTable: aws.ec2.RouteTable;
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
  // S3 Gateway Endpoint (free)
  new aws.ec2.VpcEndpoint(`${baseName}-s3-endpoint`, {
    vpcId: vpc.id,
    serviceName: `com.amazonaws.${aws.getRegionOutput().name}.s3`,
    vpcEndpointType: "Gateway",
    routeTableIds: [publicRouteTable.id, privateRouteTable.id],
    tags: {
      ...tags,
      Name: `${baseName}-s3-endpoint`,
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
  };
}
