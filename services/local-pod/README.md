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
pip install podex-pod

# Or using pipx (recommended)
pipx install podex-pod
```

### 3. Run

```bash
# Start the agent
podex-pod start --token pdx_pod_xxx

# Or use environment variable
export PODEX_POD_TOKEN=pdx_pod_xxx
podex-pod start
```

## Docker Installation (Optional)

You can run the pod agent itself inside Docker:

```bash
docker run -d \
  --name podex-pod \
  -e PODEX_POD_TOKEN=pdx_pod_xxx \
  podex/local-pod:latest
```

## Commands

```bash
# Start the agent
podex-pod start [OPTIONS]

# Check system requirements
podex-pod check

# Show version
podex-pod version
```

### Start Options

| Option    | Environment Variable | Description                                      |
| --------- | -------------------- | ------------------------------------------------ |
| `--token` | `PODEX_POD_TOKEN`    | Pod authentication token (required)              |
| `--url`   | `PODEX_CLOUD_URL`    | Podex cloud URL (default: https://api.podex.dev) |
| `--name`  | `PODEX_POD_NAME`     | Display name for this pod                        |

## Configuration File

Create a `.env` file to save your configuration:

```bash
# ~/.config/podex/.env
PODEX_POD_TOKEN=pdx_pod_xxx
PODEX_POD_NAME=my-dev-machine
PODEX_CLOUD_URL=https://api.podex.dev
```

Then run from that directory:

```bash
cd ~/.config/podex && podex-pod start
```

Or copy the `.env` file to your current working directory.

## Requirements

- Python 3.11+
- tmux (required for terminal features)
- 4GB+ RAM recommended
- 2+ CPU cores recommended

## How It Works

1. **Registration**: You register a local pod in Podex Settings and receive a token
2. **Connection**: The agent connects to Podex cloud via WebSocket (outbound connection)
3. **Commands**: When you create a workspace targeting your local pod, Podex sends commands through the WebSocket
4. **Execution**: The agent executes commands natively on your machine using tmux for terminal sessions
5. **Communication**: File operations, terminal, and port forwarding all work through the connection

## Security

- **Outbound only**: The agent initiates the connection - no inbound ports needed
- **Token auth**: Tokens are hashed and verified on each connection
- **User isolation**: Each pod only sees workspaces for its owner
- **Native execution**: Commands run directly on your machine with your user permissions

## Troubleshooting

### Check Requirements

```bash
podex-pod check
```

This verifies tmux is available and shows system resources.

### Common Issues

**Connection refused**

- Check your internet connection
- Verify the token is correct
- Check if a firewall is blocking outbound WebSocket connections

**tmux not found**

- Install tmux: `brew install tmux` (macOS) or `apt install tmux` (Linux)
- tmux is required for terminal features to work properly

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
