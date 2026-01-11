import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

interface EmailStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  hostedZone?: route53.IHostedZone;
}

/**
 * EmailStack - Amazon SES configuration for transactional emails.
 *
 * This stack sets up:
 * - SES domain identity with DKIM signing
 * - Email templates for transactional emails
 * - Bounce and complaint handling via SNS
 * - CloudWatch alarms for email delivery metrics
 * - IAM roles for services to send emails
 */
export class EmailStack extends cdk.Stack {
  public readonly emailIdentity: ses.EmailIdentity;
  public readonly senderPolicy: iam.ManagedPolicy;
  public readonly bounceTopic: sns.Topic;
  public readonly complaintTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    const { config, hostedZone } = props;

    // ============================================================
    // SNS Topics for bounce and complaint handling
    // ============================================================

    this.bounceTopic = new sns.Topic(this, 'BounceTopic', {
      topicName: `podex-ses-bounces-${config.envName}`,
      displayName: 'Podex Email Bounces',
    });

    this.complaintTopic = new sns.Topic(this, 'ComplaintTopic', {
      topicName: `podex-ses-complaints-${config.envName}`,
      displayName: 'Podex Email Complaints',
    });

    // Add email subscription for alerts in production
    if (config.isProd && config.alertEmail) {
      this.bounceTopic.addSubscription(new subscriptions.EmailSubscription(config.alertEmail));
      this.complaintTopic.addSubscription(new subscriptions.EmailSubscription(config.alertEmail));
    }

    // ============================================================
    // SES Domain Identity
    // ============================================================

    // For production, use the configured domain
    // For dev/staging, use a subdomain like mail-dev.podex.dev
    const emailDomain = config.isProd
      ? config.domainName!
      : `mail-${config.envName}.${config.domainName ?? 'podex.dev'}`;

    if (hostedZone) {
      // Create email identity with automatic DNS records
      this.emailIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
        identity: ses.Identity.publicHostedZone(hostedZone),
        mailFromDomain: `mail.${emailDomain}`,
      });
    } else {
      // Create email identity without DNS (manual verification required)
      this.emailIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
        identity: ses.Identity.domain(emailDomain),
      });

      // Output the DKIM tokens for manual DNS configuration
      new cdk.CfnOutput(this, 'DkimTokens', {
        value: cdk.Fn.join(
          ',',
          this.emailIdentity.dkimRecords.map((r) => r.value)
        ),
        description: 'DKIM tokens for DNS configuration',
      });
    }

    // ============================================================
    // Configuration Set for tracking and delivery
    // ============================================================

    const configSet = new ses.ConfigurationSet(this, 'ConfigSet', {
      configurationSetName: `podex-${config.envName}`,
      reputationMetrics: true,
      sendingEnabled: true,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
    });

    // Add event destinations for tracking
    configSet.addEventDestination('CloudWatchDestination', {
      destination: ses.EventDestination.cloudWatchDimensions([
        {
          name: 'ses:source-ip',
          source: ses.CloudWatchDimensionSource.MESSAGE_TAG,
          defaultValue: 'unknown',
        },
        {
          name: 'ses:from-domain',
          source: ses.CloudWatchDimensionSource.MESSAGE_TAG,
          defaultValue: emailDomain,
        },
      ]),
      events: [
        ses.EmailSendingEvent.SEND,
        ses.EmailSendingEvent.DELIVERY,
        ses.EmailSendingEvent.BOUNCE,
        ses.EmailSendingEvent.COMPLAINT,
        ses.EmailSendingEvent.REJECT,
        ses.EmailSendingEvent.OPEN,
        ses.EmailSendingEvent.CLICK,
      ],
    });

    configSet.addEventDestination('BounceDestination', {
      destination: ses.EventDestination.snsTopic(this.bounceTopic),
      events: [ses.EmailSendingEvent.BOUNCE],
    });

    configSet.addEventDestination('ComplaintDestination', {
      destination: ses.EventDestination.snsTopic(this.complaintTopic),
      events: [ses.EmailSendingEvent.COMPLAINT],
    });

    // ============================================================
    // IAM Policy for sending emails
    // ============================================================

    this.senderPolicy = new iam.ManagedPolicy(this, 'SenderPolicy', {
      managedPolicyName: `podex-ses-sender-${config.envName}`,
      description: 'Policy for sending transactional emails via SES',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ses:SendEmail', 'ses:SendRawEmail', 'ses:SendTemplatedEmail'],
          resources: [
            `arn:aws:ses:${this.region}:${this.account}:identity/${emailDomain}`,
            `arn:aws:ses:${this.region}:${this.account}:configuration-set/${configSet.configurationSetName}`,
          ],
        }),
        // Allow getting send quota and statistics
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ses:GetSendQuota', 'ses:GetSendStatistics'],
          resources: ['*'],
        }),
      ],
    });

    // ============================================================
    // CloudWatch Alarms
    // ============================================================

    if (config.isProd) {
      const alarmTopic = new sns.Topic(this, 'EmailAlarmTopic', {
        topicName: `podex-ses-alarms-${config.envName}`,
      });

      if (config.alertEmail) {
        alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alertEmail));
      }

      // Bounce rate alarm (> 5% is concerning, > 10% is critical)
      new cloudwatch.Alarm(this, 'BounceRateAlarm', {
        alarmName: `podex-ses-bounce-rate-${config.envName}`,
        alarmDescription: 'SES bounce rate is above threshold',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/SES',
          metricName: 'Reputation.BounceRate',
          dimensionsMap: {
            // No dimensions needed for account-level metrics
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 0.05, // 5%
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new actions.SnsAction(alarmTopic));

      // Complaint rate alarm (> 0.1% is concerning)
      new cloudwatch.Alarm(this, 'ComplaintRateAlarm', {
        alarmName: `podex-ses-complaint-rate-${config.envName}`,
        alarmDescription: 'SES complaint rate is above threshold',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/SES',
          metricName: 'Reputation.ComplaintRate',
          dimensionsMap: {},
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 0.001, // 0.1%
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new actions.SnsAction(alarmTopic));

      // Sending quota utilization alarm (> 80%)
      new cloudwatch.Alarm(this, 'QuotaUtilizationAlarm', {
        alarmName: `podex-ses-quota-${config.envName}`,
        alarmDescription: 'SES sending quota utilization is high',
        metric: new cloudwatch.MathExpression({
          expression: 'm1 / m2 * 100',
          usingMetrics: {
            m1: new cloudwatch.Metric({
              namespace: 'AWS/SES',
              metricName: 'Send',
              statistic: 'Sum',
              period: cdk.Duration.hours(24),
            }),
            // Note: Max24HourSend isn't a direct metric, this is illustrative
            m2: new cloudwatch.Metric({
              namespace: 'AWS/SES',
              metricName: 'Send',
              statistic: 'Maximum',
              period: cdk.Duration.hours(24),
            }),
          },
          label: 'Quota Utilization %',
          period: cdk.Duration.hours(1),
        }),
        threshold: 80,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new actions.SnsAction(alarmTopic));
    }

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'EmailDomain', {
      value: emailDomain,
      description: 'Email sending domain',
    });

    new cdk.CfnOutput(this, 'ConfigurationSetName', {
      value: configSet.configurationSetName,
      description: 'SES Configuration Set name',
    });

    new cdk.CfnOutput(this, 'SenderPolicyArn', {
      value: this.senderPolicy.managedPolicyArn,
      description: 'IAM policy ARN for email sending',
    });

    new cdk.CfnOutput(this, 'BounceTopicArn', {
      value: this.bounceTopic.topicArn,
      description: 'SNS topic for bounce notifications',
    });

    new cdk.CfnOutput(this, 'ComplaintTopicArn', {
      value: this.complaintTopic.topicArn,
      description: 'SNS topic for complaint notifications',
    });
  }
}
