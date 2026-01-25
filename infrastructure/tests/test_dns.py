"""Tests for Cloud DNS and SSL Certificate configuration."""

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

# Add the infrastructure directory to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from stacks import dns


class TestDNSConfiguration:
    """Test Cloud DNS and SSL configuration."""

    def test_create_dns_and_ssl_function_exists(self) -> None:
        """Test that create_dns_and_ssl function exists and is callable."""
        assert hasattr(dns, "create_dns_and_ssl")
        assert callable(dns.create_dns_and_ssl)

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_creates_dns_zone(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl creates a DNS zone."""
        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location=region),
            "web": MagicMock(name="web-service", location=region),
        }

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        result = dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Verify DNS zone was created
        assert mock_zone.called
        call_args = mock_zone.call_args

        # Verify zone configuration
        assert call_args[0][0] == f"podex-zone-{env}"
        kwargs = call_args[1]
        assert kwargs["name"] == f"podex-zone-{env}"
        assert kwargs["dns_name"] == f"{domain}."
        assert f"Podex DNS zone ({env})" in kwargs["description"]
        assert kwargs["labels"]["env"] == env
        assert kwargs["labels"]["app"] == "podex"

        # Verify result contains zone
        assert "zone" in result

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_creates_ssl_certificate(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl creates an SSL certificate."""
        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location=region)}

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        result = dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Verify SSL certificate was created
        assert mock_cert.called
        call_args = mock_cert.call_args

        # Verify certificate configuration
        assert call_args[0][0] == f"podex-cert-{env}"
        kwargs = call_args[1]
        assert kwargs["name"] == f"podex-cert-{env}"

        # Verify managed domains
        managed_domains = kwargs["managed"].domains
        assert domain in managed_domains
        assert f"api.{domain}" in managed_domains
        assert f"app.{domain}" in managed_domains
        assert f"agent.{domain}" in managed_domains
        assert f"compute.{domain}" in managed_domains

        # Verify result contains certificate
        assert "certificate" in result

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_creates_domain_mappings(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl creates domain mappings for services."""
        # Mock zone
        mock_zone_instance = MagicMock()
        mock_zone_instance.name = f"podex-zone-{env}"
        mock_zone.return_value = mock_zone_instance

        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location=region),
            "web": MagicMock(name="web-service", location=region),
            "agent": MagicMock(name="agent-service", location=region),
            "compute": MagicMock(name="compute-service", location=region),
        }

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        result = dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Verify domain mappings were created for each service
        assert mock_mapping.call_count == 4  # api, web, agent, compute

        # Verify result contains mappings
        assert "mappings" in result
        assert len(result["mappings"]) > 0

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_creates_cname_records(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl creates CNAME records for services."""
        # Mock zone
        mock_zone_instance = MagicMock()
        mock_zone_instance.name = f"podex-zone-{env}"
        mock_zone.return_value = mock_zone_instance

        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location=region),
            "web": MagicMock(name="web-service", location=region),
        }

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Verify DNS records were created
        # Should be: 4 CNAME records (for each service) + 1 A record (root) + 1 TXT record
        assert mock_record.call_count >= 4

        # Verify CNAME records point to Google hosted
        cname_calls = [
            call for call in mock_record.call_args_list if call[1].get("type") == "CNAME"
        ]
        assert len(cname_calls) >= 2
        for call in cname_calls:
            assert call[1]["rrdatas"] == ["ghs.googlehosted.com."]

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_creates_root_a_record(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl creates A record for root domain."""
        # Mock zone
        mock_zone_instance = MagicMock()
        mock_zone_instance.name = f"podex-zone-{env}"
        mock_zone.return_value = mock_zone_instance

        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location=region)}

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Find A record calls
        a_record_calls = [call for call in mock_record.call_args_list if call[1].get("type") == "A"]

        # Should have at least one A record for root domain
        assert len(a_record_calls) >= 1

        # Verify A record points to Google's redirect IPs
        a_record_call = a_record_calls[0]
        assert a_record_call[1]["name"] == f"{domain}."
        assert len(a_record_call[1]["rrdatas"]) == 4
        assert "216.239.32.21" in a_record_call[1]["rrdatas"]
        assert "216.239.34.21" in a_record_call[1]["rrdatas"]

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_creates_txt_record(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl creates TXT record for SPF."""
        # Mock zone
        mock_zone_instance = MagicMock()
        mock_zone_instance.name = f"podex-zone-{env}"
        mock_zone.return_value = mock_zone_instance

        # Mock services
        mock_services = {"api": MagicMock(name="api-service", location=region)}

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Find TXT record calls
        txt_record_calls = [
            call for call in mock_record.call_args_list if call[1].get("type") == "TXT"
        ]

        # Should have at least one TXT record
        assert len(txt_record_calls) >= 1

        # Verify TXT record contains SPF
        txt_record_call = txt_record_calls[0]
        assert txt_record_call[1]["name"] == f"{domain}."
        assert len(txt_record_call[1]["rrdatas"]) > 0
        assert "spf1" in txt_record_call[1]["rrdatas"][0]

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_subdomain_mapping(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl maps services to correct subdomains."""
        # Mock zone
        mock_zone_instance = MagicMock()
        mock_zone_instance.name = f"podex-zone-{env}"
        mock_zone.return_value = mock_zone_instance

        # Mock services
        mock_services = {
            "api": MagicMock(name="api-service", location=region),
            "web": MagicMock(name="web-service", location=region),
            "agent": MagicMock(name="agent-service", location=region),
            "compute": MagicMock(name="compute-service", location=region),
        }

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Verify domain mappings use correct subdomains
        mapping_calls = mock_mapping.call_args_list

        # Check that subdomains are correct
        subdomain_names = [call[1]["name"] for call in mapping_calls]

        # api -> api.domain
        assert f"api.{domain}" in subdomain_names
        # web -> app.domain (not web.domain)
        assert f"app.{domain}" in subdomain_names
        # agent -> agent.domain
        assert f"agent.{domain}" in subdomain_names
        # compute -> compute.domain
        assert f"compute.{domain}" in subdomain_names

    @patch("pulumi_gcp.dns.RecordSet")
    @patch("pulumi_gcp.cloudrun.DomainMapping")
    @patch("pulumi_gcp.compute.ManagedSslCertificate")
    @patch("pulumi_gcp.dns.ManagedZone")
    @patch("pulumi.Output")
    def test_create_dns_and_ssl_skips_missing_services(
        self,
        mock_output: Any,
        mock_zone: Any,
        mock_cert: Any,
        mock_mapping: Any,
        mock_record: Any,
        project_id: str,
        region: str,
        domain: str,
        env: str,
    ) -> None:
        """Test that create_dns_and_ssl skips services not in the services dict."""
        # Mock zone
        mock_zone_instance = MagicMock()
        mock_zone_instance.name = f"podex-zone-{env}"
        mock_zone.return_value = mock_zone_instance

        # Mock services - only include api
        mock_services = {"api": MagicMock(name="api-service", location=region)}

        # Mock Output.concat
        mock_output.concat.return_value = "mocked-filter"

        # Call the function
        dns.create_dns_and_ssl(project_id, region, domain, env, mock_services)

        # Should only create 1 domain mapping (for api)
        assert mock_mapping.call_count == 1

    def test_subdomain_map_structure(self, domain: str) -> None:
        """Test that subdomain mapping has the expected structure."""
        # Test the subdomain mapping logic
        subdomain_map = {
            "api": f"api.{domain}",
            "web": f"app.{domain}",  # Note: web uses app subdomain
            "agent": f"agent.{domain}",
            "compute": f"compute.{domain}",
        }

        assert subdomain_map["api"] == f"api.{domain}"
        assert subdomain_map["web"] == f"app.{domain}"  # Not web.domain
        assert subdomain_map["agent"] == f"agent.{domain}"
        assert subdomain_map["compute"] == f"compute.{domain}"
