#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/NetworkStack';
import { DatabaseStack } from '../lib/stacks/DatabaseStack';
import { StorageStack } from '../lib/stacks/StorageStack';
import { ComputeStack } from '../lib/stacks/ComputeStack';
import { AuthStack } from '../lib/stacks/AuthStack';
import { DnsStack } from '../lib/stacks/DnsStack';
import { MonitoringStack } from '../lib/stacks/MonitoringStack';
import { SecurityStack } from '../lib/stacks/SecurityStack';
import { EmailStack } from '../lib/stacks/EmailStack';
import { getEnvironmentConfig } from '../lib/config/environments';

const app = new cdk.App();

// Get environment from context
const environmentName = app.node.tryGetContext('environment') ?? 'dev';
const config = getEnvironmentConfig(environmentName);

// Common props
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

// Network (no dependencies)
const networkStack = new NetworkStack(app, `Podex-Network-${config.envName}`, {
  env,
  config,
});

// Auth (no dependencies)
const authStack = new AuthStack(app, `Podex-Auth-${config.envName}`, {
  env,
  config,
});

// Storage (no dependencies)
const storageStack = new StorageStack(app, `Podex-Storage-${config.envName}`, {
  env,
  config,
});

// Database (depends on Network)
const databaseStack = new DatabaseStack(app, `Podex-Database-${config.envName}`, {
  env,
  config,
  vpc: networkStack.vpc,
});
databaseStack.addDependency(networkStack);

// DNS (only for environments with domainName)
let dnsStack: DnsStack | undefined;
if (config.domainName) {
  dnsStack = new DnsStack(app, `Podex-Dns-${config.envName}`, {
    env,
    config,
  });
}

// Email - SES configuration (optionally depends on DNS for verified domain)
const emailStack = new EmailStack(app, `Podex-Email-${config.envName}`, {
  env,
  config,
  hostedZone: dnsStack?.hostedZone,
});
if (dnsStack) {
  emailStack.addDependency(dnsStack);
}

// Compute (depends on Network, Database, Storage, optionally DNS)
const computeStack = new ComputeStack(app, `Podex-Compute-${config.envName}`, {
  env,
  config,
  vpc: networkStack.vpc,
  dbSecurityGroup: databaseStack.dbSecurityGroup,
  redisSecurityGroup: databaseStack.redisSecurityGroup,
  dbSecret: databaseStack.dbSecret,
  workspaceBucket: storageStack.workspaceBucket,
  certificate: dnsStack?.certificate,
  hostedZone: dnsStack?.hostedZone,
  // Secrets for services
  sentrySecret: databaseStack.sentrySecret,
  jwtSecret: databaseStack.jwtSecret,
  internalApiKeySecret: databaseStack.internalApiKeySecret,
  redisAuthToken: databaseStack.redisAuthToken,
  // Redis endpoint for services
  redisEndpoint: databaseStack.redisEndpoint,
});
computeStack.addDependency(networkStack);
computeStack.addDependency(databaseStack);
computeStack.addDependency(storageStack);
computeStack.addDependency(authStack);
if (dnsStack) {
  computeStack.addDependency(dnsStack);
}

// Security - WAF (depends on Compute for ALB)
const securityStack = new SecurityStack(app, `Podex-Security-${config.envName}`, {
  env,
  config,
  alb: computeStack.alb,
});
securityStack.addDependency(computeStack);

// Monitoring (depends on Compute and Database)
const monitoringStack = new MonitoringStack(app, `Podex-Monitoring-${config.envName}`, {
  env,
  config,
  cluster: computeStack.cluster,
  apiService: computeStack.apiService,
  agentService: computeStack.agentService,
  computeService: computeStack.computeService,
  webService: computeStack.webService,
  database: databaseStack.database,
  redisReplicationGroup: databaseStack.redisReplicationGroup,
  alb: computeStack.alb,
  alertEmail: config.alertEmail,
});
monitoringStack.addDependency(computeStack);
monitoringStack.addDependency(databaseStack);

// Tags
cdk.Tags.of(app).add('Project', 'Podex');
cdk.Tags.of(app).add('Environment', config.envName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
