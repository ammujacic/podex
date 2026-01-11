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

const environments: Record<string, EnvironmentConfig> = {
  dev: {
    envName: 'dev',
    region: 'us-east-1',
    isProd: false,
    vpcCidr: '10.0.0.0/16',
    maxAzs: 2,
    databaseInstanceClass: 'db.t4g.medium',
    databaseMinCapacity: 0.5,
    databaseMaxCapacity: 2,
    apiDesiredCount: 1,
    agentDesiredCount: 1,
    computeDesiredCount: 1,
    webDesiredCount: 1,
    cacheNodeType: 'cache.t4g.micro',
    cacheNumNodes: 1,
    sentryTracesSampleRate: 1.0,
    sentryProfilesSampleRate: 1.0,
  },
  staging: {
    envName: 'staging',
    region: 'us-east-1',
    isProd: false,
    vpcCidr: '10.1.0.0/16',
    maxAzs: 2,
    databaseInstanceClass: 'db.t4g.large',
    databaseMinCapacity: 1,
    databaseMaxCapacity: 4,
    apiDesiredCount: 2,
    agentDesiredCount: 2,
    computeDesiredCount: 2,
    webDesiredCount: 2,
    cacheNodeType: 'cache.t4g.small',
    cacheNumNodes: 2,
    sentryTracesSampleRate: 0.5,
    sentryProfilesSampleRate: 0.3,
  },
  prod: {
    envName: 'prod',
    region: 'us-east-1',
    isProd: true,
    vpcCidr: '10.2.0.0/16',
    maxAzs: 3,
    databaseInstanceClass: 'db.r6g.large',
    databaseMinCapacity: 2,
    databaseMaxCapacity: 16,
    apiDesiredCount: 3,
    agentDesiredCount: 5,
    computeDesiredCount: 5,
    webDesiredCount: 3,
    cacheNodeType: 'cache.r6g.large',
    cacheNumNodes: 3,
    domainName: 'podex.dev',
    sentryTracesSampleRate: 0.2,
    sentryProfilesSampleRate: 0.1,
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
