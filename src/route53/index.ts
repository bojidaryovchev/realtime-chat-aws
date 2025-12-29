import * as aws from "@pulumi/aws";
import { Config } from "../../config";
import { AlbOutputs } from "../alb";

export interface Route53Outputs {
  hostedZoneId: string;
  apiRecord: aws.route53.Record;
}

/**
 * Creates Route53 DNS records pointing to the ALB
 *
 * Architecture:
 * - Web frontend: Hosted on Vercel (manages its own DNS for root/www domain)
 * - Mobile app: Expo (connects to api.domain.com)
 * - API + WebSocket: ALB at api.domain.com
 *
 * This module only creates the api.* subdomain record.
 * The root domain is managed by Vercel for the web frontend.
 *
 * Uses an EXISTING hosted zone (not creating a new one)
 * The hosted zone ID should be provided in the config
 */
export function createRoute53(config: Config, albOutputs: AlbOutputs): Route53Outputs {
  const baseName = `${config.projectName}-${config.environment}`;

  if (!config.hostedZoneId) {
    throw new Error("hostedZoneId is required when createDns is true");
  }

  // API subdomain -> ALB (api.yourdomain.com)
  // Used by:
  // - Vercel web frontend (API calls and WebSocket)
  // - Expo mobile app (API calls and WebSocket)
  const apiRecord = new aws.route53.Record(`${baseName}-api-record`, {
    zoneId: config.hostedZoneId,
    name: `api.${config.domainName}`,
    type: "A",
    aliases: [
      {
        name: albOutputs.alb.dnsName,
        zoneId: albOutputs.alb.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  });

  return {
    hostedZoneId: config.hostedZoneId,
    apiRecord,
  };
}
