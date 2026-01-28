#!/usr/bin/env python3
"""Podex Local Pod - CLI entry point."""

import asyncio
import logging
import os
import signal
import socket
import sys
from pathlib import Path

import click
import sentry_sdk
import structlog
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from . import __version__
from .client import LocalPodClient
from .config import load_config
from .config_manager import ConfigManager


def _init_sentry() -> bool:
    """Initialize Sentry for error tracking in local pod."""
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return False

    environment = os.environ.get("ENVIRONMENT", "development")

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=f"podex-local-pod@{__version__}",
        traces_sample_rate=1.0 if environment == "development" else 0.2,
        profiles_sample_rate=1.0 if environment == "development" else 0.1,
        integrations=[
            AsyncioIntegration(),
            HttpxIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        send_default_pii=False,
        attach_stacktrace=True,
        max_breadcrumbs=50,
        server_name="podex-local-pod",
        ignore_errors=[
            "ConnectionRefusedError",
            "ConnectionResetError",
            "TimeoutError",
            "asyncio.CancelledError",
            "KeyboardInterrupt",
            "SystemExit",
        ],
    )

    sentry_sdk.set_tag("service", "podex-local-pod")
    return True


# Initialize Sentry at module load time
_sentry_enabled = _init_sentry()

# Configure structlog
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.dev.ConsoleRenderer(colors=True),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@click.group()
@click.version_option(version=__version__, prog_name="podex-local-pod")
def cli() -> None:
    """Podex Local Pod - Self-hosted compute agent for Podex.

    Run workspaces on your own machine for faster local development,
    full GPU access, and keeping code on-premises.
    """
    pass


@cli.command()
@click.option(
    "--token",
    envvar="PODEX_POD_TOKEN",
    help="Pod authentication token from Podex",
)
@click.option(
    "--url",
    envvar="PODEX_CLOUD_URL",
    default=None,
    help="Podex cloud API URL (overrides config file)",
)
@click.option(
    "--name",
    envvar="PODEX_POD_NAME",
    default=None,
    help="Display name for this pod (overrides config file)",
)
@click.option(
    "--config",
    "config_file",
    type=click.Path(exists=True, path_type=Path),
    help="Path to config file",
)
def start(
    token: str | None,
    url: str | None,
    name: str | None,
    config_file: Path | None,
) -> None:
    """Start the Podex local pod agent.

    Connects to Podex cloud and waits for workspace commands.
    The pod will automatically reconnect if the connection is lost.

    Configuration is loaded from (in priority order):
    1. Command line arguments
    2. Environment variables (PODEX_*)
    3. Config file (~/.config/podex/local-pod.toml or --config)
    """
    # Always load from config file first (uses default location if not specified)
    config = load_config(config_file)

    # Override with CLI arguments if explicitly provided
    if token:
        config = config.model_copy(update={"pod_token": token})
    if url:
        config = config.model_copy(update={"cloud_url": url})
    if name:
        config = config.model_copy(update={"pod_name": name})

    # Use hostname if pod_name still not set
    if not config.pod_name:
        config = config.model_copy(update={"pod_name": socket.gethostname()})

    if not config.pod_token:
        click.echo(
            click.style("Error: ", fg="red", bold=True) + "Pod token is required.\n\n"
            "Get your token from Podex:\n"
            "  1. Go to Settings > Local Pods\n"
            "  2. Click 'Add Pod' and copy the token\n\n"
            "Then run:\n"
            "  podex-local-pod start --token pdx_pod_xxx\n\n"
            "Or set the PODEX_POD_TOKEN environment variable.",
            err=True,
        )
        sys.exit(1)

    click.echo(
        click.style("Podex Local Pod ", fg="cyan", bold=True)
        + click.style(f"v{__version__}", fg="cyan")
    )
    click.echo(f"  Name: {config.pod_name}")
    click.echo(f"  Cloud: {config.cloud_url}")
    click.echo(f"  Mode: {config.mode}")

    # Check tmux availability for native mode (required for terminal features)
    if config.is_native_mode():
        import shutil

        if not shutil.which("tmux"):
            click.echo()
            click.echo(
                click.style("Warning: ", fg="yellow", bold=True)
                + "tmux is not installed. Terminal features will not work properly without tmux.\n"
                "Install it with: brew install tmux (macOS) or apt install tmux (Linux)"
            )

    click.echo()

    # Create client
    client = LocalPodClient(config)

    # Set up event loop with signal handlers
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Handle shutdown signals gracefully
    shutdown_event = asyncio.Event()

    def signal_handler() -> None:
        click.echo("\nShutting down...")
        shutdown_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, signal_handler)

    try:
        loop.run_until_complete(client.run(shutdown_event))
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(client.shutdown())
        # Flush Sentry events before shutdown
        if _sentry_enabled:
            sentry_sdk.flush(timeout=2.0)
        loop.close()

    click.echo("Pod stopped.")


@cli.command()
def check() -> None:
    """Check system requirements for running a local pod.

    Verifies Docker is available and shows system resources.
    """
    import platform

    click.echo(click.style("System Check", fg="cyan", bold=True))
    click.echo()

    all_ok = True

    # Check Docker
    try:
        import docker

        client = docker.from_env()
        info = client.info()
        click.echo(
            click.style("  Docker: ", bold=True)
            + click.style("OK", fg="green")
            + f" (v{info['ServerVersion']})"
        )
    except Exception as e:
        click.echo(
            click.style("  Docker: ", bold=True) + click.style("FAILED", fg="red") + f" ({e})"
        )
        all_ok = False

    # Check resources
    try:
        import psutil

        mem = psutil.virtual_memory()
        mem_gb = mem.total / (1024**3)
        cpu_count = psutil.cpu_count()

        click.echo(click.style("  Memory: ", bold=True) + f"{mem_gb:.1f} GB")
        click.echo(click.style("  CPU cores: ", bold=True) + f"{cpu_count}")
    except Exception as e:
        click.echo(click.style("  Resources: ", bold=True) + f"Error: {e}")
        all_ok = False

    # Check tmux (required for terminal agent integration)
    import shutil

    tmux_path = shutil.which("tmux")
    if tmux_path:
        import subprocess

        try:
            result = subprocess.run(["tmux", "-V"], capture_output=True, text=True, timeout=5)
            version = result.stdout.strip() if result.returncode == 0 else "unknown"
            click.echo(
                click.style("  tmux: ", bold=True) + click.style("OK", fg="green") + f" ({version})"
            )
        except Exception:
            click.echo(
                click.style("  tmux: ", bold=True)
                + click.style("OK", fg="green")
                + f" (found at {tmux_path})"
            )
    else:
        click.echo(
            click.style("  tmux: ", bold=True)
            + click.style("NOT FOUND", fg="yellow")
            + " (optional, required for terminal agents)"
        )

    # Platform info
    click.echo(click.style("  Platform: ", bold=True) + f"{platform.system()} {platform.release()}")
    click.echo(click.style("  Architecture: ", bold=True) + platform.machine())
    click.echo()

    if all_ok:
        click.echo(click.style("All checks passed!", fg="green", bold=True))
    else:
        click.echo(click.style("Some checks failed.", fg="red", bold=True))
        sys.exit(1)


@cli.command()
def version() -> None:
    """Show version information."""
    click.echo(f"podex-local-pod v{__version__}")


# =============================================================================
# CONFIG COMMANDS
# =============================================================================


@cli.group()
def config() -> None:
    """Manage local pod configuration."""
    pass


@config.command("show")
def config_show() -> None:
    """Display current configuration."""
    manager = ConfigManager()

    if not manager.exists():
        click.echo(click.style("No configuration file found.", fg="yellow"))
        click.echo(f"Expected location: {manager.config_path}")
        click.echo("\nRun 'podex-local-pod config init' to create one.")
        return

    cfg = manager.load()

    click.echo(click.style("Configuration", fg="cyan", bold=True))
    click.echo(f"  File: {manager.config_path}")
    click.echo()

    # Podex section
    click.echo(click.style("[podex]", fg="green"))
    podex = cfg.get("podex", {})
    token = podex.get("pod_token", "")
    token_display = f"{token[:12]}..." if len(token) > 12 else token or "(not set)"
    click.echo(f"  pod_token = {token_display}")
    click.echo(f"  cloud_url = {podex.get('cloud_url', '')}")
    click.echo(f"  pod_name = {podex.get('pod_name') or '(auto)'}")
    click.echo(f"  mode = {podex.get('mode', 'docker')}")
    click.echo()

    # Native section
    click.echo(click.style("[native]", fg="green"))
    native = cfg.get("native", {})
    click.echo(f"  workspace_dir = {native.get('workspace_dir', '')}")
    click.echo(f"  security = {native.get('security', 'allowlist')}")
    click.echo()

    # Mounts
    mounts = cfg.get("mounts", [])
    if mounts:
        click.echo(click.style("[[mounts]]", fg="green"))
        for mount in mounts:
            mode_color = "green" if mount.get("mode") == "rw" else "yellow"
            click.echo(
                f"  {mount.get('label', mount['path'])}: "
                f"{mount['path']} "
                f"[{click.style(mount.get('mode', 'rw'), fg=mode_color)}]"
            )
    else:
        click.echo(click.style("No mounts configured.", fg="yellow"))
        click.echo("  Run 'podex-local-pod mounts add <path>' to add allowed paths.")


@config.command("init")
@click.option("--token", help="Pod authentication token from Podex")
@click.option(
    "--mode",
    type=click.Choice(["docker", "native"]),
    help="Execution mode: docker (containers) or native (direct)",
)
@click.option(
    "--security",
    type=click.Choice(["allowlist", "unrestricted"]),
    help="Native mode security: allowlist or unrestricted",
)
@click.option("--workspace-dir", help="Directory for native mode workspaces")
@click.option("--name", help="Display name for this pod")
@click.option(
    "--mount",
    "mounts",
    multiple=True,
    help="Mount path in format 'path:mode:label' (can be repeated)",
)
@click.option("-y", "--yes", is_flag=True, help="Overwrite existing config without prompting")
def config_init(
    token: str | None,
    mode: str | None,
    security: str | None,
    workspace_dir: str | None,
    name: str | None,
    mounts: tuple[str, ...],
    yes: bool,
) -> None:
    """Initialize configuration.

    Can be run interactively (no flags) or non-interactively with flags.

    Examples:

      # Interactive setup
      podex-local-pod config init

      # Non-interactive Docker mode
      podex-local-pod config init --token pdx_pod_xxx --mode docker

      # Non-interactive Native mode with mounts
      podex-local-pod config init --token pdx_pod_xxx --mode native \\
        --security allowlist --workspace-dir ~/workspaces \\
        --mount "/path/to/project:rw:My Project"
    """
    manager = ConfigManager()

    # Check if any flags provided - determines interactive vs non-interactive
    has_flags = any([token, mode, security, workspace_dir, name, mounts])

    # Check if config exists
    if manager.exists():
        if has_flags and not yes:
            click.echo(
                click.style("Warning: ", fg="yellow")
                + f"Config exists at {manager.config_path}. Use -y to overwrite."
            )
            sys.exit(1)
        elif not has_flags and not click.confirm(
            "Configuration already exists. Overwrite?", default=False
        ):
            click.echo("Setup cancelled.")
            return

    # Non-interactive mode: use provided flags with defaults
    if has_flags:
        final_token = token or ""
        final_mode = mode or "docker"
        final_security = security or "allowlist"
        final_workspace_dir = workspace_dir or str(Path.home() / "podex-workspaces")
        final_name = name or socket.gethostname()

        # Parse mounts
        final_mounts = []
        for mount_str in mounts:
            parts = mount_str.split(":")
            if len(parts) >= 1:
                mount_path = parts[0]
                mount_mode = parts[1] if len(parts) > 1 else "rw"
                mount_label = parts[2] if len(parts) > 2 else Path(mount_path).name
                # Resolve path
                resolved = str(Path(mount_path).expanduser().resolve())
                final_mounts.append(
                    {
                        "path": resolved,
                        "mode": mount_mode,
                        "label": mount_label,
                    }
                )

        # Build config
        cfg = {
            "podex": {
                "pod_token": final_token,
                "cloud_url": "https://api.podex.dev",
                "pod_name": final_name,
                "mode": final_mode,
            },
            "native": {
                "workspace_dir": final_workspace_dir,
                "security": final_security,
            },
            "mounts": final_mounts,
        }

        manager.save(cfg)

        click.echo(click.style("Configuration saved!", fg="green", bold=True))
        click.echo(f"  File: {manager.config_path}")
        click.echo(f"  Mode: {final_mode}")
        if final_mounts:
            click.echo(f"  Mounts: {len(final_mounts)} configured")
        click.echo()
        click.echo("Start the pod with: podex-local-pod start")
        return

    # Interactive mode: prompt for each value
    click.echo(click.style("Podex Local Pod Setup", fg="cyan", bold=True))
    click.echo()

    # Token
    click.echo(click.style("Step 1: Pod Token", fg="green", bold=True))
    click.echo("Get your token from Podex: Settings > Local Pods > Add Pod")
    final_token = click.prompt("Pod token", default="", show_default=False)

    # Mode
    click.echo()
    click.echo(click.style("Step 2: Execution Mode", fg="green", bold=True))
    click.echo("  docker - Run workspaces in isolated containers (recommended)")
    click.echo("  native - Run workspaces directly on your machine")
    final_mode = click.prompt(
        "Mode",
        type=click.Choice(["docker", "native"]),
        default="docker",
    )

    # Native settings
    final_workspace_dir = str(Path.home() / "podex-workspaces")
    final_security = "allowlist"
    if final_mode == "native":
        click.echo()
        click.echo(click.style("Step 3: Native Mode Settings", fg="green", bold=True))
        final_workspace_dir = click.prompt(
            "Workspace directory",
            default=final_workspace_dir,
        )
        click.echo("  allowlist - Only allow access to configured mount paths")
        click.echo("  unrestricted - Full filesystem access (use with caution)")
        final_security = click.prompt(
            "Security mode",
            type=click.Choice(["allowlist", "unrestricted"]),
            default="allowlist",
        )

    # Pod name
    click.echo()
    click.echo(click.style("Step 4: Pod Identity", fg="green", bold=True))
    default_name = socket.gethostname()
    final_name = click.prompt("Pod name", default=default_name)

    # Build config
    cfg = {
        "podex": {
            "pod_token": final_token,
            "cloud_url": "https://api.podex.dev",
            "pod_name": final_name,
            "mode": final_mode,
        },
        "native": {
            "workspace_dir": final_workspace_dir,
            "security": final_security,
        },
        "mounts": [],
    }

    manager.save(cfg)

    click.echo()
    click.echo(click.style("Configuration saved!", fg="green", bold=True))
    click.echo(f"  File: {manager.config_path}")
    click.echo()
    click.echo("Next steps:")
    click.echo("  1. Add allowed mount paths: podex-local-pod mounts add ~/projects")
    click.echo("  2. Start the pod: podex-local-pod start")


@config.command("set")
@click.argument("key")
@click.argument("value")
def config_set(key: str, value: str) -> None:
    """Set a configuration value.

    KEY is in dot-notation (e.g., podex.pod_name, native.security).
    """
    manager = ConfigManager()

    # Convert value to appropriate type
    if value.lower() == "true":
        typed_value: str | int | bool = True
    elif value.lower() == "false":
        typed_value = False
    elif value.isdigit():
        typed_value = int(value)
    else:
        typed_value = value

    try:
        manager.set_value(key, typed_value)
        click.echo(click.style("OK", fg="green") + f" Set {key} = {typed_value}")
    except ValueError as e:
        click.echo(click.style("Error: ", fg="red") + str(e), err=True)
        sys.exit(1)


# =============================================================================
# MOUNTS COMMANDS
# =============================================================================


@cli.group()
def mounts() -> None:
    """Manage allowed filesystem mounts."""
    pass


@mounts.command("list")
def mounts_list() -> None:
    """List all configured mounts."""
    manager = ConfigManager()
    mount_list = manager.list_mounts()

    if not mount_list:
        click.echo(click.style("No mounts configured.", fg="yellow"))
        click.echo("\nAdd mounts with: podex-local-pod mounts add <path>")
        return

    click.echo(click.style("Configured Mounts", fg="cyan", bold=True))
    click.echo()

    for mount in mount_list:
        mode = mount.get("mode", "rw")
        mode_color = "green" if mode == "rw" else "yellow"
        mode_label = "read-write" if mode == "rw" else "read-only"

        label = mount.get("label", Path(mount["path"]).name)
        click.echo(f"  {click.style(label, bold=True)}")
        click.echo(f"    Path: {mount['path']}")
        click.echo(f"    Mode: {click.style(mode_label, fg=mode_color)}")
        click.echo()


@mounts.command("add")
@click.argument("path", type=click.Path())
@click.option(
    "--mode",
    type=click.Choice(["rw", "ro"]),
    default="rw",
    help="Mount mode: rw (read-write) or ro (read-only)",
)
@click.option(
    "--label",
    default=None,
    help="Friendly name for this mount",
)
def mounts_add(path: str, mode: str, label: str | None) -> None:
    """Add a path to the mount allowlist.

    PATH is the filesystem path to allow workspaces to access.
    """
    manager = ConfigManager()

    try:
        manager.add_mount(path, mode=mode, label=label)
        resolved = str(Path(path).expanduser().resolve())
        click.echo(click.style("OK", fg="green") + f" Added mount: {resolved} [{mode}]")
    except ValueError as e:
        click.echo(click.style("Error: ", fg="red") + str(e), err=True)
        sys.exit(1)


@mounts.command("remove")
@click.argument("path", type=click.Path())
def mounts_remove(path: str) -> None:
    """Remove a path from the mount allowlist."""
    manager = ConfigManager()

    try:
        manager.remove_mount(path)
        click.echo(click.style("OK", fg="green") + f" Removed mount: {path}")
    except ValueError as e:
        click.echo(click.style("Error: ", fg="red") + str(e), err=True)
        sys.exit(1)


# =============================================================================
# MODE COMMANDS
# =============================================================================


@cli.group()
def mode() -> None:
    """Manage execution mode (docker or native)."""
    pass


@mode.command("docker")
def mode_docker() -> None:
    """Switch to Docker execution mode.

    Workspaces run in isolated Docker containers.
    Allowed mounts are attached as volumes.
    """
    manager = ConfigManager()
    manager.set_mode("docker")
    click.echo(click.style("OK", fg="green") + " Switched to Docker mode")
    click.echo("\nWorkspaces will run in isolated containers.")
    click.echo("Configured mounts will be attached as volumes.")


@mode.command("native")
@click.option(
    "--workspace-dir",
    type=click.Path(),
    default=None,
    help="Directory for workspace files",
)
@click.option(
    "--security",
    type=click.Choice(["allowlist", "unrestricted"]),
    default=None,
    help="Security mode for filesystem access",
)
def mode_native(workspace_dir: str | None, security: str | None) -> None:
    """Switch to native execution mode.

    Workspaces run directly on your machine without containers.
    Faster performance and full access to local tools.
    """
    manager = ConfigManager()
    manager.set_mode("native", workspace_dir=workspace_dir, security=security)

    click.echo(click.style("OK", fg="green") + " Switched to Native mode")
    click.echo("\nWorkspaces will run directly on your machine.")

    cfg = manager.load()
    native = cfg.get("native", {})
    click.echo(f"  Workspace dir: {native.get('workspace_dir')}")
    click.echo(f"  Security: {native.get('security')}")

    if native.get("security") == "unrestricted":
        click.echo()
        click.echo(
            click.style("Warning: ", fg="yellow", bold=True)
            + "Unrestricted mode allows full filesystem access."
        )


if __name__ == "__main__":
    cli()
