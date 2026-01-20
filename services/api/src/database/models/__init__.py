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
    AgentRoleConfig,
    AgentTemplate,
    AgentTool,
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

# CLI sync models
from .cli_sync import (
    CLISyncConflict,
    CLISyncLog,
    CLISyncStatus,
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
    DefaultMCPServer,
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
    LLMProvider,
    PlatformSetting,
    ProductivityMetric,
    ProjectHealthScore,
)

# Skill management models
from .skill_sync import (
    MarketplaceSkill,
    SkillExecution,
    SkillRepository,
    SkillSyncLog,
    SkillTemplate,
    SkillVersion,
    SystemSkill,
    UserAddedSkill,
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
    "AgentRoleConfig",
    "AgentTemplate",
    "AgentTool",
    "AgentWorktree",
    "AuditLog",
    "Base",
    "BillingEvent",
    "CLISyncConflict",
    "CLISyncLog",
    "CLISyncStatus",
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
    "DefaultMCPServer",
    "ExecutionPlan",
    "ExternalAgentEnvProfile",
    "FileChange",
    "FileCheckpoint",
    "GitHubIntegration",
    "HardwareSpec",
    "Invoice",
    "LLMModel",
    "LLMProvider",
    "LocalPod",
    "MCPServer",
    "MarketplaceSkill",
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
    "SkillExecution",
    "SkillRepository",
    "SkillSyncLog",
    "SkillTemplate",
    "SkillVersion",
    "Subagent",
    "SubscriptionPlan",
    "SystemSkill",
    "TaskProgress",
    "TerminalAgentSession",
    "TerminalIntegratedAgentType",
    "UsageQuota",
    "UsageRecord",
    "User",
    "UserAddedSkill",
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
