# Base Python image
FROM python:3.12-slim AS base

WORKDIR /app

# Install system dependencies including Node.js for MCP servers
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    espeak-ng \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management
RUN pip install uv

# Development stage
FROM base AS development

# Copy shared package first
COPY services/shared/pyproject.toml services/shared/README.md ./services/shared/
COPY services/shared/src ./services/shared/src

# Copy API package
COPY services/api/pyproject.toml services/api/README.md ./services/api/

WORKDIR /app/services/api

# Install dependencies including dev deps
# Install shared package and its dependencies first
RUN cd ../shared && uv pip install --system . && \
    cd /app/services/api && \
    uv pip install --system -e ".[dev]" && \
    uv pip install --system -e "../shared"

# Copy source code and migrations
COPY services/api/src ./src
COPY services/api/alembic.ini ./
COPY services/api/migrations ./migrations

# Start with hot reload (migrations controlled by RUN_MIGRATIONS env var in app)
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then alembic upgrade head; fi && uvicorn src.main:socket_app --host 0.0.0.0 --port 3001 --reload"]

# Production stage
FROM base AS production

# Copy shared package first
COPY services/shared/pyproject.toml services/shared/README.md ./services/shared/
COPY services/shared/src ./services/shared/src

# Copy API package
COPY services/api/pyproject.toml services/api/README.md ./services/api/

WORKDIR /app/services/api

# Install only production dependencies
# Install shared package and its dependencies first
RUN cd ../shared && uv pip install --system . && \
    cd /app/services/api && \
    uv pip install --system -e . && \
    uv pip install --system -e "../shared"

# Copy source code and migrations
COPY services/api/src ./src
COPY services/api/alembic.ini ./
COPY services/api/migrations ./migrations

# Create non-root user
RUN adduser --disabled-password --gecos "" appuser
USER appuser

# Prometheus metrics labels (for Docker service discovery)
LABEL prometheus.scrape="true"
LABEL prometheus.port="3001"
LABEL prometheus.path="/metrics"

# Health check (start-period allows time for migrations and app initialization)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start with gunicorn (migrations controlled by RUN_MIGRATIONS env var in app)
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then alembic upgrade head; fi && gunicorn src.main:socket_app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:3001 --workers 4 --threads 4"]
