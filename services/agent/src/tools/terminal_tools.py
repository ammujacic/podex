"""Terminal tools for agents to execute commands via WebSocket.

Connects to the compute service's terminal WebSocket endpoint to execute
commands in workspace containers.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import structlog
import websockets
from websockets.asyncio.client import ClientConnection  # noqa: TC002

from src.config import settings

logger = structlog.get_logger()


class AgentTerminalSession:
    """WebSocket terminal session for agent command execution.

    Connects to the compute service's terminal WebSocket and allows
    agents to execute commands and read output.
    """

    def __init__(
        self,
        workspace_id: str,
        session_id: str,
        agent_id: str,
    ) -> None:
        """Initialize terminal session.

        Args:
            workspace_id: The workspace/container ID.
            session_id: The session ID.
            agent_id: The agent ID.
        """
        self.workspace_id = workspace_id
        self.session_id = session_id
        self.agent_id = agent_id
        self._websocket: ClientConnection | None = None
        self._running = False
        self._output_buffer: list[str] = []
        self._read_task: asyncio.Task[None] | None = None

    async def connect(self) -> bool:
        """Connect to workspace terminal via compute service WebSocket.

        Returns:
            True if connected successfully.
        """
        try:
            # Build WebSocket URL from compute service URL
            compute_url = settings.COMPUTE_SERVICE_URL
            ws_url = compute_url.replace("http://", "ws://").replace("https://", "wss://")
            terminal_url = f"{ws_url}/terminal/{self.workspace_id}"

            logger.info(
                "Connecting to terminal",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
                url=terminal_url,
            )

            self._websocket = await websockets.connect(
                terminal_url,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
            )
            self._running = True

            # Start background output reader
            self._read_task = asyncio.create_task(self._read_output())

            logger.info(
                "Agent terminal connected",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
            )
            return True

        except Exception as e:
            logger.error(
                "Failed to connect agent terminal",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
                error=str(e),
            )
            return False

    async def execute_command(
        self,
        command: str,
        timeout: int = 60,
        wait_for_output: bool = True,
    ) -> dict[str, Any]:
        """Execute a command in the terminal and capture output.

        Args:
            command: The command to execute.
            timeout: Maximum time to wait for output in seconds.
            wait_for_output: Whether to wait for output before returning.

        Returns:
            Dict with success status, output, and command.
        """
        if not self._websocket or not self._running:
            return {
                "success": False,
                "error": "Terminal not connected",
                "command": command,
            }

        try:
            # Clear output buffer before sending command
            self._output_buffer.clear()

            # Send command with newline to execute
            await self._websocket.send(command + "\n")

            if wait_for_output:
                # Wait for output to accumulate
                # Use a simple strategy: wait for a brief period then check for output
                # This is a simple implementation - could be improved with command markers
                await asyncio.sleep(0.5)  # Initial wait for command to start

                # Wait up to timeout for output, checking every 100ms
                start_time = asyncio.get_event_loop().time()
                last_output_len = 0

                while (asyncio.get_event_loop().time() - start_time) < timeout:
                    await asyncio.sleep(0.1)
                    current_output_len = len(self._output_buffer)

                    # If output hasn't changed for a while, assume command is done
                    if current_output_len > 0 and current_output_len == last_output_len:
                        # Wait a bit more to make sure no more output is coming
                        await asyncio.sleep(0.3)
                        if len(self._output_buffer) == current_output_len:
                            break

                    last_output_len = current_output_len

            # Collect output
            output = "".join(self._output_buffer)

            logger.info(
                "Command executed",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
                command=command[:50] + "..." if len(command) > 50 else command,
                output_length=len(output),
            )

            return {
                "success": True,
                "output": output,
                "command": command,
            }

        except TimeoutError:
            output = "".join(self._output_buffer)
            return {
                "success": False,
                "error": "Command execution timed out",
                "output": output,
                "command": command,
            }
        except Exception as e:
            logger.error(
                "Command execution failed",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
                command=command,
                error=str(e),
            )
            return {
                "success": False,
                "error": str(e),
                "command": command,
            }

    async def _read_output(self) -> None:
        """Background task to read terminal output continuously."""
        if not self._websocket:
            return

        try:
            async for message in self._websocket:
                if not self._running:
                    break

                # Terminal output comes as bytes
                if isinstance(message, bytes):
                    try:
                        text = message.decode("utf-8", errors="replace")
                        self._output_buffer.append(text)
                    except Exception:  # noqa: S110
                        pass  # Non-UTF8 data is fine, just skip
                elif isinstance(message, str):
                    self._output_buffer.append(message)

        except websockets.exceptions.ConnectionClosed:
            logger.debug(
                "Terminal connection closed",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
            )
        except Exception as e:
            logger.warning(
                "Terminal read error",
                workspace_id=self.workspace_id,
                agent_id=self.agent_id,
                error=str(e),
            )
        finally:
            self._running = False

    async def close(self) -> None:
        """Close the terminal session."""
        self._running = False

        if self._read_task:
            self._read_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._read_task

        if self._websocket:
            with contextlib.suppress(Exception):
                await self._websocket.close()

        logger.info(
            "Agent terminal session closed",
            workspace_id=self.workspace_id,
            agent_id=self.agent_id,
        )

    @property
    def is_connected(self) -> bool:
        """Check if terminal is connected."""
        return self._running and self._websocket is not None


async def run_terminal_command(
    workspace_id: str,
    session_id: str,
    agent_id: str,
    command: str,
    timeout: int = 60,
) -> dict[str, Any]:
    """Run a command via terminal WebSocket.

    This is a convenience function that creates a session, executes
    the command, and closes the session.

    Args:
        workspace_id: The workspace/container ID.
        session_id: The session ID.
        agent_id: The agent ID.
        command: The command to execute.
        timeout: Maximum time to wait for output.

    Returns:
        Dict with success status, output, and command.
    """
    session = AgentTerminalSession(workspace_id, session_id, agent_id)

    try:
        if not await session.connect():
            return {
                "success": False,
                "error": "Failed to connect to terminal",
                "command": command,
            }

        result = await session.execute_command(command, timeout)
        return result

    finally:
        await session.close()
