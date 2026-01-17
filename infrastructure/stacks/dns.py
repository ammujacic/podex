"""Cloud DNS and SSL Certificate configuration.

Creates:
- Cloud DNS managed zone
- Google-managed SSL certificate
- Domain mappings for Cloud Run services
"""

from typing import Any

import pulumi_gcp as gcp


def create_dns_and_ssl(
    project_id: str,
    region: str,
    domain: str,
    env: str,
    services: dict[str, Any],
) -> dict[str, Any]:
    """Create Cloud DNS zone and managed SSL certificate."""
    # DNS Zone
    zone = gcp.dns.ManagedZone(
        f"podex-zone-{env}",
        name=f"podex-zone-{env}",
        dns_name=f"{domain}.",
        description=f"Podex DNS zone ({env})",
        labels={
            "env": env,
            "app": "podex",
        },
    )

    # Google-managed SSL Certificate (FREE)
    certificate = gcp.compute.ManagedSslCertificate(
        f"podex-cert-{env}",
        name=f"podex-cert-{env}",
        managed=gcp.compute.ManagedSslCertificateManagedArgs(
            domains=[
                domain,
                f"api.{domain}",
                f"app.{domain}",
                f"agent.{domain}",
            ],
        ),
    )

    # Domain mappings for Cloud Run services
    subdomain_map = {
        "api": f"api.{domain}",
        "web": domain,  # Root domain
        "agent": f"agent.{domain}",
    }

    mappings = {}

    for svc_name, subdomain in subdomain_map.items():
        if svc_name not in services:
            continue

        # Cloud Run domain mapping
        mapping = gcp.cloudrun.DomainMapping(
            f"podex-{svc_name}-mapping-{env}",
            location=region,
            name=subdomain,
            metadata=gcp.cloudrun.DomainMappingMetadataArgs(
                namespace=project_id,
            ),
            spec=gcp.cloudrun.DomainMappingSpecArgs(
                route_name=services[svc_name].name,
            ),
        )
        mappings[svc_name] = mapping

        # DNS CNAME record pointing to Cloud Run
        gcp.dns.RecordSet(
            f"podex-{svc_name}-dns-{env}",
            name=f"{subdomain}.",
            managed_zone=zone.name,
            type="CNAME",
            ttl=300,
            rrdatas=["ghs.googlehosted.com."],
        )

    # Additional DNS records

    # TXT record for domain verification (if needed)
    gcp.dns.RecordSet(
        f"podex-txt-{env}",
        name=f"{domain}.",
        managed_zone=zone.name,
        type="TXT",
        ttl=3600,
        rrdatas=['"v=spf1 include:_spf.google.com ~all"'],
    )

    return {
        "zone": zone,
        "certificate": certificate,
        "mappings": mappings,
    }
