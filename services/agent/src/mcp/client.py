"""MCP client for communicating with MCP servers."""

import asyncio
import contextlib
import json
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

# Dangerous environment variable names that could enable code injection
_DANGEROUS_ENV_VAR_PREFIXES = frozenset(
    {
        "LD_",  # LD_PRELOAD, LD_LIBRARY_PATH, etc.
        "DYLD_",  # macOS dynamic linker
        "PYTHON",  # PYTHONPATH, PYTHONSTARTUP, PYTHONHOME
        "RUBY",  # RUBYLIB, RUBYOPT
        "PERL",  # PERL5LIB, PERL5OPT
        "NODE_",  # NODE_OPTIONS, NODE_PATH
        "JAVA_",  # JAVA_TOOL_OPTIONS, JAVA_OPTIONS
        "_JAVA_",  # _JAVA_OPTIONS
        "BASH_",  # BASH_ENV
    }
)

_DANGEROUS_ENV_VARS = frozenset(
    {
        "PATH",
        "HOME",
        "SHELL",
        "ENV",
        "ZDOTDIR",
        "CLASSPATH",
    }
)


def _is_safe_env_var(key: str) -> bool:
    """Check if an environment variable name is safe to pass to subprocess.

    Args:
        key: Environment variable name

    Returns:
        True if safe, False if potentially dangerous
    """
    key_upper = key.upper()

    # Check exact matches
    if key_upper in _DANGEROUS_ENV_VARS:
        return False

    # Check prefixes
    for prefix in _DANGEROUS_ENV_VAR_PREFIXES:
        if key_upper.startswith(prefix):
            return False

    # Validate key format (alphanumeric and underscore only)
    if not key.replace("_", "").replace("-", "").isalnum():
        return False

    return True


class MCPTransport(str, Enum):
    """MCP transport types."""

    STDIO = "stdio"  # Subprocess with stdin/stdout
    SSE = "sse"  # Server-Sent Events
    HTTP = "http"  # HTTP REST


@dataclass
class MCPServerConfig:
    """Configuration for an MCP server."""

    id: str
    name: str
    transport: MCPTransport
    command: str | None = None  # For stdio
    args: list[str] = field(default_factory=list)
    url: str | None = None  # For sse/http
    env_vars: dict[str, str] = field(default_factory=dict)
    timeout: int = 30
    auth_token: str | None = None  # Bearer token for HTTP transport auth


@dataclass
class MCPToolDefinition:
    """Definition of a tool provided by an MCP server."""

    name: str
    description: str
    input_schema: dict[str, Any]
    server_id: str


class MCPClient:
    """Client for communicating with an MCP server.

    Supports stdio, SSE, and HTTP transports.
    """

    def __init__(self, config: MCPServerConfig) -> None:
        """Initialize MCP client.

        Args:
            config: Server configuration
        """
        self._config = config
        self._process: asyncio.subprocess.Process | None = None
        self._http_client: httpx.AsyncClient | None = None
        self._connected = False
        self._tools: list[MCPToolDefinition] = []
        self._request_id = 0
        self._pending_requests: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task[None] | None = None

    @property
    def is_connected(self) -> bool:
        """Check if connected to server."""
        return self._connected

    @property
    def tools(self) -> list[MCPToolDefinition]:
        """Get discovered tools."""
        return self._tools

    async def connect(self) -> bool:
        """Connect to the MCP server.

        Returns:
            True if connected successfully
        """
        if self._connected:
            return True

        if self._config.transport == MCPTransport.STDIO:
            return await self._connect_stdio()
        elif self._config.transport == MCPTransport.SSE:
            return await self._connect_http()  # SSE uses HTTP for discovery
        elif self._config.transport == MCPTransport.HTTP:
            return await self._connect_http()

        return False

    async def _connect_http(self) -> bool:
        """Connect via HTTP/SSE transport.

        Returns:
            True if connected
        """
        if not self._config.url:
            logger.error("No URL specified for HTTP/SSE transport")
            return False

        try:
            # Create HTTP client
            self._http_client = httpx.AsyncClient(timeout=self._config.timeout)

            # Initialize connection (MCP handshake)
            response = await self._send_http_request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {},
                    },
                    "clientInfo": {
                        "name": "podex-agent",
                        "version": "1.0.0",
                    },
                },
            )

            if response.get("error"):
                logger.error("MCP HTTP initialization failed", error=response["error"])
                await self._http_client.aclose()
                self._http_client = None
                return False

            self._connected = True

            # Discover tools
            await self._discover_tools()

            logger.info(
                "Connected to MCP server via HTTP",
                server=self._config.name,
                tools=len(self._tools),
            )

            return True

        except Exception as e:
            logger.error("Failed to connect to MCP server via HTTP", error=str(e))
            if self._http_client:
                await self._http_client.aclose()
                self._http_client = None
            return False

    async def _connect_stdio(self) -> bool:
        """Connect via stdio (subprocess).

        Returns:
            True if connected
        """
        if not self._config.command:
            logger.error("No command specified for stdio transport")
            return False

        try:
            # Prepare environment with sanitization to prevent code injection
            env = {**os.environ}
            # Sanitize user-provided env vars
            for key, value in self._config.env_vars.items():
                if not _is_safe_env_var(key):
                    logger.warning(
                        "Blocked dangerous environment variable for MCP server",
                        key=key,
                        server=self._config.name,
                    )
                    continue
                # Sanitize value - remove null bytes and limit length
                if value:
                    value = value.replace("\x00", "")[:4096]
                env[key] = value

            # Start subprocess
            self._process = await asyncio.create_subprocess_exec(
                self._config.command,
                *self._config.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            # Start reader task
            self._reader_task = asyncio.create_task(self._read_responses())

            # Initialize connection (MCP handshake)
            response = await self._send_request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {},
                    },
                    "clientInfo": {
                        "name": "podex-agent",
                        "version": "1.0.0",
                    },
                },
            )

            if response.get("error"):
                logger.error("MCP initialization failed", error=response["error"])
                return False

            self._connected = True

            # Discover tools
            await self._discover_tools()

            logger.info(
                "Connected to MCP server",
                server=self._config.name,
                tools=len(self._tools),
            )

            return True

        except Exception as e:
            logger.error("Failed to connect to MCP server", error=str(e))
            return False

    async def disconnect(self) -> None:
        """Disconnect from the server."""
        if self._reader_task:
            self._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_task

        if self._process:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except TimeoutError:
                self._process.kill()

        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        self._connected = False
        self._tools = []
        logger.info("Disconnected from MCP server", server=self._config.name)

    async def _send_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request to the server.

        Routes to appropriate transport method based on config.

        Args:
            method: RPC method name
            params: Method parameters

        Returns:
            Response data
        """
        if self._config.transport in (MCPTransport.SSE, MCPTransport.HTTP):
            return await self._send_http_request(method, params)
        return await self._send_stdio_request(method, params)

    async def _send_stdio_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request via stdio.

        Args:
            method: RPC method name
            params: Method parameters

        Returns:
            Response data
        """
        if not self._process or not self._process.stdin:
            raise RuntimeError("Not connected to MCP server")

        self._request_id += 1
        request_id = self._request_id

        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params:
            request["params"] = params

        # Create future for response
        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_requests[request_id] = future

        # Send request
        request_json = json.dumps(request) + "\n"
        self._process.stdin.write(request_json.encode())
        await self._process.stdin.drain()

        # Wait for response
        try:
            response = await asyncio.wait_for(future, timeout=self._config.timeout)
            return response
        except TimeoutError:
            del self._pending_requests[request_id]
            return {"error": {"code": -1, "message": "Request timed out"}}

    async def _send_http_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request via HTTP.

        Args:
            method: RPC method name
            params: Method parameters

        Returns:
            Response data
        """
        if not self._http_client:
            raise RuntimeError("Not connected to MCP server via HTTP")

        self._request_id += 1
        request_id = self._request_id

        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params:
            request["params"] = params

        try:
            headers = {"Content-Type": "application/json"}
            if self._config.auth_token:
                headers["Authorization"] = f"Bearer {self._config.auth_token}"

            response = await self._http_client.post(
                self._config.url,  # type: ignore
                json=request,
                headers=headers,
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
            return result
        except httpx.HTTPStatusError as e:
            return {"error": {"code": e.response.status_code, "message": str(e)}}
        except httpx.TimeoutException:
            return {"error": {"code": -1, "message": "Request timed out"}}
        except Exception as e:
            return {"error": {"code": -1, "message": str(e)}}

    async def _read_responses(self) -> None:
        """Read responses from the server stdout."""
        if not self._process or not self._process.stdout:
            return

        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break

                try:
                    response = json.loads(line.decode())

                    # Handle response
                    request_id = response.get("id")
                    if request_id in self._pending_requests:
                        future = self._pending_requests.pop(request_id)
                        if not future.done():
                            future.set_result(response)

                except json.JSONDecodeError:
                    continue

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Error reading MCP responses", error=str(e))

    async def _discover_tools(self) -> None:
        """Discover available tools from the server."""
        response = await self._send_request("tools/list", {})

        if response.get("error"):
            logger.warning("Failed to list tools", error=response["error"])
            return

        tools_data = response.get("result", {}).get("tools", [])
        self._tools = []

        for tool_data in tools_data:
            tool = MCPToolDefinition(
                name=tool_data.get("name", ""),
                description=tool_data.get("description", ""),
                input_schema=tool_data.get("inputSchema", {}),
                server_id=self._config.id,
            )
            self._tools.append(tool)

        logger.info(
            "Discovered MCP tools",
            server=self._config.name,
            count=len(self._tools),
        )

    async def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Call a tool on the MCP server.

        Args:
            tool_name: Name of the tool
            arguments: Tool arguments

        Returns:
            Tool result
        """
        if not self._connected:
            return {"success": False, "error": "Not connected to MCP server"}

        response = await self._send_request(
            "tools/call",
            {
                "name": tool_name,
                "arguments": arguments,
            },
        )

        if response.get("error"):
            return {
                "success": False,
                "error": response["error"].get("message", "Unknown error"),
            }

        result = response.get("result", {})

        # Handle different result formats
        content = result.get("content", [])
        if content and isinstance(content, list):
            # Extract text content
            text_parts = []
            for item in content:
                if item.get("type") == "text":
                    text_parts.append(item.get("text", ""))

            return {
                "success": True,
                "output": "\n".join(text_parts),
                "raw_content": content,
            }

        return {
            "success": True,
            "output": str(result),
        }

    async def list_resources(self) -> list[dict[str, Any]]:
        """List available resources from the server.

        Returns:
            List of resource definitions
        """
        response = await self._send_request("resources/list", {})

        if response.get("error"):
            return []

        resources: list[dict[str, Any]] = response.get("result", {}).get("resources", [])
        return resources

    async def read_resource(self, uri: str) -> dict[str, Any]:
        """Read a resource from the server.

        Args:
            uri: Resource URI

        Returns:
            Resource content
        """
        response = await self._send_request("resources/read", {"uri": uri})

        if response.get("error"):
            return {"success": False, "error": response["error"].get("message")}

        return {
            "success": True,
            "contents": response.get("result", {}).get("contents", []),
        }
