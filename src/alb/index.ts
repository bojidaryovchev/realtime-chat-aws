import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Config, getTags } from "../../config";
import { AcmOutputs } from "../acm";
import { SecurityGroupOutputs } from "../security-groups";
import { VpcOutputs } from "../vpc";

export interface AlbOutputs {
  alb: aws.lb.LoadBalancer;
  httpsListener: aws.lb.Listener;
  httpListener: aws.lb.Listener;
  apiTargetGroup: aws.lb.TargetGroup;
  realtimeTargetGroup: aws.lb.TargetGroup;
  albLogsBucketName: pulumi.Output<string>;
}

/**
 * Creates Application Load Balancer with:
 * - HTTPS listener (requires ACM certificate)
 * - HTTP listener (redirects to HTTPS)
 * - Path-based routing:
 *   - /api/* -> API service
 *   - /socket.io/* -> Realtime service
 * - WebSocket support with increased idle timeout
 */
export function createAlb(
  config: Config,
  vpcOutputs: VpcOutputs,
  securityGroupOutputs: SecurityGroupOutputs,
  acmOutputs?: AcmOutputs
): AlbOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;
  const currentRegion = aws.getRegionOutput();
  const currentAccount = aws.getCallerIdentityOutput();

  // ==================== ALB Access Logs S3 Bucket ====================
  // Store ALB access logs for security analysis and debugging
  
  const albLogsBucket = new aws.s3.BucketV2(`${baseName}-alb-logs`, {
    bucket: `${baseName}-alb-logs`,
    forceDestroy: config.environment !== "prod", // Allow deletion in dev
    tags: {
      ...tags,
      Name: `${baseName}-alb-logs`,
    },
  });

  // Enable server-side encryption
  new aws.s3.BucketServerSideEncryptionConfigurationV2(`${baseName}-alb-logs-encryption`, {
    bucket: albLogsBucket.id,
    rules: [{
      applyServerSideEncryptionByDefault: {
        sseAlgorithm: "AES256",
      },
    }],
  });

  // Block public access
  new aws.s3.BucketPublicAccessBlock(`${baseName}-alb-logs-public-access`, {
    bucket: albLogsBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  // Lifecycle policy to expire old logs
  new aws.s3.BucketLifecycleConfigurationV2(`${baseName}-alb-logs-lifecycle`, {
    bucket: albLogsBucket.id,
    rules: [{
      id: "expire-old-logs",
      status: "Enabled",
      expiration: {
        days: config.environment === "prod" ? 90 : 30,
      },
    }],
  });

  // Bucket policy to allow ALB to write logs
  // ALB log delivery uses regional AWS account IDs
  // https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
  const albLogsBucketPolicy = new aws.s3.BucketPolicy(`${baseName}-alb-logs-policy`, {
    bucket: albLogsBucket.id,
    policy: pulumi.all([albLogsBucket.arn, currentAccount.accountId, currentRegion.name]).apply(
      ([bucketArn, accountId, region]: [string, string, string]) => {
        // ELB account IDs by region for log delivery
        const elbAccountIds: Record<string, string> = {
          "us-east-1": "127311923021",
          "us-east-2": "033677994240",
          "us-west-1": "027434742980",
          "us-west-2": "797873946194",
          "eu-west-1": "156460612806",
          "eu-west-2": "652711504416",
          "eu-west-3": "009996457667",
          "eu-central-1": "054676820928",
          "ap-northeast-1": "582318560864",
          "ap-northeast-2": "600734575887",
          "ap-southeast-1": "114774131450",
          "ap-southeast-2": "783225319266",
          "ap-south-1": "718504428378",
          "sa-east-1": "507241528517",
          "ca-central-1": "985666609251",
        };
        const elbAccountId = elbAccountIds[region] || "127311923021"; // Default to us-east-1

        return JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                AWS: `arn:aws:iam::${elbAccountId}:root`,
              },
              Action: "s3:PutObject",
              Resource: `${bucketArn}/AWSLogs/${accountId}/*`,
            },
          ],
        });
      }
    ),
  });

  // Create Application Load Balancer
  const alb = new aws.lb.LoadBalancer(`${baseName}-alb`, {
    name: `${baseName}-alb`,
    internal: false,
    loadBalancerType: "application",
    securityGroups: [securityGroupOutputs.albSecurityGroup.id],
    subnets: vpcOutputs.publicSubnets.map((subnet) => subnet.id),
    enableDeletionProtection: config.environment === "prod",
    // Increased idle timeout for WebSocket connections (300 seconds = 5 minutes)
    idleTimeout: 300,
    enableHttp2: true,
    // Access logs for security and debugging
    accessLogs: {
      bucket: albLogsBucket.id,
      enabled: true,
    },
    tags: {
      ...tags,
      Name: `${baseName}-alb`,
    },
  }, { dependsOn: [albLogsBucketPolicy] });

  // API Target Group
  const apiTargetGroup = new aws.lb.TargetGroup(`${baseName}-api-tg`, {
    name: `${baseName}-api-tg`,
    port: 3000,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpcOutputs.vpc.id,
    healthCheck: {
      enabled: true,
      path: "/health",
      port: "traffic-port",
      protocol: "HTTP",
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      timeout: 5,
      interval: 30,
      matcher: "200",
    },
    // API can drain quickly - stateless HTTP requests
    deregistrationDelay: config.apiDeregistrationDelaySeconds,
    tags: {
      ...tags,
      Name: `${baseName}-api-tg`,
    },
  });

  // Realtime Target Group (with stickiness for Socket.IO)
  const realtimeTargetGroup = new aws.lb.TargetGroup(`${baseName}-realtime-tg`, {
    name: `${baseName}-realtime-tg`,
    port: 3001,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpcOutputs.vpc.id,
    healthCheck: {
      enabled: true,
      path: "/health",
      port: "traffic-port",
      protocol: "HTTP",
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      timeout: 5,
      interval: 30,
      matcher: "200",
    },
    // Enable sticky sessions for Socket.IO polling fallback
    stickiness: {
      enabled: true,
      type: "lb_cookie",
      // Shorter stickiness for faster load balancing during scale-out
      // WebSocket connections persist independent of cookie
      cookieDuration: config.realtimeStickyDurationSeconds,
    },
    // Longer draining for WebSocket connections to migrate gracefully
    deregistrationDelay: config.realtimeDeregistrationDelaySeconds,
    tags: {
      ...tags,
      Name: `${baseName}-realtime-tg`,
    },
  });

  // HTTP Listener - Redirect to HTTPS
  const httpListener = new aws.lb.Listener(`${baseName}-http-listener`, {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
      {
        type: "redirect",
        redirect: {
          port: "443",
          protocol: "HTTPS",
          statusCode: "HTTP_301",
        },
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-http-listener`,
    },
  });

  // HTTPS Listener
  // Use validated ACM certificate if provided, otherwise fall back to config.certificateArn
  const certificateArn = acmOutputs?.certificateValidation.certificateArn || config.certificateArn;
  
  if (!certificateArn) {
    throw new Error("Either ACM outputs or certificateArn config must be provided for HTTPS");
  }

  const httpsListener = new aws.lb.Listener(`${baseName}-https-listener`, {
    loadBalancerArn: alb.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    // Use the validated certificate ARN
    certificateArn: certificateArn,
    defaultActions: [
      {
        type: "fixed-response",
        fixedResponse: {
          contentType: "text/plain",
          messageBody: "Not Found",
          statusCode: "404",
        },
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-https-listener`,
    },
  });

  // Listener Rule: /api/* -> API Target Group
  new aws.lb.ListenerRule(`${baseName}-api-rule`, {
    listenerArn: httpsListener.arn,
    priority: 100,
    conditions: [
      {
        pathPattern: {
          values: ["/api/*"],
        },
      },
    ],
    actions: [
      {
        type: "forward",
        targetGroupArn: apiTargetGroup.arn,
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-api-rule`,
    },
  });

  // Listener Rule: /socket.io/* -> Realtime Target Group
  new aws.lb.ListenerRule(`${baseName}-socketio-rule`, {
    listenerArn: httpsListener.arn,
    priority: 200,
    conditions: [
      {
        pathPattern: {
          values: ["/socket.io/*"],
        },
      },
    ],
    actions: [
      {
        type: "forward",
        targetGroupArn: realtimeTargetGroup.arn,
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-socketio-rule`,
    },
  });

  // Listener Rule: /ws/* -> Realtime Target Group (alternative path)
  new aws.lb.ListenerRule(`${baseName}-ws-rule`, {
    listenerArn: httpsListener.arn,
    priority: 201,
    conditions: [
      {
        pathPattern: {
          values: ["/ws/*"],
        },
      },
    ],
    actions: [
      {
        type: "forward",
        targetGroupArn: realtimeTargetGroup.arn,
      },
    ],
    tags: {
      ...tags,
      Name: `${baseName}-ws-rule`,
    },
  });

  return {
    alb,
    httpsListener,
    httpListener,
    apiTargetGroup,
    realtimeTargetGroup,
    albLogsBucketName: albLogsBucket.bucket,
  };
}
