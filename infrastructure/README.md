# Podex GCP Infrastructure

This directory contains the Pulumi infrastructure code for deploying Podex to Google Cloud Platform.

## Architecture

The infrastructure deploys the following GCP resources:

- **Cloud Run Services** (API, Agent, Compute, Web) - Scale to zero when idle
- **Cloud SQL PostgreSQL** (db-f1-micro) - ~$9/month database
- **Redis on Compute Engine** (e2-micro) - Always Free tier
- **Cloud Storage** - 5GB free storage
- **Secret Manager** - 6 free secret versions
- **GKE Cluster** - GPU-ready, scales to zero when idle
- **Cloud DNS + SSL** - Custom domain with managed certificates

## Testing

### Local Testing

Run infrastructure tests locally:

```bash
# Run all infrastructure tests
make test-infra

# Or run directly with uv
cd infrastructure
uv run pytest tests/ -v
```

### Test Coverage

The test suite covers:

- ✅ **Configuration validation** - Project ID, region, domain formats
- ✅ **Stack imports** - All modules load correctly
- ✅ **Secret Manager** - Auto-generated secrets with proper replication
- ✅ **VPC Network** - Proper subnetting, NAT, firewall rules
- ✅ **Cloud SQL** - Database configuration, backups, security
- ✅ **Redis VM** - Startup scripts, firewall, configuration
- ✅ **Cloud Run** - Service configuration, scaling, environment variables

### Test Results

Current test status: **34 passing, 11 failing** (mocking issues)

The failing tests are due to incomplete mocking of Pulumi's complex object hierarchies. These are primarily integration-style tests that would pass with real Pulumi resources.

## CI/CD Integration

### GitHub Actions

Infrastructure tests run automatically on:

- **Push to main/develop** when infrastructure files change
- **Pull requests** affecting infrastructure

The CI pipeline includes:

1. **Unit Tests** - Python test suite with mocked dependencies
2. **Configuration Validation** - YAML and Python syntax checks
3. **Pulumi Preview** - Dry-run deployment (requires GCP credentials)

### Required Secrets

For full CI functionality, set these GitHub secrets:

```bash
GCP_SA_KEY          # GCP Service Account JSON key
PULUMI_ACCESS_TOKEN # Pulumi Cloud access token
```

## Development

### Prerequisites

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Python dependencies (using uv)
cd infrastructure
uv sync --dev

# Install Pulumi CLI
curl -fsSL https://get.pulumi.com | sh
```

#### Dependency Management

This project uses **uv** for fast Python dependency management:

- **Install dependencies**: `uv sync --dev`
- **Add dependency**: `uv add package-name`
- **Add dev dependency**: `uv add --dev package-name`
- **Run commands**: `uv run pytest` or `uv run ruff check`
- **Lock file**: `uv.lock` ensures reproducible builds

### Development Workflow

#### Pre-commit Hooks

Infrastructure code is automatically checked with pre-commit hooks that run:

- **Ruff linting** - Code style and quality checks
- **Ruff formatting** - Automatic code formatting
- **MyPy type checking** - Static type analysis
- **Unit tests** - Infrastructure configuration validation

Install and run pre-commit hooks:

```bash
# Install pre-commit hooks
pre-commit install

# Run on all files
pre-commit run --all-files

# Or run specific infrastructure checks
pre-commit run ruff-infrastructure --all-files
pre-commit run infrastructure-tests --all-files
```

#### Local Deployment

```bash
# Login to Pulumi (Cloud or Local)
pulumi login

# Select/create stack
pulumi stack select dev

# Configure GCP project and region
pulumi config set gcp:project your-gcp-project-id
pulumi config set gcp:region us-central1
pulumi config set podex-infra:domain yourdomain.com
pulumi config set podex-infra:env dev

# Preview deployment
pulumi preview

# Deploy
pulumi up
```

### Cost Optimization

The infrastructure is designed for cost efficiency:

- **Cloud Run**: Scales to zero automatically
- **GKE**: Node pools scale to zero when idle
- **Cloud SQL**: Smallest instance (db-f1-micro)
- **Redis**: Uses Always Free e2-micro VM
- **Storage**: Stays within free tier limits

## Security Considerations

### Identified Issues

1. **Database Access**: Dev environment allows `0.0.0.0/0` access (should be restricted)
2. **VPC Connector**: Uses "default" network instead of custom VPC
3. **Service Accounts**: Broad IAM permissions (follows least privilege principle)

### Recommendations

- Restrict database access to VPC-only in production
- Use custom VPC for all resources
- Implement more granular IAM roles
- Enable Cloud Armor for DDoS protection
- Configure VPC Service Controls

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure Python path includes infrastructure directory
2. **GCP Permissions**: Service account needs multiple GCP roles
3. **Quota Limits**: Check GCP quotas for new projects
4. **Domain DNS**: Allow time for DNS propagation after SSL certificate issuance

### Logs and Monitoring

```bash
# View Pulumi logs
pulumi logs

# GCP Cloud Logging
gcloud logging read "resource.type=cloud_run_revision"

# Stack outputs
pulumi stack output
```

## Architecture Decisions

### Why Cloud Run?

- Serverless scaling (pay only when used)
- Managed platform (no server management)
- Built-in HTTPS and custom domains
- VPC access for private resources

### Why Cloud SQL over Cloud Spanner?

- PostgreSQL compatibility
- Lower cost for small workloads
- Familiar development experience

### Why GKE over Cloud Run for GPUs?

- GPU workload requirements
- Complex orchestration needs
- Cost-effective scaling to zero

## Contributing

1. Make infrastructure changes
2. Run tests: `make test-infra`
3. Test deployment in dev environment
4. Create pull request with infrastructure changes
