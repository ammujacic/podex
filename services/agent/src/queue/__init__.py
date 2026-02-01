"""Queue module for distributed task processing.

Workers:
- AgentTaskWorker: Processes main agent tasks from Redis queue
- SubagentTaskWorker: Processes subagent tasks from Redis queue
- CompactionTaskWorker: Processes context compaction tasks from Redis queue
- ApprovalListener: Listens for approval responses via Redis pub/sub
"""

from src.queue.agent_worker import AgentTaskWorker, get_agent_task_worker, set_agent_task_worker
from src.queue.approval_listener import (
    ApprovalListener,
    get_approval_listener,
    set_approval_listener,
)
from src.queue.compaction_worker import (
    CompactionTaskWorker,
    get_compaction_task_worker,
    set_compaction_task_worker,
)
from src.queue.subagent_worker import (
    SubagentTaskWorker,
    get_subagent_task_worker,
    set_subagent_task_worker,
)

__all__ = [
    "AgentTaskWorker",
    "ApprovalListener",
    "CompactionTaskWorker",
    "SubagentTaskWorker",
    "get_agent_task_worker",
    "get_approval_listener",
    "get_compaction_task_worker",
    "get_subagent_task_worker",
    "set_agent_task_worker",
    "set_approval_listener",
    "set_compaction_task_worker",
    "set_subagent_task_worker",
]
