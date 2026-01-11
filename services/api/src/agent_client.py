"""Client for communicating with the Agent service."""

import asyncio
from typing import Any

import httpx
import structlog

from src.config import settings
from src.exceptions import (
    AgentServiceConnectionError,
    AgentServiceHTTPError,
    AgentServiceTimeoutError,
    AgentTaskFailedError,
    AgentTaskMissingIdError,
    AgentTaskNoResponseError,
    AgentTaskNotFoundError,
    AgentTaskTimeoutError,
)

logger = structlog.get_logger()


class AgentClient:
    """HTTP client for agent service communication."""

    def __init__(self) -> None:
        """Initialize the agent client."""
        self.base_url = settings.AGENT_SERVICE_URL.rstrip("/")
        self.timeout = httpx.Timeout(30.0, connect=5.0)

    async def _request(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make an HTTP request to the agent service.

        Args:
            method: HTTP method (GET, POST, etc.)
            path: API path (e.g., /agents/execute)
            json: Optional JSON body

        Returns:
            Response JSON as dict

        Raises:
            AgentClientError: If the request fails
        """
        url = f"{self.base_url}{path}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(method, url, json=json)
                response.raise_for_status()
                result: dict[str, Any] = response.json()
                return result
        except httpx.TimeoutException as e:
            logger.warning("Agent service timeout", url=url, error=str(e))
            raise AgentServiceTimeoutError(str(e)) from e
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Agent service HTTP error",
                url=url,
                status=e.response.status_code,
                error=str(e),
            )
            raise AgentServiceHTTPError(e.response.status_code, e.response.text) from e
        except httpx.RequestError as e:
            logger.warning("Agent service request error", url=url, error=str(e))
            raise AgentServiceConnectionError(str(e)) from e

    async def execute(
        self,
        session_id: str,
        agent_id: str,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """Submit a task to the agent service and wait for completion.

        Args:
            session_id: The session ID
            agent_id: The agent ID
            message: The user message to process
            context: Optional context dict (role, model, template_config, etc.)

        Returns:
            The agent's response content

        Raises:
            AgentClientError: If execution fails
        """
        # Submit the task
        result = await self._request(
            "POST",
            "/agents/execute",
            json={
                "session_id": session_id,
                "agent_id": agent_id,
                "message": message,
                "context": context or {},
            },
        )

        task_id = result.get("task_id")
        if not task_id:
            raise AgentTaskMissingIdError

        logger.info(
            "Task submitted to agent service",
            task_id=task_id,
            agent_id=agent_id,
        )

        # Poll for completion
        return await self._wait_for_task(task_id)

    async def _wait_for_task(self, task_id: str) -> str:
        """Wait for a task to complete.

        Args:
            task_id: The task ID to wait for

        Returns:
            The task response content

        Raises:
            AgentClientError: If the task fails or times out
        """
        poll_interval = settings.AGENT_TASK_POLL_INTERVAL
        timeout = settings.AGENT_TASK_TIMEOUT
        elapsed = 0.0

        while elapsed < timeout:
            status = await self.get_task_status(task_id)
            task_status = status.get("status")

            if task_status == "completed":
                response: str | None = status.get("response")
                if response is None:
                    raise AgentTaskNoResponseError
                return response

            if task_status == "failed":
                error = status.get("error", "Unknown error")
                raise AgentTaskFailedError(error)

            if task_status == "not_found":
                raise AgentTaskNotFoundError(task_id)

            # Still pending or running
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise AgentTaskTimeoutError(task_id, timeout)

    async def get_task_status(self, task_id: str) -> dict[str, Any]:
        """Get the status of a task.

        Args:
            task_id: The task ID

        Returns:
            Task status dict with status, response, tool_calls, error
        """
        return await self._request("GET", f"/agents/tasks/{task_id}")

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        """Cancel a running or pending task.

        Args:
            task_id: The task ID to cancel

        Returns:
            Cancellation result with success status
        """
        return await self._request("POST", f"/agents/tasks/{task_id}/cancel")

    async def abort_agent(self, agent_id: str) -> dict[str, Any]:
        """Abort all running tasks for an agent.

        Args:
            agent_id: The agent ID whose tasks should be aborted

        Returns:
            Abort result with success status and cancelled count
        """
        return await self._request("POST", f"/agents/agents/{agent_id}/abort")

    async def pause_agent(self, agent_id: str) -> dict[str, Any]:
        """Pause a running agent.

        Unlike abort, this preserves the agent's state for later resumption.

        Args:
            agent_id: The agent ID to pause

        Returns:
            Pause result with success status
        """
        return await self._request("POST", f"/agents/agents/{agent_id}/pause")

    async def resume_agent(self, agent_id: str) -> dict[str, Any]:
        """Resume a paused agent.

        The agent will continue from where it was paused.

        Args:
            agent_id: The agent ID to resume

        Returns:
            Resume result with success status
        """
        return await self._request("POST", f"/agents/agents/{agent_id}/resume")

    async def execute_streaming(
        self,
        session_id: str,
        agent_id: str,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> tuple[str, list[dict[str, Any]], int]:
        """Execute and return both response and tool calls.

        Args:
            session_id: The session ID
            agent_id: The agent ID
            message: The user message to process
            context: Optional context dict

        Returns:
            Tuple of (response_content, tool_calls, tokens_used)
        """
        # Submit the task
        result = await self._request(
            "POST",
            "/agents/execute",
            json={
                "session_id": session_id,
                "agent_id": agent_id,
                "message": message,
                "context": context or {},
            },
        )

        task_id = result.get("task_id")
        if not task_id:
            raise AgentTaskMissingIdError

        # Poll for completion
        poll_interval = settings.AGENT_TASK_POLL_INTERVAL
        timeout = settings.AGENT_TASK_TIMEOUT
        elapsed = 0.0

        while elapsed < timeout:
            status = await self.get_task_status(task_id)
            task_status = status.get("status")

            if task_status == "completed":
                response = status.get("response", "")
                tool_calls = status.get("tool_calls", [])
                tokens_used = status.get("tokens_used", 0)
                return response, tool_calls, tokens_used

            if task_status == "failed":
                error = status.get("error", "Unknown error")
                raise AgentTaskFailedError(error)

            if task_status == "not_found":
                raise AgentTaskNotFoundError(task_id)

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise AgentTaskTimeoutError(task_id, timeout)


# Global client instance
agent_client = AgentClient()
