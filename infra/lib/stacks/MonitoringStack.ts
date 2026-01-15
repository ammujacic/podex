import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

interface MonitoringStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  cluster: ecs.Cluster;
  apiService: ecs.FargateService;
  agentService: ecs.FargateService;
  computeService: ecs.FargateService;
  webService: ecs.FargateService;
  database: rds.DatabaseCluster;
  redisReplicationGroup: elasticache.CfnReplicationGroup;
  alb: elbv2.ApplicationLoadBalancer;
  alertEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;
  public readonly criticalAlertTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly trail: cloudtrail.Trail;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config } = props;

    // SNS Topics for alerts
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `podex-alerts-${config.envName}`,
      displayName: `Podex ${config.envName} Alerts`,
    });

    this.criticalAlertTopic = new sns.Topic(this, 'CriticalAlertTopic', {
      topicName: `podex-critical-alerts-${config.envName}`,
      displayName: `Podex ${config.envName} CRITICAL Alerts`,
    });

    // Add email subscription if provided
    if (props.alertEmail) {
      this.alertTopic.addSubscription(new sns_subscriptions.EmailSubscription(props.alertEmail));
      this.criticalAlertTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(props.alertEmail)
      );
    }

    // CloudTrail for API audit logging
    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `podex-cloudtrail-${config.envName}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: config.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.isProd,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          expiration: cdk.Duration.days(config.isProd ? 365 : 90),
          enabled: true,
        },
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          enabled: true,
        },
      ],
    });

    this.trail = new cloudtrail.Trail(this, 'CloudTrail', {
      trailName: `podex-${config.envName}`,
      bucket: trailBucket,
      s3KeyPrefix: 'cloudtrail',
      sendToCloudWatchLogs: true,
      cloudWatchLogsRetention: config.isProd
        ? cdk.aws_logs.RetentionDays.ONE_YEAR
        : cdk.aws_logs.RetentionDays.ONE_MONTH,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: false, // Single region for cost savings in alpha
      enableFileValidation: true,
    });

    // Create CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `Podex-${config.envName}`,
    });

    // Add ECS Service Metrics
    this.addEcsServiceWidgets(props);

    // Add Database Metrics
    this.addDatabaseWidgets(props);

    // Add ALB Metrics
    this.addAlbWidgets(props);

    // Add Redis Metrics
    this.addRedisWidgets(props);

    // Create Alarms
    this.createEcsAlarms(props);
    this.createDatabaseAlarms(props);
    this.createAlbAlarms(props);
    this.createRedisAlarms(props);

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${config.region}.console.aws.amazon.com/cloudwatch/home?region=${config.region}#dashboards:name=${this.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: 'SNS Alert Topic ARN',
    });
  }

  private addEcsServiceWidgets(props: MonitoringStackProps): void {
    const services = [
      { name: 'API', service: props.apiService },
      { name: 'Agent', service: props.agentService },
      { name: 'Compute', service: props.computeService },
      { name: 'Web', service: props.webService },
    ];

    // CPU Utilization
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS Services - CPU Utilization',
        width: 12,
        height: 6,
        left: services.map(
          ({ name, service }) =>
            new cloudwatch.Metric({
              namespace: 'AWS/ECS',
              metricName: 'CPUUtilization',
              dimensionsMap: {
                ClusterName: props.cluster.clusterName,
                ServiceName: service.serviceName,
              },
              statistic: 'Average',
              period: cdk.Duration.minutes(1),
              label: name,
            })
        ),
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS Services - Memory Utilization',
        width: 12,
        height: 6,
        left: services.map(
          ({ name, service }) =>
            new cloudwatch.Metric({
              namespace: 'AWS/ECS',
              metricName: 'MemoryUtilization',
              dimensionsMap: {
                ClusterName: props.cluster.clusterName,
                ServiceName: service.serviceName,
              },
              statistic: 'Average',
              period: cdk.Duration.minutes(1),
              label: name,
            })
        ),
      })
    );

    // Running Task Count
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS Services - Running Tasks',
        width: 12,
        height: 6,
        left: services.map(
          ({ name, service }) =>
            new cloudwatch.Metric({
              namespace: 'ECS/ContainerInsights',
              metricName: 'RunningTaskCount',
              dimensionsMap: {
                ClusterName: props.cluster.clusterName,
                ServiceName: service.serviceName,
              },
              statistic: 'Average',
              period: cdk.Duration.minutes(1),
              label: name,
            })
        ),
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Service Health',
        width: 12,
        height: 6,
        metrics: services.map(
          ({ name, service }) =>
            new cloudwatch.Metric({
              namespace: 'ECS/ContainerInsights',
              metricName: 'RunningTaskCount',
              dimensionsMap: {
                ClusterName: props.cluster.clusterName,
                ServiceName: service.serviceName,
              },
              statistic: 'Average',
              period: cdk.Duration.minutes(1),
              label: name,
            })
        ),
      })
    );
  }

  private addDatabaseWidgets(props: MonitoringStackProps): void {
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Aurora - CPU & Connections',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              DBClusterIdentifier: props.database.clusterIdentifier,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'CPU %',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: {
              DBClusterIdentifier: props.database.clusterIdentifier,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: 'Connections',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Aurora - Latency',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'ReadLatency',
            dimensionsMap: {
              DBClusterIdentifier: props.database.clusterIdentifier,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Read Latency',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'WriteLatency',
            dimensionsMap: {
              DBClusterIdentifier: props.database.clusterIdentifier,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Write Latency',
          }),
        ],
      })
    );
  }

  private addAlbWidgets(props: MonitoringStackProps): void {
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB - Request Count & Latency',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: {
              LoadBalancer: props.alb.loadBalancerFullName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: 'Request Count',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetResponseTime',
            dimensionsMap: {
              LoadBalancer: props.alb.loadBalancerFullName,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Response Time',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB - HTTP Errors',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_4XX_Count',
            dimensionsMap: {
              LoadBalancer: props.alb.loadBalancerFullName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: '4XX Errors',
            color: '#ff7f0e',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: {
              LoadBalancer: props.alb.loadBalancerFullName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
            label: '5XX Errors',
            color: '#d62728',
          }),
        ],
      })
    );

    // Healthy/Unhealthy Host Count
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB - Target Health',
        width: 24,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HealthyHostCount',
            dimensionsMap: {
              LoadBalancer: props.alb.loadBalancerFullName,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Healthy Hosts',
            color: '#2ca02c',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'UnHealthyHostCount',
            dimensionsMap: {
              LoadBalancer: props.alb.loadBalancerFullName,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Unhealthy Hosts',
            color: '#d62728',
          }),
        ],
      })
    );
  }

  private addRedisWidgets(props: MonitoringStackProps): void {
    const replicationGroupId =
      props.redisReplicationGroup.replicationGroupId || `podex-redis-${props.config.envName}`;

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Redis - CPU & Memory',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              ReplicationGroupId: replicationGroupId,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'CPU %',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'DatabaseMemoryUsagePercentage',
            dimensionsMap: {
              ReplicationGroupId: replicationGroupId,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Memory %',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Redis - Cache Hit Rate',
        width: 12,
        height: 6,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ElastiCache',
            metricName: 'CacheHitRate',
            dimensionsMap: {
              ReplicationGroupId: replicationGroupId,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'Hit Rate',
          }),
        ],
      })
    );
  }

  private createEcsAlarms(props: MonitoringStackProps): void {
    const services = [
      { name: 'API', service: props.apiService },
      { name: 'Agent', service: props.agentService },
      { name: 'Compute', service: props.computeService },
      { name: 'Web', service: props.webService },
    ];

    for (const { name, service } of services) {
      // High CPU Alarm
      const cpuAlarm = new cloudwatch.Alarm(this, `${name}HighCpuAlarm`, {
        alarmName: `podex-${props.config.envName}-${name.toLowerCase()}-high-cpu`,
        alarmDescription: `${name} service CPU utilization is above 80%`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            ClusterName: props.cluster.clusterName,
            ServiceName: service.serviceName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 80,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      cpuAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

      // High Memory Alarm
      const memoryAlarm = new cloudwatch.Alarm(this, `${name}HighMemoryAlarm`, {
        alarmName: `podex-${props.config.envName}-${name.toLowerCase()}-high-memory`,
        alarmDescription: `${name} service memory utilization is above 85%`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'MemoryUtilization',
          dimensionsMap: {
            ClusterName: props.cluster.clusterName,
            ServiceName: service.serviceName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 85,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      memoryAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

      // No Running Tasks (Critical)
      const noTasksAlarm = new cloudwatch.Alarm(this, `${name}NoTasksAlarm`, {
        alarmName: `podex-${props.config.envName}-${name.toLowerCase()}-no-tasks`,
        alarmDescription: `CRITICAL: ${name} service has no running tasks`,
        metric: new cloudwatch.Metric({
          namespace: 'ECS/ContainerInsights',
          metricName: 'RunningTaskCount',
          dimensionsMap: {
            ClusterName: props.cluster.clusterName,
            ServiceName: service.serviceName,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      noTasksAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.criticalAlertTopic));
    }
  }

  private createDatabaseAlarms(props: MonitoringStackProps): void {
    // High CPU
    const dbCpuAlarm = new cloudwatch.Alarm(this, 'DatabaseHighCpuAlarm', {
      alarmName: `podex-${props.config.envName}-db-high-cpu`,
      alarmDescription: 'Database CPU utilization is above 80%',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBClusterIdentifier: props.database.clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    dbCpuAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

    // High Connections
    const dbConnectionsAlarm = new cloudwatch.Alarm(this, 'DatabaseHighConnectionsAlarm', {
      alarmName: `podex-${props.config.envName}-db-high-connections`,
      alarmDescription: 'Database connections above threshold',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'DatabaseConnections',
        dimensionsMap: {
          DBClusterIdentifier: props.database.clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: props.config.isProd ? 200 : 50,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    dbConnectionsAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

    // Low Freeable Memory (Critical)
    const dbMemoryAlarm = new cloudwatch.Alarm(this, 'DatabaseLowMemoryAlarm', {
      alarmName: `podex-${props.config.envName}-db-low-memory`,
      alarmDescription: 'CRITICAL: Database freeable memory is low',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'FreeableMemory',
        dimensionsMap: {
          DBClusterIdentifier: props.database.clusterIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 256 * 1024 * 1024, // 256 MB
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    dbMemoryAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.criticalAlertTopic));
  }

  private createAlbAlarms(props: MonitoringStackProps): void {
    // High 5XX Errors
    const alb5xxAlarm = new cloudwatch.Alarm(this, 'Alb5xxErrorsAlarm', {
      alarmName: `podex-${props.config.envName}-alb-5xx-errors`,
      alarmDescription: 'ALB 5XX error rate is high',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xxAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

    // High Response Time
    const albLatencyAlarm = new cloudwatch.Alarm(this, 'AlbHighLatencyAlarm', {
      alarmName: `podex-${props.config.envName}-alb-high-latency`,
      alarmDescription: 'ALB response time is above threshold',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2, // 2 seconds
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    albLatencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

    // Unhealthy Hosts (Critical)
    const unhealthyHostsAlarm = new cloudwatch.Alarm(this, 'AlbUnhealthyHostsAlarm', {
      alarmName: `podex-${props.config.envName}-alb-unhealthy-hosts`,
      alarmDescription: 'CRITICAL: ALB has unhealthy targets',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'UnHealthyHostCount',
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    unhealthyHostsAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.criticalAlertTopic));
  }

  private createRedisAlarms(props: MonitoringStackProps): void {
    const replicationGroupId =
      props.redisReplicationGroup.replicationGroupId || `podex-redis-${props.config.envName}`;

    // High CPU
    const redisCpuAlarm = new cloudwatch.Alarm(this, 'RedisHighCpuAlarm', {
      alarmName: `podex-${props.config.envName}-redis-high-cpu`,
      alarmDescription: 'Redis CPU utilization is above 80%',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ReplicationGroupId: replicationGroupId,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    redisCpuAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alertTopic));

    // High Memory (Critical)
    const redisMemoryAlarm = new cloudwatch.Alarm(this, 'RedisHighMemoryAlarm', {
      alarmName: `podex-${props.config.envName}-redis-high-memory`,
      alarmDescription: 'CRITICAL: Redis memory usage is above 90%',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'DatabaseMemoryUsagePercentage',
        dimensionsMap: {
          ReplicationGroupId: replicationGroupId,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 90,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    redisMemoryAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.criticalAlertTopic));
  }
}
