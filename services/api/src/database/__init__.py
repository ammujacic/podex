"""Database module for Podex API."""

from src.database.connection import (
    async_session_factory,
    close_database,
    engine,
    get_db,
    init_database,
    seed_database,
)

# Import all models from the new modular structure
from src.database.models import (
    # Core
    Agent,
    # Notifications
    AgentAttention,
    AgentPendingApproval,
    # Agent config
    AgentTemplate,
    AgentWorktree,
    # Base
    Base,
    # Billing
    BillingEvent,
    # Checkpoints
    ChangeSetFile,
    CheckpointFile,
    # Context
    CompactionLog,
    ContextCompactionSettings,
    ConversationSummary,
    CostAlert,
    CreditBalance,
    CreditTransaction,
    # User preferences
    CustomCommand,
    # Planning
    ExecutionPlan,
    FileChange,
    FileCheckpoint,
    HardwareSpec,
    Invoice,
    # Platform
    LLMModel,
    # Infrastructure
    LocalPod,
    MCPServer,
    Memory,
    Notification,
    PendingChangeSet,
    PlatformSetting,
    PodTemplate,
    PushSubscription,
    Session,
    SessionBudget,
    SessionCollaborator,
    SessionShare,
    Subagent,
    SubscriptionPlan,
    TaskProgress,
    UsageQuota,
    UsageRecord,
    User,
    UserBudget,
    UserConfig,
    # Knowledge
    UserCorrection,
    # Extensions
    UserExtension,
    UserHook,
    UserSubscription,
    WikiDocument,
    Workspace,
    WorkspaceExtension,
    WorkspaceTunnel,
    _generate_uuid,
)

__all__ = [
    "Agent",
    "AgentAttention",
    "AgentPendingApproval",
    # Agent config
    "AgentTemplate",
    "AgentWorktree",
    # Base
    "Base",
    "BillingEvent",
    "ChangeSetFile",
    "CheckpointFile",
    "CompactionLog",
    "ContextCompactionSettings",
    # Context
    "ConversationSummary",
    "CostAlert",
    "CreditBalance",
    "CreditTransaction",
    "CustomCommand",
    # Planning
    "ExecutionPlan",
    "FileChange",
    # Checkpoints
    "FileCheckpoint",
    "HardwareSpec",
    "Invoice",
    "LLMModel",
    "LocalPod",
    "MCPServer",
    "Memory",
    # Notifications
    "Notification",
    "PendingChangeSet",
    # Platform
    "PlatformSetting",
    # Infrastructure
    "PodTemplate",
    "PushSubscription",
    "Session",
    "SessionBudget",
    "SessionCollaborator",
    "SessionShare",
    "Subagent",
    # Billing
    "SubscriptionPlan",
    "TaskProgress",
    "UsageQuota",
    "UsageRecord",
    # Core
    "User",
    "UserBudget",
    # User preferences
    "UserConfig",
    "UserCorrection",
    # Extensions
    "UserExtension",
    "UserHook",
    "UserSubscription",
    # Knowledge
    "WikiDocument",
    "Workspace",
    "WorkspaceExtension",
    "WorkspaceTunnel",
    "_generate_uuid",
    # Connection
    "async_session_factory",
    "close_database",
    "engine",
    "get_db",
    "init_database",
    "seed_database",
]
