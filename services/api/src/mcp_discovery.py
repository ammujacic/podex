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
class MCPToolExecutionResult:
    """Result of MCP tool execution."""

    success: bool
    result: Any = None
    error: str | None = None
    is_error: bool = False  # True if the tool itself returned an error


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
                    stderr_output = await self._get_stderr_output()
                    error_msg = f"Initialization failed: {init_response['error']}"
                    if stderr_output:
                        error_msg = f"{error_msg}. Details: {stderr_output}"
                    return MCPDiscoveryResult(
                        success=False,
                        error=error_msg,
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
            # Try to get stderr output for better error messages
            stderr_output = await self._get_stderr_output()
            error_msg = str(e) if str(e) else "Unknown error"
            if stderr_output:
                error_msg = (
                    f"{error_msg}: {stderr_output}"
                    if error_msg != "Unknown error"
                    else stderr_output
                )
            logger.exception("MCP discovery failed", error=error_msg)
            return MCPDiscoveryResult(success=False, error=error_msg)

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
            with contextlib.suppress(ProcessLookupError):
                self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    self._process.kill()

    async def _get_stderr_output(self) -> str:
        """Read stderr output from the process."""
        if not self._process or not self._process.stderr:
            return ""
        try:
            stderr_data = await asyncio.wait_for(
                self._process.stderr.read(),
                timeout=1,
            )
            return stderr_data.decode().strip()
        except (TimeoutError, Exception):
            return ""

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


async def execute_mcp_tool(
    config: MCPDiscoveryConfig,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
) -> MCPToolExecutionResult:
    """Execute a tool on an MCP server.

    Args:
        config: MCP server configuration
        tool_name: Name of the tool to execute
        arguments: Tool arguments

    Returns:
        Execution result
    """
    client = MCPExecutionClient(config)
    return await client.execute_tool(tool_name, arguments or {})


class MCPExecutionClient:
    """Client for executing tools on MCP servers.

    This client manages the full lifecycle: connect, execute, disconnect.
    """

    def __init__(self, config: MCPDiscoveryConfig) -> None:
        """Initialize execution client.

        Args:
            config: Server configuration
        """
        self._config = config
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._pending_requests: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task[None] | None = None
        self._initialized = False

    async def execute_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> MCPToolExecutionResult:
        """Execute a tool and return the result.

        Args:
            tool_name: Name of the tool to execute
            arguments: Tool arguments

        Returns:
            Execution result
        """
        if self._config.transport == "stdio":
            return await self._execute_stdio(tool_name, arguments)
        if self._config.transport in ("sse", "http"):
            return await self._execute_http(tool_name, arguments)
        return MCPToolExecutionResult(
            success=False,
            error=f"Unknown transport: {self._config.transport}",
        )

    async def _execute_stdio(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> MCPToolExecutionResult:
        """Execute tool via stdio transport."""
        if not self._config.command:
            return MCPToolExecutionResult(
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
                    return MCPToolExecutionResult(
                        success=False,
                        error=f"Initialization failed: {init_response['error']}",
                    )

                self._initialized = True

                # Execute the tool
                tool_response = await self._send_request(
                    "tools/call",
                    {
                        "name": tool_name,
                        "arguments": arguments,
                    },
                )

                if tool_response.get("error"):
                    error_info = tool_response["error"]
                    error_msg = (
                        error_info.get("message", str(error_info))
                        if isinstance(error_info, dict)
                        else str(error_info)
                    )
                    return MCPToolExecutionResult(
                        success=False,
                        error=error_msg,
                    )

                result = tool_response.get("result", {})
                # Check if the tool returned an error
                is_error = result.get("isError", False)

                # Extract content from result
                content = result.get("content", [])
                if content and isinstance(content, list):
                    # Combine text content
                    text_parts = [
                        item.get("text", "") for item in content if item.get("type") == "text"
                    ]
                    result_text = "\n".join(text_parts) if text_parts else content
                else:
                    result_text = result

                logger.info(
                    "MCP tool executed",
                    command=self._config.command,
                    tool=tool_name,
                    is_error=is_error,
                )

                return MCPToolExecutionResult(
                    success=True,
                    result=result_text,
                    is_error=is_error,
                )

            finally:
                await self._cleanup()

        except FileNotFoundError:
            return MCPToolExecutionResult(
                success=False,
                error=f"Command not found: {self._config.command}",
            )
        except Exception as e:
            logger.exception("MCP tool execution failed", error=str(e))
            return MCPToolExecutionResult(success=False, error=str(e))

    async def _execute_http(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> MCPToolExecutionResult:
        """Execute tool via HTTP/SSE transport."""
        if not self._config.url:
            return MCPToolExecutionResult(
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
                    return MCPToolExecutionResult(
                        success=False,
                        error=f"Initialization failed: {init_response['error']}",
                    )

                # Execute the tool
                tool_response = await self._send_http_request(
                    client,
                    "tools/call",
                    {
                        "name": tool_name,
                        "arguments": arguments,
                    },
                )

                if tool_response.get("error"):
                    error_info = tool_response["error"]
                    error_msg = (
                        error_info.get("message", str(error_info))
                        if isinstance(error_info, dict)
                        else str(error_info)
                    )
                    return MCPToolExecutionResult(
                        success=False,
                        error=error_msg,
                    )

                result = tool_response.get("result", {})
                is_error = result.get("isError", False)

                # Extract content from result
                content = result.get("content", [])
                if content and isinstance(content, list):
                    text_parts = [
                        item.get("text", "") for item in content if item.get("type") == "text"
                    ]
                    result_text = "\n".join(text_parts) if text_parts else content
                else:
                    result_text = result

                logger.info(
                    "MCP tool executed via HTTP",
                    url=self._config.url,
                    tool=tool_name,
                    is_error=is_error,
                )

                return MCPToolExecutionResult(
                    success=True,
                    result=result_text,
                    is_error=is_error,
                )

        except httpx.ConnectError:
            return MCPToolExecutionResult(
                success=False,
                error=f"Failed to connect to {self._config.url}",
            )
        except httpx.TimeoutException:
            return MCPToolExecutionResult(
                success=False,
                error=f"Connection to {self._config.url} timed out",
            )
        except Exception as e:
            logger.exception("MCP HTTP tool execution failed", error=str(e))
            return MCPToolExecutionResult(success=False, error=str(e))

    async def _send_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request via stdio."""
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

    async def _send_http_request(
        self,
        client: httpx.AsyncClient,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Send a JSON-RPC request via HTTP."""
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
