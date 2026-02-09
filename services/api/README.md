# Podex API Gateway

FastAPI-based API gateway for the Podex web-based agentic IDE platform.

## Features

- RESTful API endpoints for authentication, sessions, agents, and workspaces
- Real-time WebSocket communication via Socket.IO
- PostgreSQL database with async SQLAlchemy
- JWT-based authentication with OAuth support
- Rate limiting and security middleware

## Development

```bash
# Install dependencies
uv sync

# Run development server
uv run uvicorn src.main:socket_app --reload --host 0.0.0.0 --port 8000

# Run linting
uv run ruff check src/
uv run ruff format src/

# Run type checking
uv run mypy src/

# Run tests
uv run pytest
```

## Configuration

Configuration is handled via environment variables. See `src/config.py` for available options.
