/**
 * Environment configuration for CDK stacks.
 */

export interface EnvironmentConfig {
  envName: string;
  region: string;
  isProd: boolean;

  // VPC
  vpcCidr: string;
  maxAzs: number;

  // Database
  databaseInstanceClass: string;
  databaseMinCapacity: number;
  databaseMaxCapacity: number;

  // Compute
  apiDesiredCount: number;
  agentDesiredCount: number;
  computeDesiredCount: number;
  webDesiredCount: number;

  // Cache
  cacheNodeType: string;
  cacheNumNodes: number;

  // Domain
  domainName?: string;
  hostedZoneId?: string;

  // Sentry
  sentryTracesSampleRate: number;
  sentryProfilesSampleRate: number;

  // Monitoring
  alertEmail?: string;
}

// ALPHA STAGE: All environments use minimal resources to reduce costs
// Scale up as needed when traffic increases
const environments: Record<string, EnvironmentConfig> = {
  dev: {
    envName: 'dev',
    region: 'us-east-1',
    isProd: false,
    vpcCidr: '10.0.0.0/16',
    maxAzs: 2,
    // Aurora Serverless v2 minimum (0.5 ACU = ~$0.06/hour when active, scales to 0 when idle)
    databaseInstanceClass: 'db.t4g.micro',
    databaseMinCapacity: 0.5,
    databaseMaxCapacity: 1,
    // Single instance for all services
    apiDesiredCount: 1,
    agentDesiredCount: 1,
    computeDesiredCount: 1,
    webDesiredCount: 1,
    // Smallest cache instance (free tier eligible)
    cacheNodeType: 'cache.t4g.micro',
    cacheNumNodes: 1,
    // Reduced sampling for cost savings
    sentryTracesSampleRate: 0.1,
    sentryProfilesSampleRate: 0.1,
  },
  staging: {
    envName: 'staging',
    region: 'us-east-1',
    isProd: false,
    vpcCidr: '10.1.0.0/16',
    maxAzs: 2,
    // Minimal Aurora Serverless v2
    databaseInstanceClass: 'db.t4g.micro',
    databaseMinCapacity: 0.5,
    databaseMaxCapacity: 2,
    // Single instance for all services
    apiDesiredCount: 1,
    agentDesiredCount: 1,
    computeDesiredCount: 1,
    webDesiredCount: 1,
    // Smallest cache instance
    cacheNodeType: 'cache.t4g.micro',
    cacheNumNodes: 1,
    // Reduced sampling
    sentryTracesSampleRate: 0.1,
    sentryProfilesSampleRate: 0.1,
  },
  prod: {
    envName: 'prod',
    region: 'us-east-1',
    isProd: true,
    vpcCidr: '10.2.0.0/16',
    // ALPHA: Use 2 AZs to reduce NAT gateway costs (1 NAT gateway)
    maxAzs: 2,
    // ALPHA: Smallest production instance (scales up automatically with Serverless v2)
    databaseInstanceClass: 'db.t4g.small',
    databaseMinCapacity: 0.5,
    databaseMaxCapacity: 4,
    // ALPHA: Single instance for all services - scale up when traffic increases
    apiDesiredCount: 1,
    agentDesiredCount: 1,
    computeDesiredCount: 1,
    webDesiredCount: 1,
    // ALPHA: Smallest cache instance - upgrade to cache.t4g.small when needed
    cacheNodeType: 'cache.t4g.micro',
    cacheNumNodes: 1,
    domainName: 'podex.dev',
    // Keep sampling low for cost
    sentryTracesSampleRate: 0.1,
    sentryProfilesSampleRate: 0.05,
    // Set this to receive monitoring alerts
    alertEmail: undefined, // Configure in AWS Console or set here: 'alerts@podex.dev'
  },
};

export function getEnvironmentConfig(envName: string): EnvironmentConfig {
  const config = environments[envName];
  if (!config) {
    throw new Error(`Unknown environment: ${envName}`);
  }
  return config;
}
