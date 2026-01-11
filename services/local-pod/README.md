# Podex Local Pod

Self-hosted compute agent for Podex. Run workspaces on your own machine for faster local development, full GPU access, and keeping code on-premises.

## Quick Start

### 1. Get Your Token

1. Go to **Settings > Local Pods** in Podex
2. Click **Add Pod** and give it a name
3. Copy the token (shown only once!)

### 2. Install

```bash
# Using pip
pip install podex-local-pod

# Or using pipx (recommended)
pipx install podex-local-pod
```

### 3. Run

```bash
# Start the agent
podex-local-pod start --token pdx_pod_xxx

# Or use environment variable
export PODEX_POD_TOKEN=pdx_pod_xxx
podex-local-pod start
```

## Docker Installation

```bash
docker run -d \
  --name podex-local-pod \
  -e PODEX_POD_TOKEN=pdx_pod_xxx \
  -v /var/run/docker.sock:/var/run/docker.sock \
  podex/local-pod:latest
```

## Commands

```bash
# Start the agent
podex-local-pod start [OPTIONS]

# Check system requirements
podex-local-pod check

# Show version
podex-local-pod version
```

### Start Options

| Option             | Environment Variable   | Description                                      |
| ------------------ | ---------------------- | ------------------------------------------------ |
| `--token`          | `PODEX_POD_TOKEN`      | Pod authentication token (required)              |
| `--url`            | `PODEX_CLOUD_URL`      | Podex cloud URL (default: https://api.podex.dev) |
| `--name`           | `PODEX_POD_NAME`       | Display name for this pod                        |
| `--max-workspaces` | `PODEX_MAX_WORKSPACES` | Maximum concurrent workspaces (1-10, default: 3) |
| `--config`         | -                      | Path to config file                              |

## Configuration File

You can use a TOML config file instead of command-line options:

```toml
# ~/.config/podex/local-pod.toml
[podex]
pod_token = "pdx_pod_xxx"
cloud_url = "https://api.podex.dev"
pod_name = "my-dev-machine"
max_workspaces = 3
docker_network = "podex-local"
heartbeat_interval = 30
```

Then run:

```bash
podex-local-pod start --config ~/.config/podex/local-pod.toml
```

## Requirements

- Docker (with access to `/var/run/docker.sock`)
- Python 3.11+
- 4GB+ RAM recommended
- 2+ CPU cores recommended

## How It Works

1. **Registration**: You register a local pod in Podex Settings and receive a token
2. **Connection**: The agent connects to Podex cloud via WebSocket (outbound connection)
3. **Commands**: When you create a workspace targeting your local pod, Podex sends commands through the WebSocket
4. **Workspaces**: The agent manages Docker containers on your machine for each workspace
5. **Communication**: File operations, terminal, and port forwarding all work through the connection

## Security

- **Outbound only**: The agent initiates the connection - no inbound ports needed
- **Token auth**: Tokens are hashed and verified on each connection
- **User isolation**: Each pod only sees workspaces for its owner
- **Container isolation**: Workspaces run in isolated Docker containers

## Troubleshooting

### Check Requirements

```bash
podex-local-pod check
```

This verifies Docker is available and shows system resources.

### Common Issues

**Connection refused**

- Check your internet connection
- Verify the token is correct
- Check if a firewall is blocking outbound WebSocket connections

**Docker permission denied**

- Add your user to the docker group: `sudo usermod -aG docker $USER`
- Or run with sudo (not recommended for production)

**Image not found**

- Pull the workspace image: `docker pull podex/workspace:latest`

## Development

```bash
# Clone the repo
git clone https://github.com/podex/podex
cd podex/services/local-pod

# Install dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run linting
ruff check .
mypy .
```

## License

MIT License - see [LICENSE](../../LICENSE) for details.
