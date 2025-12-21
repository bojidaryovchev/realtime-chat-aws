import * as aws from "@pulumi/aws";
import { Config } from "../../config";
import { AlbOutputs } from "../alb";

export interface Route53Outputs {
  hostedZoneId: string;
  apiRecord: aws.route53.Record;
  rootRecord: aws.route53.Record;
}

/**
 * Creates Route53 DNS records pointing to the ALB
 * 
 * Uses an EXISTING hosted zone (not creating a new one)
 * The hosted zone ID should be provided in the config
 */
export function createRoute53(
  config: Config,
  albOutputs: AlbOutputs
): Route53Outputs {
  const baseName = `${config.projectName}-${config.environment}`;

  if (!config.hostedZoneId) {
    throw new Error("hostedZoneId is required when createDns is true");
  }

  // Root domain -> ALB (for accessing via thepersonforme.com)
  const rootRecord = new aws.route53.Record(`${baseName}-root-record`, {
    zoneId: config.hostedZoneId,
    name: config.domainName,
    type: "A",
    aliases: [
      {
        name: albOutputs.alb.dnsName,
        zoneId: albOutputs.alb.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  });

  // API subdomain -> ALB (api.thepersonforme.com)
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
    rootRecord,
  };
}
