# Base Python image
FROM python:3.12-slim AS base

WORKDIR /app

# Install system dependencies including Docker CLI for container management
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
RUN pip install uv

# Development stage
FROM base AS development

# Copy shared package first
COPY services/shared/pyproject.toml services/shared/README.md ./services/shared/
COPY services/shared/src ./services/shared/src

# Copy compute package
COPY services/compute/pyproject.toml services/compute/README.md ./services/compute/

WORKDIR /app/services/compute

# Install dependencies including dev deps
# Install shared package and its dependencies first
RUN cd ../shared && uv pip install --system . && \
    cd /app/services/compute && \
    uv pip install --system -e ".[dev]" && \
    uv pip install --system -e "../shared"

# Copy source code
COPY services/compute/src ./src

# Run with hot reload
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3003", "--reload"]

# Production stage
FROM base AS production

# Copy shared package first
COPY services/shared/pyproject.toml services/shared/README.md ./services/shared/
COPY services/shared/src ./services/shared/src

# Copy compute package
COPY services/compute/pyproject.toml services/compute/README.md ./services/compute/

WORKDIR /app/services/compute

# Install only production dependencies
# Install shared package and its dependencies first
RUN cd ../shared && uv pip install --system . && \
    cd /app/services/compute && \
    uv pip install --system -e . && \
    uv pip install --system -e "../shared"

# Copy source code
COPY services/compute/src ./src

# Create non-root user (note: needs docker group access in production)
RUN adduser --disabled-password --gecos "" appuser
USER appuser

# Health check (start-period allows time for app initialization)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3003/health || exit 1

# Run with gunicorn
CMD ["gunicorn", "src.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:3003", "--workers", "4", "--threads", "4"]
