"""Orchestrator-specific tool implementations.

These tools enable the OrchestratorAgent to create execution plans,
delegate tasks to specialized subagents, create custom agents, and synthesize results.

Task delegation uses the subagent system which provides:
- Context isolation (subagents don't pollute parent context)
- Role-based specialization (coder, reviewer, tester, planner, researcher)
- Background execution support
- Distributed processing via Redis queues
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import uuid4

import structlog

from podex_shared.redis_client import get_redis_client
from src.config import settings
from src.config_reader import get_config_reader
from src.providers.llm import LLMProvider
from src.subagent import SubagentStatus, get_subagent_manager

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
    parent_agent_id: str,
    agent_role: str,
    description: str,
    background: bool = False,
    system_prompt: str | None = None,
) -> dict[str, Any]:
    """Delegate a task to a specialized subagent.

    Uses the subagent system to spawn an isolated agent that executes
    the task without polluting the parent agent's context. The result
    is returned as a summary.

    Args:
        session_id: The session this task belongs to.
        parent_agent_id: The parent agent spawning this subagent.
        agent_role: Target agent role (must exist in database and be delegatable).
        description: Task description with requirements.
        background: If True, run asynchronously and return immediately.
        system_prompt: Optional custom system prompt (uses role default if not provided).

    Returns:
        Dictionary with subagent info and result (or task_id if background).
    """
    try:
        # Validate role via ConfigReader (roles are in Redis, synced from database)
        config = get_config_reader()
        role_name = agent_role.lower()

        if not await config.is_delegatable_role(role_name):
            delegatable = await config.get_delegatable_roles()
            valid_roles = [r["role"] for r in delegatable]
            return {
                "success": False,
                "error": f"Invalid agent role: {agent_role}. Must be one of: {valid_roles}",
            }

        # Get the subagent manager
        manager = get_subagent_manager()

        # Spawn the subagent (manager validates role and gets system_prompt from Redis)
        subagent = await manager.spawn_subagent(
            parent_agent_id=parent_agent_id,
            session_id=session_id,
            role=role_name,
            task=description,
            background=background,
            system_prompt=system_prompt,
        )

        logger.info(
            "Task delegated to subagent",
            subagent_id=subagent.id,
            role=role_name,
            session_id=session_id,
            background=background,
        )

        if background:
            # Return immediately with task ID for later retrieval
            return {
                "success": True,
                "subagent_id": subagent.id,
                "role": role_name,
                "status": subagent.status.value,
                "message": (
                    f"Background task delegated to {role_name} subagent. "
                    "Use get_subagent_status to check progress."
                ),
            }
        else:
            # Task completed synchronously
            return {
                "success": subagent.status == SubagentStatus.COMPLETED,
                "subagent_id": subagent.id,
                "role": role_name,
                "status": subagent.status.value,
                "result": subagent.result_summary,
                "error": subagent.error,
                "tokens_used": subagent.context.tokens_used,
            }
    except ValueError as e:
        # Max concurrent subagents exceeded or invalid role
        logger.warning("Failed to delegate task", error=str(e))
        return {"success": False, "error": str(e)}
    except Exception as e:
        logger.error("Failed to delegate task", error=str(e))
        return {"success": False, "error": str(e)}


async def create_custom_agent(
    session_id: str,
    name: str,
    system_prompt: str,
    tools: list[str],
    model: str,
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
    if not model:
        return {
            "success": False,
            "error": "Model is required to create a custom agent. "
            "Pass an explicit model or configure role defaults in the platform settings.",
        }
    try:
        # Validate tools against database (via Redis)
        config = get_config_reader()
        valid_tools = await config.get_tool_names()
        if not valid_tools:
            return {
                "success": False,
                "error": "Failed to load tools from configuration. "
                "Ensure the API service is running and has synced tools to Redis.",
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
        agent_config = {
            "agent_id": agent_id,
            "name": name,
            "system_prompt": system_prompt,
            "tools": tools,
            "model": model,
        }

        await redis_client.set_json(config_key, agent_config, ex=CUSTOM_AGENT_TTL)

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


async def get_subagent_status(subagent_id: str) -> dict[str, Any]:
    """Get the status of a delegated subagent task.

    Args:
        subagent_id: Subagent ID to check.

    Returns:
        Dictionary with subagent status and result.
    """
    try:
        manager = get_subagent_manager()
        subagent = manager.get_subagent(subagent_id)

        if not subagent:
            return {"success": False, "error": f"Subagent {subagent_id} not found"}

        return {
            "success": True,
            "subagent_id": subagent.id,
            "status": subagent.status.value,
            "role": subagent.role,
            "task": subagent.task[:500],  # Truncate for readability
            "result": subagent.result_summary,
            "error": subagent.error,
            "tokens_used": subagent.context.tokens_used,
            "background": subagent.background,
        }
    except Exception as e:
        logger.error("Failed to get subagent status", error=str(e))
        return {"success": False, "error": str(e)}


async def wait_for_subagents(
    subagent_ids: list[str],
    timeout_seconds: int = 300,
) -> dict[str, Any]:
    """Wait for multiple subagent tasks to complete.

    Args:
        subagent_ids: List of subagent IDs to wait for.
        timeout_seconds: Maximum seconds to wait.

    Returns:
        Dictionary with completion status and results.
    """
    try:
        manager = get_subagent_manager()
        results: dict[str, dict[str, Any]] = {}
        pending = set(subagent_ids)

        # Wait for each subagent
        for subagent_id in subagent_ids:
            try:
                subagent = await manager.wait_for_subagent(
                    subagent_id,
                    timeout=float(timeout_seconds),
                )
                if subagent:
                    results[subagent_id] = {
                        "status": subagent.status.value,
                        "result": subagent.result_summary,
                        "error": subagent.error,
                        "role": subagent.role,
                        "tokens_used": subagent.context.tokens_used,
                    }
                    if subagent.status in (
                        SubagentStatus.COMPLETED,
                        SubagentStatus.FAILED,
                        SubagentStatus.CANCELLED,
                    ):
                        pending.discard(subagent_id)
                else:
                    results[subagent_id] = {
                        "status": "not_found",
                        "error": f"Subagent {subagent_id} not found",
                    }
                    pending.discard(subagent_id)
            except TimeoutError:
                results[subagent_id] = {
                    "status": "timeout",
                    "error": "Subagent did not complete within timeout",
                }

        return {
            "success": len(pending) == 0,
            "completed": len(subagent_ids) - len(pending),
            "total": len(subagent_ids),
            "results": results,
            "timed_out": list(pending),
        }
    except Exception as e:
        logger.error("Failed to wait for subagents", error=str(e))
        return {"success": False, "error": str(e)}


async def get_active_subagents(parent_agent_id: str) -> dict[str, Any]:
    """Get all active subagents for a parent agent.

    Args:
        parent_agent_id: The parent agent ID.

    Returns:
        Dictionary with subagent lists and stats.
    """
    try:
        manager = get_subagent_manager()

        all_subagents = manager.get_subagents(parent_agent_id)
        active = manager.get_active_subagents(parent_agent_id)

        # Calculate stats
        stats = {
            "total": len(all_subagents),
            "active": len(active),
            "completed": len([s for s in all_subagents if s.status == SubagentStatus.COMPLETED]),
            "failed": len([s for s in all_subagents if s.status == SubagentStatus.FAILED]),
        }

        return {
            "success": True,
            "stats": stats,
            "active_subagents": [
                {
                    "subagent_id": s.id,
                    "role": s.role,
                    "task": s.task[:100],
                    "status": s.status.value,
                    "background": s.background,
                    "tokens_used": s.context.tokens_used,
                }
                for s in active
            ],
            "all_subagents": [
                {
                    "subagent_id": s.id,
                    "role": s.role,
                    "task": s.task[:100],
                    "status": s.status.value,
                    "result": s.result_summary[:200] if s.result_summary else None,
                }
                for s in all_subagents
            ],
        }
    except Exception as e:
        logger.error("Failed to get active subagents", error=str(e))
        return {"success": False, "error": str(e)}


async def synthesize_results(
    subagent_ids: list[str],
    synthesis_instructions: str = "",
) -> dict[str, Any]:
    """Gather results from completed subagent tasks for synthesis.

    Args:
        subagent_ids: Subagent IDs to gather results from.
        synthesis_instructions: How to combine/summarize results.

    Returns:
        Dictionary with gathered results.
    """
    try:
        manager = get_subagent_manager()
        results = []

        for subagent_id in subagent_ids:
            subagent = manager.get_subagent(subagent_id)
            if subagent:
                results.append(
                    {
                        "subagent_id": subagent.id,
                        "role": subagent.role,
                        "task": subagent.task,
                        "status": subagent.status.value,
                        "result": subagent.result_summary,
                        "error": subagent.error,
                        "tokens_used": subagent.context.tokens_used,
                    },
                )

        return {
            "success": True,
            "subagent_count": len(results),
            "results": results,
            "synthesis_instructions": synthesis_instructions,
        }
    except Exception as e:
        logger.error("Failed to synthesize results", error=str(e))
        return {"success": False, "error": str(e)}
