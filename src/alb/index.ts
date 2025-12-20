import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";
import { SecurityGroupOutputs } from "../security-groups";
import { VpcOutputs } from "../vpc";

export interface AlbOutputs {
  alb: aws.lb.LoadBalancer;
  httpsListener: aws.lb.Listener;
  httpListener: aws.lb.Listener;
  apiTargetGroup: aws.lb.TargetGroup;
  realtimeTargetGroup: aws.lb.TargetGroup;
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
  securityGroupOutputs: SecurityGroupOutputs
): AlbOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

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
    tags: {
      ...tags,
      Name: `${baseName}-alb`,
    },
  });

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
    deregistrationDelay: 30,
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
      cookieDuration: 86400, // 24 hours
    },
    deregistrationDelay: 30,
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
  // If no certificate ARN is provided, create a self-signed or use HTTP only for dev
  const httpsListener = new aws.lb.Listener(`${baseName}-https-listener`, {
    loadBalancerArn: alb.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    // Certificate ARN must be provided - use ACM
    certificateArn: config.certificateArn || undefined,
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
  };
}
