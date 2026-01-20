"""Orchestrator-specific tool implementations.

These tools enable the OrchestratorAgent to create execution plans,
delegate tasks to other agents, create custom agents, and synthesize results.
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import structlog

from podex_shared.redis_client import get_redis_client
from src.config import settings
from src.providers.llm import LLMProvider
from src.queue.task_queue import EnqueueParams, TaskStatus
from src.tools.task_tools import get_session_task_stats, get_task_queue

if TYPE_CHECKING:
    from src.orchestrator import AgentOrchestrator

logger = structlog.get_logger()

# Redis key for storing runtime custom agent configs
CUSTOM_AGENT_KEY = "podex:orchestrator:custom_agent:{session_id}:{agent_id}"
CUSTOM_AGENT_TTL = 86400  # 24 hours

# Singleton orchestrator instance to reuse across calls
_orchestrator_instance: AgentOrchestrator | None = None


def _get_orchestrator() -> AgentOrchestrator:
    """Get or create singleton orchestrator instance."""
    global _orchestrator_instance
    if _orchestrator_instance is None:
        from src.orchestrator import AgentOrchestrator

        _orchestrator_instance = AgentOrchestrator()
    return _orchestrator_instance


async def create_execution_plan(
    session_id: str,
    agent_id: str,
    task_description: str,
    context: str = "",
    agent_mode: str = "ask",
) -> dict[str, Any]:
    """Create an execution plan using the Planner.

    Args:
        session_id: The session ID.
        agent_id: The orchestrator agent ID.
        task_description: Description of the task to plan.
        context: Additional context for planning.
        agent_mode: The agent's execution mode (ask, auto, sovereign, plan).

    Returns:
        Dictionary with plan details or error.
    """
    # Late import to avoid circular dependency with tools/executor.py
    from src.planning.planner import Planner, PlanStatus

    try:
        redis_client = get_redis_client(settings.REDIS_URL)
        try:
            await redis_client.connect()
        except Exception as conn_err:
            logger.error("Failed to connect to Redis", error=str(conn_err))
            return {"success": False, "error": f"Redis connection failed: {conn_err}"}

        planner = Planner(redis_client, LLMProvider())
        plan = await planner.create_plan(
            session_id=session_id,
            agent_id=agent_id,
            task_description=task_description,
            context=context,
        )

        # Auto-approve and execute if agent is in auto or sovereign mode
        auto_execute = agent_mode in ("auto", "sovereign")
        if auto_execute:
            plan.status = PlanStatus.APPROVED
            await planner._save_plan(plan)
            logger.info(
                "Plan auto-approved due to agent mode",
                plan_id=plan.id,
                agent_mode=agent_mode,
            )

        return {
            "success": True,
            "plan_id": plan.id,
            "title": plan.title,
            "description": plan.description,
            "steps": [
                {
                    "order": s.order,
                    "action_type": s.action_type,
                    "description": s.description,
                    "confidence": s.confidence,
                }
                for s in plan.steps
            ],
            "confidence_score": plan.confidence_score,
            "status": plan.status.value,
            "auto_execute": auto_execute,
        }
    except Exception as e:
        logger.error("Failed to create execution plan", error=str(e))
        return {"success": False, "error": str(e)}


async def delegate_task(
    session_id: str,
    agent_role: str,
    description: str,
    priority: str = "medium",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Delegate a task to an agent via the task queue.

    Args:
        session_id: The session this task belongs to.
        agent_role: Target agent role (coder, reviewer, tester, architect).
        description: Task description with requirements.
        priority: Task priority (high, medium, low).
        context: Optional context data for the task.

    Returns:
        Dictionary with task info or error.
    """
    try:
        # Validate agent role
        valid_roles = {"coder", "reviewer", "tester", "architect", "agent_builder", "orchestrator"}
        if agent_role not in valid_roles:
            return {
                "success": False,
                "error": f"Invalid agent role: {agent_role}. Must be one of: {valid_roles}",
            }

        # Validate priority
        valid_priorities = {"high", "medium", "low"}
        if priority not in valid_priorities:
            priority = "medium"

        # Enqueue task
        queue = get_task_queue()
        enqueue_params = EnqueueParams(
            session_id=session_id,
            agent_role=agent_role,
            description=description,
            priority=priority,
            context=context,
        )
        task_id = await queue.enqueue(enqueue_params)

        logger.info(
            "Task delegated",
            task_id=task_id,
            agent_role=agent_role,
            priority=priority,
            session_id=session_id,
        )

        return {
            "success": True,
            "task_id": task_id,
            "agent_role": agent_role,
            "priority": priority,
            "message": f"Task delegated to {agent_role} agent",
        }
    except Exception as e:
        logger.error("Failed to delegate task", error=str(e))
        return {"success": False, "error": str(e)}


async def create_custom_agent(
    session_id: str,
    name: str,
    system_prompt: str,
    tools: list[str],
    model: str = "claude-sonnet-4-20250514",
) -> dict[str, Any]:
    """Create a custom agent at runtime.

    The agent config is stored in Redis for the session duration.
    This allows creating specialized agents without database persistence.

    Args:
        session_id: The session ID.
        name: Descriptive name for the agent.
        system_prompt: System prompt defining agent behavior.
        tools: List of tools to enable.
        model: LLM model to use.

    Returns:
        Dictionary with agent info or error.
    """
    try:
        # Validate tools - includes orchestration tools for creating powerful sub-agents
        valid_tools = {
            # Basic file tools
            "read_file",
            "write_file",
            "search_code",
            "run_command",
            "list_directory",
            # Task delegation tools - allows custom agents to delegate work
            "create_task",
            "delegate_task",
            "get_task_status",
            "wait_for_tasks",
            "get_all_pending_tasks",
            # Git tools
            "git_status",
            "git_diff",
            "git_commit",
            "git_push",
            "git_branch",
            "git_log",
        }
        invalid_tools = set(tools) - valid_tools
        if invalid_tools:
            return {
                "success": False,
                "error": f"Invalid tools: {invalid_tools}. Valid tools: {valid_tools}",
            }

        # Generate unique agent ID
        agent_id = f"custom-{name.lower().replace(' ', '-')}-{uuid4().hex[:8]}"

        # Store config in Redis
        redis_client = get_redis_client(settings.REDIS_URL)
        try:
            await redis_client.connect()
        except Exception as conn_err:
            logger.error("Failed to connect to Redis", error=str(conn_err))
            return {"success": False, "error": f"Redis connection failed: {conn_err}"}

        config_key = CUSTOM_AGENT_KEY.format(session_id=session_id, agent_id=agent_id)
        config = {
            "agent_id": agent_id,
            "name": name,
            "system_prompt": system_prompt,
            "tools": tools,
            "model": model,
        }

        await redis_client.set_json(config_key, config, ex=CUSTOM_AGENT_TTL)

        logger.info(
            "Custom agent created",
            agent_id=agent_id,
            name=name,
            tools=tools,
            session_id=session_id,
        )

        return {
            "success": True,
            "agent_id": agent_id,
            "name": name,
            "tools": tools,
            "model": model,
            "message": (
                f"Custom agent '{name}' created. Use delegate_to_custom_agent to assign tasks."
            ),
        }
    except Exception as e:
        logger.error("Failed to create custom agent", error=str(e))
        return {"success": False, "error": str(e)}


async def delegate_to_custom_agent(
    session_id: str,
    agent_id: str,
    message: str,
) -> dict[str, Any]:
    """Delegate a task to a custom agent and get the response.

    Args:
        session_id: The session ID.
        agent_id: ID of the custom agent.
        message: Task message for the agent.

    Returns:
        Dictionary with agent response or error.
    """
    try:
        # Retrieve custom agent config from Redis
        redis_client = get_redis_client(settings.REDIS_URL)
        try:
            await redis_client.connect()
        except Exception as conn_err:
            logger.error("Failed to connect to Redis", error=str(conn_err))
            return {"success": False, "error": f"Redis connection failed: {conn_err}"}

        config_key = CUSTOM_AGENT_KEY.format(session_id=session_id, agent_id=agent_id)
        config = await redis_client.get_json(config_key)

        if not config or not isinstance(config, dict):
            return {
                "success": False,
                "error": (
                    f"Custom agent '{agent_id}' not found. Create it first "
                    "with create_custom_agent."
                ),
            }

        # Create template config (late import to avoid circular dependency)
        from src.agents.custom import AgentTemplateConfig

        template_config = AgentTemplateConfig(
            name=str(config["name"]),
            system_prompt=str(config["system_prompt"]),
            allowed_tools=list(config["tools"]),
            model=str(config["model"]),
        )

        # Get or create the agent instance using singleton orchestrator
        from src.orchestrator import AgentCreationParams

        orchestrator = _get_orchestrator()
        agent_params = AgentCreationParams(
            agent_id=agent_id,
            role="custom",
            model=str(config["model"]),
            session_id=session_id,
            template_config=template_config,
        )
        agent = await orchestrator.get_or_create_agent(agent_params)

        # Load conversation history to ensure context is preserved
        await agent.load_conversation_history()

        # Execute the agent
        response = await agent.execute(message)

        return {
            "success": True,
            "agent_id": agent_id,
            "response": response.content,
            "tool_calls": response.tool_calls,
            "tokens_used": response.tokens_used,
        }
    except Exception as e:
        logger.error("Failed to delegate to custom agent", error=str(e))
        return {"success": False, "error": str(e)}


async def get_task_status(task_id: str) -> dict[str, Any]:
    """Get the status of a delegated task.

    Args:
        task_id: Task ID to check.

    Returns:
        Dictionary with task status and result.
    """
    try:
        queue = get_task_queue()
        task = await queue.get_task(task_id)

        if not task:
            return {"success": False, "error": f"Task {task_id} not found"}

        return {
            "success": True,
            "task_id": task.id,
            "status": task.status.value,
            "agent_role": task.agent_role,
            "description": task.description[:500],  # Truncate for readability
            "result": task.result,
            "error": task.error,
            "assigned_agent_id": task.assigned_agent_id,
        }
    except Exception as e:
        logger.error("Failed to get task status", error=str(e))
        return {"success": False, "error": str(e)}


async def wait_for_tasks(
    session_id: str,  # noqa: ARG001 - Required by tool interface for future use
    task_ids: list[str],
    timeout_seconds: int = 300,
) -> dict[str, Any]:
    """Wait for multiple tasks to complete.

    Args:
        session_id: The session ID (reserved for future session-scoped filtering).
        task_ids: List of task IDs to wait for.
        timeout_seconds: Maximum seconds to wait.

    Returns:
        Dictionary with completion status and results.
    """
    try:
        queue = get_task_queue()
        results: dict[str, dict[str, Any]] = {}
        start_time = time.monotonic()
        poll_interval = 0.5  # Check every 500ms for faster response

        pending = set(task_ids)

        while pending:
            # Check timeout before doing work
            elapsed = time.monotonic() - start_time
            if elapsed >= timeout_seconds:
                break

            for task_id in list(pending):
                task = await queue.get_task(task_id)
                if task and task.status in (
                    TaskStatus.COMPLETED,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                ):
                    results[task_id] = {
                        "status": task.status.value,
                        "result": task.result,
                        "error": task.error,
                        "agent_role": task.agent_role,
                    }
                    pending.discard(task_id)

            if pending:
                # Calculate remaining time and don't sleep longer than needed
                remaining = timeout_seconds - (time.monotonic() - start_time)
                if remaining > 0:
                    await asyncio.sleep(min(poll_interval, remaining))

        # Handle timeout for remaining tasks
        for task_id in pending:
            results[task_id] = {
                "status": "timeout",
                "error": "Task did not complete within timeout",
            }

        return {
            "success": len(pending) == 0,
            "completed": len(task_ids) - len(pending),
            "total": len(task_ids),
            "results": results,
            "timed_out": list(pending),
        }
    except Exception as e:
        logger.error("Failed to wait for tasks", error=str(e))
        return {"success": False, "error": str(e)}


async def get_all_pending_tasks(session_id: str) -> dict[str, Any]:
    """Get all pending and active tasks in the session.

    Args:
        session_id: The session ID.

    Returns:
        Dictionary with task lists and stats.
    """
    try:
        queue = get_task_queue()

        pending = await queue.get_pending_tasks(session_id)
        stats = await get_session_task_stats(session_id)

        return {
            "success": True,
            "stats": stats,
            "pending_tasks": [
                {
                    "task_id": t.id,
                    "agent_role": t.agent_role,
                    "description": t.description[:100],
                    "priority": t.priority.value if hasattr(t.priority, "value") else t.priority,
                    "status": t.status.value if hasattr(t.status, "value") else t.status,
                }
                for t in pending
            ],
        }
    except Exception as e:
        logger.error("Failed to get pending tasks", error=str(e))
        return {"success": False, "error": str(e)}


async def synthesize_results(
    session_id: str,  # noqa: ARG001 - Required by tool interface for future use
    task_ids: list[str],
    synthesis_instructions: str = "",
) -> dict[str, Any]:
    """Gather results from completed tasks for synthesis.

    Args:
        session_id: The session ID (reserved for future session-scoped filtering).
        task_ids: Task IDs to gather results from.
        synthesis_instructions: How to combine/summarize results.

    Returns:
        Dictionary with gathered results.
    """
    try:
        queue = get_task_queue()
        results = []

        for task_id in task_ids:
            task = await queue.get_task(task_id)
            if task:
                results.append(
                    {
                        "task_id": task.id,
                        "agent_role": task.agent_role,
                        "description": task.description,
                        "status": task.status.value
                        if hasattr(task.status, "value")
                        else task.status,
                        "result": task.result,
                        "error": task.error,
                    },
                )

        return {
            "success": True,
            "task_count": len(results),
            "results": results,
            "synthesis_instructions": synthesis_instructions,
        }
    except Exception as e:
        logger.error("Failed to synthesize results", error=str(e))
        return {"success": False, "error": str(e)}
