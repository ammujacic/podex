# Podex

AI-powered development workspace platform.

## Prerequisites

Before you begin, ensure you have the following installed:

| Dependency         | Version | Installation                                                              |
| ------------------ | ------- | ------------------------------------------------------------------------- |
| **Docker**         | Latest  | [docker.com/get-docker](https://www.docker.com/get-docker)                |
| **Docker Compose** | v2+     | Included with Docker Desktop                                              |
| **Node.js**        | 20+     | [nodejs.org](https://nodejs.org) or `brew install node`                   |
| **pnpm**           | 8+      | `npm install -g pnpm`                                                     |
| **Python**         | 3.11+   | [python.org](https://www.python.org) or `brew install python@3.11`        |
| **uv**             | Latest  | `curl -LsSf https://astral.sh/uv/install.sh \| sh`                        |
| **Ollama**         | Latest  | [ollama.ai/download](https://ollama.ai/download) or `brew install ollama` |

### Ollama Setup

Ollama is **required** for local development. The `make run` command will automatically offer to install Ollama and pull a model if not present.

To set up manually:

```bash
# Install via Homebrew (macOS)
brew install ollama

# Start Ollama
ollama serve

# Pull the recommended coding model
ollama pull qwen2.5-coder:14b
```

## Quick Start

```bash
# 1. Build everything (install deps + build Docker images)
make build

# 2. Start development environment
make run
```

## Make Commands

| Command      | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `make build` | Install all dependencies (npm, Python) and build Docker images |
| `make test`  | Run all tests with coverage (frontend + all Python services)   |
| `make check` | Run pre-commit hooks (auto-installs hooks if needed)           |
| `make run`   | Start local development (auto-installs Ollama if needed)       |
| `make stop`  | Stop running services                                          |
| `make logs`  | Watch logs from all services                                   |
| `make clean` | Stop all services, remove volumes, kill all workspaces         |
| `make help`  | Show available commands                                        |

## Project Structure

```
podex/
├── apps/
│   └── web/              # Next.js frontend
├── services/
│   ├── api/              # FastAPI backend
│   ├── agent/            # AI agent service
│   ├── compute/          # Compute/workspace manager
│   └── shared/           # Shared Python library
├── packages/             # Shared TypeScript packages
├── infra/                # CDK infrastructure
└── docker-compose.yml    # Local development stack
```

## Development URLs

After running `make run`:

- **Web**: http://localhost:3000
- **API**: http://localhost:3001
- **Ollama**: http://localhost:11434

## Environment Variables

Copy `.env.example` to `.env` and configure as needed:

```bash
cp .env.example .env
```

## License

MIT - see `LICENSE`.
