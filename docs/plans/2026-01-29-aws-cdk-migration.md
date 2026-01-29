# GCP to AWS Infrastructure Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Podex infrastructure from GCP/Pulumi to AWS/CDK, replacing Cloud Run with ECS Fargate, Vertex AI with Bedrock, and offering both ARM and x86 EC2 workspace tiers.

**Architecture:** ECS Fargate for platform services (API, Agent, Compute, Web), EC2 instances for customer workspaces (both ARM and x86), RDS PostgreSQL (free tier), ElastiCache Redis, S3 for storage, and Bedrock for LLM inference.

**Tech Stack:** AWS CDK (TypeScript), ECS Fargate, EC2, RDS PostgreSQL, ElastiCache Redis, S3, ECR, Bedrock, Route53, ACM, CloudWatch

---

## Executive Summary

### Current GCP Infrastructure Cost: ~$10-15/month

| Service                 | Monthly Cost         |
| ----------------------- | -------------------- |
| Cloud SQL (db-f1-micro) | ~$9                  |
| Redis VM (e2-micro)     | FREE                 |
| Cloud Run               | FREE (within limits) |
| Cloud Storage           | FREE (5GB)           |
| Cloud DNS               | ~$0.40               |
| **Total**               | **~$10-15**          |

### Target AWS Infrastructure Cost: ~$50-65/month

| Service                             | Monthly Cost                    |
| ----------------------------------- | ------------------------------- |
| RDS PostgreSQL (db.t4g.micro)       | FREE (750 hrs/mo for 12 months) |
| ElastiCache Redis (cache.t4g.micro) | ~$12                            |
| ECS Fargate (4 services, minimal)   | ~$8-12                          |
| NAT Gateway                         | ~$32                            |
| S3                                  | FREE (5GB)                      |
| Route53                             | ~$0.50                          |
| ECR                                 | ~$1                             |
| **Total Year 1**                    | **~$53-58**                     |
| **Total After Year 1**              | **~$65-70**                     |

### Hardware Tier Mapping - x86 (Intel/AMD)

| Tier           | Specs         | AWS Instance | AWS On-Demand | Our Rate | AWS Spot   |
| -------------- | ------------- | ------------ | ------------- | -------- | ---------- |
| Starter x86    | 2 vCPU, 4GB   | t3.medium    | $0.0416/hr    | $0.05/hr | ~$0.013/hr |
| Pro x86        | 4 vCPU, 8GB   | t3.xlarge    | $0.1664/hr    | $0.15/hr | ~$0.05/hr  |
| Power x86      | 8 vCPU, 16GB  | m5.2xlarge   | $0.384/hr     | $0.35/hr | ~$0.12/hr  |
| Enterprise x86 | 16 vCPU, 32GB | m5.4xlarge   | $0.768/hr     | $0.60/hr | ~$0.24/hr  |

### Hardware Tier Mapping - ARM (Graviton) - 20% cheaper!

| Tier           | Specs         | AWS Instance | AWS On-Demand | Our Rate | AWS Spot   |
| -------------- | ------------- | ------------ | ------------- | -------- | ---------- |
| Starter ARM    | 2 vCPU, 4GB   | t4g.medium   | $0.0336/hr    | $0.04/hr | ~$0.010/hr |
| Pro ARM        | 4 vCPU, 8GB   | t4g.xlarge   | $0.1344/hr    | $0.12/hr | ~$0.04/hr  |
| Power ARM      | 8 vCPU, 16GB  | m6g.2xlarge  | $0.308/hr     | $0.28/hr | ~$0.09/hr  |
| Enterprise ARM | 16 vCPU, 32GB | m6g.4xlarge  | $0.616/hr     | $0.50/hr | ~$0.18/hr  |

### GPU Tiers (x86 only - no ARM GPUs)

| Tier        | GPU         | AWS Instance | AWS On-Demand | Our Rate | AWS Spot  |
| ----------- | ----------- | ------------ | ------------- | -------- | --------- |
| GPU Starter | NVIDIA T4   | g4dn.xlarge  | $0.526/hr     | $0.80/hr | ~$0.16/hr |
| GPU Pro     | NVIDIA A10G | g5.xlarge    | $1.006/hr     | $1.20/hr | ~$0.30/hr |
| GPU Power   | NVIDIA V100 | p3.2xlarge   | $3.06/hr      | $3.50/hr | ~$1.00/hr |

**Note:** ARM (Graviton) instances are ~20% cheaper than x86 equivalents with comparable performance. Recommended for most workloads.

---

## Phase 1: CDK Project Setup

### Task 1.1: Initialize CDK TypeScript Project

**Files:**

- Create: `infrastructure-aws/package.json`
- Create: `infrastructure-aws/tsconfig.json`
- Create: `infrastructure-aws/cdk.json`
- Create: `infrastructure-aws/bin/podex.ts`
- Create: `infrastructure-aws/lib/podex-stack.ts`

**Step 1: Create CDK project structure**

```bash
mkdir -p infrastructure-aws
cd infrastructure-aws
npx cdk init app --language typescript
```

**Step 2: Install dependencies**

```bash
npm install aws-cdk-lib constructs
```

**Step 3: Verify CDK setup**

Run: `npx cdk --version`
Expected: CDK version number

**Step 4: Commit**

```bash
git add infrastructure-aws/
git commit -m "feat(infra): initialize AWS CDK project structure"
```

---

### Task 1.2: Create Configuration Types

**Files:**

- Create: `infrastructure-aws/lib/config.ts`

**Step 1: Write configuration types**

```typescript
// infrastructure-aws/lib/config.ts
export interface PodexConfig {
  env: 'dev' | 'prod';
  region: string;
  domain: string;
  vpcCidr: string;
}

export interface ServiceConfig {
  name: string;
  port: number;
  cpu: number; // Fargate CPU units (256, 512, 1024, 2048, 4096)
  memory: number; // Fargate memory in MB
  desiredCount: number;
  maxCount: number;
  needsDb: boolean;
  needsRedis: boolean;
  needsStorage: boolean;
  needsBedrock: boolean;
}

// ECS Fargate services (API, Agent, Compute, Web)
// Using minimum Fargate resources to minimize cost
// Fargate pricing: $0.04048/vCPU-hr + $0.004445/GB-hr (ARM is 20% less)
export const SERVICES: ServiceConfig[] = [
  {
    name: 'api',
    port: 3001,
    cpu: 256, // 0.25 vCPU (minimum)
    memory: 512, // 512 MB (minimum for 256 CPU)
    desiredCount: 1,
    maxCount: 5,
    needsDb: true,
    needsRedis: true,
    needsStorage: true,
    needsBedrock: true,
  },
  {
    name: 'agent',
    port: 3002,
    cpu: 512, // 0.5 vCPU (needs more for LLM streaming)
    memory: 1024, // 1 GB
    desiredCount: 1,
    maxCount: 5,
    needsDb: true,
    needsRedis: true,
    needsStorage: true,
    needsBedrock: true,
  },
  {
    name: 'compute',
    port: 3003,
    cpu: 256, // 0.25 vCPU (minimum)
    memory: 512, // 512 MB
    desiredCount: 1,
    maxCount: 3,
    needsDb: false,
    needsRedis: true,
    needsStorage: true,
    needsBedrock: false,
  },
  {
    name: 'web',
    port: 3000,
    cpu: 256, // 0.25 vCPU (minimum)
    memory: 512, // 512 MB
    desiredCount: 1,
    maxCount: 5,
    needsDb: false,
    needsRedis: false,
    needsStorage: false,
    needsBedrock: false,
  },
];

export const DEV_CONFIG: PodexConfig = {
  env: 'dev',
  region: 'us-east-1', // Bedrock availability
  domain: 'podex.dev',
  vpcCidr: '10.0.0.0/16',
};

export const PROD_CONFIG: PodexConfig = {
  env: 'prod',
  region: 'us-east-1',
  domain: 'podex.dev',
  vpcCidr: '10.0.0.0/16',
};
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/config.ts
git commit -m "feat(infra): add configuration types for AWS CDK"
```

---

## Phase 2: Core Infrastructure Stacks

### Task 2.1: Create VPC Stack

**Files:**

- Create: `infrastructure-aws/lib/stacks/vpc-stack.ts`

**Step 1: Write VPC stack**

```typescript
// infrastructure-aws/lib/stacks/vpc-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

export interface VpcStackProps extends cdk.StackProps {
  config: PodexConfig;
}

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    // VPC with public and private subnets
    // NAT Gateway needed for Fargate tasks in private subnets
    this.vpc = new ec2.Vpc(this, 'PodexVpc', {
      vpcName: `podex-vpc-${props.config.env}`,
      ipAddresses: ec2.IpAddresses.cidr(props.config.vpcCidr),
      maxAzs: 2,
      natGateways: 1, // Single NAT for cost savings (add more for prod HA)
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // VPC Endpoints for cost savings (reduce NAT traffic)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Interface endpoints for private subnet access
    this.vpc.addInterfaceEndpoint('EcrEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
    });

    this.vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });

    this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    this.vpc.addInterfaceEndpoint('BedrockEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
    });
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/vpc-stack.ts
git commit -m "feat(infra): add VPC stack with NAT and endpoints"
```

---

### Task 2.2: Create Secrets Stack

**Files:**

- Create: `infrastructure-aws/lib/stacks/secrets-stack.ts`

**Step 1: Write secrets stack**

```typescript
// infrastructure-aws/lib/stacks/secrets-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

export interface SecretsStackProps extends cdk.StackProps {
  config: PodexConfig;
}

export class SecretsStack extends cdk.Stack {
  public readonly secrets: Record<string, secretsmanager.Secret>;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const secretNames = [
      'jwt-secret',
      'internal-api-key',
      'database-password',
      'redis-password',
      'admin-email',
      'admin-password',
      'anthropic-api-key',
      'openai-api-key',
      'github-client-id',
      'github-client-secret',
      'google-client-id',
      'google-client-secret',
      'stripe-secret-key',
      'stripe-webhook-secret',
      'stripe-publishable-key',
      'sendgrid-api-key',
      'vapid-public-key',
      'vapid-private-key',
      'vapid-email',
      'sentry-dsn-api',
      'sentry-dsn-agent',
      'sentry-dsn-compute',
      'sentry-dsn-web',
    ];

    this.secrets = {};

    for (const name of secretNames) {
      this.secrets[name] = new secretsmanager.Secret(this, `Secret-${name}`, {
        secretName: `podex/${props.config.env}/${name}`,
        description: `Podex ${name} for ${props.config.env}`,
      });
    }
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/secrets-stack.ts
git commit -m "feat(infra): add AWS Secrets Manager stack"
```

---

### Task 2.3: Create Database Stack (RDS PostgreSQL)

**Files:**

- Create: `infrastructure-aws/lib/stacks/database-stack.ts`

**Step 1: Write database stack**

```typescript
// infrastructure-aws/lib/stacks/database-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

export interface DatabaseStackProps extends cdk.StackProps {
  config: PodexConfig;
  vpc: ec2.Vpc;
  dbPasswordSecret: secretsmanager.Secret;
}

export class DatabaseStack extends cdk.Stack {
  public readonly instance: rds.DatabaseInstance;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.securityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });

    // db.t4g.micro: 2 vCPU, 1GB RAM - FREE TIER eligible (ARM/Graviton)
    // Equivalent to GCP db-f1-micro (~$12/mo after free tier)
    this.instance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      instanceIdentifier: `podex-db-${props.config.env}`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G, // ARM/Graviton for cost savings
        ec2.InstanceSize.MICRO
      ),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.securityGroup],
      credentials: rds.Credentials.fromSecret(props.dbPasswordSecret),
      databaseName: 'podex',
      allocatedStorage: 20,
      maxAllocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      multiAz: false,
      publiclyAccessible: false,
      deletionProtection: props.config.env === 'prod',
      backupRetention: props.config.env === 'prod' ? cdk.Duration.days(7) : cdk.Duration.days(0),
      removalPolicy:
        props.config.env === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/database-stack.ts
git commit -m "feat(infra): add RDS PostgreSQL stack (Graviton, free tier)"
```

---

### Task 2.4: Create Redis Stack (ElastiCache)

**Files:**

- Create: `infrastructure-aws/lib/stacks/redis-stack.ts`

**Step 1: Write Redis stack**

```typescript
// infrastructure-aws/lib/stacks/redis-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

export interface RedisStackProps extends cdk.StackProps {
  config: PodexConfig;
  vpc: ec2.Vpc;
}

export class RedisStack extends cdk.Stack {
  public readonly cluster: elasticache.CfnCacheCluster;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly endpoint: string;

  constructor(scope: Construct, id: string, props: RedisStackProps) {
    super(scope, id, props);

    this.securityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for ElastiCache Redis',
      allowAllOutbound: false,
    });

    // Subnet group for Redis
    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Podex Redis',
      subnetIds: props.vpc.isolatedSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: `podex-redis-${props.config.env}`,
    });

    // cache.t4g.micro: 2 vCPU, 0.5GB RAM - ~$12/mo (ARM/Graviton)
    // ElastiCache has no free tier, but managed Redis is worth the cost
    this.cluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      clusterName: `podex-redis-${props.config.env}`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.t4g.micro', // ARM/Graviton for cost savings
      numCacheNodes: 1,
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
      vpcSecurityGroupIds: [this.securityGroup.securityGroupId],
      port: 6379,
    });

    this.cluster.addDependency(subnetGroup);

    this.endpoint = `${this.cluster.attrRedisEndpointAddress}:${this.cluster.attrRedisEndpointPort}`;
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/redis-stack.ts
git commit -m "feat(infra): add ElastiCache Redis stack (Graviton)"
```

---

### Task 2.5: Create Storage Stack (S3 + ECR)

**Files:**

- Create: `infrastructure-aws/lib/stacks/storage-stack.ts`

**Step 1: Write storage stack**

```typescript
// infrastructure-aws/lib/stacks/storage-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

export interface StorageStackProps extends cdk.StackProps {
  config: PodexConfig;
}

export class StorageStack extends cdk.Stack {
  public readonly workspacesBucket: s3.Bucket;
  public readonly repositories: Record<string, ecr.Repository>;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // S3 Bucket for workspaces
    this.workspacesBucket = new s3.Bucket(this, 'WorkspacesBucket', {
      bucketName: `podex-workspaces-${props.config.env}-${this.account}`,
      removalPolicy:
        props.config.env === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.config.env !== 'prod',
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
          enabled: true,
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins:
            props.config.env === 'prod'
              ? ['https://app.podex.dev', 'https://podex.dev']
              : ['http://localhost:3000', 'http://localhost:3001'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ECR repositories - separate repos for x86 and ARM images
    const repoConfigs = [
      'api',
      'agent',
      'compute',
      'web',
      'workspace-x86',
      'workspace-arm',
      'workspace-gpu',
    ];

    this.repositories = {};

    for (const name of repoConfigs) {
      this.repositories[name] = new ecr.Repository(this, `Repo-${name}`, {
        repositoryName: `podex/${name}`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        lifecycleRules: [
          {
            maxImageCount: 5,
            rulePriority: 1,
            tagStatus: ecr.TagStatus.ANY,
          },
        ],
      });
    }
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/storage-stack.ts
git commit -m "feat(infra): add S3 and ECR storage stack with ARM/x86 repos"
```

---

## Phase 3: Compute Services

### Task 3.1: Create ECS Fargate Stack (Cloud Run replacement)

**Files:**

- Create: `infrastructure-aws/lib/stacks/ecs-stack.ts`

**Step 1: Write ECS Fargate stack**

```typescript
// infrastructure-aws/lib/stacks/ecs-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { PodexConfig, SERVICES, ServiceConfig } from '../config';

export interface EcsStackProps extends cdk.StackProps {
  config: PodexConfig;
  vpc: ec2.Vpc;
  repositories: Record<string, ecr.Repository>;
  secrets: Record<string, secretsmanager.Secret>;
  dbEndpoint: string;
  dbSecurityGroup: ec2.SecurityGroup;
  redisEndpoint: string;
  redisSecurityGroup: ec2.SecurityGroup;
  bucketName: string;
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly services: Record<string, ecs.FargateService>;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'PodexCluster', {
      clusterName: `podex-${props.config.env}`,
      vpc: props.vpc,
      containerInsights: true,
    });

    // Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc: props.vpc,
      internetFacing: true,
      loadBalancerName: `podex-alb-${props.config.env}`,
    });

    // Task execution role (for pulling images, writing logs)
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Grant secrets access
    for (const secret of Object.values(props.secrets)) {
      secret.grantRead(executionRole);
    }

    // Task role (for application permissions)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant Bedrock access
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')
    );

    this.services = {};

    for (const svcConfig of SERVICES) {
      const service = this.createService(svcConfig, props, executionRole, taskRole);
      this.services[svcConfig.name] = service;
    }
  }

  private createService(
    config: ServiceConfig,
    props: EcsStackProps,
    executionRole: iam.Role,
    taskRole: iam.Role
  ): ecs.FargateService {
    const repo = props.repositories[config.name];

    // Log group
    const logGroup = new logs.LogGroup(this, `LogGroup-${config.name}`, {
      logGroupName: `/ecs/podex-${config.name}-${props.config.env}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task definition - using minimal Fargate resources
    // Fargate ARM pricing: ~$0.03238/vCPU-hr + $0.00356/GB-hr
    // 0.25 vCPU + 0.5GB = ~$0.01/hr = ~$7.20/mo per service
    const taskDef = new ecs.FargateTaskDefinition(this, `TaskDef-${config.name}`, {
      family: `podex-${config.name}-${props.config.env}`,
      cpu: config.cpu, // 256 = 0.25 vCPU minimum
      memoryLimitMiB: config.memory, // 512 MB minimum
      executionRole,
      taskRole,
      // Use ARM64 for Fargate (20% cost savings vs x86)
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Environment variables
    const environment: Record<string, string> = {
      ENV: props.config.env,
      AWS_REGION: props.config.region,
      LLM_PROVIDER: 'bedrock',
      PORT: config.port.toString(),
    };

    if (config.needsDb) {
      environment.DATABASE_HOST = props.dbEndpoint;
    }

    if (config.needsRedis) {
      environment.REDIS_URL = `redis://${props.redisEndpoint}`;
    }

    if (config.needsStorage) {
      environment.S3_BUCKET = props.bucketName;
    }

    // Secrets from Secrets Manager
    const secrets: Record<string, ecs.Secret> = {
      JWT_SECRET: ecs.Secret.fromSecretsManager(props.secrets['jwt-secret']),
      INTERNAL_API_KEY: ecs.Secret.fromSecretsManager(props.secrets['internal-api-key']),
    };

    if (config.needsDb) {
      secrets.DATABASE_PASSWORD = ecs.Secret.fromSecretsManager(props.secrets['database-password']);
    }

    if (config.name === 'agent') {
      secrets.ANTHROPIC_API_KEY = ecs.Secret.fromSecretsManager(props.secrets['anthropic-api-key']);
      secrets.OPENAI_API_KEY = ecs.Secret.fromSecretsManager(props.secrets['openai-api-key']);
    }

    // Container
    const container = taskDef.addContainer(config.name, {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: config.name,
        logGroup,
      }),
      environment,
      secrets,
      healthCheck:
        config.name !== 'web'
          ? {
              command: ['CMD-SHELL', `curl -f http://localhost:${config.port}/health || exit 1`],
              interval: cdk.Duration.seconds(30),
              timeout: cdk.Duration.seconds(5),
              retries: 3,
              startPeriod: cdk.Duration.seconds(60),
            }
          : undefined,
    });

    container.addPortMappings({
      containerPort: config.port,
      protocol: ecs.Protocol.TCP,
    });

    // Security group
    const serviceSg = new ec2.SecurityGroup(this, `SG-${config.name}`, {
      vpc: props.vpc,
      description: `Security group for ${config.name} service`,
    });

    // Allow ALB to reach service
    serviceSg.addIngressRule(
      ec2.Peer.securityGroupId(this.alb.connections.securityGroups[0].securityGroupId),
      ec2.Port.tcp(config.port),
      'Allow ALB'
    );

    // Allow service to reach database
    if (config.needsDb) {
      props.dbSecurityGroup.addIngressRule(
        serviceSg,
        ec2.Port.tcp(5432),
        `Allow ${config.name} to DB`
      );
    }

    // Allow service to reach Redis
    if (config.needsRedis) {
      props.redisSecurityGroup.addIngressRule(
        serviceSg,
        ec2.Port.tcp(6379),
        `Allow ${config.name} to Redis`
      );
    }

    // Fargate service
    const service = new ecs.FargateService(this, `Service-${config.name}`, {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: config.desiredCount,
      securityGroups: [serviceSg],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      serviceName: `podex-${config.name}-${props.config.env}`,
      // Enable Fargate Spot for cost savings (70% discount)
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 2,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
    });

    // ALB target group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, `TG-${config.name}`, {
      vpc: props.vpc,
      port: config.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: config.name !== 'web' ? '/health' : '/',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // Auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: config.desiredCount,
      maxCapacity: config.maxCount,
    });

    scaling.scaleOnCpuUtilization(`CpuScaling-${config.name}`, {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    return service;
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/ecs-stack.ts
git commit -m "feat(infra): add ECS Fargate stack with ARM64 and Spot support"
```

---

### Task 3.2: Create EC2 Workspace Stack (Customer Pods - ARM + x86)

**Files:**

- Create: `infrastructure-aws/lib/stacks/workspace-stack.ts`

**Step 1: Write workspace EC2 configuration with ARM and x86 tiers**

```typescript
// infrastructure-aws/lib/stacks/workspace-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

// EC2 instance mapping for workspace tiers
// Both ARM (Graviton) and x86 options - ARM is ~20% cheaper
export interface WorkspaceTierConfig {
  instanceType: string;
  architecture: 'x86_64' | 'arm64';
  vcpu: number;
  memoryGb: number;
  gpuType?: string;
  gpuMemoryGb?: number;
  spotPrice: string;
  onDemandHourly: number;
  ourHourlyRateCents: number;
}

export const WORKSPACE_TIERS: Record<string, WorkspaceTierConfig> = {
  // ==================== x86_64 CPU Tiers ====================
  starter_x86: {
    instanceType: 't3.medium',
    architecture: 'x86_64',
    vcpu: 2,
    memoryGb: 4,
    spotPrice: '0.02',
    onDemandHourly: 0.0416,
    ourHourlyRateCents: 5,
  },
  pro_x86: {
    instanceType: 't3.xlarge',
    architecture: 'x86_64',
    vcpu: 4,
    memoryGb: 16,
    spotPrice: '0.06',
    onDemandHourly: 0.1664,
    ourHourlyRateCents: 15,
  },
  power_x86: {
    instanceType: 'm5.2xlarge',
    architecture: 'x86_64',
    vcpu: 8,
    memoryGb: 32,
    spotPrice: '0.15',
    onDemandHourly: 0.384,
    ourHourlyRateCents: 35,
  },
  enterprise_x86: {
    instanceType: 'm5.4xlarge',
    architecture: 'x86_64',
    vcpu: 16,
    memoryGb: 64,
    spotPrice: '0.30',
    onDemandHourly: 0.768,
    ourHourlyRateCents: 60,
  },

  // ==================== ARM64 (Graviton) CPU Tiers - 20% cheaper! ====================
  starter_arm: {
    instanceType: 't4g.medium',
    architecture: 'arm64',
    vcpu: 2,
    memoryGb: 4,
    spotPrice: '0.015',
    onDemandHourly: 0.0336,
    ourHourlyRateCents: 4, // Pass savings to customers
  },
  pro_arm: {
    instanceType: 't4g.xlarge',
    architecture: 'arm64',
    vcpu: 4,
    memoryGb: 16,
    spotPrice: '0.05',
    onDemandHourly: 0.1344,
    ourHourlyRateCents: 12,
  },
  power_arm: {
    instanceType: 'm6g.2xlarge',
    architecture: 'arm64',
    vcpu: 8,
    memoryGb: 32,
    spotPrice: '0.12',
    onDemandHourly: 0.308,
    ourHourlyRateCents: 28,
  },
  enterprise_arm: {
    instanceType: 'm6g.4xlarge',
    architecture: 'arm64',
    vcpu: 16,
    memoryGb: 64,
    spotPrice: '0.25',
    onDemandHourly: 0.616,
    ourHourlyRateCents: 50,
  },

  // ==================== GPU Tiers (x86 only) ====================
  gpu_starter: {
    instanceType: 'g4dn.xlarge',
    architecture: 'x86_64',
    vcpu: 4,
    memoryGb: 16,
    gpuType: 'NVIDIA T4',
    gpuMemoryGb: 16,
    spotPrice: '0.20',
    onDemandHourly: 0.526,
    ourHourlyRateCents: 80,
  },
  gpu_pro: {
    instanceType: 'g5.xlarge',
    architecture: 'x86_64',
    vcpu: 4,
    memoryGb: 16,
    gpuType: 'NVIDIA A10G',
    gpuMemoryGb: 24,
    spotPrice: '0.40',
    onDemandHourly: 1.006,
    ourHourlyRateCents: 120,
  },
  gpu_power: {
    instanceType: 'p3.2xlarge',
    architecture: 'x86_64',
    vcpu: 8,
    memoryGb: 61,
    gpuType: 'NVIDIA V100',
    gpuMemoryGb: 16,
    spotPrice: '1.50',
    onDemandHourly: 3.06,
    ourHourlyRateCents: 350,
  },
};

export interface WorkspaceStackProps extends cdk.StackProps {
  config: PodexConfig;
  vpc: ec2.Vpc;
}

export class WorkspaceStack extends cdk.Stack {
  public readonly instanceRole: iam.Role;
  public readonly instanceProfile: iam.CfnInstanceProfile;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: WorkspaceStackProps) {
    super(scope, id, props);

    // Security group for workspace instances
    this.securityGroup = new ec2.SecurityGroup(this, 'WorkspaceSG', {
      vpc: props.vpc,
      description: 'Security group for workspace EC2 instances',
      securityGroupName: `podex-workspace-${props.config.env}`,
      allowAllOutbound: true,
    });

    // Allow SSH from VPC (for compute service to connect)
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(22),
      'SSH from VPC'
    );

    // Allow workspace API port from VPC
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Workspace API from VPC'
    );

    // IAM role for workspace instances
    this.instanceRole = new iam.Role(this, 'WorkspaceRole', {
      roleName: `podex-workspace-${props.config.env}`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // Grant S3 access for workspace storage
    this.instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
    );

    // Grant ECR access for pulling images
    this.instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly')
    );

    // Grant CloudWatch for logging
    this.instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );

    // Instance profile
    this.instanceProfile = new iam.CfnInstanceProfile(this, 'WorkspaceProfile', {
      instanceProfileName: `podex-workspace-${props.config.env}`,
      roles: [this.instanceRole.roleName],
    });

    // Export values for compute service to launch instances dynamically
    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: this.securityGroup.securityGroupId,
      exportName: `podex-workspace-sg-${props.config.env}`,
    });

    new cdk.CfnOutput(this, 'InstanceProfileArn', {
      value: this.instanceProfile.attrArn,
      exportName: `podex-workspace-profile-${props.config.env}`,
    });

    // Export subnet IDs for launching instances
    new cdk.CfnOutput(this, 'SubnetIds', {
      value: props.vpc.privateSubnets.map((s) => s.subnetId).join(','),
      exportName: `podex-workspace-subnets-${props.config.env}`,
    });
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/workspace-stack.ts
git commit -m "feat(infra): add EC2 workspace stack with ARM and x86 tiers"
```

---

## Phase 4: DNS and Monitoring

### Task 4.1: Create DNS Stack (Route53 + ALB)

**Files:**

- Create: `infrastructure-aws/lib/stacks/dns-stack.ts`

**Step 1: Write DNS stack**

```typescript
// infrastructure-aws/lib/stacks/dns-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { PodexConfig } from '../config';

export interface DnsStackProps extends cdk.StackProps {
  config: PodexConfig;
  alb: elbv2.ApplicationLoadBalancer;
}

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    // Create hosted zone
    this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: props.config.domain,
    });

    // ACM Certificate
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.config.domain,
      subjectAlternativeNames: [`*.${props.config.domain}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // A record for root domain -> ALB
    new route53.ARecord(this, 'RootRecord', {
      zone: this.hostedZone,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(props.alb)),
    });

    // Wildcard A record -> ALB
    new route53.ARecord(this, 'WildcardRecord', {
      zone: this.hostedZone,
      recordName: '*',
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(props.alb)),
    });

    // Output nameservers
    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(', ', this.hostedZone.hostedZoneNameServers!),
      description: 'Update your domain registrar with these nameservers',
    });
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/dns-stack.ts
git commit -m "feat(infra): add Route53 DNS and ACM certificate stack"
```

---

### Task 4.2: Create Monitoring Stack (CloudWatch)

**Files:**

- Create: `infrastructure-aws/lib/stacks/monitoring-stack.ts`

**Step 1: Write monitoring stack**

```typescript
// infrastructure-aws/lib/stacks/monitoring-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { PodexConfig, SERVICES } from '../config';

export interface MonitoringStackProps extends cdk.StackProps {
  config: PodexConfig;
  alertEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // SNS topic for alerts
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `podex-alerts-${props.config.env}`,
    });

    if (props.alertEmail) {
      this.alertTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    }

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `podex-${props.config.env}`,
    });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# Podex Infrastructure Dashboard',
        width: 24,
        height: 1,
      })
    );

    // ECS Service metrics
    for (const service of SERVICES) {
      const serviceName = `podex-${service.name}-${props.config.env}`;

      // CPU alarm
      new cloudwatch.Alarm(this, `${service.name}-cpu-alarm`, {
        alarmName: `${serviceName}-high-cpu`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            ClusterName: `podex-${props.config.env}`,
            ServiceName: serviceName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 80,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Memory alarm
      new cloudwatch.Alarm(this, `${service.name}-memory-alarm`, {
        alarmName: `${serviceName}-high-memory`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'MemoryUtilization',
          dimensionsMap: {
            ClusterName: `podex-${props.config.env}`,
            ServiceName: serviceName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 85,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }

    // RDS metrics widget
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RDS CPU Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              DBInstanceIdentifier: `podex-db-${props.config.env}`,
            },
            statistic: 'Average',
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS Connections',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: {
              DBInstanceIdentifier: `podex-db-${props.config.env}`,
            },
            statistic: 'Average',
          }),
        ],
        width: 12,
      })
    );

    // ElastiCache metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Redis CPU Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              CacheClusterId: `podex-redis-${props.config.env}`,
            },
            statistic: 'Average',
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Redis Memory Usage',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'BytesUsedForCache',
            dimensionsMap: {
              CacheClusterId: `podex-redis-${props.config.env}`,
            },
            statistic: 'Average',
          }),
        ],
        width: 12,
      })
    );
  }
}
```

**Step 2: Commit**

```bash
git add infrastructure-aws/lib/stacks/monitoring-stack.ts
git commit -m "feat(infra): add CloudWatch monitoring stack"
```

---

## Phase 5: Main Stack Assembly

### Task 5.1: Create Main Podex Stack

**Files:**

- Modify: `infrastructure-aws/lib/podex-stack.ts`
- Modify: `infrastructure-aws/bin/podex.ts`

**Step 1: Update main stack**

```typescript
// infrastructure-aws/lib/podex-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DEV_CONFIG, PROD_CONFIG, PodexConfig } from './config';
import { VpcStack } from './stacks/vpc-stack';
import { SecretsStack } from './stacks/secrets-stack';
import { DatabaseStack } from './stacks/database-stack';
import { RedisStack } from './stacks/redis-stack';
import { StorageStack } from './stacks/storage-stack';
import { EcsStack } from './stacks/ecs-stack';
import { WorkspaceStack } from './stacks/workspace-stack';
import { DnsStack } from './stacks/dns-stack';
import { MonitoringStack } from './stacks/monitoring-stack';

export interface PodexStackProps extends cdk.StackProps {
  config?: PodexConfig;
}

export class PodexInfrastructure extends Construct {
  constructor(scope: Construct, id: string, props: PodexStackProps = {}) {
    super(scope, id);

    const config = props.config || DEV_CONFIG;
    const env = {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: config.region,
    };

    // 1. VPC
    const vpcStack = new VpcStack(this, 'VpcStack', { config, env });

    // 2. Secrets
    const secretsStack = new SecretsStack(this, 'SecretsStack', { config, env });

    // 3. Database
    const databaseStack = new DatabaseStack(this, 'DatabaseStack', {
      config,
      env,
      vpc: vpcStack.vpc,
      dbPasswordSecret: secretsStack.secrets['database-password'],
    });
    databaseStack.addDependency(vpcStack);
    databaseStack.addDependency(secretsStack);

    // 4. Redis (ElastiCache)
    const redisStack = new RedisStack(this, 'RedisStack', {
      config,
      env,
      vpc: vpcStack.vpc,
    });
    redisStack.addDependency(vpcStack);

    // 5. Storage
    const storageStack = new StorageStack(this, 'StorageStack', { config, env });

    // 6. ECS Fargate Services
    const ecsStack = new EcsStack(this, 'EcsStack', {
      config,
      env,
      vpc: vpcStack.vpc,
      repositories: storageStack.repositories,
      secrets: secretsStack.secrets,
      dbEndpoint: databaseStack.instance.dbInstanceEndpointAddress,
      dbSecurityGroup: databaseStack.securityGroup,
      redisEndpoint: redisStack.endpoint,
      redisSecurityGroup: redisStack.securityGroup,
      bucketName: storageStack.workspacesBucket.bucketName,
    });
    ecsStack.addDependency(databaseStack);
    ecsStack.addDependency(redisStack);
    ecsStack.addDependency(storageStack);

    // 7. EC2 Workspaces (for customer pods)
    const workspaceStack = new WorkspaceStack(this, 'WorkspaceStack', {
      config,
      env,
      vpc: vpcStack.vpc,
    });
    workspaceStack.addDependency(vpcStack);

    // 8. DNS
    const dnsStack = new DnsStack(this, 'DnsStack', {
      config,
      env,
      alb: ecsStack.alb,
    });
    dnsStack.addDependency(ecsStack);

    // 9. Monitoring
    new MonitoringStack(this, 'MonitoringStack', {
      config,
      env,
      alertEmail: process.env.ALERT_EMAIL,
    });
  }
}
```

**Step 2: Update bin/podex.ts**

```typescript
// infrastructure-aws/bin/podex.ts
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PodexInfrastructure } from '../lib/podex-stack';
import { DEV_CONFIG, PROD_CONFIG } from '../lib/config';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') || 'dev';

if (envName === 'prod') {
  new PodexInfrastructure(app, 'PodexProd', {
    config: PROD_CONFIG,
  });
} else {
  new PodexInfrastructure(app, 'PodexDev', {
    config: DEV_CONFIG,
  });
}

app.synth();
```

**Step 3: Commit**

```bash
git add infrastructure-aws/lib/podex-stack.ts infrastructure-aws/bin/podex.ts
git commit -m "feat(infra): assemble main CDK stack with ECS Fargate"
```

---

## Phase 6: Application Code Updates

### Task 6.1: Create Bedrock Provider

**Files:**

- Create: `services/agent/src/providers/bedrock.py`

**Step 1: Write Bedrock provider**

(Same as before - see original plan)

**Step 2: Commit**

```bash
git add services/agent/src/providers/bedrock.py
git commit -m "feat(agent): add AWS Bedrock provider"
```

---

### Task 6.2: Update Hardware Seed Data for ARM + x86

**Files:**

- Modify: `services/api/src/database/seeds/hardware.py`

**Step 1: Update hardware specs with ARM and x86 tiers**

```python
# services/api/src/database/seeds/hardware.py
"""Default hardware specifications seed data - AWS EC2 with ARM and x86 options."""

DEFAULT_HARDWARE_SPECS = [
    # ==================== x86_64 CPU Tiers ====================
    {
        "tier": "starter_x86",
        "display_name": "Starter (x86)",
        "description": "Basic x86 development environment",
        "architecture": "x86_64",
        "vcpu": 2,
        "memory_mb": 4096,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "t3.medium",
        "storage_gb_default": 20,
        "storage_gb_max": 50,
        "hourly_rate_cents": 5,
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 0,
    },
    {
        "tier": "pro_x86",
        "display_name": "Pro (x86)",
        "description": "Standard x86 development environment",
        "architecture": "x86_64",
        "vcpu": 4,
        "memory_mb": 16384,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "t3.xlarge",
        "storage_gb_default": 50,
        "storage_gb_max": 100,
        "hourly_rate_cents": 15,
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 1,
    },
    {
        "tier": "power_x86",
        "display_name": "Power (x86)",
        "description": "High-performance x86 environment",
        "architecture": "x86_64",
        "vcpu": 8,
        "memory_mb": 32768,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "m5.2xlarge",
        "storage_gb_default": 100,
        "storage_gb_max": 200,
        "hourly_rate_cents": 35,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 2,
    },
    {
        "tier": "enterprise_x86",
        "display_name": "Enterprise (x86)",
        "description": "Maximum x86 resources",
        "architecture": "x86_64",
        "vcpu": 16,
        "memory_mb": 65536,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "m5.4xlarge",
        "storage_gb_default": 200,
        "storage_gb_max": 500,
        "hourly_rate_cents": 60,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 3,
    },

    # ==================== ARM64 (Graviton) CPU Tiers - 20% cheaper! ====================
    {
        "tier": "starter_arm",
        "display_name": "Starter (ARM) ⚡",
        "description": "Basic ARM development - 20% cheaper!",
        "architecture": "arm64",
        "vcpu": 2,
        "memory_mb": 4096,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "t4g.medium",
        "storage_gb_default": 20,
        "storage_gb_max": 50,
        "hourly_rate_cents": 4,  # 20% cheaper than x86
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 10,
    },
    {
        "tier": "pro_arm",
        "display_name": "Pro (ARM) ⚡",
        "description": "Standard ARM development - 20% cheaper!",
        "architecture": "arm64",
        "vcpu": 4,
        "memory_mb": 16384,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "t4g.xlarge",
        "storage_gb_default": 50,
        "storage_gb_max": 100,
        "hourly_rate_cents": 12,
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 11,
    },
    {
        "tier": "power_arm",
        "display_name": "Power (ARM) ⚡",
        "description": "High-performance ARM environment",
        "architecture": "arm64",
        "vcpu": 8,
        "memory_mb": 32768,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "m6g.2xlarge",
        "storage_gb_default": 100,
        "storage_gb_max": 200,
        "hourly_rate_cents": 28,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 12,
    },
    {
        "tier": "enterprise_arm",
        "display_name": "Enterprise (ARM) ⚡",
        "description": "Maximum ARM resources",
        "architecture": "arm64",
        "vcpu": 16,
        "memory_mb": 65536,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "aws_instance_type": "m6g.4xlarge",
        "storage_gb_default": 200,
        "storage_gb_max": 500,
        "hourly_rate_cents": 50,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 13,
    },

    # ==================== GPU Tiers (x86 only - no ARM GPUs) ====================
    {
        "tier": "gpu_starter",
        "display_name": "GPU Starter",
        "description": "NVIDIA T4 - inference and light training",
        "architecture": "x86_64",
        "vcpu": 4,
        "memory_mb": 16384,
        "gpu_type": "NVIDIA T4",
        "gpu_memory_gb": 16,
        "gpu_count": 1,
        "is_gpu": True,
        "aws_instance_type": "g4dn.xlarge",
        "storage_gb_default": 100,
        "storage_gb_max": 200,
        "hourly_rate_cents": 80,
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 20,
    },
    {
        "tier": "gpu_pro",
        "display_name": "GPU Pro",
        "description": "NVIDIA A10G - efficient AI/ML workloads",
        "architecture": "x86_64",
        "vcpu": 4,
        "memory_mb": 16384,
        "gpu_type": "NVIDIA A10G",
        "gpu_memory_gb": 24,
        "gpu_count": 1,
        "is_gpu": True,
        "aws_instance_type": "g5.xlarge",
        "storage_gb_default": 150,
        "storage_gb_max": 300,
        "hourly_rate_cents": 120,
        "is_available": True,
        "requires_subscription": "team",
        "sort_order": 21,
    },
    {
        "tier": "gpu_power",
        "display_name": "GPU Power",
        "description": "NVIDIA V100 - serious ML training",
        "architecture": "x86_64",
        "vcpu": 8,
        "memory_mb": 61440,
        "gpu_type": "NVIDIA V100",
        "gpu_memory_gb": 16,
        "gpu_count": 1,
        "is_gpu": True,
        "aws_instance_type": "p3.2xlarge",
        "storage_gb_default": 500,
        "storage_gb_max": 1000,
        "hourly_rate_cents": 350,
        "is_available": True,
        "requires_subscription": "enterprise",
        "sort_order": 22,
    },
]
```

**Step 2: Commit**

```bash
git add services/api/src/database/seeds/hardware.py
git commit -m "feat(api): add ARM and x86 EC2 workspace tiers"
```

---

## Phase 7: CI/CD and Cleanup

### Task 7.1: Remove Pulumi Infrastructure

**Files:**

- Delete: `infrastructure/` (entire Pulumi directory)
- Delete: `infrastructure/.venv/`
- Delete: `infrastructure/Pulumi.yaml`
- Delete: `infrastructure/Pulumi.dev.yaml`
- Delete: `infrastructure/__main__.py`
- Delete: `infrastructure/stacks/`

**Step 1: Remove Pulumi directory**

```bash
rm -rf infrastructure/
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore(infra): remove Pulumi GCP infrastructure"
```

---

### Task 7.2: Update CI/CD Pipeline for AWS CDK

**Files:**

- Modify: `.github/workflows/deploy.yml` (or equivalent)
- Modify: `.github/workflows/test.yml`
- Delete: Any Pulumi-specific CI files

**Step 1: Update deployment workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Install CDK dependencies
        working-directory: infrastructure-aws
        run: npm ci

      - name: Deploy CDK
        working-directory: infrastructure-aws
        run: npx cdk deploy --all --require-approval never
```

**Step 2: Update test workflow to include CDK tests**

```yaml
# Add to test workflow
- name: CDK Tests
  working-directory: infrastructure-aws
  run: npm test
```

**Step 3: Commit**

```bash
git add .github/
git commit -m "ci: update workflows for AWS CDK deployment"
```

---

### Task 7.3: Update Pre-commit Hooks

**Files:**

- Modify: `.pre-commit-config.yaml`

**Step 1: Remove Pulumi-related hooks, add CDK linting**

```yaml
# Remove any pulumi hooks, add:
- repo: local
  hooks:
    - id: cdk-synth
      name: CDK Synth Check
      entry: bash -c 'cd infrastructure-aws && npx cdk synth --quiet'
      language: system
      files: ^infrastructure-aws/
      pass_filenames: false
```

**Step 2: Commit**

```bash
git add .pre-commit-config.yaml
git commit -m "chore: update pre-commit hooks for AWS CDK"
```

---

### Task 7.4: Update Documentation

**Files:**

- Modify: `README.md`
- Delete: Any GCP-specific deployment docs
- Create: `infrastructure-aws/README.md`

**Step 1: Update main README with AWS deployment instructions**

**Step 2: Create infrastructure-aws/README.md**

````markdown
# Podex AWS Infrastructure

AWS CDK infrastructure for Podex.

## Prerequisites

- Node.js 20+
- AWS CLI configured
- CDK CLI: `npm install -g aws-cdk`

## Deployment

```bash
# First time: bootstrap CDK
cdk bootstrap

# Deploy dev
cdk deploy --all

# Deploy prod
cdk deploy --all --context env=prod
```
````

## Stacks

- **VpcStack**: VPC, subnets, NAT, endpoints
- **SecretsStack**: AWS Secrets Manager
- **DatabaseStack**: RDS PostgreSQL (free tier)
- **RedisStack**: ElastiCache Redis
- **StorageStack**: S3 + ECR
- **EcsStack**: Fargate services
- **WorkspaceStack**: EC2 workspace config
- **DnsStack**: Route53 + ACM
- **MonitoringStack**: CloudWatch

````

**Step 3: Commit**

```bash
git add README.md infrastructure-aws/README.md
git commit -m "docs: update documentation for AWS infrastructure"
````

---

### Task 7.5: Clean Up GCP-Specific Code

**Files:**

- Remove GCP-specific environment variables from services
- Update docker-compose for local development
- Remove `pulumi` from any requirements files

**Step 1: Search and remove GCP references**

```bash
# Find GCP-specific code
grep -r "GCP_PROJECT" services/
grep -r "gcp" services/ --include="*.py"
grep -r "pulumi" .
```

**Step 2: Update environment templates**

Remove `GCP_PROJECT_ID`, `GCP_REGION` from `.env.example` files.
Add `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove GCP-specific code and configs"
```

---

## Cost Comparison Summary

### Monthly Cost Breakdown

| Component              | GCP (Current)      | AWS (Target)                 | Difference  |
| ---------------------- | ------------------ | ---------------------------- | ----------- |
| Database               | $9 (Cloud SQL)     | FREE (RDS free tier)         | -$9         |
| Cache                  | FREE (e2-micro VM) | $12 (ElastiCache)            | +$12        |
| Compute                | FREE (Cloud Run)   | ~$8-12 (ECS Fargate minimal) | +$8-12      |
| NAT Gateway            | N/A                | ~$32/mo                      | +$32        |
| Storage                | FREE (5GB GCS)     | FREE (5GB S3)                | $0          |
| DNS                    | $0.40              | $0.50                        | +$0.10      |
| Container Registry     | $0.10              | ~$1 (ECR)                    | +$0.90      |
| **Total Year 1**       | **~$10-15**        | **~$53-58**                  | **+$43-48** |
| **Total After Year 1** | **~$10-15**        | **~$65-70**                  | **+$55-60** |

### Cost Optimization Notes

1. **NAT Gateway is the biggest cost** (~$32/mo + data transfer). Options:
   - Use NAT instances on t4g.nano (~$3/mo) for dev environments
   - VPC endpoints reduce NAT traffic (already configured)
   - Consider VPC-less architecture for dev (public subnets only)

2. **RDS Free Tier** - 750 hours/month of db.t4g.micro for 12 months = FREE

3. **ECS Fargate Spot** saves 70% on compute - enabled by default

4. **ARM (Graviton)** saves 20% - used for all Fargate services and workspace tiers

5. **Minimal Fargate resources** - Services use 0.25-0.5 vCPU, 512MB-1GB RAM

6. **ElastiCache** - No free tier (~$12/mo), but managed Redis is worth reliability

### ARM vs x86 Savings for Workspaces

| Tier       | x86 Rate | ARM Rate | Customer Savings |
| ---------- | -------- | -------- | ---------------- |
| Starter    | $0.05/hr | $0.04/hr | 20%              |
| Pro        | $0.15/hr | $0.12/hr | 20%              |
| Power      | $0.35/hr | $0.28/hr | 20%              |
| Enterprise | $0.60/hr | $0.50/hr | 17%              |

---

## Migration Checklist

- [ ] Phase 1: CDK project setup complete
- [ ] Phase 2: Core infrastructure stacks created
- [ ] Phase 3: ECS Fargate and EC2 workspace stacks ready
- [ ] Phase 4: DNS and monitoring setup
- [ ] Phase 5: Main stack assembled
- [ ] Phase 6: Application code updated for Bedrock + ARM/x86
- [ ] Phase 7: CI/CD and cleanup
  - [ ] Remove Pulumi infrastructure directory
  - [ ] Update GitHub Actions for CDK
  - [ ] Update pre-commit hooks
  - [ ] Remove GCP-specific code
  - [ ] Update documentation
- [ ] Phase 8: Testing and validation
  - [ ] CDK synth passes
  - [ ] CDK tests pass
  - [ ] ARM workspace images built
  - [ ] x86 workspace images built
  - [ ] Secrets migrated to AWS
  - [ ] Domain DNS updated to Route53
  - [ ] Production deployment validated

---

## Sources

- [AWS EC2 On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [Amazon Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [AWS RDS PostgreSQL Pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [Amazon ElastiCache Pricing](https://aws.amazon.com/elasticache/pricing/)
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [AWS Graviton Instances](https://aws.amazon.com/ec2/graviton/)
- [EC2 Instance Comparison - Vantage](https://instances.vantage.sh/aws/ec2/)
