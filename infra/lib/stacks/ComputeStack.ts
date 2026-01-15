import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

interface ComputeStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
  dbSecurityGroup: ec2.SecurityGroup;
  redisSecurityGroup: ec2.SecurityGroup;
  dbSecret: secretsmanager.Secret;
  workspaceBucket: s3.Bucket;
  certificate?: acm.Certificate;
  hostedZone?: route53.IHostedZone;
  sentrySecret?: secretsmanager.ISecret;
  jwtSecret?: secretsmanager.ISecret;
  internalApiKeySecret?: secretsmanager.ISecret;
  redisAuthToken?: secretsmanager.ISecret;
  stripeSecret?: secretsmanager.ISecret;
  redisEndpoint: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public alb!: elbv2.ApplicationLoadBalancer;
  public readonly apiService: ecs.FargateService;
  public readonly agentService: ecs.FargateService;
  public readonly computeService: ecs.FargateService;
  public readonly webService: ecs.FargateService;
  public workspaceRepo!: ecr.Repository;
  // Workspace task definitions for different architectures/accelerators
  public workspaceTaskDefinition!: ecs.FargateTaskDefinition; // ARM64 (default)
  public workspaceTaskDefinitionX86!: ecs.FargateTaskDefinition; // x86_64
  public workspaceTaskDefinitionGpu!: ecs.Ec2TaskDefinition; // x86_64 + GPU
  public workspaceTaskDefinitionArmGpu!: ecs.Ec2TaskDefinition; // ARM64 + T4G GPU
  public workspaceTaskDefinitionMl!: ecs.Ec2TaskDefinition; // ML accelerators
  public workspaceSecurityGroup!: ec2.SecurityGroup;
  public readonly serviceDiscoveryNamespace: servicediscovery.PrivateDnsNamespace;

  private readonly config: EnvironmentConfig;
  private readonly vpc: ec2.Vpc;
  private readonly dbSecurityGroup: ec2.SecurityGroup;
  private readonly redisSecurityGroup: ec2.SecurityGroup;
  private readonly dbSecret: secretsmanager.Secret;
  private readonly workspaceBucket: s3.Bucket;
  private readonly sentrySecret?: secretsmanager.ISecret;
  private readonly jwtSecret?: secretsmanager.ISecret;
  private readonly internalApiKeySecret?: secretsmanager.ISecret;
  private readonly redisAuthToken?: secretsmanager.ISecret;
  private readonly stripeSecret?: secretsmanager.ISecret;
  private readonly redisEndpoint: string;
  private albSecurityGroup!: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    this.config = props.config;
    this.vpc = props.vpc;
    this.dbSecurityGroup = props.dbSecurityGroup;
    this.redisSecurityGroup = props.redisSecurityGroup;
    this.dbSecret = props.dbSecret;
    this.workspaceBucket = props.workspaceBucket;
    this.sentrySecret = props.sentrySecret;
    this.jwtSecret = props.jwtSecret;
    this.internalApiKeySecret = props.internalApiKeySecret;
    this.redisAuthToken = props.redisAuthToken;
    this.stripeSecret = props.stripeSecret;
    this.redisEndpoint = props.redisEndpoint;

    // ECS Cluster with CloudMap namespace for service discovery
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: this.vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
      clusterName: `podex-${this.config.envName}`,
    });

    // Service Discovery namespace for inter-service communication
    this.serviceDiscoveryNamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      'ServiceDiscoveryNamespace',
      {
        name: `podex-${this.config.envName}.local`,
        vpc: this.vpc,
        description: `Service discovery namespace for Podex ${this.config.envName}`,
      }
    );

    // Create ALB
    this.createLoadBalancer(props.certificate);

    // Create ECR Repositories
    const { apiRepo, agentRepo, computeRepo, webRepo } = this.createRepositories();

    // Create target groups
    const { apiTargetGroup, agentTargetGroup, computeTargetGroup, webTargetGroup } =
      this.createTargetGroups();

    // Create workspace resources BEFORE compute service (compute needs workspace task defs for IAM)
    this.createWorkspaceResources();

    // Create services
    this.apiService = this.createApiService(apiRepo, apiTargetGroup);
    this.agentService = this.createAgentService(agentRepo, agentTargetGroup);
    this.computeService = this.createComputeService(computeRepo, computeTargetGroup);
    this.webService = this.createWebService(webRepo, webTargetGroup);

    // Create DNS records if hosted zone provided
    if (props.hostedZone && this.config.domainName) {
      this.createDnsRecords(props.hostedZone);
    }

    // Outputs
    this.createOutputs();
  }

  private createLoadBalancer(certificate?: acm.Certificate): void {
    // ALB Security Group
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Podex ALB',
      allowAllOutbound: false,
    });

    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP for redirect'
    );
    this.albSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.allTcp(),
      'Allow outbound to targets'
    );

    // S3 bucket for ALB access logs
    const albLogsBucket = new s3.Bucket(this, 'AlbLogsBucket', {
      bucketName: `podex-alb-logs-${this.config.envName}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: this.config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !this.config.isProd,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          expiration: cdk.Duration.days(this.config.isProd ? 90 : 30),
          enabled: true,
        },
      ],
    });

    // Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
      loadBalancerName: `podex-${this.config.envName}`,
    });

    // Enable ALB access logging
    this.alb.logAccessLogs(albLogsBucket, `alb-logs/${this.config.envName}`);

    // Create listener - HTTPS with cert if available, otherwise HTTP for dev
    let listener: elbv2.ApplicationListener;

    if (certificate) {
      // Production: HTTP redirects to HTTPS
      this.alb.addListener('HttpListener', {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });

      // HTTPS Listener with certificate
      listener = this.alb.addListener('HttpsListener', {
        port: 443,
        certificates: [certificate],
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: 'text/plain',
          messageBody: 'Not Found',
        }),
      });
    } else {
      // Dev: HTTP only (no certificate)
      listener = this.alb.addListener('HttpListener', {
        port: 80,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: 'text/plain',
          messageBody: 'Not Found',
        }),
      });
    }

    // Store listener for target group attachment
    (this as { httpsListener?: elbv2.ApplicationListener }).httpsListener = listener;
  }

  private createRepositories() {
    // ECR lifecycle rules - keep recent images, clean up old ones
    // Note: TagStatus.ANY must have highest rulePriority (lowest precedence)
    const lifecycleRules: ecr.LifecycleRule[] = [
      {
        description: 'Remove untagged images older than 1 day',
        maxImageAge: cdk.Duration.days(1),
        rulePriority: 1,
        tagStatus: ecr.TagStatus.UNTAGGED,
      },
      {
        description: 'Keep last 10 images',
        maxImageCount: 10,
        rulePriority: 2,
        tagStatus: ecr.TagStatus.ANY,
      },
    ];

    const apiRepo = new ecr.Repository(this, 'ApiRepository', {
      repositoryName: `podex/api-${this.config.envName}`,
      removalPolicy: this.config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      lifecycleRules,
    });

    const agentRepo = new ecr.Repository(this, 'AgentRepository', {
      repositoryName: `podex/agent-${this.config.envName}`,
      removalPolicy: this.config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      lifecycleRules,
    });

    const computeRepo = new ecr.Repository(this, 'ComputeRepository', {
      repositoryName: `podex/compute-${this.config.envName}`,
      removalPolicy: this.config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      lifecycleRules,
    });

    const webRepo = new ecr.Repository(this, 'WebRepository', {
      repositoryName: `podex/web-${this.config.envName}`,
      removalPolicy: this.config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      lifecycleRules,
    });

    this.workspaceRepo = new ecr.Repository(this, 'WorkspaceRepository', {
      repositoryName: `podex/workspace-${this.config.envName}`,
      removalPolicy: this.config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      lifecycleRules,
    });

    return { apiRepo, agentRepo, computeRepo, webRepo };
  }

  private createTargetGroups() {
    const httpsListener = (this as { httpsListener?: elbv2.ApplicationListener }).httpsListener!;

    const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
      vpc: this.vpc,
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const agentTargetGroup = new elbv2.ApplicationTargetGroup(this, 'AgentTargetGroup', {
      vpc: this.vpc,
      port: 3002,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const computeTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ComputeTargetGroup', {
      vpc: this.vpc,
      port: 3003,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const webTargetGroup = new elbv2.ApplicationTargetGroup(this, 'WebTargetGroup', {
      vpc: this.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Add routing rules
    httpsListener.addAction('ApiRoute', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*', '/health'])],
      action: elbv2.ListenerAction.forward([apiTargetGroup]),
    });

    httpsListener.addAction('AgentRoute', {
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/agent/*', '/ws/agent/*'])],
      action: elbv2.ListenerAction.forward([agentTargetGroup]),
    });

    httpsListener.addAction('ComputeRoute', {
      priority: 30,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/compute/*', '/ws/compute/*'])],
      action: elbv2.ListenerAction.forward([computeTargetGroup]),
    });

    httpsListener.addAction('WebRoute', {
      priority: 100,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      action: elbv2.ListenerAction.forward([webTargetGroup]),
    });

    return { apiTargetGroup, agentTargetGroup, computeTargetGroup, webTargetGroup };
  }

  private createServiceSecurityGroup(
    name: string,
    port: number,
    needsDbAccess: boolean,
    needsRedisAccess: boolean
  ): ec2.SecurityGroup {
    const securityGroup = new ec2.SecurityGroup(this, `${name}SG`, {
      vpc: this.vpc,
      description: `Security group for ${name} service`,
      allowAllOutbound: false,
    });

    // Allow inbound from ALB
    securityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(port), 'Allow from ALB');

    // Allow HTTPS outbound for AWS services
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');

    // Database access - egress only, ingress is handled in DatabaseStack
    if (needsDbAccess) {
      securityGroup.addEgressRule(this.dbSecurityGroup, ec2.Port.tcp(5432), 'Allow to PostgreSQL');
    }

    // Redis access - egress only, ingress is handled in DatabaseStack
    if (needsRedisAccess) {
      securityGroup.addEgressRule(this.redisSecurityGroup, ec2.Port.tcp(6379), 'Allow to Redis');
    }

    return securityGroup;
  }

  private getBaseIamPolicies(): iam.PolicyStatement[] {
    return [
      // Secrets Manager access for DB credentials
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [this.dbSecret.secretArn],
      }),
      // S3 access for workspace files
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [this.workspaceBucket.bucketArn, `${this.workspaceBucket.bucketArn}/*`],
      }),
      // AWS Transcribe access for speech-to-text
      new iam.PolicyStatement({
        actions: [
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
          'transcribe:ListTranscriptionJobs',
          'transcribe:DeleteTranscriptionJob',
          'transcribe:StartStreamTranscription',
          'transcribe:StartStreamTranscriptionWebSocket',
        ],
        resources: ['*'],
      }),
      // AWS Polly access for text-to-speech
      new iam.PolicyStatement({
        actions: [
          'polly:SynthesizeSpeech',
          'polly:DescribeVoices',
          'polly:GetSpeechSynthesisTask',
          'polly:ListSpeechSynthesisTasks',
          'polly:StartSpeechSynthesisTask',
        ],
        resources: ['*'],
      }),
    ];
  }

  private createApiService(
    repository: ecr.Repository,
    targetGroup: elbv2.ApplicationTargetGroup
  ): ecs.FargateService {
    const securityGroup = this.createServiceSecurityGroup('api', 3001, true, true);

    // ALPHA: Minimum Fargate task size (256 CPU, 512 MB)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'apiTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Build secrets for API service
    const apiSecrets: Record<string, ecs.Secret> = {
      DATABASE_SECRET: ecs.Secret.fromSecretsManager(this.dbSecret),
    };
    if (this.sentrySecret) {
      apiSecrets.SENTRY_DSN = ecs.Secret.fromSecretsManager(this.sentrySecret, 'dsn');
    }
    if (this.jwtSecret) {
      apiSecrets.JWT_SECRET_KEY = ecs.Secret.fromSecretsManager(this.jwtSecret);
    }
    if (this.redisAuthToken) {
      apiSecrets.REDIS_AUTH_TOKEN = ecs.Secret.fromSecretsManager(this.redisAuthToken);
    }
    if (this.stripeSecret) {
      apiSecrets.STRIPE_SECRET_KEY = ecs.Secret.fromSecretsManager(this.stripeSecret, 'secret_key');
      apiSecrets.STRIPE_WEBHOOK_SECRET = ecs.Secret.fromSecretsManager(
        this.stripeSecret,
        'webhook_secret'
      );
      apiSecrets.STRIPE_PUBLISHABLE_KEY = ecs.Secret.fromSecretsManager(
        this.stripeSecret,
        'publishable_key'
      );
    }
    if (this.internalApiKeySecret) {
      apiSecrets.INTERNAL_SERVICE_TOKEN = ecs.Secret.fromSecretsManager(this.internalApiKeySecret);
    }

    // Compute API URL based on ALB DNS or domain name
    const apiBaseUrl = this.config.domainName
      ? `https://${this.config.domainName}`
      : `http://${this.alb.loadBalancerDnsName}`;

    // Use service discovery for inter-service URLs
    const serviceDiscoveryDomain = `podex-${this.config.envName}.local`;

    taskDefinition.addContainer('apiContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        // ALPHA: Reduced log retention for cost savings
        logRetention: this.config.isProd
          ? logs.RetentionDays.THREE_MONTHS
          : logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        ENVIRONMENT: this.config.envName,
        PORT: '3001',
        // AWS / S3
        S3_BUCKET: this.workspaceBucket.bucketName,
        S3_WORKSPACE_PREFIX: 'workspaces',
        AWS_REGION: this.config.region,
        // Redis with TLS
        REDIS_URL: `rediss://${this.redisEndpoint}:6379`,
        REDIS_TLS_ENABLED: 'true',
        // Inter-service URLs using service discovery
        COMPUTE_SERVICE_URL: `http://compute.${serviceDiscoveryDomain}:3003`,
        AGENT_SERVICE_URL: `http://agent.${serviceDiscoveryDomain}:3002`,
        FRONTEND_URL: apiBaseUrl,
        // Voice/Audio defaults
        DEFAULT_POLLY_VOICE_ID: 'Joanna',
        DEFAULT_POLLY_ENGINE: 'neural',
        DEFAULT_TRANSCRIBE_LANGUAGE: 'en-US',
        VOICE_AUDIO_S3_PREFIX: 'audio/voice',
        // Cache settings
        CACHE_TTL_TEMPLATES: '3600',
        CACHE_TTL_SESSIONS: '300',
        CACHE_TTL_USER_CONFIG: '600',
        CACHE_PREFIX: 'podex:cache:',
        // Sentry
        SENTRY_TRACES_SAMPLE_RATE: this.config.sentryTracesSampleRate.toString(),
        SENTRY_PROFILES_SAMPLE_RATE: this.config.sentryProfilesSampleRate.toString(),
      },
      secrets: apiSecrets,
      portMappings: [{ containerPort: 3001 }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3001/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    // Add IAM policies
    this.getBaseIamPolicies().forEach((policy) => {
      taskDefinition.taskRole.addToPrincipalPolicy(policy);
    });

    const service = new ecs.FargateService(this, 'apiService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: this.config.apiDesiredCount,
      securityGroups: [securityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: this.config.isProd ? 0 : 2 },
        { capacityProvider: 'FARGATE', weight: 1 },
      ],
      // Enable service discovery
      cloudMapOptions: {
        name: 'api',
        cloudMapNamespace: this.serviceDiscoveryNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // Add auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: this.config.apiDesiredCount,
      maxCapacity: this.config.isProd
        ? this.config.apiDesiredCount * 4
        : this.config.apiDesiredCount * 2,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    return service;
  }

  private createAgentService(
    repository: ecr.Repository,
    targetGroup: elbv2.ApplicationTargetGroup
  ): ecs.FargateService {
    const securityGroup = this.createServiceSecurityGroup('agent', 3002, true, true);

    // ALPHA: Reduced task size (512 CPU, 1024 MB) - needs more than API for LLM streaming
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'agentTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Build secrets for agent service
    const agentSecrets: Record<string, ecs.Secret> = {
      DATABASE_SECRET: ecs.Secret.fromSecretsManager(this.dbSecret),
    };
    if (this.sentrySecret) {
      agentSecrets.SENTRY_DSN = ecs.Secret.fromSecretsManager(this.sentrySecret, 'dsn');
    }
    if (this.redisAuthToken) {
      agentSecrets.REDIS_AUTH_TOKEN = ecs.Secret.fromSecretsManager(this.redisAuthToken);
    }

    taskDefinition.addContainer('agentContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'agent',
        // ALPHA: Reduced log retention for cost savings
        logRetention: this.config.isProd
          ? logs.RetentionDays.THREE_MONTHS
          : logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        ENVIRONMENT: this.config.envName,
        PORT: '3002',
        // AWS / S3
        S3_BUCKET: this.workspaceBucket.bucketName,
        AWS_REGION: this.config.region,
        AWS_S3_REGION: this.config.region,
        // Redis with TLS
        REDIS_URL: `rediss://${this.redisEndpoint}:6379`,
        REDIS_TLS_ENABLED: 'true',
        // LLM Configuration
        LLM_PROVIDER: 'bedrock',
        DEFAULT_ARCHITECT_MODEL: 'claude-opus-4-5-20251101',
        DEFAULT_CODER_MODEL: 'claude-sonnet-4-20250514',
        DEFAULT_REVIEWER_MODEL: 'claude-sonnet-4-20250514',
        DEFAULT_TESTER_MODEL: 'claude-sonnet-4-20250514',
        // Task queue settings
        TASK_QUEUE_POLL_INTERVAL: '1.0',
        TASK_TTL: '86400',
        TASK_MAX_RETRIES: '3',
        // Context window settings
        MAX_CONTEXT_TOKENS: '100000',
        CONTEXT_OUTPUT_RESERVATION: '4096',
        CONTEXT_SUMMARIZATION_THRESHOLD: '40',
        CONTEXT_TOKEN_THRESHOLD: '50000',
        // Tool execution limits
        COMMAND_TIMEOUT: '60',
        MAX_FILE_SIZE: '1000000',
        MAX_SEARCH_RESULTS: '50',
        // Sentry
        SENTRY_TRACES_SAMPLE_RATE: this.config.sentryTracesSampleRate.toString(),
        SENTRY_PROFILES_SAMPLE_RATE: this.config.sentryProfilesSampleRate.toString(),
      },
      secrets: agentSecrets,
      portMappings: [{ containerPort: 3002 }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3002/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    // Add IAM policies
    [
      ...this.getBaseIamPolicies(),
      // Bedrock access for LLM calls - scoped to region
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [`arn:aws:bedrock:${this.config.region}::foundation-model/*`],
      }),
    ].forEach((policy) => {
      taskDefinition.taskRole.addToPrincipalPolicy(policy);
    });

    const service = new ecs.FargateService(this, 'agentService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: this.config.agentDesiredCount,
      securityGroups: [securityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: this.config.isProd ? 0 : 2 },
        { capacityProvider: 'FARGATE', weight: 1 },
      ],
      // Enable service discovery
      cloudMapOptions: {
        name: 'agent',
        cloudMapNamespace: this.serviceDiscoveryNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // Add auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: this.config.agentDesiredCount,
      maxCapacity: this.config.isProd
        ? this.config.agentDesiredCount * 4
        : this.config.agentDesiredCount * 2,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    return service;
  }

  private createComputeService(
    repository: ecr.Repository,
    targetGroup: elbv2.ApplicationTargetGroup
  ): ecs.FargateService {
    const securityGroup = this.createServiceSecurityGroup('compute', 3003, false, true);

    // ALPHA: Reduced task size (512 CPU, 1024 MB)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'computeTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Build secrets object conditionally
    const computeSecrets: Record<string, ecs.Secret> = {};
    if (this.sentrySecret) {
      computeSecrets.SENTRY_DSN = ecs.Secret.fromSecretsManager(this.sentrySecret, 'dsn');
    }
    if (this.internalApiKeySecret) {
      computeSecrets.COMPUTE_INTERNAL_API_KEY = ecs.Secret.fromSecretsManager(
        this.internalApiKeySecret
      );
    }
    if (this.redisAuthToken) {
      computeSecrets.REDIS_AUTH_TOKEN = ecs.Secret.fromSecretsManager(this.redisAuthToken);
    }

    taskDefinition.addContainer('computeContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'compute',
        // ALPHA: Reduced log retention for cost savings
        logRetention: this.config.isProd
          ? logs.RetentionDays.THREE_MONTHS
          : logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        COMPUTE_ENVIRONMENT: this.config.envName,
        PORT: '3003',
        COMPUTE_MODE: 'aws',
        // AWS settings
        COMPUTE_AWS_REGION: this.config.region,
        COMPUTE_ECS_CLUSTER_NAME: this.cluster.clusterName,
        // Task definitions for different architectures/tiers (using family names)
        COMPUTE_ECS_TASK_DEFINITION: `podex-workspace-x86-${this.config.envName}`,
        COMPUTE_ECS_ARM_TASK_DEFINITION: `podex-workspace-${this.config.envName}`,
        COMPUTE_ECS_GPU_TASK_DEFINITION: `podex-workspace-gpu-${this.config.envName}`,
        COMPUTE_ECS_ARM_GPU_TASK_DEFINITION: `podex-workspace-arm-gpu-${this.config.envName}`,
        COMPUTE_ECS_ML_ACCELERATOR_TASK_DEFINITION: `podex-workspace-ml-${this.config.envName}`,
        COMPUTE_WORKSPACE_IMAGE: `${this.workspaceRepo.repositoryUri}:latest`,
        // Redis with TLS
        COMPUTE_REDIS_URL: `rediss://${this.redisEndpoint}:6379`,
        REDIS_TLS_ENABLED: 'true',
        // S3 Storage
        COMPUTE_S3_BUCKET: this.workspaceBucket.bucketName,
        COMPUTE_S3_PREFIX: 'workspaces',
        COMPUTE_S3_SYNC_INTERVAL: '30',
        // ALPHA: Minimum workspace tier configurations
        // All tiers use minimum resources during alpha - scale up when needed
        COMPUTE_TIER_STARTER_CPU: '1',
        COMPUTE_TIER_STARTER_MEMORY: '512',
        COMPUTE_TIER_PRO_CPU: '1',
        COMPUTE_TIER_PRO_MEMORY: '512',
        COMPUTE_TIER_POWER_CPU: '1',
        COMPUTE_TIER_POWER_MEMORY: '512',
        COMPUTE_TIER_ENTERPRISE_CPU: '1',
        COMPUTE_TIER_ENTERPRISE_MEMORY: '512',
        // Sentry (uses SENTRY_ prefix)
        SENTRY_TRACES_SAMPLE_RATE: this.config.sentryTracesSampleRate.toString(),
        SENTRY_PROFILES_SAMPLE_RATE: this.config.sentryProfilesSampleRate.toString(),
      },
      secrets: Object.keys(computeSecrets).length > 0 ? computeSecrets : undefined,
      portMappings: [{ containerPort: 3003 }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3003/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    // Add IAM policies - compute needs more permissions for managing workspaces
    // Scoped to specific cluster and task resources where possible
    [
      ...this.getBaseIamPolicies(),
      // ECS permissions for managing workspace tasks - scoped to cluster
      new iam.PolicyStatement({
        actions: [
          'ecs:RunTask',
          'ecs:StopTask',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
          'ecs:ExecuteCommand',
        ],
        resources: [
          `arn:aws:ecs:${this.config.region}:${this.account}:cluster/${this.cluster.clusterName}`,
          `arn:aws:ecs:${this.config.region}:${this.account}:task/${this.cluster.clusterName}/*`,
          `arn:aws:ecs:${this.config.region}:${this.account}:task-definition/podex-workspace-${this.config.envName}:*`,
        ],
      }),
      // Pass role permission for ECS task execution - scoped to specific workspace task roles
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          this.workspaceTaskDefinition.taskRole.roleArn,
          this.workspaceTaskDefinition.executionRole?.roleArn || '',
          this.workspaceTaskDefinitionX86.taskRole.roleArn,
          this.workspaceTaskDefinitionX86.executionRole?.roleArn || '',
          this.workspaceTaskDefinitionGpu.taskRole.roleArn,
          this.workspaceTaskDefinitionGpu.executionRole?.roleArn || '',
          this.workspaceTaskDefinitionArmGpu.taskRole.roleArn,
          this.workspaceTaskDefinitionArmGpu.executionRole?.roleArn || '',
          this.workspaceTaskDefinitionMl.taskRole.roleArn,
          this.workspaceTaskDefinitionMl.executionRole?.roleArn || '',
        ].filter((arn) => arn !== ''),
        conditions: {
          StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
        },
      }),
      // SSM permissions for ECS Exec
      new iam.PolicyStatement({
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'], // SSM doesn't support resource-level permissions
      }),
      // ECR permissions - scoped to workspace repository
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'], // GetAuthorizationToken must be *
      }),
      new iam.PolicyStatement({
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        resources: [this.workspaceRepo.repositoryArn],
      }),
    ].forEach((policy) => {
      taskDefinition.taskRole.addToPrincipalPolicy(policy);
    });

    const service = new ecs.FargateService(this, 'computeService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: this.config.computeDesiredCount,
      securityGroups: [securityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: this.config.isProd ? 0 : 2 },
        { capacityProvider: 'FARGATE', weight: 1 },
      ],
      // Enable service discovery
      cloudMapOptions: {
        name: 'compute',
        cloudMapNamespace: this.serviceDiscoveryNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // Add auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: this.config.computeDesiredCount,
      maxCapacity: this.config.isProd
        ? this.config.computeDesiredCount * 4
        : this.config.computeDesiredCount * 2,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    return service;
  }

  private createWebService(
    repository: ecr.Repository,
    targetGroup: elbv2.ApplicationTargetGroup
  ): ecs.FargateService {
    const securityGroup = this.createServiceSecurityGroup('web', 3000, false, false);

    // ALPHA: Minimum Fargate task size (256 CPU, 512 MB)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'webTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Build secrets for web frontend
    const webSecrets: Record<string, ecs.Secret> = {};
    if (this.sentrySecret) {
      webSecrets.NEXT_PUBLIC_SENTRY_DSN = ecs.Secret.fromSecretsManager(
        this.sentrySecret,
        'frontend_dsn'
      );
    }

    // Compute URLs based on domain name
    const apiUrl = this.config.domainName ? `https://${this.config.domainName}` : '/api';
    const wsUrl = this.config.domainName
      ? `wss://${this.config.domainName}`
      : `ws://${this.alb.loadBalancerDnsName}`;

    taskDefinition.addContainer('webContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web',
        // ALPHA: Reduced log retention for cost savings
        logRetention: this.config.isProd
          ? logs.RetentionDays.THREE_MONTHS
          : logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: this.config.isProd ? 'production' : 'development',
        NEXT_PUBLIC_ENVIRONMENT: this.config.envName,
        PORT: '3000',
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_PUBLIC_WS_URL: wsUrl,
      },
      secrets: Object.keys(webSecrets).length > 0 ? webSecrets : undefined,
      portMappings: [{ containerPort: 3000 }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/ || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    const service = new ecs.FargateService(this, 'webService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: this.config.webDesiredCount,
      securityGroups: [securityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: this.config.isProd ? 0 : 2 },
        { capacityProvider: 'FARGATE', weight: 1 },
      ],
      // Enable service discovery for web service
      cloudMapOptions: {
        name: 'web',
        cloudMapNamespace: this.serviceDiscoveryNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // Add auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity: this.config.webDesiredCount,
      maxCapacity: this.config.isProd
        ? this.config.webDesiredCount * 4
        : this.config.webDesiredCount * 2,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    return service;
  }

  private createWorkspaceResources(): void {
    // Workspace security group
    this.workspaceSecurityGroup = new ec2.SecurityGroup(this, 'WorkspaceSG', {
      vpc: this.vpc,
      description: 'Security group for workspace pods',
      allowAllOutbound: true, // Workspaces need internet for npm/pip
    });

    // Allow workspace to access Redis - egress only, ingress handled in DatabaseStack
    this.workspaceSecurityGroup.addEgressRule(
      this.redisSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow to Redis'
    );

    // Common workspace environment variables
    const workspaceEnv = {
      AWS_REGION: this.config.region,
      S3_BUCKET: this.workspaceBucket.bucketName,
      S3_PREFIX: 'workspaces',
      ENVIRONMENT: this.config.envName,
    };

    // Common port mappings for dev servers
    const workspacePorts = [
      { containerPort: 3000 },
      { containerPort: 3001 },
      { containerPort: 4000 },
      { containerPort: 5000 },
      { containerPort: 5173 },
      { containerPort: 8000 },
      { containerPort: 8080 },
    ];

    // S3 policy for all workspace task roles
    const s3Policy = new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
      resources: [this.workspaceBucket.bucketArn, `${this.workspaceBucket.bucketArn}/*`],
    });

    // ========================================
    // 1. ARM64 Fargate Task Definition (default - most cost effective)
    // ========================================
    // ALPHA: Minimum Fargate size (256 CPU, 512 MB) - scale up via tier config when needed
    this.workspaceTaskDefinition = new ecs.FargateTaskDefinition(this, 'WorkspaceTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      family: `podex-workspace-${this.config.envName}`,
    });

    this.workspaceTaskDefinition.addContainer('workspace', {
      image: ecs.ContainerImage.fromEcrRepository(this.workspaceRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'workspace-arm',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: { ...workspaceEnv, ARCH: 'arm64' },
      portMappings: workspacePorts,
      linuxParameters: new ecs.LinuxParameters(this, 'WorkspaceLinuxParams', {
        initProcessEnabled: true,
      }),
    });
    this.workspaceTaskDefinition.taskRole.addToPrincipalPolicy(s3Policy);

    // ========================================
    // 2. x86_64 Fargate Task Definition (for x86 compatibility)
    // ========================================
    // ALPHA: Minimum Fargate size (256 CPU, 512 MB)
    this.workspaceTaskDefinitionX86 = new ecs.FargateTaskDefinition(this, 'WorkspaceTaskDefX86', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      family: `podex-workspace-x86-${this.config.envName}`,
    });

    this.workspaceTaskDefinitionX86.addContainer('workspace', {
      image: ecs.ContainerImage.fromEcrRepository(this.workspaceRepo, 'latest-amd64'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'workspace-x86',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: { ...workspaceEnv, ARCH: 'x86_64' },
      portMappings: workspacePorts,
      linuxParameters: new ecs.LinuxParameters(this, 'WorkspaceLinuxParamsX86', {
        initProcessEnabled: true,
      }),
    });
    this.workspaceTaskDefinitionX86.taskRole.addToPrincipalPolicy(s3Policy);

    // ========================================
    // GPU Capacity Providers (only in production)
    // ========================================
    if (this.config.isProd) {
      this.createGpuCapacityProviders();
    }

    // ========================================
    // 3. x86_64 GPU Task Definition (for NVIDIA T4/A10G/A100)
    // ========================================
    this.workspaceTaskDefinitionGpu = new ecs.Ec2TaskDefinition(this, 'WorkspaceTaskDefGpu', {
      family: `podex-workspace-gpu-${this.config.envName}`,
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    this.workspaceTaskDefinitionGpu.addContainer('workspace', {
      image: ecs.ContainerImage.fromEcrRepository(this.workspaceRepo, 'latest-gpu'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'workspace-gpu',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: { ...workspaceEnv, ARCH: 'x86_64', GPU_ENABLED: 'true' },
      portMappings: workspacePorts,
      memoryLimitMiB: 16384,
      cpu: 4096,
      gpuCount: 1,
      linuxParameters: new ecs.LinuxParameters(this, 'WorkspaceLinuxParamsGpu', {
        initProcessEnabled: true,
        sharedMemorySize: 2048, // 2GB shared memory for CUDA
      }),
    });
    this.workspaceTaskDefinitionGpu.taskRole.addToPrincipalPolicy(s3Policy);

    // ========================================
    // 4. ARM64 GPU Task Definition (for Graviton2 + T4G via g5g)
    // ========================================
    this.workspaceTaskDefinitionArmGpu = new ecs.Ec2TaskDefinition(this, 'WorkspaceTaskDefArmGpu', {
      family: `podex-workspace-arm-gpu-${this.config.envName}`,
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    this.workspaceTaskDefinitionArmGpu.addContainer('workspace', {
      image: ecs.ContainerImage.fromEcrRepository(this.workspaceRepo, 'latest-arm-gpu'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'workspace-arm-gpu',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: { ...workspaceEnv, ARCH: 'arm64', GPU_ENABLED: 'true' },
      portMappings: workspacePorts,
      memoryLimitMiB: 8192,
      cpu: 4096,
      gpuCount: 1,
      linuxParameters: new ecs.LinuxParameters(this, 'WorkspaceLinuxParamsArmGpu', {
        initProcessEnabled: true,
        sharedMemorySize: 2048,
      }),
    });
    this.workspaceTaskDefinitionArmGpu.taskRole.addToPrincipalPolicy(s3Policy);

    // ========================================
    // 5. ML Accelerator Task Definition (for Inferentia2/Trainium)
    // ========================================
    this.workspaceTaskDefinitionMl = new ecs.Ec2TaskDefinition(this, 'WorkspaceTaskDefMl', {
      family: `podex-workspace-ml-${this.config.envName}`,
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    // Create Linux parameters with Neuron device access
    const mlLinuxParams = new ecs.LinuxParameters(this, 'WorkspaceLinuxParamsMl', {
      initProcessEnabled: true,
    });
    // Add Neuron device access for ML accelerators
    mlLinuxParams.addDevices({
      hostPath: '/dev/neuron0',
      containerPath: '/dev/neuron0',
      permissions: [ecs.DevicePermission.READ, ecs.DevicePermission.WRITE],
    });

    this.workspaceTaskDefinitionMl.addContainer('workspace', {
      image: ecs.ContainerImage.fromEcrRepository(this.workspaceRepo, 'latest-neuron'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'workspace-ml',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        ...workspaceEnv,
        ARCH: 'x86_64',
        ML_ACCELERATOR: 'true',
        NEURON_RT_VISIBLE_CORES: '0-1', // Use first 2 NeuronCores
      },
      portMappings: workspacePorts,
      memoryLimitMiB: 16384,
      cpu: 4096,
      linuxParameters: mlLinuxParams,
    });
    this.workspaceTaskDefinitionMl.taskRole.addToPrincipalPolicy(s3Policy);
  }

  /**
   * Create GPU capacity providers with auto-scaling groups.
   * Each GPU type has its own capacity provider backed by an ASG of GPU instances.
   */
  private createGpuCapacityProviders(): void {
    // GPU instance configurations
    const gpuConfigs = [
      {
        name: 'gpu-t4',
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.G4DN, ec2.InstanceSize.XLARGE),
        ami: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.GPU),
        minCapacity: 0,
        maxCapacity: 10,
      },
      {
        name: 'gpu-a10g',
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.G5, ec2.InstanceSize.XLARGE2),
        ami: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.GPU),
        minCapacity: 0,
        maxCapacity: 5,
      },
      {
        name: 'gpu-arm-t4g',
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.G5G, ec2.InstanceSize.XLARGE),
        ami: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.GPU, {
          cachedInContext: true,
        }),
        minCapacity: 0,
        maxCapacity: 10,
      },
    ];

    for (const config of gpuConfigs) {
      // Create Auto Scaling Group
      const asg = new autoscaling.AutoScalingGroup(this, `${config.name}Asg`, {
        vpc: this.vpc,
        instanceType: config.instanceType,
        machineImage: config.ami,
        minCapacity: config.minCapacity,
        maxCapacity: config.maxCapacity,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroup: this.workspaceSecurityGroup,
        // Enable managed termination protection for running tasks
        newInstancesProtectedFromScaleIn: true,
      });

      // Create ECS Capacity Provider
      const capacityProvider = new ecs.AsgCapacityProvider(this, `${config.name}Provider`, {
        autoScalingGroup: asg,
        capacityProviderName: `${config.name}-provider`,
        enableManagedScaling: true,
        enableManagedTerminationProtection: true,
        // Target 100% utilization before scaling
        targetCapacityPercent: 100,
      });

      // Add capacity provider to cluster
      this.cluster.addAsgCapacityProvider(capacityProvider);
    }

    // ML Accelerator capacity providers (Inferentia2, Trainium)
    const mlConfigs = [
      {
        name: 'ml-inferentia2',
        instanceType: new ec2.InstanceType('inf2.xlarge'),
        ami: ec2.MachineImage.genericLinux({
          'us-east-1': 'ami-0123456789', // Replace with actual Neuron AMI
          'us-west-2': 'ami-0123456789',
        }),
        minCapacity: 0,
        maxCapacity: 5,
      },
      {
        name: 'ml-trainium',
        instanceType: new ec2.InstanceType('trn1.2xlarge'),
        ami: ec2.MachineImage.genericLinux({
          'us-east-1': 'ami-0123456789', // Replace with actual Neuron AMI
          'us-west-2': 'ami-0123456789',
        }),
        minCapacity: 0,
        maxCapacity: 3,
      },
    ];

    for (const config of mlConfigs) {
      const asg = new autoscaling.AutoScalingGroup(this, `${config.name}Asg`, {
        vpc: this.vpc,
        instanceType: config.instanceType,
        machineImage: config.ami,
        minCapacity: config.minCapacity,
        maxCapacity: config.maxCapacity,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroup: this.workspaceSecurityGroup,
        newInstancesProtectedFromScaleIn: true,
      });

      const capacityProvider = new ecs.AsgCapacityProvider(this, `${config.name}Provider`, {
        autoScalingGroup: asg,
        capacityProviderName: `${config.name}-provider`,
        enableManagedScaling: true,
        enableManagedTerminationProtection: true,
        targetCapacityPercent: 100,
      });

      this.cluster.addAsgCapacityProvider(capacityProvider);
    }
  }

  private createDnsRecords(hostedZone: route53.IHostedZone): void {
    // Root domain -> ALB
    new route53.ARecord(this, 'RootRecord', {
      zone: hostedZone,
      recordName: this.config.domainName,
      target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(this.alb)),
    });

    // api.domain -> ALB
    new route53.ARecord(this, 'ApiRecord', {
      zone: hostedZone,
      recordName: `api.${this.config.domainName}`,
      target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(this.alb)),
    });

    // app.domain -> ALB
    new route53.ARecord(this, 'AppRecord', {
      zone: hostedZone,
      recordName: `app.${this.config.domainName}`,
      target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(this.alb)),
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'ECS Cluster ARN',
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB DNS Name',
    });

    new cdk.CfnOutput(this, 'AlbArn', {
      value: this.alb.loadBalancerArn,
      description: 'ALB ARN',
    });

    new cdk.CfnOutput(this, 'WorkspaceRepositoryUri', {
      value: this.workspaceRepo.repositoryUri,
      description: 'Workspace ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'WorkspaceTaskDefinitionArn', {
      value: this.workspaceTaskDefinition.taskDefinitionArn,
      description: 'Workspace task definition ARN (ARM64 Fargate)',
    });

    new cdk.CfnOutput(this, 'WorkspaceTaskDefinitionX86Arn', {
      value: this.workspaceTaskDefinitionX86.taskDefinitionArn,
      description: 'Workspace task definition ARN (x86_64 Fargate)',
    });

    new cdk.CfnOutput(this, 'WorkspaceTaskDefinitionGpuArn', {
      value: this.workspaceTaskDefinitionGpu.taskDefinitionArn,
      description: 'Workspace task definition ARN (x86_64 GPU EC2)',
    });

    new cdk.CfnOutput(this, 'WorkspaceTaskDefinitionArmGpuArn', {
      value: this.workspaceTaskDefinitionArmGpu.taskDefinitionArn,
      description: 'Workspace task definition ARN (ARM64 GPU EC2 - g5g)',
    });

    new cdk.CfnOutput(this, 'WorkspaceTaskDefinitionMlArn', {
      value: this.workspaceTaskDefinitionMl.taskDefinitionArn,
      description: 'Workspace task definition ARN (ML Accelerators - Inferentia2/Trainium)',
    });

    new cdk.CfnOutput(this, 'WorkspaceSecurityGroupId', {
      value: this.workspaceSecurityGroup.securityGroupId,
      description: 'Workspace security group ID',
    });
  }
}
