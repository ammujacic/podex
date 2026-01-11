#!/usr/bin/env python3
"""Podex Local Pod - CLI entry point."""

import asyncio
import signal
import socket
import sys
from pathlib import Path

import click
import structlog

from . import __version__
from .client import LocalPodClient
from .config import LocalPodConfig, load_config

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
    default="https://api.podex.dev",
    help="Podex cloud API URL",
)
@click.option(
    "--name",
    envvar="PODEX_POD_NAME",
    default=None,
    help="Display name for this pod (uses hostname if not set)",
)
@click.option(
    "--max-workspaces",
    envvar="PODEX_MAX_WORKSPACES",
    default=3,
    type=click.IntRange(1, 10),
    help="Maximum concurrent workspaces",
)
@click.option(
    "--config",
    "config_file",
    type=click.Path(exists=True, path_type=Path),
    help="Path to config file",
)
def start(
    token: str | None,
    url: str,
    name: str | None,
    max_workspaces: int,
    config_file: Path | None,
) -> None:
    """Start the Podex local pod agent.

    Connects to Podex cloud and waits for workspace commands.
    The pod will automatically reconnect if the connection is lost.
    """
    # Load configuration
    if config_file:
        config = load_config(config_file)
    else:
        config = LocalPodConfig(
            pod_token=token or "",
            cloud_url=url,
            pod_name=name or socket.gethostname(),
            max_workspaces=max_workspaces,
        )

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
    click.echo(f"  Max workspaces: {config.max_workspaces}")
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


if __name__ == "__main__":
    cli()
