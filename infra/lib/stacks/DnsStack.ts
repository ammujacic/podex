import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

interface DnsStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { config } = props;

    if (!config.domainName) {
      throw new Error('domainName is required for DnsStack');
    }

    // Create or import hosted zone
    if (config.hostedZoneId) {
      // Import existing hosted zone
      this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.domainName,
      });
    } else {
      // Create new hosted zone
      this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
        zoneName: config.domainName,
        comment: `Podex ${config.envName} hosted zone`,
      });
    }

    // ACM Certificate with DNS validation
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: config.domainName,
      subjectAlternativeNames: [
        `*.${config.domainName}`,
        `api.${config.domainName}`,
        `app.${config.domainName}`,
      ],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // Outputs
    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.hostedZone.hostedZoneId,
      description: 'Route53 Hosted Zone ID',
    });

    if (this.hostedZone instanceof route53.HostedZone) {
      new cdk.CfnOutput(this, 'NameServers', {
        value: cdk.Fn.join(',', this.hostedZone.hostedZoneNameServers ?? []),
        description: 'Name servers for DNS delegation (configure at your domain registrar)',
      });
    }

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'ACM Certificate ARN',
    });
  }
}
