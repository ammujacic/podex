"""
LSP Manager

Manages Language Server Protocol servers for workspaces.
Spawns, monitors, and proxies communication with language servers.
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class LanguageServerConfig:
    """Configuration for a language server."""

    language: str
    command: list[str]
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    root_uri_template: str = "file:///home/dev"


# Default language server configurations
LANGUAGE_SERVERS: dict[str, LanguageServerConfig] = {
    "typescript": LanguageServerConfig(
        language="typescript",
        command=["npx", "typescript-language-server", "--stdio"],
    ),
    "javascript": LanguageServerConfig(
        language="javascript",
        command=["npx", "typescript-language-server", "--stdio"],
    ),
    "python": LanguageServerConfig(
        language="python",
        command=["pyright-langserver", "--stdio"],
    ),
    "rust": LanguageServerConfig(
        language="rust",
        command=["rust-analyzer"],
    ),
    "go": LanguageServerConfig(
        language="go",
        command=["gopls"],
    ),
}

# Timeout for LSP requests in seconds
LSP_REQUEST_TIMEOUT_SECONDS = 30.0
# Timeout for stopping the process
LSP_STOP_TIMEOUT_SECONDS = 5.0


class LspServerProcess:
    """Manages a single language server process."""

    def __init__(
        self,
        workspace_id: str,
        language: str,
        config: LanguageServerConfig,
        workspace_path: str,
    ):
        self.workspace_id = workspace_id
        self.language = language
        self.config = config
        self.workspace_path = workspace_path
        self.process: asyncio.subprocess.Process | None = None
        self.initialized = False
        self.request_id = 0
        self.pending_requests: dict[int, asyncio.Future[Any]] = {}
        self.message_handlers: list[Callable[[dict[str, Any]], None]] = []
        self._read_task: asyncio.Task[None] | None = None
        self._drain_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the language server process."""
        env = {**(self.config.env or {})}

        self.process = await asyncio.create_subprocess_exec(
            *self.config.command,
            *(self.config.args or []),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.workspace_path,
            env=env,
        )

        # Start reading stdout
        self._read_task = asyncio.create_task(self._read_messages())

        logger.info(
            f"Started LSP server for {self.language} in {self.workspace_id}, "
            f"PID: {self.process.pid}",
        )

    async def stop(self) -> None:
        """Stop the language server process."""
        if self._read_task:
            self._read_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._read_task

        if self.process:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=LSP_STOP_TIMEOUT_SECONDS)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()

            logger.info(f"Stopped LSP server for {self.language} in {self.workspace_id}")

        # Reject all pending requests
        for future in self.pending_requests.values():
            if not future.done():
                future.set_exception(Exception("Server stopped"))
        self.pending_requests.clear()

    async def _read_messages(self) -> None:
        """Read messages from the language server stdout."""
        if not self.process or not self.process.stdout:
            return

        try:
            while True:
                # Read headers
                headers: dict[str, str] = {}
                while True:
                    line_bytes = await self.process.stdout.readline()
                    if not line_bytes:
                        return  # EOF

                    line = line_bytes.decode("utf-8").strip()
                    if not line:
                        break  # End of headers

                    if ":" in line:
                        key, value = line.split(":", 1)
                        headers[key.strip().lower()] = value.strip()

                # Read content
                content_length = int(headers.get("content-length", "0"))
                if content_length > 0:
                    content = await self.process.stdout.read(content_length)
                    message: dict[str, Any] = json.loads(content.decode("utf-8"))
                    await self._handle_message(message)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Error reading LSP messages: {e}")

    async def _handle_message(self, message: dict[str, Any]) -> None:
        """Handle an incoming message from the language server."""
        if "id" in message and message["id"] in self.pending_requests:
            # Response to a request
            future = self.pending_requests.pop(message["id"])
            if "error" in message:
                future.set_exception(Exception(message["error"].get("message", "Unknown error")))
            else:
                future.set_result(message.get("result"))
        else:
            # Notification from server
            for handler in self.message_handlers:
                try:
                    handler(message)
                except Exception as e:
                    logger.error(f"Error in message handler: {e}")

    def add_message_handler(self, handler: Callable[[dict[str, Any]], None]) -> None:
        """Add a handler for server notifications."""
        self.message_handlers.append(handler)

    def remove_message_handler(self, handler: Callable[[dict[str, Any]], None]) -> None:
        """Remove a message handler."""
        if handler in self.message_handlers:
            self.message_handlers.remove(handler)

    async def send_request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a request to the language server and wait for response."""
        if not self.process or not self.process.stdin:
            raise Exception("Server not running")

        self.request_id += 1
        request_id = self.request_id

        message = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params is not None:
            message["params"] = params

        content = json.dumps(message)
        data = f"Content-Length: {len(content)}\r\n\r\n{content}"

        self.process.stdin.write(data.encode("utf-8"))
        await self.process.stdin.drain()

        # Wait for response
        future: asyncio.Future[Any] = asyncio.get_event_loop().create_future()
        self.pending_requests[request_id] = future

        try:
            return await asyncio.wait_for(future, timeout=LSP_REQUEST_TIMEOUT_SECONDS)
        except TimeoutError:
            self.pending_requests.pop(request_id, None)
            raise Exception(f"Request timeout: {method}") from None

    def send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        """Send a notification to the language server (no response expected)."""
        if not self.process or not self.process.stdin:
            return

        message: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": method,
        }
        if params is not None:
            message["params"] = params

        content = json.dumps(message)
        data = f"Content-Length: {len(content)}\r\n\r\n{content}"

        try:
            self.process.stdin.write(data.encode("utf-8"))
            self._drain_task = asyncio.create_task(self.process.stdin.drain())
        except Exception as e:
            logger.error(f"Error sending notification: {e}")


class LspManager:
    """Manages LSP servers for all workspaces."""

    def __init__(self) -> None:
        self.servers: dict[str, LspServerProcess] = {}  # key: workspace_id:language

    def _key(self, workspace_id: str, language: str) -> str:
        return f"{workspace_id}:{language}"

    async def start_server(
        self,
        workspace_id: str,
        language: str,
        workspace_path: str,
    ) -> LspServerProcess:
        """Start a language server for a workspace."""
        key = self._key(workspace_id, language)

        # Check if already running
        if key in self.servers:
            return self.servers[key]

        # Get configuration
        config = LANGUAGE_SERVERS.get(language)
        if not config:
            raise ValueError(f"Unsupported language: {language}")

        # Create and start server
        server = LspServerProcess(workspace_id, language, config, workspace_path)
        await server.start()

        self.servers[key] = server
        return server

    async def stop_server(self, workspace_id: str, language: str) -> None:
        """Stop a language server."""
        key = self._key(workspace_id, language)
        server = self.servers.pop(key, None)
        if server:
            await server.stop()

    async def stop_workspace_servers(self, workspace_id: str) -> None:
        """Stop all servers for a workspace."""
        keys_to_remove = [k for k in self.servers if k.startswith(f"{workspace_id}:")]
        for key in keys_to_remove:
            server = self.servers.pop(key)
            await server.stop()

    async def stop_all(self) -> None:
        """Stop all language servers."""
        for server in self.servers.values():
            await server.stop()
        self.servers.clear()

    def get_server(self, workspace_id: str, language: str) -> LspServerProcess | None:
        """Get a running server."""
        return self.servers.get(self._key(workspace_id, language))

    async def initialize_server(
        self,
        workspace_id: str,
        language: str,
        root_uri: str,
    ) -> Any:
        """Initialize an LSP server session."""
        server = self.get_server(workspace_id, language)
        if not server:
            raise Exception("Server not running")

        result = await server.send_request(
            "initialize",
            {
                "processId": None,
                "rootUri": root_uri,
                "capabilities": {
                    "textDocument": {
                        "synchronization": {"dynamicRegistration": True},
                        "completion": {"dynamicRegistration": True},
                        "hover": {"dynamicRegistration": True},
                        "signatureHelp": {"dynamicRegistration": True},
                        "definition": {"dynamicRegistration": True},
                        "references": {"dynamicRegistration": True},
                        "documentSymbol": {"dynamicRegistration": True},
                        "formatting": {"dynamicRegistration": True},
                        "rename": {"dynamicRegistration": True},
                        "publishDiagnostics": {"relatedInformation": True},
                    },
                    "workspace": {
                        "workspaceFolders": True,
                    },
                },
                "workspaceFolders": [{"uri": root_uri, "name": "workspace"}],
            },
        )

        # Send initialized notification
        server.send_notification("initialized", {})
        server.initialized = True

        return result


class LspManagerSingleton:
    """Singleton holder for the LSP manager instance."""

    _instance: LspManager | None = None

    @classmethod
    def get_instance(cls) -> LspManager:
        """Get or create the LSP manager instance."""
        if cls._instance is None:
            cls._instance = LspManager()
        return cls._instance


def get_lsp_manager() -> LspManager:
    """Get the global LSP manager instance."""
    return LspManagerSingleton.get_instance()
