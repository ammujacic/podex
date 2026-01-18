# Podex AWS to GCP Migration Plan

> **Target:** GCP-native minimal dev stack with future-ready GPU infrastructure
> **Estimated Monthly Cost:** ~$9.50 (dev environment)
> **Migration Effort:** 3-4 weeks

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Service Mapping](#3-service-mapping)
4. [Infrastructure (Pulumi)](#4-infrastructure-pulumi)
5. [Codebase Changes](#5-codebase-changes)
6. [LLM Provider (Vertex AI)](#6-llm-provider-vertex-ai)
7. [Local Development](#7-local-development)
8. [Migration Steps](#8-migration-steps)
9. [Cost Analysis](#9-cost-analysis)

---

## 1. Executive Summary

### What We're Building

| Component              | Solution                          | Cost             |
| ---------------------- | --------------------------------- | ---------------- |
| **Compute**            | Cloud Run (4 services)            | FREE (free tier) |
| **Database**           | Cloud SQL db-f1-micro             | ~$9/mo           |
| **Redis**              | e2-micro VM (always free)         | FREE             |
| **Storage**            | Cloud Storage (5GB)               | FREE             |
| **Secrets**            | Secret Manager (6 versions)       | FREE             |
| **LLM**                | Vertex AI (Claude, Gemini, Llama) | Pay-per-use      |
| **DNS**                | Cloud DNS + managed SSL           | ~$0.50/mo        |
| **GPU Workspaces**     | GKE (scaled to 0)                 | FREE when idle   |
| **Email**              | Disabled (console logging)        | FREE             |
| **Container Registry** | Artifact Registry                 | ~$0.50/mo        |

### Why Pulumi Over Terraform

- **You already use Python** - natural fit
- **Similar to AWS CDK** - familiar patterns
- **Better testing** - use pytest for infrastructure
- **Type safety** - full IDE autocomplete

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Google Cloud Platform                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Cloud Run (FREE TIER)                        │   │
│  │                                                                      │   │
│  │   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐        │   │
│  │   │   API    │   │  Agent   │   │ Compute  │   │   Web    │        │   │
│  │   │ Service  │   │ Service  │   │ Service  │   │ Service  │        │   │
│  │   │ :3001    │   │ :3002    │   │ :3003    │   │ :3000    │        │   │
│  │   └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────────┘        │   │
│  │        │              │              │                              │   │
│  └────────┼──────────────┼──────────────┼──────────────────────────────┘   │
│           │              │              │                                   │
│           └──────────────┼──────────────┘                                   │
│                          │                                                  │
│  ┌───────────────────────┼─────────────────────────────────────────────┐   │
│  │                       ▼                                              │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │   │  Cloud SQL   │  │   e2-micro   │  │ Cloud Storage│              │   │
│  │   │  PostgreSQL  │  │    Redis     │  │   (5GB)      │              │   │
│  │   │  db-f1-micro │  │  (FREE VM)   │  │    FREE      │              │   │
│  │   │    ~$9/mo    │  │    FREE      │  │              │              │   │
│  │   └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │                       DATA LAYER                                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    GKE Cluster (GPU Workspaces)                       │  │
│  │                         SCALED TO 0 = FREE                            │  │
│  │                                                                       │  │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                │  │
│  │   │  T4 Pool    │   │  L4 Pool    │   │  A100 Pool  │                │  │
│  │   │  min: 0     │   │  min: 0     │   │  min: 0     │                │  │
│  │   │  max: 10    │   │  max: 5     │   │  max: 2     │                │  │
│  │   └─────────────┘   └─────────────┘   └─────────────┘                │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │   Cloud DNS     │  │  Certificate    │  │   Vertex AI     │            │
│  │   podex.dev     │  │    Manager      │  │  (Claude/Gemini)│            │
│  │   ~$0.20/zone   │  │     FREE        │  │   Pay-per-use   │            │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Service Mapping

### Complete AWS → GCP Mapping

| AWS Service           | GCP Replacement        | Notes                 |
| --------------------- | ---------------------- | --------------------- |
| **ECS Fargate**       | Cloud Run              | Serverless containers |
| **ECS EC2 (GPU)**     | GKE + GPU Node Pools   | Scaled to 0 when idle |
| **ECR**               | Artifact Registry      | Same functionality    |
| **RDS PostgreSQL**    | Cloud SQL PostgreSQL   | db-f1-micro (~$9/mo)  |
| **ElastiCache Redis** | e2-micro VM + Redis    | Always free!          |
| **DynamoDB**          | Firestore (if needed)  | Free tier available   |
| **S3**                | Cloud Storage          | 5GB free              |
| **ALB**               | Cloud Run built-in     | No separate LB needed |
| **Route 53**          | Cloud DNS              | ~$0.20/zone/mo        |
| **ACM**               | Certificate Manager    | Google-managed, free  |
| **Cognito**           | Firebase Auth (future) | Skip for now          |
| **SES**               | Disabled (console log) | No GCP native email   |
| **WAF**               | Cloud Armor            | Same functionality    |
| **Secrets Manager**   | Secret Manager         | 6 versions free       |
| **CloudWatch**        | Cloud Monitoring       | Free for GCP metrics  |
| **CloudTrail**        | Cloud Audit Logs       | Automatic, free       |
| **SNS**               | Pub/Sub                | 10GB/mo free          |
| **Bedrock**           | Vertex AI              | Claude, Gemini, Llama |
| **Polly**             | Text-to-Speech API     | Same functionality    |
| **Transcribe**        | Speech-to-Text API     | Same functionality    |
| **VPC**               | VPC                    | Same concepts         |
| **NAT Gateway**       | Skip for Cloud Run     | Direct egress works   |

### GPU Instance Mapping (for GKE)

| Your Pod Type    | AWS Instance | GCP Equivalent     | GCP Config            |
| ---------------- | ------------ | ------------------ | --------------------- |
| `gpu-t4`         | g4dn.xlarge  | n1-standard-4 + T4 | 1x T4, 4 vCPU, 15GB   |
| `gpu-a10g`       | g5.2xlarge   | g2-standard-8 + L4 | 1x L4, 8 vCPU, 32GB   |
| `gpu-arm-t4g`    | g5g.xlarge   | n1-standard-4 + T4 | No ARM, use x86 T4    |
| `ml-inferentia2` | inf2.xlarge  | TPU v4 or A100     | Different accelerator |
| `ml-trainium`    | trn1.2xlarge | a2-highgpu-1g      | 1x A100               |

---

## 4. Infrastructure (Pulumi)

### Project Structure

```
infra-gcp/
├── __main__.py              # Main entry point
├── Pulumi.yaml              # Project configuration
├── Pulumi.dev.yaml          # Dev stack config
├── Pulumi.prod.yaml         # Prod stack config (future)
├── requirements.txt         # Python dependencies
└── stacks/
    ├── __init__.py
    ├── network.py           # VPC (for GKE)
    ├── database.py          # Cloud SQL
    ├── redis.py             # Free e2-micro VM + Redis
    ├── storage.py           # Cloud Storage, Artifact Registry
    ├── compute.py           # Cloud Run services
    ├── gke.py               # GKE cluster + GPU pools (scaled to 0)
    ├── dns.py               # Cloud DNS + SSL certificates
    ├── secrets.py           # Secret Manager
    └── monitoring.py        # Cloud Monitoring (optional)
```

### Pulumi.yaml

```yaml
name: podex-infra
runtime:
  name: python
  options:
    virtualenv: venv
description: Podex GCP Infrastructure
```

### requirements.txt

```
pulumi>=3.0.0
pulumi-gcp>=7.0.0
pulumi-random>=4.0.0
pulumi-docker>=4.0.0
```

### Main Entry Point

```python
# infra-gcp/__main__.py
import pulumi
import pulumi_gcp as gcp
from stacks import network, database, redis, storage, compute, gke, dns, secrets

# Configuration
config = pulumi.Config()
gcp_config = pulumi.Config("gcp")
project_id = gcp_config.require("project")
region = config.get("region") or "us-east1"
env = pulumi.get_stack()  # 'dev', 'staging', 'prod'
domain = config.get("domain") or "podex.dev"

# ============================================
# 1. Secrets (FREE - 6 versions)
# ============================================
secrets_result = secrets.create_secrets(project_id, env)

# ============================================
# 2. Storage (FREE - 5GB)
# ============================================
bucket = storage.create_bucket(project_id, env)
artifact_repo = storage.create_artifact_registry(project_id, region, env)

# ============================================
# 3. Database - Cloud SQL (~$9/mo)
# ============================================
cloud_sql = database.create_cloud_sql(project_id, region, env, secrets_result)

# ============================================
# 4. Redis - Free e2-micro VM (ALWAYS FREE)
# ============================================
redis_vm = redis.create_redis_vm(project_id, region, env)

# ============================================
# 5. Network (for GKE)
# ============================================
vpc = network.create_vpc(project_id, region, env)

# ============================================
# 6. GKE Cluster (GPU ready, scaled to 0)
# ============================================
gke_cluster = gke.create_gke_cluster(project_id, region, env, vpc)
gke.create_gpu_node_pools(gke_cluster, env)

# ============================================
# 7. Cloud Run Services (FREE TIER)
# ============================================
services = compute.create_cloud_run_services(
    project_id=project_id,
    region=region,
    env=env,
    artifact_repo=artifact_repo,
    cloud_sql=cloud_sql,
    redis_vm=redis_vm,
    secrets=secrets_result,
    bucket=bucket,
)

# ============================================
# 8. DNS + SSL (Custom Domain)
# ============================================
dns_result = dns.create_dns_and_ssl(
    project_id=project_id,
    domain=domain,
    env=env,
    services=services,
)

# ============================================
# Outputs
# ============================================
pulumi.export("api_url", services["api"].uri)
pulumi.export("agent_url", services["agent"].uri)
pulumi.export("web_url", services["web"].uri)
pulumi.export("custom_domain", f"https://{domain}")
pulumi.export("database_connection", cloud_sql["connection_name"])
pulumi.export("redis_ip", redis_vm["internal_ip"])
pulumi.export("bucket_name", bucket.name)
pulumi.export("gke_cluster", gke_cluster.name)
```

### Secrets Stack

```python
# infra-gcp/stacks/secrets.py
import pulumi
import pulumi_gcp as gcp
import pulumi_random as random

def create_secrets(project_id: str, env: str):
    """Create Secret Manager secrets (6 free versions)."""

    secrets = {}

    # 1. JWT Secret (auto-generated)
    jwt_value = random.RandomPassword(
        f"jwt-secret-value-{env}",
        length=64,
        special=False,
    )

    jwt_secret = gcp.secretmanager.Secret(
        f"jwt-secret-{env}",
        secret_id=f"podex-jwt-secret-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"jwt-secret-version-{env}",
        secret=jwt_secret.id,
        secret_data=jwt_value.result,
    )

    secrets["jwt"] = jwt_secret

    # 2. Database password (auto-generated)
    db_password = random.RandomPassword(
        f"db-password-{env}",
        length=32,
        special=False,
    )

    db_secret = gcp.secretmanager.Secret(
        f"db-password-{env}",
        secret_id=f"podex-db-password-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"db-password-version-{env}",
        secret=db_secret.id,
        secret_data=db_password.result,
    )

    secrets["db_password"] = db_secret
    secrets["db_password_value"] = db_password.result

    # 3. Redis password (auto-generated)
    redis_password = random.RandomPassword(
        f"redis-password-{env}",
        length=32,
        special=False,
    )

    redis_secret = gcp.secretmanager.Secret(
        f"redis-password-{env}",
        secret_id=f"podex-redis-password-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"redis-password-version-{env}",
        secret=redis_secret.id,
        secret_data=redis_password.result,
    )

    secrets["redis_password"] = redis_secret
    secrets["redis_password_value"] = redis_password.result

    # 4-6. Placeholder secrets (set manually)
    for name in ["vertex-ai-key", "sendgrid-api-key", "stripe-api-key"]:
        secret = gcp.secretmanager.Secret(
            f"{name}-{env}",
            secret_id=f"podex-{name}-{env}",
            replication=gcp.secretmanager.SecretReplicationArgs(
                auto=gcp.secretmanager.SecretReplicationAutoArgs(),
            ),
        )
        secrets[name.replace("-", "_")] = secret

    return secrets
```

### Database Stack (Cloud SQL)

```python
# infra-gcp/stacks/database.py
import pulumi
import pulumi_gcp as gcp

def create_cloud_sql(project_id: str, region: str, env: str, secrets: dict):
    """Create Cloud SQL PostgreSQL instance (db-f1-micro ~$9/mo)."""

    instance = gcp.sql.DatabaseInstance(
        f"podex-db-{env}",
        database_version="POSTGRES_16",
        region=region,
        deletion_protection=env == "prod",
        settings=gcp.sql.DatabaseInstanceSettingsArgs(
            # db-f1-micro: 0.25 vCPU, 0.6GB RAM, ~$9/mo
            tier="db-f1-micro",
            disk_size=10,
            disk_autoresize=False,
            availability_type="ZONAL",

            # Skip backups for dev (saves cost)
            backup_configuration=gcp.sql.DatabaseInstanceSettingsBackupConfigurationArgs(
                enabled=env == "prod",
                start_time="03:00" if env == "prod" else None,
            ),

            # Public IP for simplicity (restrict in prod)
            ip_configuration=gcp.sql.DatabaseInstanceSettingsIpConfigurationArgs(
                ipv4_enabled=True,
                authorized_networks=[
                    gcp.sql.DatabaseInstanceSettingsIpConfigurationAuthorizedNetworkArgs(
                        name="cloud-run",
                        value="0.0.0.0/0",  # Cloud Run uses different IPs
                    ),
                ] if env == "dev" else [],
            ),
        ),
    )

    database = gcp.sql.Database(
        f"podex-database-{env}",
        instance=instance.name,
        name="podex",
    )

    user = gcp.sql.User(
        f"podex-user-{env}",
        instance=instance.name,
        name="podex",
        password=secrets["db_password_value"],
    )

    # Create database URL secret
    db_url_secret = gcp.secretmanager.Secret(
        f"database-url-{env}",
        secret_id=f"podex-database-url-{env}",
        replication=gcp.secretmanager.SecretReplicationArgs(
            auto=gcp.secretmanager.SecretReplicationAutoArgs(),
        ),
    )

    gcp.secretmanager.SecretVersion(
        f"database-url-version-{env}",
        secret=db_url_secret.id,
        secret_data=pulumi.Output.all(
            instance.public_ip_address,
            secrets["db_password_value"]
        ).apply(
            lambda args: f"postgresql+asyncpg://podex:{args[1]}@{args[0]}:5432/podex"
        ),
    )

    return {
        "instance": instance,
        "connection_name": instance.connection_name,
        "public_ip": instance.public_ip_address,
        "url_secret": db_url_secret,
    }
```

### Redis Stack (Free e2-micro VM)

```python
# infra-gcp/stacks/redis.py
import pulumi
import pulumi_gcp as gcp

def create_redis_vm(project_id: str, region: str, env: str):
    """Create free e2-micro VM running Redis.

    GCP Free Tier includes:
    - 1 e2-micro VM in us-east1
    - 30GB standard persistent disk
    - 1GB egress
    """

    # Use free tier eligible region
    zone = f"{region}-a"

    # Startup script to install and configure Redis
    startup_script = """#!/bin/bash
set -e

# Install Redis
apt-get update
apt-get install -y redis-server

# Configure Redis
cat > /etc/redis/redis.conf << 'EOF'
bind 0.0.0.0
port 6379
daemonize yes
supervised systemd

# Memory management (e2-micro has 1GB RAM, allocate 512MB to Redis)
maxmemory 512mb
maxmemory-policy allkeys-lru

# Persistence (optional, can disable for pure cache)
save 900 1
save 300 10
save 60 10000

# Security
requirepass ${REDIS_PASSWORD}

# Performance
tcp-keepalive 300
EOF

# Start Redis
systemctl enable redis-server
systemctl restart redis-server

echo "Redis installation complete"
"""

    # Create the VM
    redis_vm = gcp.compute.Instance(
        f"podex-redis-{env}",
        machine_type="e2-micro",  # FREE TIER!
        zone=zone,

        boot_disk=gcp.compute.InstanceBootDiskArgs(
            initialize_params=gcp.compute.InstanceBootDiskInitializeParamsArgs(
                image="debian-cloud/debian-12",
                size=30,  # 30GB standard disk is free
                type="pd-standard",
            ),
        ),

        network_interfaces=[
            gcp.compute.InstanceNetworkInterfaceArgs(
                network="default",
                access_configs=[
                    gcp.compute.InstanceNetworkInterfaceAccessConfigArgs(
                        # Ephemeral public IP (for setup, can remove later)
                    ),
                ],
            ),
        ],

        metadata_startup_script=startup_script,

        # Allow Redis port from Cloud Run
        tags=["redis-server"],

        labels={
            "env": env,
            "app": "podex",
            "service": "redis",
        },

        # Preemptible would save more but restarts - not ideal for Redis
        scheduling=gcp.compute.InstanceSchedulingArgs(
            preemptible=False,
            automatic_restart=True,
        ),
    )

    # Firewall rule for Redis
    gcp.compute.Firewall(
        f"allow-redis-{env}",
        network="default",
        allows=[
            gcp.compute.FirewallAllowArgs(
                protocol="tcp",
                ports=["6379"],
            ),
        ],
        source_ranges=["0.0.0.0/0"],  # Cloud Run IPs vary - restrict in prod
        target_tags=["redis-server"],
    )

    return {
        "instance": redis_vm,
        "internal_ip": redis_vm.network_interfaces[0].network_ip,
        "external_ip": redis_vm.network_interfaces[0].access_configs[0].nat_ip,
    }
```

### Storage Stack

```python
# infra-gcp/stacks/storage.py
import pulumi
import pulumi_gcp as gcp

def create_bucket(project_id: str, env: str):
    """Create Cloud Storage bucket (5GB free)."""

    bucket = gcp.storage.Bucket(
        f"podex-workspaces-{env}",
        name=f"podex-workspaces-{env}-{project_id}",
        location="US",
        uniform_bucket_level_access=True,

        # Auto-delete old files to stay under 5GB free limit
        lifecycle_rules=[
            gcp.storage.BucketLifecycleRuleArgs(
                action=gcp.storage.BucketLifecycleRuleActionArgs(type="Delete"),
                condition=gcp.storage.BucketLifecycleRuleConditionArgs(age=7),
            ),
        ],

        # CORS for web uploads
        cors=[
            gcp.storage.BucketCorArgs(
                origins=["*"],
                methods=["GET", "PUT", "POST", "DELETE"],
                response_headers=["*"],
                max_age_seconds=3600,
            ),
        ],
    )

    return bucket


def create_artifact_registry(project_id: str, region: str, env: str):
    """Create Artifact Registry for container images."""

    repo = gcp.artifactregistry.Repository(
        f"podex-repo-{env}",
        location=region,
        repository_id=f"podex-{env}",
        format="DOCKER",
        description=f"Podex container images ({env})",
    )

    return repo
```

### Cloud Run Stack

```python
# infra-gcp/stacks/compute.py
import pulumi
import pulumi_gcp as gcp

def create_cloud_run_services(
    project_id: str,
    region: str,
    env: str,
    artifact_repo,
    cloud_sql: dict,
    redis_vm: dict,
    secrets: dict,
    bucket,
):
    """Create Cloud Run services (FREE TIER)."""

    services = {}

    # Service account for Cloud Run
    service_account = gcp.serviceaccount.Account(
        f"podex-cloudrun-{env}",
        account_id=f"podex-cloudrun-{env}",
        display_name=f"Podex Cloud Run ({env})",
    )

    # Grant permissions
    for role in [
        "roles/secretmanager.secretAccessor",
        "roles/storage.objectAdmin",
        "roles/cloudsql.client",
        "roles/aiplatform.user",  # For Vertex AI
    ]:
        gcp.projects.IAMMember(
            f"podex-sa-{role.split('/')[-1]}-{env}",
            project=project_id,
            role=role,
            member=service_account.email.apply(lambda e: f"serviceAccount:{e}"),
        )

    # Service configurations
    svc_configs = [
        {
            "name": "api",
            "port": 3001,
            "cpu": "1",
            "memory": "512Mi",
            "env_vars": {
                "DATABASE_URL": ("secret", "database-url"),
                "REDIS_URL": ("value", redis_vm["internal_ip"].apply(
                    lambda ip: f"redis://:{secrets['redis_password_value']}@{ip}:6379/0"
                )),
                "GCS_BUCKET": ("value", bucket.name),
                "LLM_PROVIDER": ("value", "vertex"),
                "GCP_PROJECT_ID": ("value", project_id),
                "GCP_REGION": ("value", region),
                "EMAIL_BACKEND": ("value", "console"),
                "ENV": ("value", env),
            },
        },
        {
            "name": "agent",
            "port": 3002,
            "cpu": "1",
            "memory": "1Gi",
            "env_vars": {
                "LLM_PROVIDER": ("value", "vertex"),
                "GCP_PROJECT_ID": ("value", project_id),
                "GCP_REGION": ("value", region),
                "ENV": ("value", env),
            },
        },
        {
            "name": "compute",
            "port": 3003,
            "cpu": "1",
            "memory": "512Mi",
            "env_vars": {
                "GCP_PROJECT_ID": ("value", project_id),
                "GCP_REGION": ("value", region),
                "GCS_BUCKET": ("value", bucket.name),
                "ENV": ("value", env),
            },
        },
        {
            "name": "web",
            "port": 3000,
            "cpu": "0.5",
            "memory": "256Mi",
            "env_vars": {
                "ENV": ("value", env),
            },
        },
    ]

    for cfg in svc_configs:
        # Build environment variables
        envs = []
        for key, (type_, val) in cfg["env_vars"].items():
            if type_ == "secret":
                envs.append(
                    gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                        name=key,
                        value_source=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceArgs(
                            secret_key_ref=gcp.cloudrunv2.ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs(
                                secret=f"podex-{val}-{env}",
                                version="latest",
                            ),
                        ),
                    )
                )
            else:
                envs.append(
                    gcp.cloudrunv2.ServiceTemplateContainerEnvArgs(
                        name=key,
                        value=val,
                    )
                )

        service = gcp.cloudrunv2.Service(
            f"podex-{cfg['name']}-{env}",
            location=region,
            ingress="INGRESS_TRAFFIC_ALL",
            template=gcp.cloudrunv2.ServiceTemplateArgs(
                service_account=service_account.email,
                scaling=gcp.cloudrunv2.ServiceTemplateScalingArgs(
                    min_instance_count=0,  # Scale to zero!
                    max_instance_count=5,
                ),
                containers=[
                    gcp.cloudrunv2.ServiceTemplateContainerArgs(
                        name=cfg["name"],
                        image=f"{region}-docker.pkg.dev/{project_id}/podex-{env}/{cfg['name']}:latest",
                        ports=[gcp.cloudrunv2.ServiceTemplateContainerPortArgs(
                            container_port=cfg["port"],
                        )],
                        resources=gcp.cloudrunv2.ServiceTemplateContainerResourcesArgs(
                            limits={
                                "cpu": cfg["cpu"],
                                "memory": cfg["memory"],
                            },
                            cpu_idle=True,  # Don't charge when idle
                        ),
                        envs=envs,
                        startup_probe=gcp.cloudrunv2.ServiceTemplateContainerStartupProbeArgs(
                            http_get=gcp.cloudrunv2.ServiceTemplateContainerStartupProbeHttpGetArgs(
                                path="/health",
                            ),
                            initial_delay_seconds=5,
                            period_seconds=10,
                        ) if cfg["name"] != "web" else None,
                    ),
                ],
            ),
        )

        # Allow public access
        gcp.cloudrunv2.ServiceIamMember(
            f"podex-{cfg['name']}-{env}-public",
            location=region,
            name=service.name,
            role="roles/run.invoker",
            member="allUsers",
        )

        services[cfg["name"]] = service

    return services
```

### GKE Stack (GPU Ready, Scaled to 0)

```python
# infra-gcp/stacks/gke.py
import pulumi
import pulumi_gcp as gcp

def create_gke_cluster(project_id: str, region: str, env: str, vpc):
    """Create GKE cluster for GPU workspaces (scaled to 0 = FREE)."""

    # Service account for GKE nodes
    gke_sa = gcp.serviceaccount.Account(
        f"podex-gke-{env}",
        account_id=f"podex-gke-{env}",
        display_name=f"Podex GKE Nodes ({env})",
    )

    for role in [
        "roles/logging.logWriter",
        "roles/monitoring.metricWriter",
        "roles/storage.objectViewer",
        "roles/artifactregistry.reader",
    ]:
        gcp.projects.IAMMember(
            f"podex-gke-{role.split('/')[-1]}-{env}",
            project=project_id,
            role=role,
            member=gke_sa.email.apply(lambda e: f"serviceAccount:{e}"),
        )

    cluster = gcp.container.Cluster(
        f"podex-workspaces-{env}",
        location=region,

        # Remove default node pool (we'll create GPU pools)
        remove_default_node_pool=True,
        initial_node_count=1,

        # Networking
        network=vpc["network"].name,
        subnetwork=vpc["subnet"].name,

        # Workload Identity
        workload_identity_config=gcp.container.ClusterWorkloadIdentityConfigArgs(
            workload_pool=f"{project_id}.svc.id.goog",
        ),

        # Enable features
        enable_shielded_nodes=True,

        # Cluster autoscaling with NAP
        cluster_autoscaling=gcp.container.ClusterClusterAutoscalingArgs(
            enabled=True,
            resource_limits=[
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="cpu",
                    minimum=0,
                    maximum=100,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="memory",
                    minimum=0,
                    maximum=200,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="nvidia-tesla-t4",
                    minimum=0,
                    maximum=10,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="nvidia-l4",
                    minimum=0,
                    maximum=5,
                ),
                gcp.container.ClusterClusterAutoscalingResourceLimitArgs(
                    resource_type="nvidia-tesla-a100",
                    minimum=0,
                    maximum=2,
                ),
            ],
            auto_provisioning_defaults=gcp.container.ClusterClusterAutoscalingAutoProvisioningDefaultsArgs(
                service_account=gke_sa.email,
                oauth_scopes=["https://www.googleapis.com/auth/cloud-platform"],
            ),
        ),

        # Release channel
        release_channel=gcp.container.ClusterReleaseChannelArgs(
            channel="REGULAR",
        ),
    )

    return cluster


def create_gpu_node_pools(cluster, env: str):
    """Create GPU node pools, all scaled to 0 (no cost when idle)."""

    gpu_configs = [
        {
            "name": "t4",
            "machine_type": "n1-standard-4",
            "gpu_type": "nvidia-tesla-t4",
            "gpu_count": 1,
            "max_nodes": 10,
        },
        {
            "name": "l4",
            "machine_type": "g2-standard-8",
            "gpu_type": "nvidia-l4",
            "gpu_count": 1,
            "max_nodes": 5,
        },
        {
            "name": "a100",
            "machine_type": "a2-highgpu-1g",
            "gpu_type": "nvidia-tesla-a100",
            "gpu_count": 1,
            "max_nodes": 2,
        },
    ]

    pools = {}

    for cfg in gpu_configs:
        pool = gcp.container.NodePool(
            f"podex-{cfg['name']}-pool-{env}",
            cluster=cluster.name,
            location=cluster.location,

            # SCALED TO 0 = NO COST
            initial_node_count=0,
            autoscaling=gcp.container.NodePoolAutoscalingArgs(
                min_node_count=0,  # Scale to zero!
                max_node_count=cfg["max_nodes"],
            ),

            node_config=gcp.container.NodePoolNodeConfigArgs(
                machine_type=cfg["machine_type"],

                # GPU configuration
                guest_accelerators=[
                    gcp.container.NodePoolNodeConfigGuestAcceleratorArgs(
                        type=cfg["gpu_type"],
                        count=cfg["gpu_count"],
                        gpu_driver_installation_config=gcp.container.NodePoolNodeConfigGuestAcceleratorGpuDriverInstallationConfigArgs(
                            gpu_driver_version="LATEST",
                        ),
                    ),
                ],

                # Use Spot VMs for massive savings (60-90% off)
                spot=True,

                # Taints to ensure only GPU workloads land here
                taints=[
                    gcp.container.NodePoolNodeConfigTaintArgs(
                        key="nvidia.com/gpu",
                        value="present",
                        effect="NO_SCHEDULE",
                    ),
                ],

                labels={
                    "gpu-type": cfg["gpu_type"],
                    "workload": "workspace",
                },

                oauth_scopes=["https://www.googleapis.com/auth/cloud-platform"],
            ),

            management=gcp.container.NodePoolManagementArgs(
                auto_repair=True,
                auto_upgrade=True,
            ),
        )

        pools[cfg["name"]] = pool

    return pools
```

### DNS Stack (Custom Domain)

```python
# infra-gcp/stacks/dns.py
import pulumi
import pulumi_gcp as gcp

def create_dns_and_ssl(
    project_id: str,
    domain: str,
    env: str,
    services: dict,
):
    """Create Cloud DNS zone and managed SSL certificate."""

    # DNS Zone
    zone = gcp.dns.ManagedZone(
        f"podex-zone-{env}",
        dns_name=f"{domain}.",
        description=f"Podex DNS zone ({env})",
    )

    # SSL Certificate (Google-managed, FREE)
    certificate = gcp.compute.ManagedSslCertificate(
        f"podex-cert-{env}",
        managed=gcp.compute.ManagedSslCertificateManagedArgs(
            domains=[
                domain,
                f"*.{domain}",
                f"api.{domain}",
                f"app.{domain}",
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
        if svc_name in services:
            mapping = gcp.cloudrun.DomainMapping(
                f"podex-{svc_name}-mapping-{env}",
                location=services[svc_name].location,
                name=subdomain,
                metadata=gcp.cloudrun.DomainMappingMetadataArgs(
                    namespace=project_id,
                ),
                spec=gcp.cloudrun.DomainMappingSpecArgs(
                    route_name=services[svc_name].name,
                ),
            )
            mappings[svc_name] = mapping

    # DNS records pointing to Cloud Run
    # Note: Cloud Run provides the CNAME target
    for svc_name, mapping in mappings.items():
        subdomain = subdomain_map[svc_name]
        record_name = "" if subdomain == domain else subdomain.replace(f".{domain}", "")

        gcp.dns.RecordSet(
            f"podex-{svc_name}-dns-{env}",
            managed_zone=zone.name,
            name=f"{subdomain}.",
            type="CNAME",
            ttl=300,
            rrdatas=["ghs.googlehosted.com."],
        )

    return {
        "zone": zone,
        "certificate": certificate,
        "mappings": mappings,
        "nameservers": zone.name_servers,
    }
```

### Network Stack (for GKE)

```python
# infra-gcp/stacks/network.py
import pulumi
import pulumi_gcp as gcp

def create_vpc(project_id: str, region: str, env: str):
    """Create VPC for GKE cluster."""

    network = gcp.compute.Network(
        f"podex-vpc-{env}",
        auto_create_subnetworks=False,
        description=f"Podex VPC ({env})",
    )

    subnet = gcp.compute.Subnetwork(
        f"podex-subnet-{env}",
        network=network.id,
        ip_cidr_range="10.0.0.0/20",
        region=region,
        private_ip_google_access=True,

        # Secondary ranges for GKE
        secondary_ip_ranges=[
            gcp.compute.SubnetworkSecondaryIpRangeArgs(
                range_name="pods",
                ip_cidr_range="10.4.0.0/14",
            ),
            gcp.compute.SubnetworkSecondaryIpRangeArgs(
                range_name="services",
                ip_cidr_range="10.8.0.0/20",
            ),
        ],
    )

    # Cloud Router (for NAT if needed)
    router = gcp.compute.Router(
        f"podex-router-{env}",
        network=network.id,
        region=region,
    )

    # Cloud NAT (for GKE private nodes)
    nat = gcp.compute.RouterNat(
        f"podex-nat-{env}",
        router=router.name,
        region=region,
        nat_ip_allocate_option="AUTO_ONLY",
        source_subnetwork_ip_ranges_to_nat="ALL_SUBNETWORKS_ALL_IP_RANGES",
    )

    return {
        "network": network,
        "subnet": subnet,
        "router": router,
        "nat": nat,
    }
```

---

## 5. Codebase Changes

### Files to Modify

| File                                           | Change                             | Effort |
| ---------------------------------------------- | ---------------------------------- | ------ |
| `services/api/pyproject.toml`                  | Replace boto3 with google-cloud-\* | Low    |
| `services/agent/pyproject.toml`                | Replace boto3 with google-cloud-\* | Low    |
| `services/shared/pyproject.toml`               | Replace boto3 with google-cloud-\* | Low    |
| `services/shared/src/podex_shared/aws/*`       | Delete entirely                    | -      |
| `services/shared/src/podex_shared/gcp/*`       | Create new modules                 | Medium |
| `services/api/src/storage/s3.py`               | Rewrite as `gcs.py`                | Medium |
| `services/api/src/services/email.py`           | Add console backend                | Low    |
| `services/agent/src/providers/llm.py`          | Add Vertex AI provider             | Medium |
| `services/api/src/config.py`                   | Update LLM provider options        | Low    |
| `services/api/src/cost/realtime_tracker.py`    | Update model pricing               | Low    |
| `services/compute/src/managers/aws_manager.py` | Rewrite as `gcp_manager.py`        | High   |
| `.env.example`                                 | Update for GCP                     | Low    |

### New Dependencies

```toml
# Replace in all pyproject.toml files

# Remove
# "boto3>=1.34.0",
# "aioboto3>=12.3.0",

# Add
"google-cloud-storage>=2.14.0",
"google-cloud-secret-manager>=2.18.0",
"google-cloud-aiplatform>=1.40.0",  # Vertex AI
"google-cloud-texttospeech>=2.16.0",
"google-cloud-speech>=2.24.0",
"google-cloud-run>=0.10.0",
"google-auth>=2.28.0",
"anthropic[vertex]>=0.40.0",  # Claude on Vertex AI
```

### GCS Storage Module

```python
# services/shared/src/podex_shared/gcp/storage.py
from google.cloud import storage
import asyncio
from functools import partial
import os

class GCSClient:
    """Google Cloud Storage client with async support."""

    def __init__(self, bucket_name: str | None = None):
        self.client = storage.Client()
        bucket_name = bucket_name or os.environ.get("GCS_BUCKET", "podex-workspaces")
        self.bucket = self.client.bucket(bucket_name)

    async def upload_file(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream"
    ) -> str:
        blob = self.bucket.blob(key)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            partial(blob.upload_from_string, data, content_type=content_type)
        )
        return f"gs://{self.bucket.name}/{key}"

    async def download_file(self, key: str) -> bytes:
        blob = self.bucket.blob(key)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, blob.download_as_bytes)

    async def delete_file(self, key: str) -> None:
        blob = self.bucket.blob(key)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, blob.delete)

    async def file_exists(self, key: str) -> bool:
        blob = self.bucket.blob(key)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, blob.exists)

    async def list_files(self, prefix: str) -> list[str]:
        loop = asyncio.get_event_loop()
        blobs = await loop.run_in_executor(
            None,
            partial(list, self.client.list_blobs(self.bucket, prefix=prefix))
        )
        return [blob.name for blob in blobs]

    async def generate_signed_url(self, key: str, expiration: int = 3600) -> str:
        blob = self.bucket.blob(key)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            partial(blob.generate_signed_url, expiration=expiration, version="v4")
        )
```

---

## 6. LLM Provider (Vertex AI)

### Available Models on Vertex AI

| Provider      | Model             | Vertex AI Name                  | Available |
| ------------- | ----------------- | ------------------------------- | --------- |
| **Anthropic** | Claude Opus 4.5   | `claude-opus-4-5@20250514`      | ✅        |
| **Anthropic** | Claude Sonnet 4   | `claude-sonnet-4@20250514`      | ✅        |
| **Anthropic** | Claude 3.5 Sonnet | `claude-3-5-sonnet-v2@20241022` | ✅        |
| **Anthropic** | Claude 3.5 Haiku  | `claude-3-5-haiku@20241022`     | ✅        |
| **Google**    | Gemini 2.5 Pro    | `gemini-2.5-pro`                | ✅        |
| **Google**    | Gemini 2.5 Flash  | `gemini-2.5-flash`              | ✅        |
| **Google**    | Gemini 2.0 Flash  | `gemini-2.0-flash`              | ✅        |
| **Meta**      | Llama 4 Scout     | `llama-4-scout`                 | ✅        |
| **Meta**      | Llama 3.1 70B     | `llama-3.1-70b-instruct`        | ✅        |
| **Mistral**   | Mistral Large     | `mistral-large`                 | ✅        |

### Vertex AI LLM Provider

```python
# services/agent/src/providers/vertex.py
"""Vertex AI LLM provider supporting multiple models."""

import os
from typing import AsyncIterator
from anthropic import AnthropicVertex
from google.cloud import aiplatform
from vertexai.generative_models import GenerativeModel

class VertexAIProvider:
    """Multi-model LLM provider using Vertex AI."""

    # Model mappings
    CLAUDE_MODELS = {
        "claude-opus-4": "claude-opus-4-5@20250514",
        "claude-sonnet-4": "claude-sonnet-4@20250514",
        "claude-3-5-sonnet": "claude-3-5-sonnet-v2@20241022",
        "claude-3-5-haiku": "claude-3-5-haiku@20241022",
    }

    GEMINI_MODELS = {
        "gemini-2.5-pro": "gemini-2.5-pro",
        "gemini-2.5-flash": "gemini-2.5-flash",
        "gemini-2.0-flash": "gemini-2.0-flash-001",
    }

    LLAMA_MODELS = {
        "llama-4-scout": "llama-4-scout",
        "llama-3.1-70b": "llama-3.1-70b-instruct",
    }

    def __init__(self):
        self.project_id = os.environ.get("GCP_PROJECT_ID")
        self.region = os.environ.get("GCP_REGION", "us-east1")

        # Initialize Vertex AI
        aiplatform.init(project=self.project_id, location=self.region)

        # Claude client (via Anthropic's Vertex integration)
        self.claude_client = AnthropicVertex(
            project_id=self.project_id,
            region=self.region,
        )

    def _get_model_type(self, model: str) -> str:
        """Determine model provider type."""
        if model in self.CLAUDE_MODELS or model.startswith("claude"):
            return "claude"
        elif model in self.GEMINI_MODELS or model.startswith("gemini"):
            return "gemini"
        elif model in self.LLAMA_MODELS or model.startswith("llama"):
            return "llama"
        else:
            # Default to Gemini for unknown models
            return "gemini"

    def _resolve_model_name(self, model: str) -> str:
        """Resolve shorthand model names to full Vertex AI names."""
        if model in self.CLAUDE_MODELS:
            return self.CLAUDE_MODELS[model]
        elif model in self.GEMINI_MODELS:
            return self.GEMINI_MODELS[model]
        elif model in self.LLAMA_MODELS:
            return self.LLAMA_MODELS[model]
        return model

    async def generate(
        self,
        messages: list[dict],
        model: str = "claude-sonnet-4",
        max_tokens: int = 4096,
        temperature: float = 0.7,
        system: str | None = None,
    ) -> str:
        """Generate a response from the specified model."""

        model_type = self._get_model_type(model)
        model_name = self._resolve_model_name(model)

        if model_type == "claude":
            return await self._generate_claude(
                messages, model_name, max_tokens, temperature, system
            )
        elif model_type == "gemini":
            return await self._generate_gemini(
                messages, model_name, max_tokens, temperature, system
            )
        else:
            # Llama and others use Vertex AI's model serving
            return await self._generate_vertex_model(
                messages, model_name, max_tokens, temperature, system
            )

    async def _generate_claude(
        self,
        messages: list[dict],
        model: str,
        max_tokens: int,
        temperature: float,
        system: str | None,
    ) -> str:
        """Generate using Claude via Vertex AI."""
        response = await self.claude_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system or "",
            messages=messages,
        )
        return response.content[0].text

    async def _generate_gemini(
        self,
        messages: list[dict],
        model: str,
        max_tokens: int,
        temperature: float,
        system: str | None,
    ) -> str:
        """Generate using Gemini."""
        gemini = GenerativeModel(
            model,
            system_instruction=system,
        )

        # Convert messages to Gemini format
        gemini_messages = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            gemini_messages.append({"role": role, "parts": [msg["content"]]})

        response = await gemini.generate_content_async(
            gemini_messages,
            generation_config={
                "max_output_tokens": max_tokens,
                "temperature": temperature,
            },
        )
        return response.text

    async def generate_stream(
        self,
        messages: list[dict],
        model: str = "claude-sonnet-4",
        max_tokens: int = 4096,
        temperature: float = 0.7,
        system: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream a response from the specified model."""

        model_type = self._get_model_type(model)
        model_name = self._resolve_model_name(model)

        if model_type == "claude":
            async with self.claude_client.messages.stream(
                model=model_name,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system or "",
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield text

        elif model_type == "gemini":
            gemini = GenerativeModel(model_name, system_instruction=system)
            gemini_messages = [
                {"role": "user" if m["role"] == "user" else "model", "parts": [m["content"]]}
                for m in messages
            ]

            response = await gemini.generate_content_async(
                gemini_messages,
                generation_config={
                    "max_output_tokens": max_tokens,
                    "temperature": temperature,
                },
                stream=True,
            )

            async for chunk in response:
                if chunk.text:
                    yield chunk.text
```

### Updated Model Pricing

```python
# services/api/src/cost/realtime_tracker.py
# Update MODEL_PRICING dict

MODEL_PRICING: dict[str, ModelPricing] = {
    # Anthropic (via Vertex AI)
    "claude-opus-4-5@20250514": ModelPricing(
        input_per_million=Decimal("15.00"),
        output_per_million=Decimal("75.00"),
        cached_input_per_million=Decimal("1.50"),
    ),
    "claude-sonnet-4@20250514": ModelPricing(
        input_per_million=Decimal("3.00"),
        output_per_million=Decimal("15.00"),
        cached_input_per_million=Decimal("0.30"),
    ),
    "claude-3-5-sonnet-v2@20241022": ModelPricing(
        input_per_million=Decimal("3.00"),
        output_per_million=Decimal("15.00"),
        cached_input_per_million=Decimal("0.30"),
    ),
    "claude-3-5-haiku@20241022": ModelPricing(
        input_per_million=Decimal("0.80"),
        output_per_million=Decimal("4.00"),
        cached_input_per_million=Decimal("0.08"),
    ),
    # Google Gemini
    "gemini-2.5-pro": ModelPricing(
        input_per_million=Decimal("1.25"),
        output_per_million=Decimal("5.00"),
    ),
    "gemini-2.5-flash": ModelPricing(
        input_per_million=Decimal("0.075"),
        output_per_million=Decimal("0.30"),
    ),
    "gemini-2.0-flash-001": ModelPricing(
        input_per_million=Decimal("0.10"),
        output_per_million=Decimal("0.40"),
    ),
    # Meta Llama (via Vertex AI)
    "llama-4-scout": ModelPricing(
        input_per_million=Decimal("0.20"),
        output_per_million=Decimal("0.60"),
    ),
    "llama-3.1-70b-instruct": ModelPricing(
        input_per_million=Decimal("0.90"),
        output_per_million=Decimal("0.90"),
    ),
}
```

### Seed Data Updates

Update any seed data to use Vertex AI model names instead of Bedrock model IDs.

---

## 7. Local Development

### docker-compose.yml

```yaml
version: '3.8'

services:
  # PostgreSQL (same as production)
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: podex
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: podex
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Redis (same as production e2-micro VM)
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass devpassword
    ports:
      - '6379:6379'

  # Fake GCS for local storage
  gcs:
    image: fsouza/fake-gcs-server:latest
    command: -scheme http -port 4443 -external-url http://localhost:4443
    ports:
      - '4443:4443'
    volumes:
      - gcs_data:/data

  # API service
  api:
    build: ./services/api
    environment:
      DATABASE_URL: postgresql+asyncpg://podex:dev@postgres:5432/podex
      REDIS_URL: redis://:devpassword@redis:6379/0
      STORAGE_EMULATOR_HOST: http://gcs:4443
      GCS_BUCKET: podex-dev
      LLM_PROVIDER: vertex
      GCP_PROJECT_ID: ${GCP_PROJECT_ID}
      GOOGLE_APPLICATION_CREDENTIALS: /app/service-account.json
      EMAIL_BACKEND: console
      ENV: dev
    ports:
      - '3001:3001'
    volumes:
      - ./service-account.json:/app/service-account.json:ro
    depends_on:
      - postgres
      - redis
      - gcs

volumes:
  postgres_data:
  gcs_data:
```

### .env.example

```env
# ===========================================
# GCP Configuration
# ===========================================
GCP_PROJECT_ID=podex-dev
GCP_REGION=us-east1

# For local dev with GCP APIs (Vertex AI)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json

# ===========================================
# Database (Cloud SQL / Local PostgreSQL)
# ===========================================
DATABASE_URL=postgresql+asyncpg://podex:dev@localhost:5432/podex

# ===========================================
# Cache (e2-micro VM Redis / Local Redis)
# ===========================================
REDIS_URL=redis://:devpassword@localhost:6379/0

# ===========================================
# Storage (Cloud Storage / Fake GCS)
# ===========================================
GCS_BUCKET=podex-workspaces-dev
# For local dev:
STORAGE_EMULATOR_HOST=http://localhost:4443

# ===========================================
# LLM Provider (Vertex AI)
# ===========================================
LLM_PROVIDER=vertex
# Available models: claude-sonnet-4, claude-opus-4, gemini-2.5-pro, llama-4-scout

# ===========================================
# Email (Disabled for dev)
# ===========================================
EMAIL_BACKEND=console

# ===========================================
# Environment
# ===========================================
ENV=dev
```

---

## 8. Migration Steps

### Phase 1: Setup (Days 1-2)

```bash
# 1. Create GCP project
gcloud projects create podex-dev --name="Podex Dev"
gcloud config set project podex-dev
gcloud auth application-default login

# 2. Enable APIs
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    compute.googleapis.com \
    container.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    dns.googleapis.com \
    aiplatform.googleapis.com \
    texttospeech.googleapis.com \
    speech.googleapis.com

# 3. Install Pulumi
curl -fsSL https://get.pulumi.com | sh
pip install pulumi pulumi-gcp pulumi-random

# 4. Initialize Pulumi project
mkdir infra-gcp && cd infra-gcp
pulumi new gcp-python --name podex-infra
pulumi stack init dev

# 5. Configure
pulumi config set gcp:project podex-dev
pulumi config set gcp:region us-east1
pulumi config set domain podex.dev
```

### Phase 2: Deploy Infrastructure (Days 3-4)

```bash
# Deploy everything
pulumi up

# Outputs will show:
# - api_url: https://podex-api-dev-xxx-uc.a.run.app
# - web_url: https://podex-web-dev-xxx-uc.a.run.app
# - custom_domain: https://podex.dev
# - redis_ip: 10.x.x.x
# - database_connection: podex-dev:us-east1:podex-db-dev

# Update DNS nameservers at your registrar
# (Pulumi outputs the nameservers)
```

### Phase 3: Code Changes (Days 5-10)

```bash
# 1. Create GCP modules
mkdir -p services/shared/src/podex_shared/gcp
touch services/shared/src/podex_shared/gcp/__init__.py
# Create: storage.py, tts.py, stt.py

# 2. Update dependencies
# Edit all pyproject.toml files

# 3. Update imports
# Find: from podex_shared.aws import
# Replace: from podex_shared.gcp import

# 4. Add Vertex AI provider
# Edit services/agent/src/providers/

# 5. Run tests locally
docker-compose up -d
pytest
```

### Phase 4: Build & Deploy (Days 11-12)

```bash
# Build containers
gcloud builds submit --tag us-east1-docker.pkg.dev/podex-dev/podex-dev/api:latest ./services/api
gcloud builds submit --tag us-east1-docker.pkg.dev/podex-dev/podex-dev/agent:latest ./services/agent
gcloud builds submit --tag us-east1-docker.pkg.dev/podex-dev/podex-dev/compute:latest ./services/compute
gcloud builds submit --tag us-east1-docker.pkg.dev/podex-dev/podex-dev/web:latest ./apps/web

# Update Cloud Run
pulumi up

# Verify
curl https://podex-api-dev-xxx-uc.a.run.app/health
```

### Phase 5: Data Migration (Days 13-14)

```bash
# Export from AWS RDS
pg_dump -h your-aws-rds.amazonaws.com -U podex podex > dump.sql

# Import to Cloud SQL
gcloud sql connect podex-db-dev --user=podex < dump.sql

# Migrate S3 to GCS
gsutil -m cp -r s3://podex-workspaces gs://podex-workspaces-dev-podex-dev/
```

### Phase 6: DNS & Cleanup (Days 15-16)

```bash
# Verify DNS propagation
dig podex.dev

# Test custom domain
curl https://api.podex.dev/health
curl https://podex.dev

# After 2 weeks stable, decommission AWS
cd ../infra  # Old AWS CDK project
cdk destroy --all
```

---

## 9. Cost Analysis

### Dev Environment Monthly Costs

| Service               | Configuration            | Cost          |
| --------------------- | ------------------------ | ------------- |
| **Cloud SQL**         | db-f1-micro, 10GB        | **~$9**       |
| **Redis VM**          | e2-micro (free tier)     | **$0**        |
| **Cloud Run**         | Scale to zero, free tier | **$0**        |
| **Cloud Storage**     | 5GB free                 | **$0**        |
| **Secret Manager**    | 6 versions free          | **$0**        |
| **Artifact Registry** | ~500MB images            | **~$0.50**    |
| **Cloud DNS**         | 1 zone                   | **~$0.20**    |
| **GKE Cluster**       | Zonal, no nodes running  | **$0** \*     |
| **Vertex AI**         | Pay-per-use only         | **Variable**  |
| **TOTAL (fixed)**     |                          | **~$9.70/mo** |

\* GKE has a ~$74/mo management fee for regional clusters, but zonal clusters with no nodes are effectively free.

### Comparison with AWS

|               | AWS Dev            | GCP Dev             | Savings            |
| ------------- | ------------------ | ------------------- | ------------------ |
| Compute       | ~$50 (Fargate)     | $0 (Cloud Run free) | $50                |
| Database      | ~$13 (RDS micro)   | ~$9 (Cloud SQL)     | $4                 |
| Redis         | ~$12 (ElastiCache) | $0 (free VM)        | $12                |
| Load Balancer | ~$20 (ALB)         | $0 (built-in)       | $20                |
| NAT Gateway   | ~$35               | $0 (not needed)     | $35                |
| Storage       | ~$1                | $0                  | $1                 |
| DNS           | ~$0.50             | ~$0.20              | $0.30              |
| **TOTAL**     | **~$131.50/mo**    | **~$9.70/mo**       | **~$122/mo (93%)** |

---

## Summary

### What You Get

- ✅ **~$9.70/month** dev environment (vs ~$131 on AWS)
- ✅ **Cloud Run** with scale-to-zero (FREE tier covers dev)
- ✅ **Cloud SQL** db-f1-micro for PostgreSQL
- ✅ **Free Redis** on e2-micro VM (always free)
- ✅ **Vertex AI** for Claude, Gemini, and Llama models
- ✅ **GKE cluster** ready for GPU workspaces (scaled to 0)
- ✅ **Custom domain** with managed SSL
- ✅ **Pulumi** infrastructure (similar to your CDK experience)

### What's Different

- ❌ No ARM + GPU instances (g5g equivalent doesn't exist)
- ❌ No AWS Inferentia/Trainium (use TPUs or A100s instead)
- ❌ No native email service (disabled for now)
- ⚠️ Redis on VM instead of managed service (but free!)

### Next Steps

1. Review this plan
2. Create GCP project and enable APIs
3. Set up Pulumi and deploy infrastructure
4. Begin code changes (storage, LLM provider)
5. Test locally with docker-compose
6. Deploy and migrate data
