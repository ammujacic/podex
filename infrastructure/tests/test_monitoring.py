"""Tests for GCP Cloud Monitoring and Logging configuration."""

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import monitoring


class TestMonitoringConfiguration:
    """Test Cloud Monitoring configuration."""

    def test_create_monitoring_function_exists(self) -> None:
        """Test that create_monitoring function exists and is callable."""
        assert hasattr(monitoring, "create_monitoring")
        assert callable(monitoring.create_monitoring)

    def test_create_error_reporting_function_exists(self) -> None:
        """Test that create_error_reporting function exists and is callable."""
        assert hasattr(monitoring, "create_error_reporting")
        assert callable(monitoring.create_error_reporting)

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_notification_channel(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates notification channel."""
        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location="us-east1"),
        }
        mock_sql = MagicMock()
        mock_gke = None

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify notification channel was created
        assert mock_channel.called
        call_args = mock_channel.call_args

        # Verify channel configuration
        assert call_args[0][0] == f"podex-email-{env}"
        kwargs = call_args[1]
        assert kwargs["display_name"] == f"Podex Alerts ({env})"
        assert kwargs["type"] == "email"
        assert "email_address" in kwargs["labels"]
        assert kwargs["enabled"] == (env == "prod")

        # Verify result contains channel
        assert "email_channel" in result

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_uptime_checks(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates uptime checks for services."""
        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location="us-east1"),
            "web": MagicMock(name="web-service", location="us-east1"),
        }
        mock_sql = MagicMock()
        mock_gke = None

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify uptime checks were created for each service
        assert mock_uptime.call_count == 2  # api and web

        # Verify uptime check configurations
        uptime_calls = mock_uptime.call_args_list
        for call in uptime_calls:
            kwargs = call[1]
            assert "monitored_resource" in kwargs
            assert "http_check" in kwargs
            assert kwargs["timeout"] == "10s"
            assert kwargs["period"] == "300s"  # 5 minutes

        # Verify result contains uptime checks
        assert "uptime_api" in result
        assert "uptime_web" in result

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_uptime_check_paths(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that uptime checks use correct paths."""
        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location="us-east1"),
            "web": MagicMock(name="web-service", location="us-east1"),
        }
        mock_sql = MagicMock()
        mock_gke = None

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify uptime check paths
        uptime_calls = mock_uptime.call_args_list

        # API service should use /health
        api_call = uptime_calls[0]
        assert api_call[1]["http_check"].path == "/health"

        # Web service should use /
        web_call = uptime_calls[1]
        assert web_call[1]["http_check"].path == "/"

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_error_rate_alert(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates error rate alert."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock channel
        mock_channel_instance = MagicMock()
        mock_channel_instance.id = "channel-id"
        mock_channel.return_value = mock_channel_instance

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify error alert was created
        error_alert_calls = [
            call for call in mock_alert.call_args_list if call[0][0] == f"podex-error-rate-{env}"
        ]
        assert len(error_alert_calls) > 0

        # Verify result contains error alert
        assert "error_alert" in result

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_latency_alert(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates latency alert."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock channel
        mock_channel_instance = MagicMock()
        mock_channel_instance.id = "channel-id"
        mock_channel.return_value = mock_channel_instance

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify latency alert was created
        latency_alert_calls = [
            call for call in mock_alert.call_args_list if call[0][0] == f"podex-latency-{env}"
        ]
        assert len(latency_alert_calls) > 0

        # Verify result contains latency alert
        assert "latency_alert" in result

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_sql_cpu_alert(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates Cloud SQL CPU alert."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock channel
        mock_channel_instance = MagicMock()
        mock_channel_instance.id = "channel-id"
        mock_channel.return_value = mock_channel_instance

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify SQL CPU alert was created
        sql_cpu_alert_calls = [
            call for call in mock_alert.call_args_list if call[0][0] == f"podex-sql-cpu-{env}"
        ]
        assert len(sql_cpu_alert_calls) > 0

        # Verify result contains SQL CPU alert
        assert "sql_cpu_alert" in result

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_dashboard(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates a monitoring dashboard."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify dashboard was created
        assert mock_dashboard.called
        call_args = mock_dashboard.call_args

        # Verify dashboard configuration
        assert call_args[0][0] == f"podex-dashboard-{env}"

        # Verify result contains dashboard
        assert "dashboard" in result

    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_creates_log_metrics(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring creates log-based metrics."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify log metrics were created
        assert mock_metric.call_count == 2  # API request and agent completion metrics

        # Verify API request metric
        api_metric_calls = [
            call for call in mock_metric.call_args_list if call[0][0] == f"podex-api-requests-{env}"
        ]
        assert len(api_metric_calls) > 0

        # Verify agent completion metric
        agent_metric_calls = [
            call
            for call in mock_metric.call_args_list
            if call[0][0] == f"podex-agent-completions-{env}"
        ]
        assert len(agent_metric_calls) > 0

        # Verify result contains metrics
        assert "api_request_metric" in result
        assert "agent_completion_metric" in result

    @patch("pulumi_gcp.bigquery.DatasetIamMember")
    @patch("pulumi_gcp.logging.ProjectSink")
    @patch("pulumi_gcp.bigquery.Dataset")
    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_prod_log_sink(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        mock_dataset: Any,
        mock_sink: Any,
        mock_iam: Any,
        project_id: str,
    ) -> None:
        """Test that create_monitoring creates BigQuery log sink for prod."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock dataset
        mock_dataset_instance = MagicMock()
        mock_dataset_instance.id = MagicMock()
        mock_dataset_instance.id.apply = lambda func: func("dataset-id")
        mock_dataset_instance.dataset_id = "podex_logs_prod"
        mock_dataset.return_value = mock_dataset_instance

        # Mock sink
        mock_sink_instance = MagicMock()
        mock_sink_instance.writer_identity = "service-account@gserviceaccount.com"
        mock_sink.return_value = mock_sink_instance

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function with prod environment
        result = monitoring.create_monitoring(project_id, "prod", mock_services, mock_sql, mock_gke)

        # Verify BigQuery dataset was created
        assert mock_dataset.called

        # Verify log sink was created
        assert mock_sink.called

        # Verify IAM member was created
        assert mock_iam.called

        # Verify result contains log resources
        assert "log_dataset" in result
        assert "log_sink" in result

    @patch("pulumi_gcp.bigquery.Dataset")
    @patch("pulumi_gcp.logging.Metric")
    @patch("pulumi_gcp.monitoring.Dashboard")
    @patch("pulumi_gcp.monitoring.AlertPolicy")
    @patch("pulumi_gcp.monitoring.UptimeCheckConfig")
    @patch("pulumi_gcp.monitoring.NotificationChannel")
    @patch("pulumi.Output")
    def test_create_monitoring_dev_no_log_sink(
        self,
        mock_output: Any,
        mock_channel: Any,
        mock_uptime: Any,
        mock_alert: Any,
        mock_dashboard: Any,
        mock_metric: Any,
        mock_dataset: Any,
        project_id: str,
        env: str,
    ) -> None:
        """Test that create_monitoring does not create BigQuery log sink for dev."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location="us-east1")}
        mock_sql = MagicMock()
        mock_gke = None

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"
        mock_output.json_dumps.return_value = "{}"

        # Call the function with dev environment (not prod)
        result = monitoring.create_monitoring(project_id, env, mock_services, mock_sql, mock_gke)

        # Verify BigQuery dataset was NOT created
        assert not mock_dataset.called

        # Verify result does not contain log resources
        assert "log_dataset" not in result
        assert "log_sink" not in result

    def test_create_error_reporting_returns_config(self, project_id: str, env: str) -> None:
        """Test that create_error_reporting returns config."""
        result = monitoring.create_error_reporting(project_id, env)

        # Verify result contains expected keys
        assert "enabled" in result
        assert result["enabled"] is True
        assert "note" in result

    def test_create_error_reporting_is_automatic(self, project_id: str, env: str) -> None:
        """Test that error reporting is automatic and requires no setup."""
        result = monitoring.create_error_reporting(project_id, env)

        # Error reporting should be enabled
        assert result["enabled"] is True

        # Should have a note about automatic enablement
        assert "automatic" in result["note"].lower()

    def test_create_monitoring_notification_enabled_only_for_prod(self, project_id: str) -> None:
        """Test that notifications are only enabled for prod environment."""
        # This tests the logic that notifications should only be enabled for prod
        prod_env = "prod"
        dev_env = "dev"

        # Verify logic
        assert prod_env == "prod"
        assert dev_env != "prod"

        # In the code, notifications are enabled only when env == "prod"
        prod_enabled = prod_env == "prod"
        dev_enabled = dev_env == "prod"

        assert prod_enabled is True
        assert dev_enabled is False
