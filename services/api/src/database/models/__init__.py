"""SQLAlchemy models for Podex database.

All models are organized into domain-specific modules:
- base.py: Base class and utilities
- core.py: User, Session, Agent, Message, Workspace
- agent_config.py: AgentTemplate, TerminalIntegratedAgentType, Subagent, AgentWorktree
- billing.py: SubscriptionPlan, UserSubscription, UsageRecord, Invoice, etc.
- checkpoints.py: FileCheckpoint, CheckpointFile, PendingChangeSet, ChangeSetFile
- user_preferences.py: UserConfig, UserHook, CustomCommand
- context.py: ConversationSummary, Memory, ContextCompactionSettings, CompactionLog
- infrastructure.py: PodTemplate, LocalPod, MCPServer
- notifications.py: Notification, PushSubscription, AgentAttention
- organization.py: Organization, OrganizationMember, OrganizationSubscription, etc.
- planning.py: ExecutionPlan, TaskProgress
- knowledge.py: WikiDocument, UserCorrection
- platform.py: PlatformSetting, LLMModel
- extensions.py: UserExtension, WorkspaceExtension
"""

# Base class and utilities
# Agent configuration models
from .agent_config import (
    AgentTemplate,
    AgentWorktree,
    ExternalAgentEnvProfile,
    Subagent,
    TerminalAgentSession,
    TerminalIntegratedAgentType,
)
from .base import Base, _generate_uuid

# Billing models
from .billing import (
    BillingEvent,
    CostAlert,
    CreditBalance,
    CreditTransaction,
    HardwareSpec,
    Invoice,
    SessionBudget,
    SubscriptionPlan,
    UsageQuota,
    UsageRecord,
    UserBudget,
    UserSubscription,
)

# Checkpoint models
from .checkpoints import (
    ChangeSetFile,
    CheckpointFile,
    FileCheckpoint,
    PendingChangeSet,
)

# Context management models
from .context import (
    CompactionLog,
    ContextCompactionSettings,
    ConversationSummary,
    Memory,
    UserSkill,
)

# Core models
from .core import (
    Agent,
    AgentPendingApproval,
    FileChange,
    Message,
    PendingChange,
    Session,
    SessionCollaborator,
    SessionShare,
    User,
    Workspace,
)

# Extension models
from .extensions import (
    UserExtension,
    WorkspaceExtension,
)

# Infrastructure models
from .infrastructure import (
    GitHubIntegration,
    LocalPod,
    MCPServer,
    PodTemplate,
)

# Knowledge models
from .knowledge import (
    UserCorrection,
    WikiDocument,
)

# Notification models
from .notifications import (
    AgentAttention,
    Notification,
    PushSubscription,
)

# Organization models
from .organization import (
    Organization,
    OrganizationCreditTransaction,
    OrganizationInvitation,
    OrganizationInviteLink,
    OrganizationInvoice,
    OrganizationMember,
    OrganizationSubscription,
    OrganizationUsageRecord,
)

# Planning models
from .planning import (
    ExecutionPlan,
    TaskProgress,
)

# Platform models
from .platform import (
    AccessReview,
    AuditLog,
    CustomLLMProvider,
    DataExportRequest,
    DataRetentionPolicy,
    LLMModel,
    PlatformSetting,
    ProductivityMetric,
    ProjectHealthScore,
)

# User preferences models
from .user_preferences import (
    CustomCommand,
    UserConfig,
    UserHook,
)

__all__ = [
    "AccessReview",
    "Agent",
    "AgentAttention",
    "AgentPendingApproval",
    "AgentTemplate",
    "AgentWorktree",
    "AuditLog",
    "Base",
    "BillingEvent",
    "ChangeSetFile",
    "CheckpointFile",
    "CompactionLog",
    "ContextCompactionSettings",
    "ConversationSummary",
    "CostAlert",
    "CreditBalance",
    "CreditTransaction",
    "CustomCommand",
    "CustomLLMProvider",
    "DataExportRequest",
    "DataRetentionPolicy",
    "ExecutionPlan",
    "ExternalAgentEnvProfile",
    "FileChange",
    "FileCheckpoint",
    "GitHubIntegration",
    "HardwareSpec",
    "Invoice",
    "LLMModel",
    "LocalPod",
    "MCPServer",
    "Memory",
    "Message",
    "Notification",
    "Organization",
    "OrganizationCreditTransaction",
    "OrganizationInvitation",
    "OrganizationInviteLink",
    "OrganizationInvoice",
    "OrganizationMember",
    "OrganizationSubscription",
    "OrganizationUsageRecord",
    "PendingChange",
    "PendingChangeSet",
    "PlatformSetting",
    "PodTemplate",
    "ProductivityMetric",
    "ProjectHealthScore",
    "PushSubscription",
    "Session",
    "SessionBudget",
    "SessionCollaborator",
    "SessionShare",
    "Subagent",
    "SubscriptionPlan",
    "TaskProgress",
    "TerminalAgentSession",
    "TerminalIntegratedAgentType",
    "UsageQuota",
    "UsageRecord",
    "User",
    "UserBudget",
    "UserConfig",
    "UserCorrection",
    "UserExtension",
    "UserHook",
    "UserSkill",
    "UserSubscription",
    "WikiDocument",
    "Workspace",
    "WorkspaceExtension",
    "_generate_uuid",
]
