# Base Python image
FROM python:3.12-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
RUN pip install uv

# Development stage
FROM base AS development

# Copy local-pod package
COPY services/local-pod/pyproject.toml services/local-pod/README.md ./services/local-pod/

WORKDIR /app/services/local-pod

# Install dependencies including dev deps
RUN uv pip install --system -e ".[dev]"

# Copy source code
COPY services/local-pod/src ./src
COPY services/local-pod/tests ./tests

# Default command for tests
CMD ["pytest", "tests/", "-v", "--cov=src", "--cov-report=term-missing"]

# Production stage
FROM base AS production

# Copy local-pod package
COPY services/local-pod/pyproject.toml services/local-pod/README.md ./services/local-pod/

WORKDIR /app/services/local-pod

# Install only production dependencies
RUN uv pip install --system .

# Copy source code
COPY services/local-pod/src ./src

# Create non-root user
RUN adduser --disabled-password --gecos "" appuser
USER appuser

# Default command runs the CLI
CMD ["podex-local-pod", "--help"]
