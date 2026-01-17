"""GCP Cloud Monitoring and Logging configuration.

GCP provides many monitoring features for free:
- Cloud Logging: First 50GB/month free
- Cloud Monitoring: Most features free, custom metrics cost
- Error Reporting: Free
- Cloud Trace: Free up to 2.5M spans/month
- Cloud Profiler: Free

This sets up essential monitoring for the Podex platform.
"""

from typing import Any

import pulumi
import pulumi_gcp as gcp


def create_monitoring(
    project_id: str,
    env: str,
    cloud_run_services: dict[str, Any],
    cloud_sql: dict[str, Any],
    gke_cluster: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create GCP Cloud Monitoring resources.

    Args:
        project_id: GCP project ID
        env: Environment (dev, staging, prod)
        cloud_run_services: Dict of Cloud Run services
        cloud_sql: Cloud SQL resources
        gke_cluster: Optional GKE cluster resources

    Returns:
        Dict of monitoring resources
    """
    resources: dict[str, Any] = {}

    # ==========================================
    # Notification Channels
    # ==========================================

    # Email notification channel (configure with actual email for prod)
    email_channel = gcp.monitoring.NotificationChannel(
        f"podex-email-{env}",
        display_name=f"Podex Alerts ({env})",
        type="email",
        labels={
            "email_address": f"alerts+{env}@podex.dev",
        },
        enabled=env == "prod",  # Only enable for production
    )
    resources["email_channel"] = email_channel

    # ==========================================
    # Uptime Checks (FREE)
    # ==========================================

    # Create uptime checks for Cloud Run services
    for name, service in cloud_run_services.items():
        uptime_check = gcp.monitoring.UptimeCheckConfig(
            f"podex-uptime-{name}-{env}",
            display_name=f"Podex {name.title()} Uptime ({env})",
            monitored_resource=gcp.monitoring.UptimeCheckConfigMonitoredResourceArgs(
                type="cloud_run_revision",
                labels={
                    "project_id": project_id,
                    "service_name": service.name,
                    "location": service.location,
                },
            ),
            http_check=gcp.monitoring.UptimeCheckConfigHttpCheckArgs(
                path="/health" if name != "web" else "/",
                port=443,
                use_ssl=True,
                validate_ssl=True,
            ),
            timeout="10s",
            period="300s",  # Check every 5 minutes (free tier friendly)
        )
        resources[f"uptime_{name}"] = uptime_check

    # ==========================================
    # Alert Policies
    # ==========================================

    # High error rate alert for Cloud Run services
    error_alert = gcp.monitoring.AlertPolicy(
        f"podex-error-rate-{env}",
        display_name=f"High Error Rate ({env})",
        combiner="OR",
        conditions=[
            gcp.monitoring.AlertPolicyConditionArgs(
                display_name="Cloud Run 5xx Error Rate > 5%",
                condition_threshold=gcp.monitoring.AlertPolicyConditionConditionThresholdArgs(
                    filter=pulumi.Output.concat(
                        'resource.type = "cloud_run_revision" AND ',
                        'metric.type = "run.googleapis.com/request_count" AND ',
                        f'resource.labels.project_id = "{project_id}"',
                    ),
                    aggregations=[
                        gcp.monitoring.AlertPolicyConditionConditionThresholdAggregationArgs(
                            alignment_period="300s",
                            per_series_aligner="ALIGN_RATE",
                            cross_series_reducer="REDUCE_SUM",
                            group_by_fields=["resource.labels.service_name"],
                        ),
                    ],
                    comparison="COMPARISON_GT",
                    threshold_value=0.05,  # 5% error rate
                    duration="300s",
                    trigger=gcp.monitoring.AlertPolicyConditionConditionThresholdTriggerArgs(
                        count=1,
                    ),
                ),
            ),
        ],
        notification_channels=[email_channel.id] if env == "prod" else [],
        alert_strategy=gcp.monitoring.AlertPolicyAlertStrategyArgs(
            auto_close="1800s",  # Auto-close after 30 minutes
        ),
        enabled=env == "prod",
    )
    resources["error_alert"] = error_alert

    # High latency alert
    latency_alert = gcp.monitoring.AlertPolicy(
        f"podex-latency-{env}",
        display_name=f"High Latency ({env})",
        combiner="OR",
        conditions=[
            gcp.monitoring.AlertPolicyConditionArgs(
                display_name="Cloud Run P95 Latency > 5s",
                condition_threshold=gcp.monitoring.AlertPolicyConditionConditionThresholdArgs(
                    filter=pulumi.Output.concat(
                        'resource.type = "cloud_run_revision" AND ',
                        'metric.type = "run.googleapis.com/request_latencies" AND ',
                        f'resource.labels.project_id = "{project_id}"',
                    ),
                    aggregations=[
                        gcp.monitoring.AlertPolicyConditionConditionThresholdAggregationArgs(
                            alignment_period="300s",
                            per_series_aligner="ALIGN_PERCENTILE_95",
                            cross_series_reducer="REDUCE_MEAN",
                            group_by_fields=["resource.labels.service_name"],
                        ),
                    ],
                    comparison="COMPARISON_GT",
                    threshold_value=5000,  # 5000ms = 5s
                    duration="300s",
                    trigger=gcp.monitoring.AlertPolicyConditionConditionThresholdTriggerArgs(
                        count=1,
                    ),
                ),
            ),
        ],
        notification_channels=[email_channel.id] if env == "prod" else [],
        alert_strategy=gcp.monitoring.AlertPolicyAlertStrategyArgs(
            auto_close="1800s",
        ),
        enabled=env == "prod",
    )
    resources["latency_alert"] = latency_alert

    # Cloud SQL high CPU alert
    sql_cpu_alert = gcp.monitoring.AlertPolicy(
        f"podex-sql-cpu-{env}",
        display_name=f"Cloud SQL High CPU ({env})",
        combiner="OR",
        conditions=[
            gcp.monitoring.AlertPolicyConditionArgs(
                display_name="Cloud SQL CPU > 80%",
                condition_threshold=gcp.monitoring.AlertPolicyConditionConditionThresholdArgs(
                    filter=pulumi.Output.concat(
                        'resource.type = "cloudsql_database" AND ',
                        'metric.type = "cloudsql.googleapis.com/database/cpu/utilization" AND ',
                        f'resource.labels.project_id = "{project_id}"',
                    ),
                    aggregations=[
                        gcp.monitoring.AlertPolicyConditionConditionThresholdAggregationArgs(
                            alignment_period="300s",
                            per_series_aligner="ALIGN_MEAN",
                        ),
                    ],
                    comparison="COMPARISON_GT",
                    threshold_value=0.8,  # 80%
                    duration="600s",  # 10 minutes
                    trigger=gcp.monitoring.AlertPolicyConditionConditionThresholdTriggerArgs(
                        count=1,
                    ),
                ),
            ),
        ],
        notification_channels=[email_channel.id] if env == "prod" else [],
        enabled=env == "prod",
    )
    resources["sql_cpu_alert"] = sql_cpu_alert

    # ==========================================
    # Custom Dashboard
    # ==========================================

    dashboard = gcp.monitoring.Dashboard(
        f"podex-dashboard-{env}",
        dashboard_json=pulumi.Output.json_dumps(
            {
                "displayName": f"Podex Overview ({env})",
                "gridLayout": {
                    "columns": "2",
                    "widgets": [
                        # Cloud Run Request Rate
                        {
                            "title": "Cloud Run - Request Rate",
                            "xyChart": {
                                "dataSets": [
                                    {
                                        "timeSeriesQuery": {
                                            "timeSeriesFilter": {
                                                "filter": f'resource.type = "cloud_run_revision" AND resource.labels.project_id = "{project_id}"',
                                                "aggregation": {
                                                    "alignmentPeriod": "60s",
                                                    "perSeriesAligner": "ALIGN_RATE",
                                                    "crossSeriesReducer": "REDUCE_SUM",
                                                    "groupByFields": [
                                                        "resource.labels.service_name"
                                                    ],
                                                },
                                            },
                                        },
                                        "plotType": "LINE",
                                    }
                                ],
                            },
                        },
                        # Cloud Run Latency
                        {
                            "title": "Cloud Run - Request Latency (P95)",
                            "xyChart": {
                                "dataSets": [
                                    {
                                        "timeSeriesQuery": {
                                            "timeSeriesFilter": {
                                                "filter": f'resource.type = "cloud_run_revision" AND metric.type = "run.googleapis.com/request_latencies" AND resource.labels.project_id = "{project_id}"',
                                                "aggregation": {
                                                    "alignmentPeriod": "60s",
                                                    "perSeriesAligner": "ALIGN_PERCENTILE_95",
                                                    "crossSeriesReducer": "REDUCE_MEAN",
                                                    "groupByFields": [
                                                        "resource.labels.service_name"
                                                    ],
                                                },
                                            },
                                        },
                                        "plotType": "LINE",
                                    }
                                ],
                            },
                        },
                        # Cloud SQL CPU
                        {
                            "title": "Cloud SQL - CPU Utilization",
                            "xyChart": {
                                "dataSets": [
                                    {
                                        "timeSeriesQuery": {
                                            "timeSeriesFilter": {
                                                "filter": f'resource.type = "cloudsql_database" AND metric.type = "cloudsql.googleapis.com/database/cpu/utilization" AND resource.labels.project_id = "{project_id}"',
                                                "aggregation": {
                                                    "alignmentPeriod": "60s",
                                                    "perSeriesAligner": "ALIGN_MEAN",
                                                },
                                            },
                                        },
                                        "plotType": "LINE",
                                    }
                                ],
                            },
                        },
                        # Cloud SQL Connections
                        {
                            "title": "Cloud SQL - Active Connections",
                            "xyChart": {
                                "dataSets": [
                                    {
                                        "timeSeriesQuery": {
                                            "timeSeriesFilter": {
                                                "filter": f'resource.type = "cloudsql_database" AND metric.type = "cloudsql.googleapis.com/database/postgresql/num_backends" AND resource.labels.project_id = "{project_id}"',
                                                "aggregation": {
                                                    "alignmentPeriod": "60s",
                                                    "perSeriesAligner": "ALIGN_MEAN",
                                                },
                                            },
                                        },
                                        "plotType": "LINE",
                                    }
                                ],
                            },
                        },
                        # Redis VM CPU (for e2-micro)
                        {
                            "title": "Redis VM - CPU Utilization",
                            "xyChart": {
                                "dataSets": [
                                    {
                                        "timeSeriesQuery": {
                                            "timeSeriesFilter": {
                                                "filter": f'resource.type = "gce_instance" AND resource.labels.project_id = "{project_id}" AND metadata.user_labels."service" = "redis"',
                                                "aggregation": {
                                                    "alignmentPeriod": "60s",
                                                    "perSeriesAligner": "ALIGN_MEAN",
                                                },
                                            },
                                        },
                                        "plotType": "LINE",
                                    }
                                ],
                            },
                        },
                        # Error Rate
                        {
                            "title": "Cloud Run - Error Rate (5xx)",
                            "xyChart": {
                                "dataSets": [
                                    {
                                        "timeSeriesQuery": {
                                            "timeSeriesFilter": {
                                                "filter": f'resource.type = "cloud_run_revision" AND metric.type = "run.googleapis.com/request_count" AND metric.labels.response_code_class = "5xx" AND resource.labels.project_id = "{project_id}"',
                                                "aggregation": {
                                                    "alignmentPeriod": "60s",
                                                    "perSeriesAligner": "ALIGN_RATE",
                                                    "crossSeriesReducer": "REDUCE_SUM",
                                                    "groupByFields": [
                                                        "resource.labels.service_name"
                                                    ],
                                                },
                                            },
                                        },
                                        "plotType": "LINE",
                                    }
                                ],
                            },
                        },
                    ],
                },
            }
        ),
    )
    resources["dashboard"] = dashboard

    # ==========================================
    # Log-based Metrics (for custom tracking)
    # ==========================================

    # API request log metric
    api_request_metric = gcp.logging.Metric(
        f"podex-api-requests-{env}",
        name=f"podex_api_requests_{env}",
        description="API request count by endpoint",
        filter=pulumi.Output.concat(
            'resource.type = "cloud_run_revision" AND ',
            f'resource.labels.project_id = "{project_id}" AND ',
            'jsonPayload.type = "request"',
        ),
        label_extractors={
            "method": "EXTRACT(jsonPayload.method)",
            "path": "EXTRACT(jsonPayload.path)",
            "status": "EXTRACT(jsonPayload.status)",
        },
        metric_descriptor=gcp.logging.MetricMetricDescriptorArgs(
            metric_kind="DELTA",
            value_type="INT64",
            unit="1",
            labels=[
                gcp.logging.MetricMetricDescriptorLabelArgs(
                    key="method",
                    value_type="STRING",
                ),
                gcp.logging.MetricMetricDescriptorLabelArgs(
                    key="path",
                    value_type="STRING",
                ),
                gcp.logging.MetricMetricDescriptorLabelArgs(
                    key="status",
                    value_type="STRING",
                ),
            ],
        ),
    )
    resources["api_request_metric"] = api_request_metric

    # Agent completion log metric
    agent_completion_metric = gcp.logging.Metric(
        f"podex-agent-completions-{env}",
        name=f"podex_agent_completions_{env}",
        description="Agent completion count by model",
        filter=pulumi.Output.concat(
            'resource.type = "cloud_run_revision" AND ',
            f'resource.labels.project_id = "{project_id}" AND ',
            'jsonPayload.type = "llm_completion"',
        ),
        label_extractors={
            "model": "EXTRACT(jsonPayload.model)",
            "agent_type": "EXTRACT(jsonPayload.agent_type)",
        },
        metric_descriptor=gcp.logging.MetricMetricDescriptorArgs(
            metric_kind="DELTA",
            value_type="INT64",
            unit="1",
            labels=[
                gcp.logging.MetricMetricDescriptorLabelArgs(
                    key="model",
                    value_type="STRING",
                ),
                gcp.logging.MetricMetricDescriptorLabelArgs(
                    key="agent_type",
                    value_type="STRING",
                ),
            ],
        ),
    )
    resources["agent_completion_metric"] = agent_completion_metric

    # ==========================================
    # Log Sinks (for long-term storage - optional)
    # ==========================================

    # Only create for production to save costs
    if env == "prod":
        # Create a BigQuery dataset for log analytics
        log_dataset = gcp.bigquery.Dataset(
            f"podex-logs-{env}",
            dataset_id=f"podex_logs_{env}",
            location="US",
            description="Podex application logs for analytics",
            default_table_expiration_ms=30 * 24 * 60 * 60 * 1000,  # 30 days
        )
        resources["log_dataset"] = log_dataset

        # Log sink to BigQuery
        log_sink = gcp.logging.ProjectSink(
            f"podex-bq-sink-{env}",
            name=f"podex-bq-sink-{env}",
            destination=log_dataset.id.apply(lambda id: f"bigquery.googleapis.com/{id}"),
            filter=pulumi.Output.concat(
                'resource.type = "cloud_run_revision" AND ',
                f'resource.labels.project_id = "{project_id}"',
            ),
            unique_writer_identity=True,
        )
        resources["log_sink"] = log_sink

        # Grant BigQuery permissions to the log sink
        gcp.bigquery.DatasetIamMember(
            f"podex-logs-writer-{env}",
            dataset_id=log_dataset.dataset_id,
            role="roles/bigquery.dataEditor",
            member=log_sink.writer_identity,
        )

    return resources


def create_error_reporting(project_id: str, env: str) -> dict[str, Any]:
    """Set up Error Reporting (automatically enabled, just configure alerts).

    Error Reporting is FREE and automatically aggregates errors from:
    - Cloud Run logs
    - GKE logs
    - Compute Engine logs

    Args:
        project_id: GCP project ID
        env: Environment

    Returns:
        Dict of error reporting resources
    """
    # Error Reporting is automatic - no setup needed
    # We just need to ensure structured logging is used in our apps
    # and errors are properly formatted

    # Note: Errors are automatically captured from:
    # - Log entries with severity ERROR or higher
    # - Exceptions in supported runtimes

    return {
        "enabled": True,
        "note": "Error Reporting is automatically enabled for Cloud Run logs",
    }
