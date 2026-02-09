"""Agent service routes.

Note: All inter-service communication has been moved to Redis queues and pub/sub:

1. Task execution: Redis queue (AgentTaskWorker)
2. Context compaction: Redis queue (CompactionTaskWorker)
3. Control commands (abort, pause, resume): Redis pub/sub (AgentTaskWorker)
4. Approval resolution: Redis pub/sub (ApprovalListener)

This file is kept for potential future HTTP endpoints that require
immediate, synchronous responses that can't be handled via Redis.

The previous approval endpoint has been removed because:
- Approvals are now resolved via Redis pub/sub (podex:approvals:responses channel)
- This enables horizontal scaling of agent services
- Any agent instance can receive the approval response, not just one specific instance
"""

import structlog
from fastapi import APIRouter

router = APIRouter()
logger = structlog.get_logger()


# No HTTP routes currently needed - all communication via Redis
# This router is kept for potential future endpoints
