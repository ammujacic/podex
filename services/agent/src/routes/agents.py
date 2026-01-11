"""Agent execution routes."""

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from src.orchestrator import AgentOrchestrator, AgentTask

router = APIRouter()
orchestrator = AgentOrchestrator()


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
