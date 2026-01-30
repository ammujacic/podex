# Base Python image
FROM python:3.12-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

# Development stage
FROM base AS development

# Copy shared package first
COPY services/shared/pyproject.toml services/shared/README.md ./services/shared/
COPY services/shared/src ./services/shared/src

# Copy agent package
COPY services/agent/pyproject.toml services/agent/README.md ./services/agent/

WORKDIR /app/services/agent

# Install dependencies including dev deps
# Install shared package and its dependencies first
RUN cd ../shared && uv pip install --system . && \
    cd /app/services/agent && \
    uv pip install --system -e ".[dev]" && \
    uv pip install --system -e "../shared"

# Copy source code
COPY services/agent/src ./src

# Run with hot reload
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3002", "--reload"]

# Production stage
FROM base AS production

# Copy shared package first
COPY services/shared/pyproject.toml services/shared/README.md ./services/shared/
COPY services/shared/src ./services/shared/src

# Copy agent package
COPY services/agent/pyproject.toml services/agent/README.md ./services/agent/

WORKDIR /app/services/agent

# Install only production dependencies
# Install shared package and its dependencies first
RUN cd ../shared && uv pip install --system . && \
    cd /app/services/agent && \
    uv pip install --system -e . && \
    uv pip install --system -e "../shared"

# Copy source code
COPY services/agent/src ./src

# Create non-root user
RUN adduser --disabled-password --gecos "" appuser
USER appuser

# Health check (start-period allows time for app initialization)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

# Run with gunicorn
CMD ["gunicorn", "src.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:3002", "--workers", "2", "--threads", "4"]
