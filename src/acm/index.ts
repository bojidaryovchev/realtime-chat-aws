import * as aws from "@pulumi/aws";
import { Config, getTags } from "../../config";

export interface AcmOutputs {
  certificate: aws.acm.Certificate;
  certificateValidation: aws.acm.CertificateValidation;
}

/**
 * Creates ACM certificate with DNS validation
 * - Wildcard certificate for domain and subdomains
 * - DNS validation records created in existing Route53 hosted zone
 */
export function createAcm(config: Config): AcmOutputs {
  const tags = getTags(config);
  const baseName = `${config.projectName}-${config.environment}`;

  if (!config.hostedZoneId) {
    throw new Error("hostedZoneId is required for ACM certificate creation");
  }

  // Create certificate for domain and wildcard
  const certificate = new aws.acm.Certificate(
    `${baseName}-cert`,
    {
      domainName: config.domainName,
      subjectAlternativeNames: [`*.${config.domainName}`],
      validationMethod: "DNS",
      tags: {
        ...tags,
        Name: `${baseName}-cert`,
      },
    },
    {
      deleteBeforeReplace: true,
    }
  );

  // Create DNS validation records in existing hosted zone
  const validationRecords = certificate.domainValidationOptions.apply(
    (options) =>
      options.map((option, index) => {
        return new aws.route53.Record(
          `${baseName}-cert-validation-${index}`,
          {
            name: option.resourceRecordName,
            type: option.resourceRecordType,
            zoneId: config.hostedZoneId,
            records: [option.resourceRecordValue],
            ttl: 60,
            allowOverwrite: true,
          }
        );
      })
  );

  // Wait for certificate validation
  const certificateValidation = new aws.acm.CertificateValidation(
    `${baseName}-cert-validation`,
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: validationRecords.apply((records) =>
        records.map((record) => record.fqdn)
      ),
    }
  );

  return {
    certificate,
    certificateValidation,
  };
}
