#!/usr/bin/env python3
"""Podex Local Pod - CLI entry point."""

import asyncio
import logging
import os
import signal
import socket
import sys
from typing import cast

import click
import sentry_sdk
import structlog
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from . import __version__
from .client import LocalPodClient
from .config import load_config


def _init_sentry() -> bool:
    """Initialize Sentry for error tracking in local pod."""
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return False

    environment = os.environ.get("ENVIRONMENT", "development")

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=f"podex-pod@{__version__}",
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
        server_name="podex-pod",
        ignore_errors=[
            "ConnectionRefusedError",
            "ConnectionResetError",
            "TimeoutError",
            "asyncio.CancelledError",
            "KeyboardInterrupt",
            "SystemExit",
        ],
    )

    sentry_sdk.set_tag("service", "podex-pod")
    return True


# Initialize Sentry at module load time
_sentry_enabled = _init_sentry()


def _configure_logging() -> structlog.stdlib.BoundLogger:
    """Configure logging for local-pod CLI.

    Sets up Python's stdlib logging (required for Sentry integration)
    with structlog for nice console output.
    """
    # Configure Python's root logger to output to stderr
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Remove existing handlers to avoid duplicates
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add stderr handler with simple format (structlog handles formatting)
    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root_logger.addHandler(handler)

    # Configure structlog with stdlib integration
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            # Console renderer for nice CLI output
            structlog.dev.ConsoleRenderer(colors=True),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    return cast("structlog.stdlib.BoundLogger", structlog.get_logger("podex-pod"))


logger = _configure_logging()


@click.group()
@click.version_option(version=__version__, prog_name="podex-pod")
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
    help="Podex cloud API URL",
)
@click.option(
    "--name",
    envvar="PODEX_POD_NAME",
    default=None,
    help="Display name for this pod",
)
def start(
    token: str | None,
    url: str | None,
    name: str | None,
) -> None:
    """Start the Podex local pod agent.

    Connects to Podex cloud and waits for workspace commands.
    The pod will automatically reconnect if the connection is lost.

    Configuration is loaded from:
    1. Command line arguments
    2. Environment variables (PODEX_*)
    """
    # Load config from environment
    config = load_config()

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
            "  podex-pod start --token pdx_pod_xxx\n\n"
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

    # Check tmux availability (required for terminal features)
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

    Verifies tmux is available and shows system resources.
    """
    import platform
    import shutil

    click.echo(click.style("System Check", fg="cyan", bold=True))
    click.echo()

    all_ok = True

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
            + " (required for terminal agents)"
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
    click.echo(f"podex-pod v{__version__}")


if __name__ == "__main__":
    cli()
