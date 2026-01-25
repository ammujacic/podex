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
    domain: str = "podex.dev",
) -> dict[str, Any]:
    """Create Cloud Run services (FREE TIER).

    Args:
        image_refs: Optional dict of service name -> image digest from pulumi-docker.
                   If provided, uses exact image digests; otherwise uses :latest tag.
        domain: Custom domain for service URLs (e.g., podex.dev -> agent.podex.dev)
    """
    services: dict[str, Any] = {}

    # Service account for Cloud Run
    service_account = gcp.serviceaccount.Account(
        f"podex-cloudrun-{env}",
        account_id=f"podex-cloudrun-{env}",
        display_name=f"Podex Cloud Run ({env})",
    )

    # Grant permissions with minimal required scopes
    # Note: storage.objectUser provides read/write without delete/admin capabilities
    roles = [
        "roles/secretmanager.secretAccessor",
        "roles/storage.objectUser",  # Read + create + update (no delete, no admin)
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
                value="sendgrid",  # Uses SendGrid for production email
            ),
        ]
        if cfg["name"] == "compute":
            # Compute service uses COMPUTE_ prefix for all env vars
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="COMPUTE_INTERNAL_API_KEY",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["internal_api_key"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )
            workspace_x86 = (
                image_refs["workspace"]
                if image_refs and "workspace" in image_refs
                else image_base.apply(lambda base: f"{base}/workspace:latest-amd64")
            )
            workspace_gpu = (
                image_refs["workspace-gpu"]
                if image_refs and "workspace-gpu" in image_refs
                else image_base.apply(lambda base: f"{base}/workspace:latest-gpu")
            )
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="COMPUTE_WORKSPACE_IMAGE_X86",
                    value=workspace_x86,
                )
            )
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="COMPUTE_WORKSPACE_IMAGE_GPU",
                    value=workspace_gpu,
                )
            )

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

        # Add internal service token (same as internal API key, used for MCP auth)
        envs.append(
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name="INTERNAL_SERVICE_TOKEN",
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

        # =========================================
        # Optional external service secrets
        # Empty values are handled gracefully by services
        # =========================================

        # Sentry - each service gets its own DSN
        sentry_env_name = "NEXT_PUBLIC_SENTRY_DSN" if cfg["name"] == "web" else "SENTRY_DSN"
        sentry_secret_key = f"sentry_dsn_{cfg['name']}"  # e.g., sentry_dsn_api
        envs.append(
            gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                name=sentry_env_name,
                value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                    secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                        secret=secrets[sentry_secret_key].secret_id,
                        version="latest",
                    ),
                ),
            )
        )

        # API service - OAuth, Stripe, VAPID, SendGrid
        if cfg["name"] == "api":
            # Agent service URL for MCP config rewriting
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="AGENT_SERVICE_URL",
                    value=f"https://agent.{domain}",
                )
            )

            # OAuth redirect URIs - derived from app-url secret
            # These are set via set-gcp-secrets.sh based on your domain
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="GITHUB_REDIRECT_URI",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["github_redirect_uri"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="GOOGLE_REDIRECT_URI",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["google_redirect_uri"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )

            api_secrets = [
                ("GITHUB_CLIENT_ID", "github_client_id"),
                ("GITHUB_CLIENT_SECRET", "github_client_secret"),
                ("GOOGLE_CLIENT_ID", "google_client_id"),
                ("GOOGLE_CLIENT_SECRET", "google_client_secret"),
                ("STRIPE_SECRET_KEY", "stripe_secret_key"),
                ("STRIPE_WEBHOOK_SECRET", "stripe_webhook_secret"),
                ("STRIPE_PUBLISHABLE_KEY", "stripe_publishable_key"),
                ("VAPID_PUBLIC_KEY", "vapid_public_key"),
                ("VAPID_PRIVATE_KEY", "vapid_private_key"),
                ("VAPID_EMAIL", "vapid_email"),
                ("SENDGRID_API_KEY", "sendgrid_api_key"),
            ]
            for env_name, secret_key in api_secrets:
                envs.append(
                    gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                        name=env_name,
                        value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                            secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                                secret=secrets[secret_key].secret_id,
                                version="latest",
                            ),
                        ),
                    )
                )

        # Agent service - LLM API keys
        if cfg["name"] == "agent":
            # Internal URL for MCP self-referencing endpoints (like /mcp/skills)
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="AGENT_INTERNAL_URL",
                    value=f"https://agent.{domain}",
                )
            )
            # Compute service URL
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="COMPUTE_SERVICE_URL",
                    value=f"https://compute.{domain}",
                )
            )
            # Compute service API key (for agent -> compute calls)
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="COMPUTE_INTERNAL_API_KEY",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["internal_api_key"].secret_id,
                            version="latest",
                        ),
                    ),
                )
            )

            agent_secrets = [
                ("ANTHROPIC_API_KEY", "anthropic_api_key"),
                ("OPENAI_API_KEY", "openai_api_key"),
            ]
            for env_name, secret_key in agent_secrets:
                envs.append(
                    gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                        name=env_name,
                        value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                            secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                                secret=secrets[secret_key].secret_id,
                                version="latest",
                            ),
                        ),
                    )
                )

        # Web service - VAPID public key for push notifications
        if cfg["name"] == "web":
            envs.append(
                gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                    name="NEXT_PUBLIC_VAPID_PUBLIC_KEY",
                    value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                        secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                            secret=secrets["vapid_public_key"].secret_id,
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

        # IAM access control
        # Only web service (frontend) should be publicly accessible
        # Backend services (api, agent, compute) require IAM authentication
        # via GCP ID tokens from authorized service accounts
        if cfg["name"] == "web":
            # Web frontend: allow public access (unauthenticated)
            gcp.cloudrunv2.ServiceIamMember(
                f"podex-{cfg['name']}-{env}-public",
                location=region,
                name=service.name,
                role="roles/run.invoker",
                member="allUsers",
            )
        else:
            # Backend services: require IAM authentication
            # Only the Cloud Run service account can invoke these services
            # Callers must include a GCP ID token in the Authorization header
            # The token is validated by Cloud Run before the request reaches the app
            gcp.cloudrunv2.ServiceIamMember(
                f"podex-{cfg['name']}-{env}-service-auth",
                location=region,
                name=service.name,
                role="roles/run.invoker",
                member=service_account.email.apply(lambda e: f"serviceAccount:{e}"),
            )

        services[str(cfg["name"])] = service

    return services
