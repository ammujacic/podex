import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

interface DatabaseStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
}

export class DatabaseStack extends cdk.Stack {
  public readonly database: rds.DatabaseCluster;
  public readonly redisReplicationGroup: elasticache.CfnReplicationGroup;
  public readonly redisEndpoint: string;
  public readonly redisPort: number;
  public readonly sessionsTable: dynamodb.Table;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly redisSecurityGroup: ec2.SecurityGroup;
  public readonly dbSecret: secretsmanager.Secret;
  public readonly jwtSecret: secretsmanager.Secret;
  public readonly internalApiKeySecret: secretsmanager.Secret;
  public readonly sentrySecret: secretsmanager.Secret;
  public readonly redisAuthToken: secretsmanager.Secret;
  public readonly redisEncryptionKeySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc } = props;

    // Database credentials secret
    this.dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `podex/${config.envName}/database`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'podex_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // JWT secret for authentication
    this.jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `podex/${config.envName}/jwt-secret`,
      generateSecretString: {
        excludePunctuation: false,
        passwordLength: 64,
      },
    });

    // Internal API key for inter-service communication
    this.internalApiKeySecret = new secretsmanager.Secret(this, 'InternalApiKeySecret', {
      secretName: `podex/${config.envName}/internal-api-key`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    // Sentry DSN secret (stores both backend and frontend DSNs)
    // DSN values are provided via environment variables during CDK deployment:
    //   SENTRY_DSN - Backend Sentry DSN
    //   SENTRY_FRONTEND_DSN - Frontend Sentry DSN
    // If not provided, empty strings are used (Sentry will be disabled)
    const sentryDsn = process.env.SENTRY_DSN || '';
    const sentryFrontendDsn = process.env.SENTRY_FRONTEND_DSN || '';

    this.sentrySecret = new secretsmanager.Secret(this, 'SentrySecret', {
      secretName: `podex/${config.envName}/sentry`,
      description:
        'Sentry DSN configuration - set via SENTRY_DSN and SENTRY_FRONTEND_DSN env vars during deployment',
      secretObjectValue: {
        dsn: cdk.SecretValue.unsafePlainText(sentryDsn),
        frontend_dsn: cdk.SecretValue.unsafePlainText(sentryFrontendDsn),
      },
    });

    // Security group for database
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Security group for Podex database',
      allowAllOutbound: false,
    });

    // Allow inbound PostgreSQL from private subnets (where ECS services run)
    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from VPC'
    );

    // Aurora PostgreSQL Serverless v2
    this.database = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      defaultDatabaseName: 'podex',
      serverlessV2MinCapacity: config.databaseMinCapacity,
      serverlessV2MaxCapacity: config.databaseMaxCapacity,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      readers: config.isProd
        ? [rds.ClusterInstance.serverlessV2('reader', { scaleWithWriter: true })]
        : [],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.dbSecurityGroup],
      storageEncrypted: true,
      backup: {
        retention: cdk.Duration.days(config.isProd ? 35 : 7),
      },
      deletionProtection: config.isProd,
      cloudwatchLogsExports: ['postgresql'],
    });

    // Redis security group
    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for Redis cluster',
      allowAllOutbound: false,
    });

    // Allow inbound Redis from private subnets (where ECS services run)
    this.redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis from VPC'
    );

    // Redis AUTH token for secure authentication
    this.redisAuthToken = new secretsmanager.Secret(this, 'RedisAuthToken', {
      secretName: `podex/${config.envName}/redis-auth`,
      description: 'Redis AUTH token for secure authentication',
      generateSecretString: {
        excludePunctuation: true, // Redis AUTH token restrictions
        passwordLength: 64,
        excludeCharacters: '@%*()_+=[]{}|\\:";\'<>,.?/',
      },
    });

    // Redis encryption key for application-level encryption at rest
    // This provides an additional layer of encryption on top of ElastiCache's at-rest encryption
    this.redisEncryptionKeySecret = new secretsmanager.Secret(this, 'RedisEncryptionKeySecret', {
      secretName: `podex/${config.envName}/redis-encryption-key`,
      description: 'Encryption key for Redis data at rest (application-level Fernet encryption)',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32, // 32 bytes for Fernet key derivation
      },
    });

    // Redis subnet group
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis cluster',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
      cacheSubnetGroupName: `podex-redis-${config.envName}`,
    });

    // ElastiCache Redis Replication Group with TLS and AUTH
    this.redisReplicationGroup = new elasticache.CfnReplicationGroup(
      this,
      'RedisReplicationGroup',
      {
        replicationGroupDescription: `Podex Redis ${config.envName}`,
        replicationGroupId: `podex-redis-${config.envName}`,
        engine: 'redis',
        engineVersion: '7.1',
        cacheNodeType: config.cacheNodeType,
        numCacheClusters: config.cacheNumNodes,
        automaticFailoverEnabled: config.cacheNumNodes > 1,
        multiAzEnabled: config.cacheNumNodes > 1,
        cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
        securityGroupIds: [this.redisSecurityGroup.securityGroupId],
        // Security: Enable TLS encryption in transit
        transitEncryptionEnabled: true,
        transitEncryptionMode: 'required',
        // Security: Enable encryption at rest
        atRestEncryptionEnabled: true,
        // Security: Enable AUTH token
        // Note: ElastiCache L1 construct requires plain text token. The token is stored
        // securely in Secrets Manager and referenced by ECS services via ecs.Secret.
        // The unsafeUnwrap is required by CDK but the value is resolved at deploy time.
        authToken: cdk.Token.asString(this.redisAuthToken.secretValue),
        // Maintenance
        autoMinorVersionUpgrade: true,
        snapshotRetentionLimit: config.isProd ? 7 : 1,
        snapshotWindow: '03:00-05:00',
        preferredMaintenanceWindow: 'sun:05:00-sun:07:00',
      }
    );

    this.redisReplicationGroup.addDependency(redisSubnetGroup);

    // Export the Redis endpoint for other stacks (use primary endpoint for replication group)
    this.redisEndpoint = this.redisReplicationGroup.attrPrimaryEndPointAddress;
    this.redisPort = 6379;

    // DynamoDB for sessions/state
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: `podex-sessions-${config.envName}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: config.isProd,
      removalPolicy: config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for user sessions
    this.sessionsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.clusterEndpoint.hostname,
      description: 'Database cluster endpoint',
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.redisReplicationGroup.attrPrimaryEndPointAddress,
      description: 'Redis primary endpoint',
    });

    new cdk.CfnOutput(this, 'RedisAuthTokenArn', {
      value: this.redisAuthToken.secretArn,
      description: 'Redis AUTH token secret ARN',
    });

    new cdk.CfnOutput(this, 'RedisEncryptionKeyArn', {
      value: this.redisEncryptionKeySecret.secretArn,
      description: 'Redis encryption key secret ARN',
    });
  }
}
