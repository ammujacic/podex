"""MCP tool discovery service for the API."""

import asyncio
import contextlib
import json
import os
from dataclasses import dataclass, field
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()


@dataclass
class MCPToolInfo:
    """Information about an MCP tool."""

    name: str
    description: str | None
    input_schema: dict[str, Any]


@dataclass
class MCPResourceInfo:
    """Information about an MCP resource."""

    uri: str
    name: str
    description: str | None
    mime_type: str | None


@dataclass
class MCPDiscoveryResult:
    """Result of MCP tool discovery."""

    success: bool
    tools: list[MCPToolInfo] = field(default_factory=list)
    resources: list[MCPResourceInfo] = field(default_factory=list)
    error: str | None = None


@dataclass
class MCPDiscoveryConfig:
    """Configuration for MCP discovery client."""

    transport: str = "stdio"
    command: str | None = None
    args: list[str] = field(default_factory=list)
    url: str | None = None
    env_vars: dict[str, str] = field(default_factory=dict)
    timeout: int = 30


class MCPNotConnectedError(RuntimeError):
    """Raised when MCP client is not connected."""

    def __init__(self) -> None:
        super().__init__("MCP client not connected")


class MCPDiscoveryClient:
    """Client for discovering tools from MCP servers.

    This is a simplified client that only does discovery, not execution.
    For tool execution, the agent service's full MCPClient should be used.
    """

    def __init__(self, config: MCPDiscoveryConfig) -> None:
        """Initialize discovery client.

        Args:
            config: Discovery configuration
        """
        self._config = config
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._pending_requests: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task[None] | None = None

    async def discover(self) -> MCPDiscoveryResult:
        """Discover tools and resources from the MCP server.

        Returns:
            Discovery result with tools and resources
        """
        if self._config.transport == "stdio":
            return await self._discover_stdio()
        if self._config.transport == "sse":
            return await self._discover_sse()
        if self._config.transport == "http":
            return await self._discover_http()
        return MCPDiscoveryResult(
            success=False,
            error=f"Unknown transport: {self._config.transport}",
        )

    async def _discover_stdio(self) -> MCPDiscoveryResult:
        """Discover via stdio transport."""
        if not self._config.command:
            return MCPDiscoveryResult(
                success=False,
                error="No command specified for stdio transport",
            )

        try:
            # Prepare environment
            env = {**os.environ, **self._config.env_vars}

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

            try:
                # Initialize connection
                init_response = await self._send_request(
                    "initialize",
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "clientInfo": {"name": "podex-api", "version": "1.0.0"},
                    },
                )

                if init_response.get("error"):
                    return MCPDiscoveryResult(
                        success=False,
                        error=f"Initialization failed: {init_response['error']}",
                    )

                # List tools
                tools_response = await self._send_request("tools/list", {})
                tools: list[MCPToolInfo] = []

                if not tools_response.get("error"):
                    tools.extend(
                        MCPToolInfo(
                            name=tool_data.get("name", ""),
                            description=tool_data.get("description"),
                            input_schema=tool_data.get("inputSchema", {}),
                        )
                        for tool_data in tools_response.get("result", {}).get("tools", [])
                    )

                # List resources
                resources_response = await self._send_request("resources/list", {})
                resources: list[MCPResourceInfo] = []

                if not resources_response.get("error"):
                    resources.extend(
                        MCPResourceInfo(
                            uri=res_data.get("uri", ""),
                            name=res_data.get("name", ""),
                            description=res_data.get("description"),
                            mime_type=res_data.get("mimeType"),
                        )
                        for res_data in resources_response.get("result", {}).get(
                            "resources",
                            [],
                        )
                    )

                logger.info(
                    "MCP discovery completed",
                    command=self._config.command,
                    tools=len(tools),
                    resources=len(resources),
                )

                return MCPDiscoveryResult(
                    success=True,
                    tools=tools,
                    resources=resources,
                )

            finally:
                await self._cleanup()

        except FileNotFoundError:
            return MCPDiscoveryResult(
                success=False,
                error=f"Command not found: {self._config.command}",
            )
        except Exception as e:
            logger.exception("MCP discovery failed", error=str(e))
            return MCPDiscoveryResult(success=False, error=str(e))

    async def _send_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request."""
        if not self._process or not self._process.stdin:
            raise MCPNotConnectedError

        self._request_id += 1
        request_id = self._request_id

        request = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params:
            request["params"] = params

        future: asyncio.Future[dict[str, Any]] = asyncio.Future()
        self._pending_requests[request_id] = future

        request_json = json.dumps(request) + "\n"
        self._process.stdin.write(request_json.encode())
        await self._process.stdin.drain()

        try:
            return await asyncio.wait_for(future, timeout=self._config.timeout)
        except TimeoutError:
            del self._pending_requests[request_id]
            return {"error": {"code": -1, "message": "Request timed out"}}

    async def _read_responses(self) -> None:
        """Read responses from stdout."""
        if not self._process or not self._process.stdout:
            return

        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break

                try:
                    response = json.loads(line.decode())
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
            logger.exception("Error reading MCP responses", error=str(e))

    async def _cleanup(self) -> None:
        """Clean up resources."""
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

    async def _discover_sse(self) -> MCPDiscoveryResult:
        """Discover via SSE (Server-Sent Events) transport.

        SSE transport uses HTTP POST for requests and SSE stream for responses.
        """
        if not self._config.url:
            return MCPDiscoveryResult(
                success=False,
                error="No URL specified for SSE transport",
            )

        try:
            async with httpx.AsyncClient(timeout=self._config.timeout) as client:
                # Initialize connection
                init_response = await self._send_http_request(
                    client,
                    "initialize",
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "clientInfo": {"name": "podex-api", "version": "1.0.0"},
                    },
                )

                if init_response.get("error"):
                    return MCPDiscoveryResult(
                        success=False,
                        error=f"Initialization failed: {init_response['error']}",
                    )

                # List tools
                tools_response = await self._send_http_request(client, "tools/list", {})
                tools: list[MCPToolInfo] = []

                if not tools_response.get("error"):
                    tools.extend(
                        MCPToolInfo(
                            name=tool_data.get("name", ""),
                            description=tool_data.get("description"),
                            input_schema=tool_data.get("inputSchema", {}),
                        )
                        for tool_data in tools_response.get("result", {}).get("tools", [])
                    )

                # List resources
                resources_response = await self._send_http_request(client, "resources/list", {})
                resources: list[MCPResourceInfo] = []

                if not resources_response.get("error"):
                    resources.extend(
                        MCPResourceInfo(
                            uri=res_data.get("uri", ""),
                            name=res_data.get("name", ""),
                            description=res_data.get("description"),
                            mime_type=res_data.get("mimeType"),
                        )
                        for res_data in resources_response.get("result", {}).get("resources", [])
                    )

                logger.info(
                    "MCP SSE discovery completed",
                    url=self._config.url,
                    tools=len(tools),
                    resources=len(resources),
                )

                return MCPDiscoveryResult(
                    success=True,
                    tools=tools,
                    resources=resources,
                )

        except httpx.ConnectError:
            return MCPDiscoveryResult(
                success=False,
                error=f"Failed to connect to {self._config.url}",
            )
        except httpx.TimeoutException:
            return MCPDiscoveryResult(
                success=False,
                error=f"Connection to {self._config.url} timed out",
            )
        except Exception as e:
            logger.exception("MCP SSE discovery failed", error=str(e))
            return MCPDiscoveryResult(success=False, error=str(e))

    async def _discover_http(self) -> MCPDiscoveryResult:
        """Discover via HTTP transport.

        HTTP transport uses simple HTTP POST for JSON-RPC requests.
        """
        if not self._config.url:
            return MCPDiscoveryResult(
                success=False,
                error="No URL specified for HTTP transport",
            )

        try:
            async with httpx.AsyncClient(timeout=self._config.timeout) as client:
                # Initialize connection
                init_response = await self._send_http_request(
                    client,
                    "initialize",
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "clientInfo": {"name": "podex-api", "version": "1.0.0"},
                    },
                )

                if init_response.get("error"):
                    return MCPDiscoveryResult(
                        success=False,
                        error=f"Initialization failed: {init_response['error']}",
                    )

                # List tools
                tools_response = await self._send_http_request(client, "tools/list", {})
                tools: list[MCPToolInfo] = []

                if not tools_response.get("error"):
                    tools.extend(
                        MCPToolInfo(
                            name=tool_data.get("name", ""),
                            description=tool_data.get("description"),
                            input_schema=tool_data.get("inputSchema", {}),
                        )
                        for tool_data in tools_response.get("result", {}).get("tools", [])
                    )

                # List resources
                resources_response = await self._send_http_request(client, "resources/list", {})
                resources: list[MCPResourceInfo] = []

                if not resources_response.get("error"):
                    resources.extend(
                        MCPResourceInfo(
                            uri=res_data.get("uri", ""),
                            name=res_data.get("name", ""),
                            description=res_data.get("description"),
                            mime_type=res_data.get("mimeType"),
                        )
                        for res_data in resources_response.get("result", {}).get("resources", [])
                    )

                logger.info(
                    "MCP HTTP discovery completed",
                    url=self._config.url,
                    tools=len(tools),
                    resources=len(resources),
                )

                return MCPDiscoveryResult(
                    success=True,
                    tools=tools,
                    resources=resources,
                )

        except httpx.ConnectError:
            return MCPDiscoveryResult(
                success=False,
                error=f"Failed to connect to {self._config.url}",
            )
        except httpx.TimeoutException:
            return MCPDiscoveryResult(
                success=False,
                error=f"Connection to {self._config.url} timed out",
            )
        except Exception as e:
            logger.exception("MCP HTTP discovery failed", error=str(e))
            return MCPDiscoveryResult(success=False, error=str(e))

    async def _send_http_request(
        self,
        client: httpx.AsyncClient,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request via HTTP.

        Args:
            client: HTTP client
            method: RPC method name
            params: Method parameters

        Returns:
            Response data
        """
        self._request_id += 1
        request_id = self._request_id

        request = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params:
            request["params"] = params

        try:
            response = await client.post(
                self._config.url,  # type: ignore
                json=request,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
        except httpx.HTTPStatusError as e:
            return {"error": {"code": e.response.status_code, "message": str(e)}}
        except Exception as e:
            return {"error": {"code": -1, "message": str(e)}}
        else:
            return result


async def discover_mcp_tools(config: MCPDiscoveryConfig) -> MCPDiscoveryResult:
    """Discover tools from an MCP server.

    Args:
        config: Discovery configuration

    Returns:
        Discovery result
    """
    client = MCPDiscoveryClient(config)
    return await client.discover()
