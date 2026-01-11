import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

interface SecurityStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  alb: elbv2.ApplicationLoadBalancer;
}

export class SecurityStack extends cdk.Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    const { config } = props;

    // WAF Web ACL with OWASP Top 10 protection
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `podex-waf-${config.envName}`,
      description: `WAF for Podex ${config.envName} environment`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `podex-waf-${config.envName}`,
        sampledRequestsEnabled: true,
      },
      rules: [
        // AWS Managed Rules - Core Rule Set (OWASP Top 10)
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              excludedRules: [],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - Known Bad Inputs
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
              excludedRules: [],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - SQL Injection
        {
          name: 'AWS-AWSManagedRulesSQLiRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
              excludedRules: [],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - Linux OS
        {
          name: 'AWS-AWSManagedRulesLinuxRuleSet',
          priority: 4,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesLinuxRuleSet',
              excludedRules: [],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesLinuxRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // Rate limiting rule - prevent DDoS
        {
          name: 'RateLimitRule',
          priority: 5,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: config.isProd ? 2000 : 500, // requests per 5 minutes per IP
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
            sampledRequestsEnabled: true,
          },
        },
        // Block requests from known bad IP reputation list
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 6,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
              excludedRules: [],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesAmazonIpReputationList',
            sampledRequestsEnabled: true,
          },
        },
        // Block anonymous IP addresses (VPNs, Tor, proxies)
        {
          name: 'AWS-AWSManagedRulesAnonymousIpList',
          priority: 7,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAnonymousIpList',
              excludedRules: config.isProd
                ? []
                : [
                    // Allow in non-prod for testing
                    { name: 'AnonymousIPList' },
                    { name: 'HostingProviderIPList' },
                  ],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesAnonymousIpList',
            sampledRequestsEnabled: true,
          },
        },
        // Size restrictions to prevent large payload attacks
        {
          name: 'SizeRestrictionRule',
          priority: 8,
          action: { block: {} },
          statement: {
            sizeConstraintStatement: {
              fieldToMatch: { body: { oversizeHandling: 'MATCH' } },
              comparisonOperator: 'GT',
              size: 10485760, // 10 MB max body size
              textTransformations: [{ priority: 0, type: 'NONE' }],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'SizeRestrictionRule',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate WAF with ALB
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: props.alb.loadBalancerArn,
      webAclArn: this.webAcl.attrArn,
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF Web ACL ARN',
    });

    new cdk.CfnOutput(this, 'WebAclId', {
      value: this.webAcl.attrId,
      description: 'WAF Web ACL ID',
    });
  }
}
