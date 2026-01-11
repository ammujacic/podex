import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

interface StorageStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class StorageStack extends cdk.Stack {
  public readonly workspaceBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    // S3 bucket for workspace files
    this.workspaceBucket = new s3.Bucket(this, 'WorkspaceBucket', {
      bucketName: `podex-workspaces-${config.envName}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: config.isProd,
      removalPolicy: config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.isProd,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(30),
          enabled: true,
        },
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          enabled: config.isProd,
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: config.isProd
            ? [`https://${config.domainName}`, `https://app.${config.domainName}`]
            : ['http://localhost:3000'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'WorkspaceBucketName', {
      value: this.workspaceBucket.bucketName,
      description: 'Workspace S3 bucket name',
    });

    new cdk.CfnOutput(this, 'WorkspaceBucketArn', {
      value: this.workspaceBucket.bucketArn,
      description: 'Workspace S3 bucket ARN',
    });
  }
}
