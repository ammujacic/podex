"""Compute service routes."""

from src.routes.health import router as health_router
from src.routes.preview import router as preview_router
from src.routes.terminal import router as terminal_router
from src.routes.terminal import shutdown_terminal_sessions
from src.routes.websocket_proxy import router as websocket_router
from src.routes.workspaces import router as workspaces_router

__all__ = [
    "health_router",
    "preview_router",
    "shutdown_terminal_sessions",
    "terminal_router",
    "websocket_router",
    "workspaces_router",
]
