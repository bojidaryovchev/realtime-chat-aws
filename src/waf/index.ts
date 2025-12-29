import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";
import { AlbOutputs } from "../alb";

export interface WafOutputs {
  webAcl?: aws.wafv2.WebAcl;
  webAclAssociation?: aws.wafv2.WebAclAssociation;
}

/**
 * Creates AWS WAF v2 Web ACL for ALB protection
 * - AWS Managed Rules for common threats
 * - Rate-based rules for DDoS protection
 * - Path-specific rate limits for API and WebSocket endpoints
 *
 * Only created when config.enableWaf is true (typically prod only)
 */
export function createWaf(config: Config, albOutputs: AlbOutputs): WafOutputs {
  // WAF is optional - skip in dev to save costs
  if (!config.enableWaf) {
    return {};
  }

  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  // Create Web ACL with multiple rule groups
  const webAcl = new aws.wafv2.WebAcl(`${baseName}-waf`, {
    name: `${baseName}-waf`,
    description: "WAF for ALB protection with rate limiting",
    scope: "REGIONAL", // ALB requires REGIONAL scope
    defaultAction: {
      allow: {},
    },
    visibilityConfig: {
      cloudwatchMetricsEnabled: true,
      metricName: `${baseName}-waf`,
      sampledRequestsEnabled: true,
    },

    rules: [
      // ==================== AWS Managed Rules ====================

      // Common Rule Set - Baseline protection
      {
        name: "AWSManagedRulesCommonRuleSet",
        priority: 10,
        overrideAction: {
          none: {},
        },
        statement: {
          managedRuleGroupStatement: {
            name: "AWSManagedRulesCommonRuleSet",
            vendorName: "AWS",
            // Use rule action overrides instead of excludedRules
            ruleActionOverrides: [
              // Override rules that might block legitimate WebSocket traffic
              {
                name: "SizeRestrictions_BODY", // WebSocket messages can be large
                actionToUse: { count: {} }, // Count instead of block
              },
              {
                name: "CrossSiteScripting_BODY", // Chat messages might trigger false positives
                actionToUse: { count: {} },
              },
            ],
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "AWSManagedRulesCommonRuleSet",
          sampledRequestsEnabled: true,
        },
      },

      // Known Bad Inputs - SQL injection, etc.
      {
        name: "AWSManagedRulesKnownBadInputsRuleSet",
        priority: 20,
        overrideAction: {
          none: {},
        },
        statement: {
          managedRuleGroupStatement: {
            name: "AWSManagedRulesKnownBadInputsRuleSet",
            vendorName: "AWS",
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "AWSManagedRulesKnownBadInputsRuleSet",
          sampledRequestsEnabled: true,
        },
      },

      // Bot Control - Basic protection (free tier)
      {
        name: "AWSManagedRulesBotControlRuleSet",
        priority: 30,
        overrideAction: {
          none: {},
        },
        statement: {
          managedRuleGroupStatement: {
            name: "AWSManagedRulesBotControlRuleSet",
            vendorName: "AWS",
            managedRuleGroupConfigs: [
              {
                awsManagedRulesBotControlRuleSet: {
                  inspectionLevel: "COMMON", // COMMON is free tier
                },
              },
            ],
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "AWSManagedRulesBotControlRuleSet",
          sampledRequestsEnabled: true,
        },
      },

      // ==================== Rate Limiting Rules ====================

      // API Rate Limit - /api/* paths
      {
        name: "APIRateLimit",
        priority: 40,
        action: {
          block: {
            customResponse: {
              responseCode: 429,
              customResponseBodyKey: "rate-limited",
            },
          },
        },
        statement: {
          rateBasedStatement: {
            limit: config.wafApiRateLimitPer5Min,
            aggregateKeyType: "IP",
            scopeDownStatement: {
              byteMatchStatement: {
                searchString: "/api/",
                fieldToMatch: {
                  uriPath: {},
                },
                textTransformations: [
                  {
                    priority: 0,
                    type: "LOWERCASE",
                  },
                ],
                positionalConstraint: "STARTS_WITH",
              },
            },
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "APIRateLimit",
          sampledRequestsEnabled: true,
        },
      },

      // Socket.IO Rate Limit - /socket.io/* paths
      // Higher limit since WebSocket establishes one connection then uses it
      {
        name: "SocketIORateLimit",
        priority: 50,
        action: {
          block: {
            customResponse: {
              responseCode: 429,
              customResponseBodyKey: "rate-limited",
            },
          },
        },
        statement: {
          rateBasedStatement: {
            limit: config.wafSocketRateLimitPer5Min,
            aggregateKeyType: "IP",
            scopeDownStatement: {
              byteMatchStatement: {
                searchString: "/socket.io/",
                fieldToMatch: {
                  uriPath: {},
                },
                textTransformations: [
                  {
                    priority: 0,
                    type: "LOWERCASE",
                  },
                ],
                positionalConstraint: "STARTS_WITH",
              },
            },
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "SocketIORateLimit",
          sampledRequestsEnabled: true,
        },
      },

      // Global Rate Limit - Catch-all for any path
      {
        name: "GlobalRateLimit",
        priority: 60,
        action: {
          block: {
            customResponse: {
              responseCode: 429,
              customResponseBodyKey: "rate-limited",
            },
          },
        },
        statement: {
          rateBasedStatement: {
            limit: config.wafApiRateLimitPer5Min * 2, // 2x API limit
            aggregateKeyType: "IP",
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "GlobalRateLimit",
          sampledRequestsEnabled: true,
        },
      },
    ],

    // Custom response bodies for rate limiting
    customResponseBodies: [
      {
        key: "rate-limited",
        content: JSON.stringify({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: 300,
        }),
        contentType: "APPLICATION_JSON",
      },
    ],

    tags: {
      ...tags,
      Name: `${baseName}-waf`,
    },
  });

  // Associate WAF with ALB
  const webAclAssociation = new aws.wafv2.WebAclAssociation(`${baseName}-waf-alb-association`, {
    resourceArn: albOutputs.alb.arn,
    webAclArn: webAcl.arn,
  });

  return {
    webAcl,
    webAclAssociation,
  };
}
