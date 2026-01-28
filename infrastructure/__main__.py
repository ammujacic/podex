"""Podex GCP Infrastructure - Main Entry Point.

This deploys the complete GCP-native infrastructure:
- Cloud Run services (API, Agent, Compute, Web)
- Cloud SQL PostgreSQL (db-f1-micro ~$9/mo)
- Redis on e2-micro VM (FREE tier)
- Cloud Storage (5GB FREE)
- Secret Manager (6 versions FREE)
- Cloud DNS + managed SSL
- Docker images (optional, built and pushed to Artifact Registry)

Note: GKE cluster removed - can be added back when GPU workspaces are needed.
"""

import pulumi

from stacks import compute, database, dns, images, monitoring, network, redis, secrets, storage

# Configuration
config = pulumi.Config()
gcp_config = pulumi.Config("gcp")
project_id = gcp_config.require("project")
region = gcp_config.get("region") or "us-east1"
env = config.get("env") or pulumi.get_stack()
domain = config.get("domain") or "podex.dev"

# Docker image building (set to true to build images as part of deployment)
build_images = config.get_bool("build_images") or False

pulumi.log.info(f"Deploying Podex infrastructure to {project_id} ({env})")
pulumi.log.info(f"Build Docker images: {build_images}")

# ============================================
# 1. Secrets (FREE - 6 versions)
# ============================================
pulumi.log.info("Creating secrets...")
secrets_result = secrets.create_secrets(project_id, env)

# ============================================
# 2. Storage (FREE - 5GB)
# ============================================
pulumi.log.info("Creating storage...")
bucket = storage.create_bucket(project_id, env)
artifact_repo = storage.create_artifact_registry(project_id, region, env)

# ============================================
# 3. Network (for Cloud SQL private IP option and Redis VM)
# ============================================
# Note: VPC is still created for Cloud SQL private IP option (future use)
# and Redis VM placement, but VPC connector is not needed
pulumi.log.info("Creating network...")
vpc = network.create_vpc(project_id, region, env)

# ============================================
# 4. Database - Cloud SQL (~$9/mo)
# ============================================
pulumi.log.info("Creating Cloud SQL database...")
cloud_sql = database.create_cloud_sql(
    project_id=project_id,
    region=region,
    env=env,
    secrets=secrets_result,
    vpc=vpc,
)

# ============================================
# 5. Redis - Free e2-micro VM (ALWAYS FREE)
# ============================================
pulumi.log.info("Creating Redis VM (free tier)...")
redis_vm = redis.create_redis_vm(
    project_id=project_id,
    region=region,
    env=env,
    secrets=secrets_result,
    vpc=vpc,
)

# ============================================
# 6. Docker Images (optional)
# ============================================
image_refs = None
if build_images:
    pulumi.log.info("Building Docker images (linux/amd64 for Cloud Run)...")
    docker_images = images.create_docker_images(
        project_id=project_id,
        region=region,
        env=env,
        artifact_repo=artifact_repo,
    )
    image_refs = images.get_image_refs(docker_images)
else:
    pulumi.log.info("Skipping Docker image build (use --config build_images=true to enable)")

# ============================================
# 7. Cloud Run Services (FREE TIER)
# ============================================
pulumi.log.info("Creating Cloud Run services...")
services = compute.create_cloud_run_services(
    project_id=project_id,
    region=region,
    env=env,
    artifact_repo=artifact_repo,
    cloud_sql=cloud_sql,
    redis_vm=redis_vm,
    secrets=secrets_result,
    bucket=bucket,
    vpc=vpc,
    image_refs=image_refs,
    domain=domain,
)

# ============================================
# 8. DNS + SSL (Custom Domain)
# ============================================
pulumi.log.info("Creating DNS and SSL...")
dns_result = dns.create_dns_and_ssl(
    project_id=project_id,
    region=region,
    domain=domain,
    env=env,
    services=services,
)

# ============================================
# 9. Monitoring (FREE)
# ============================================
pulumi.log.info("Creating monitoring...")
monitoring_result = monitoring.create_monitoring(
    project_id=project_id,
    env=env,
    cloud_run_services=services,
    cloud_sql=cloud_sql,
    gke_cluster=None,  # GKE removed - can be added back when needed
)

# ============================================
# Outputs
# ============================================
pulumi.export("project_id", project_id)
pulumi.export("region", region)
pulumi.export("environment", env)

# Service URLs
pulumi.export("api_url", services["api"].uri)
pulumi.export("agent_url", services["agent"].uri)
pulumi.export("compute_url", services["compute"].uri)
pulumi.export("web_url", services["web"].uri)

# Custom domains
pulumi.export("custom_domain", f"https://{domain}")
pulumi.export("app_domain", f"https://app.{domain}")
pulumi.export("api_domain", f"https://api.{domain}")
pulumi.export("agent_domain", f"https://agent.{domain}")
pulumi.export("compute_domain", f"https://compute.{domain}")
pulumi.export("dns_nameservers", dns_result["zone"].name_servers)

# Database
pulumi.export("database_connection_name", cloud_sql["connection_name"])
pulumi.export("database_ip", cloud_sql["public_ip"])

# Redis
pulumi.export("redis_internal_ip", redis_vm["internal_ip"])
pulumi.export("redis_public_ip", redis_vm["public_ip"])

# Storage
pulumi.export("bucket_name", bucket.name)
pulumi.export("artifact_registry", artifact_repo.name)

pulumi.log.info("Infrastructure deployment complete!")
