"""Agent execution routes."""

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select

from src.context.summarizer import ConversationSummarizer
from src.context.tokenizer import Tokenizer
from src.database.connection import get_db_context
from src.database.models import Agent, Message
from src.deps import require_internal_service_token
from src.orchestrator import AgentOrchestrator, AgentTask
from src.providers.llm import LLMProvider

router = APIRouter(dependencies=[Depends(require_internal_service_token)])
orchestrator = AgentOrchestrator()
logger = structlog.get_logger()


class ExecuteRequest(BaseModel):
    """Agent execution request."""

    session_id: str
    agent_id: str
    message: str
    context: dict[str, object] | None = None


class ExecuteResponse(BaseModel):
    """Agent execution response."""

    task_id: str
    status: str


@router.post("/execute", response_model=ExecuteResponse)
async def execute_agent(
    request: ExecuteRequest,
    background_tasks: BackgroundTasks,
) -> ExecuteResponse:
    """Execute an agent task."""
    task = AgentTask(
        session_id=request.session_id,
        agent_id=request.agent_id,
        message=request.message,
        context=request.context or {},
    )

    # Execute in background
    task_id = await orchestrator.submit_task(task)
    background_tasks.add_task(orchestrator.process_task, task_id)

    return ExecuteResponse(task_id=task_id, status="submitted")


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str) -> dict[str, object]:
    """Get task status."""
    status = await orchestrator.get_task_status(task_id)
    return {"task_id": task_id, **status}


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict[str, object]:
    """Cancel a running or pending task."""
    result = await orchestrator.cancel_task(task_id)
    return {"task_id": task_id, **result}


@router.post("/agents/{agent_id}/abort")
async def abort_agent_tasks(agent_id: str) -> dict[str, object]:
    """Abort all running tasks for an agent."""
    result = await orchestrator.cancel_agent_tasks(agent_id)
    return {"agent_id": agent_id, **result}


class CompactRequest(BaseModel):
    """Context compaction request."""

    custom_instructions: str | None = None
    preserve_recent_messages: int = 15


class CompactResponse(BaseModel):
    """Context compaction response."""

    tokens_before: int
    tokens_after: int
    messages_removed: int
    messages_preserved: int
    summary: str | None = None


@router.post("/agents/{agent_id}/compact", response_model=CompactResponse)
async def compact_agent_context(
    agent_id: str,
    request: CompactRequest,
) -> CompactResponse:
    """Compact an agent's conversation context.

    This endpoint:
    1. Loads the agent's conversation history
    2. Summarizes older messages using the LLM
    3. Removes old messages from the database
    4. Returns compaction statistics
    """
    async with get_db_context() as db:
        # Verify agent exists
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalar_one_or_none()

        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        # Load all messages for this agent
        messages_result = await db.execute(
            select(Message).where(Message.agent_id == agent_id).order_by(Message.created_at.asc())
        )
        messages = list(messages_result.scalars().all())

        if not messages:
            return CompactResponse(
                tokens_before=0,
                tokens_after=0,
                messages_removed=0,
                messages_preserved=0,
                summary=None,
            )

        # Calculate tokens before compaction
        tokenizer = Tokenizer(agent.model)
        messages_as_dicts = [
            {"role": msg.role, "content": msg.content, "id": msg.id} for msg in messages
        ]
        tokens_before = tokenizer.count_messages(messages_as_dicts)

        # Determine how many messages to preserve
        preserve_count = request.preserve_recent_messages
        if len(messages) <= preserve_count:
            # Nothing to compact
            return CompactResponse(
                tokens_before=tokens_before,
                tokens_after=tokens_before,
                messages_removed=0,
                messages_preserved=len(messages),
                summary=None,
            )

        # Split messages into those to summarize and those to keep
        messages_to_summarize = messages[:-preserve_count]
        messages_to_keep = messages[-preserve_count:]

        # Create summary of old messages
        summary_text = None
        if messages_to_summarize:
            try:
                llm_provider = LLMProvider()
                summarizer = ConversationSummarizer(llm_provider)

                messages_to_summarize_dicts = [
                    {"role": msg.role, "content": msg.content} for msg in messages_to_summarize
                ]

                # Add custom instructions to summarization if provided
                if request.custom_instructions:
                    logger.info(
                        "Using custom compaction instructions",
                        agent_id=agent_id,
                        instructions=request.custom_instructions[:100],
                    )

                summary = await summarizer.create_summary(
                    agent_id=agent_id,
                    messages=messages_to_summarize_dicts,
                )
                summary_text = summary.summary

                # Delete old messages from database
                message_ids_to_delete = [msg.id for msg in messages_to_summarize]
                await db.execute(delete(Message).where(Message.id.in_(message_ids_to_delete)))

                # Insert summary as a system message at the beginning
                summary_message = Message(
                    agent_id=agent_id,
                    role="system",
                    content=f"[Previous conversation summary]\n{summary_text}",
                )
                db.add(summary_message)

                await db.commit()

                logger.info(
                    "Compaction completed",
                    agent_id=agent_id,
                    messages_removed=len(messages_to_summarize),
                    messages_preserved=len(messages_to_keep) + 1,  # +1 for summary
                )

            except Exception as e:
                logger.exception("Failed to create summary", agent_id=agent_id)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create conversation summary: {e!s}",
                ) from e

        # Calculate tokens after compaction
        preserved_messages_dicts = [
            {"role": msg.role, "content": msg.content} for msg in messages_to_keep
        ]
        if summary_text:
            preserved_messages_dicts.insert(
                0, {"role": "system", "content": f"[Previous conversation summary]\n{summary_text}"}
            )
        tokens_after = tokenizer.count_messages(preserved_messages_dicts)

        return CompactResponse(
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            messages_removed=len(messages_to_summarize),
            messages_preserved=len(messages_to_keep) + (1 if summary_text else 0),
            summary=summary_text,
        )
