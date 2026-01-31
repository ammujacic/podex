"""SQLAlchemy models for Podex database.

All models are organized into domain-specific modules:
 - base.py: Base class and utilities
 - core.py: User, Session, Agent, Workspace
 - conversation.py: ConversationSession, ConversationMessage (portable chat sessions)
 - agent_config.py: AgentTemplate, Subagent, AgentWorktree, AgentRoleConfig, AgentTool
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

# ruff: noqa: I001

# Base class and utilities
from .base import Base, _generate_uuid

# Agent configuration models
from .agent_config import (
    AgentRoleConfig,
    AgentTemplate,
    AgentTool,
    AgentWorktree,
    Subagent,
)

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

# Conversation models (decoupled from agents)
from .conversation import (
    ConversationMessage,
    ConversationSession,
)

# Core models
from .core import (
    Agent,
    AgentPendingApproval,
    FileChange,
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
    GoogleIntegration,
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
    HealthCheck,
    LLMModel,
    LLMProvider,
    PlatformInvitation,
    PlatformSetting,
    ProductivityMetric,
    ProjectHealthScore,
    WaitlistEntry,
)

# Server models (multi-server orchestration)
from .server import ServerStatus, WorkspaceServer

# Tunnel models (Cloudflare external exposure)
from .tunnels import WorkspaceTunnel

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
    UserOAuthToken,
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
    "ChangeSetFile",
    "CheckpointFile",
    "CompactionLog",
    "ContextCompactionSettings",
    "ConversationMessage",
    "ConversationSession",
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
    "FileChange",
    "FileCheckpoint",
    "GitHubIntegration",
    "GoogleIntegration",
    "HardwareSpec",
    "HealthCheck",
    "Invoice",
    "LLMModel",
    "LLMProvider",
    "LocalPod",
    "MCPServer",
    "MarketplaceSkill",
    "Memory",
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
    "PlatformInvitation",
    "PlatformSetting",
    "PodTemplate",
    "ProductivityMetric",
    "ProjectHealthScore",
    "PushSubscription",
    "ServerStatus",
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
    "UsageQuota",
    "UsageRecord",
    "User",
    "UserAddedSkill",
    "UserBudget",
    "UserConfig",
    "UserCorrection",
    "UserExtension",
    "UserHook",
    "UserOAuthToken",
    "UserSkill",
    "UserSubscription",
    "WaitlistEntry",
    "WikiDocument",
    "Workspace",
    "WorkspaceExtension",
    "WorkspaceServer",
    "WorkspaceTunnel",
    "_generate_uuid",
]
