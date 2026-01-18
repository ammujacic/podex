"""Cloud Run services configuration.

All services scale to zero when not in use = FREE under GCP free tier limits.
Free tier includes:
- 2 million requests/month
- 180,000 vCPU-seconds/month
- 360,000 GiB-seconds/month
"""

from __future__ import annotations

from typing import Any, TypedDict

import pulumi
import pulumi_gcp as gcp


class ServiceConfig(TypedDict):
    """Configuration for a Cloud Run service."""

    name: str
    port: int
    cpu: str
    memory: str
    max_instances: int
    needs_db: bool
    needs_redis: bool
    needs_storage: bool
    needs_vertex: bool


def create_cloud_run_services(
    project_id: str,
    region: str,
    env: str,
    artifact_repo: gcp.artifactregistry.Repository,
    cloud_sql: dict[str, Any],
    redis_vm: dict[str, Any],
    secrets: dict[str, Any],
    bucket: gcp.storage.Bucket,
    vpc: dict[str, Any],
    image_refs: dict[str, pulumi.Output[str]] | None = None,
) -> dict[str, Any]:
    """Create Cloud Run services (FREE TIER).

    Args:
        image_refs: Optional dict of service name -> image digest from pulumi-docker.
                   If provided, uses exact image digests; otherwise uses :latest tag.
    """
    services: dict[str, Any] = {}

    # Service account for Cloud Run
    service_account = gcp.serviceaccount.Account(
        f"podex-cloudrun-{env}",
        account_id=f"podex-cloudrun-{env}",
        display_name=f"Podex Cloud Run ({env})",
    )

    # Grant permissions
    roles = [
        "roles/secretmanager.secretAccessor",
        "roles/storage.objectAdmin",
        "roles/cloudsql.client",
        "roles/aiplatform.user",  # For Vertex AI
        "roles/logging.logWriter",
        "roles/cloudtrace.agent",
    ]

    for role in roles:
        gcp.projects.IAMMember(
            f"podex-cloudrun-{role.split('/')[-1]}-{env}",
            project=project_id,
            role=role,
            member=service_account.email.apply(lambda e: f"serviceAccount:{e}"),
        )

    # VPC Connector for Cloud Run to access VPC resources (Redis VM, Cloud SQL)
    # Using 10.9.0.0/28 to avoid overlap with GKE services range (10.8.0.0/20)
    vpc_connector = gcp.vpcaccess.Connector(
        f"podex-connector-{env}",
        name=f"podex-connector-{env}",
        region=region,
        ip_cidr_range="10.9.0.0/28",
        network=vpc["network"].name,
        min_instances=2,
        max_instances=3,
    )

    # Base image path
    image_base = pulumi.Output.all(artifact_repo.location, artifact_repo.name).apply(
        lambda args: f"{args[0]}-docker.pkg.dev/{project_id}/{args[1]}"
    )

    # Service configurations
    svc_configs: list[ServiceConfig] = [
        {
            "name": "api",
            "port": 3001,
            "cpu": "1",
            "memory": "512Mi",
            "max_instances": 5,
            "needs_db": True,
            "needs_redis": True,
            "needs_storage": True,
            "needs_vertex": True,
        },
        {
            "name": "agent",
            "port": 3002,
            "cpu": "1",
            "memory": "1Gi",
            "max_instances": 5,
            "needs_db": True,
            "needs_redis": True,
            "needs_storage": True,
            "needs_vertex": True,
        },
        {
            "name": "compute",
            "port": 3003,
            "cpu": "1",
            "memory": "512Mi",
            "max_instances": 3,
            "needs_db": False,
            "needs_redis": True,
            "needs_storage": True,
            "needs_vertex": False,
        },
        {
            "name": "web",
            "port": 3000,
            "cpu": "1",
            "memory": "256Mi",
            "max_instances": 5,
            "needs_db": False,
            "needs_redis": False,
            "needs_storage": False,
            "needs_vertex": False,
        },
    ]

    for cfg in svc_configs:
        # Build environment variables
        envs = [
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="ENV",
                value=env,
            ),
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="GCP_PROJECT_ID",
                value=project_id,
            ),
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="GCP_REGION",
                value=region,
            ),
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="LLM_PROVIDER",
                value="vertex",
            ),
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="EMAIL_BACKEND",
                value="console",
            ),
        ]

        # Add JWT secret
        envs.append(
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="JWT_SECRET",
                value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                    secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                        secret=secrets["jwt"].secret_id,
                        version="latest",
                    ),
                ),
            )
        )

        # Add internal API key
        envs.append(
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="INTERNAL_API_KEY",
                value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                    secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                        secret=secrets["internal_api_key"].secret_id,
                        version="latest",
                    ),
                ),
            )
        )

        # Database URL
        if cfg["needs_db"]:
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="DATABASE_URL",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=cloud_sql["url_secret"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )

        # Redis URL
        if cfg["needs_redis"]:
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="REDIS_URL",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=redis_vm["url_secret"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )

        # Storage bucket
        if cfg["needs_storage"]:
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="GCS_BUCKET",
                    value=bucket.name,
                )
            )

        # Admin credentials (API service only - for initial admin seeding)
        if cfg["name"] == "api":
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="ADMIN_EMAIL",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["admin_email"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="ADMIN_PASSWORD",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["admin_password"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )

        # Create the service
        service = gcp.cloudrunv2.Service(
            f"podex-{cfg['name']}-{env}",
            name=f"podex-{cfg['name']}-{env}",
            location=region,
            ingress="INGRESS_TRAFFIC_ALL",
            template=gcp.cloudrunv2.ServiceTemplateArgs(
                service_account=service_account.email,
                # Scale to zero for cost savings
                scaling=gcp.cloudrunv2.ServiceTemplateScalingArgs(
                    min_instance_count=0,
                    max_instance_count=cfg["max_instances"],
                ),
                # VPC access for Redis
                vpc_access=gcp.cloudrunv2.ServiceTemplateVpcAccessArgs(
                    connector=vpc_connector.id,
                    egress="PRIVATE_RANGES_ONLY",
                )
                if cfg["needs_redis"]
                else None,
                # Container configuration
                containers=[
                    gcp.cloudrunv2.ServiceTemplateContainerArgs(
                        name=cfg["name"],
                        # Use exact image digest if built by Pulumi, otherwise use :latest
                        image=image_refs[cfg["name"]]
                        if image_refs and cfg["name"] in image_refs
                        else image_base.apply(
                            lambda base, svc_name=cfg["name"]: f"{base}/{svc_name}:latest"  # type: ignore[misc]
                        ),
                        ports=gcp.cloudrunv2.ServiceTemplateContainerPortsArgs(
                            container_port=cfg["port"],
                        ),
                        resources=gcp.cloudrunv2.ServiceTemplateContainerResourcesArgs(
                            limits={
                                "cpu": cfg["cpu"],
                                "memory": cfg["memory"],
                            },
                            cpu_idle=True,  # Don't charge when idle
                        ),
                        envs=envs,
                        # Health check (skip for web frontend)
                        startup_probe=gcp.cloudrunv2.ServiceTemplateContainerStartupProbeArgs(
                            http_get=gcp.cloudrunv2.ServiceTemplateContainerStartupProbeHttpGetArgs(
                                path="/health",
                            ),
                            initial_delay_seconds=5,
                            period_seconds=10,
                            failure_threshold=3,
                        )
                        if cfg["name"] != "web"
                        else None,
                    ),
                ],
                # Timeout and concurrency
                timeout="300s",
                max_instance_request_concurrency=80,
            ),
            # Labels
            labels={
                "env": env,
                "app": "podex",
                "service": cfg["name"],
            },
        )

        # Allow public access (unauthenticated)
        gcp.cloudrunv2.ServiceIamMember(
            f"podex-{cfg['name']}-{env}-public",
            location=region,
            name=service.name,
            role="roles/run.invoker",
            member="allUsers",
        )

        services[str(cfg["name"])] = service

    return services
