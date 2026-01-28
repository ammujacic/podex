'use client';

import React from 'react';
import Link from 'next/link';
import {
  Bell,
  Brain,
  ChevronDown,
  ClipboardList,
  Copy,
  Globe,
  ImageOff,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Settings2,
  Shield,
  Trash2,
  Undo2,
  Volume2,
} from 'lucide-react';
import { PodexIcon } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { getRoleIcon, getAgentTextColor, getModeConfig } from '@/lib/agentConstants';
import { ContextUsageRing } from './ContextUsageRing';
import { WorktreeStatus } from './WorktreeStatus';
import { ModelTooltip, ModelCapabilityBadges } from './ModelTooltip';
import { SessionDropdown } from './SessionDropdown';
import { RoleDropdown } from './RoleDropdown';
import type { Agent, AgentRole, ConversationSession } from '@/stores/session';
import { getAgentDisplayTitle } from '@/stores/session';
import type { ModelInfo } from '@podex/shared';
import type { Worktree } from '@/stores/worktrees';
import type { Checkpoint } from '@/stores/checkpoints';

// Extended ModelInfo with user API flag
type ExtendedModelInfo = ModelInfo & { isUserKey?: boolean };

interface AgentCardHeaderProps {
  agent: Agent;
  sessionId: string;
  // Conversation session attached to this agent
  conversationSession: ConversationSession | null;
  // Current model info
  currentModelInfo: ExtendedModelInfo | undefined;
  getModelDisplayName: (modelId: string) => string;
  // Models by tier
  modelsByTier: {
    flagship: ExtendedModelInfo[];
    balanced: ExtendedModelInfo[];
    fast: ExtendedModelInfo[];
    userApi: ExtendedModelInfo[];
  };
  // State flags
  isDeleting: boolean;
  isDuplicating: boolean;
  isTogglingPlanMode: boolean;
  restoringCheckpointId: string | null;
  // Related data
  agentWorktree: Worktree | undefined;
  agentCheckpoints: Checkpoint[];
  // Attention data
  hasAttention: boolean;
  hasUnread: boolean;
  unreadCount: number;
  agentAttentionsCount: number;
  highestPriorityAttention: { type: string; title: string } | null;
  pendingApprovalCount: number;
  // Callbacks
  onChangeModel: (modelId: string) => void;
  onChangeRole: (role: AgentRole) => void;
  onAttachSession: (conversationId: string) => void;
  onDetachSession: () => void;
  onCreateNewSession: () => void;
  onTogglePlanMode: () => void;
  onRestoreCheckpoint: (checkpointId: string, description: string | null) => void;
  onOpenCompaction: () => void;
  onOpenModeSettings: () => void;
  onOpenThinkingDialog: () => void;
  onOpenVoiceSettings: () => void;
  onOpenAttentionPanel: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  // Browser context (for forwarding preview data to agent)
  browserCaptureEnabled?: boolean;
  browserAutoInclude?: boolean;
  hasPendingBrowserContext?: boolean;
  onToggleBrowserCapture?: () => void;
  onOpenBrowserContextDialog?: () => void;
}

/**
 * Agent card header with identity, status, badges, and controls.
 */
export const AgentCardHeader = React.memo<AgentCardHeaderProps>(function AgentCardHeader({
  agent,
  sessionId,
  conversationSession,
  currentModelInfo,
  getModelDisplayName,
  modelsByTier,
  isDeleting,
  isDuplicating,
  isTogglingPlanMode,
  restoringCheckpointId,
  agentWorktree,
  agentCheckpoints,
  hasAttention,
  hasUnread,
  unreadCount,
  agentAttentionsCount,
  highestPriorityAttention,
  pendingApprovalCount,
  onChangeModel,
  onChangeRole,
  onAttachSession,
  onDetachSession,
  onCreateNewSession,
  onTogglePlanMode,
  onRestoreCheckpoint,
  onOpenCompaction,
  onOpenModeSettings,
  onOpenThinkingDialog,
  onOpenVoiceSettings,
  onOpenAttentionPanel,
  onRename,
  onDuplicate,
  onDelete,
  browserCaptureEnabled,
  browserAutoInclude,
  hasPendingBrowserContext: _hasPendingBrowserContext,
  onToggleBrowserCapture,
  onOpenBrowserContextDialog: _onOpenBrowserContextDialog,
}) {
  const Icon = getRoleIcon(agent.role);
  const textColor = getAgentTextColor(agent.color);
  const currentModeConfig = getModeConfig(agent.mode);
  const displayTitle = getAgentDisplayTitle(agent, conversationSession);

  return (
    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={cn('rounded-md bg-elevated p-2', textColor)} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          {/* Dynamic title: Role: Session Name */}
          <div className="flex items-center gap-2 mb-1">
            {agent.role !== 'custom' && (
              <span className="flex items-center justify-center w-5 h-5" title="Podex Agent">
                <PodexIcon size={20} />
              </span>
            )}
            <span className="font-medium text-text-primary">{displayTitle}</span>

            {/* Status indicator */}
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                agent.status === 'active' && 'bg-accent-success animate-pulse',
                agent.status === 'idle' && 'bg-text-muted',
                agent.status === 'error' && 'bg-accent-error'
              )}
              role="status"
              aria-label={`Agent is ${agent.status}`}
            />

            {/* Context usage ring */}
            <ContextUsageRing
              agentId={agent.id}
              size="xs"
              onClick={onOpenCompaction}
              className="shrink-0"
            />

            {/* Mode badge */}
            <button
              onClick={onOpenModeSettings}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-elevated hover:bg-overlay transition-colors cursor-pointer',
                currentModeConfig.color
              )}
              title={`Mode: ${currentModeConfig.label}`}
            >
              <currentModeConfig.icon className="h-3 w-3" />
              {currentModeConfig.label}
            </button>

            {/* Auto-switched badge */}
            {agent.previousMode && (
              <span
                className="flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400"
                title={`Auto-switched from ${agent.previousMode} mode - will revert after task`}
              >
                <RefreshCw className="h-3 w-3" />
                Auto
              </span>
            )}
          </div>

          {/* Role, Session, and Model dropdowns row */}
          <div className="flex items-center gap-2 mb-1">
            <RoleDropdown currentRole={agent.role} onRoleChange={onChangeRole} />
            <SessionDropdown
              sessionId={sessionId}
              agentId={agent.id}
              currentConversation={conversationSession}
              onAttach={onAttachSession}
              onDetach={onDetachSession}
              onCreateNew={onCreateNewSession}
            />

            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
                    'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary'
                  )}
                >
                  <span>{getModelDisplayName(agent.model)}</span>
                  {currentModelInfo && <ModelCapabilityBadges model={currentModelInfo} compact />}
                  {!currentModelInfo?.supportsVision && (
                    <span
                      className="text-yellow-500/70"
                      title={`${currentModelInfo?.displayName ?? 'This model'} does not support image input`}
                    >
                      <ImageOff className="h-3 w-3" />
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3 text-text-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuSeparator />

                {/* Flagship Tier */}
                <DropdownMenuLabel className="text-xs text-text-primary">
                  Flagship
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                  {modelsByTier.flagship.map((model) => (
                    <ModelTooltip key={model.id} model={model} side="right">
                      <DropdownMenuRadioItem
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    </ModelTooltip>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />

                {/* Balanced Tier */}
                <DropdownMenuLabel className="text-xs text-text-primary">
                  Balanced
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                  {modelsByTier.balanced.map((model) => (
                    <ModelTooltip key={model.id} model={model} side="right">
                      <DropdownMenuRadioItem
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    </ModelTooltip>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />

                {/* Fast Tier */}
                <DropdownMenuLabel className="text-xs text-text-primary">Fast</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                  {modelsByTier.fast.map((model) => (
                    <ModelTooltip key={model.id} model={model} side="right">
                      <DropdownMenuRadioItem
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    </ModelTooltip>
                  ))}
                </DropdownMenuRadioGroup>

                {/* Your API Keys */}
                {modelsByTier.userApi.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-accent-primary">
                      Your API Keys
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                      {modelsByTier.userApi.map((model) => (
                        <ModelTooltip key={model.id} model={model} side="right">
                          <DropdownMenuRadioItem
                            value={model.id}
                            className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                          >
                            <span>{model.shortName}</span>
                            <ModelCapabilityBadges model={model} compact />
                          </DropdownMenuRadioItem>
                        </ModelTooltip>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}

                {/* Connect Providers Link */}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link
                    href="/settings/connections"
                    className="flex items-center gap-2 text-text-secondary hover:text-text-primary"
                  >
                    <Link2 className="h-4 w-4" />
                    <span>
                      {modelsByTier.userApi.length > 0
                        ? 'Manage Connected Accounts'
                        : 'Connect Your API Keys'}
                    </span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Undo/Checkpoint dropdown */}
            {agentCheckpoints.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center justify-center rounded-full p-1 text-xs transition-colors cursor-pointer',
                      'bg-elevated text-text-muted hover:bg-overlay hover:text-text-primary',
                      restoringCheckpointId && 'opacity-50 cursor-not-allowed'
                    )}
                    disabled={!!restoringCheckpointId}
                    title="Undo changes"
                  >
                    <Undo2 className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-xs text-text-muted">
                    Restore to checkpoint
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {agentCheckpoints.slice(0, 10).map((cp) => (
                    <DropdownMenuItem
                      key={cp.id}
                      onClick={() => onRestoreCheckpoint(cp.id, cp.description)}
                      disabled={cp.status === 'restored' || !!restoringCheckpointId}
                      className="cursor-pointer"
                    >
                      <div className="flex flex-col gap-0.5 w-full">
                        <div className="flex items-center justify-between hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30">
                          <span className="text-sm truncate">
                            {cp.description || `Checkpoint #${cp.checkpointNumber}`}
                          </span>
                          {cp.status === 'restored' && (
                            <span className="text-xs text-green-400">restored</span>
                          )}
                        </div>
                        <span className="text-xs text-text-muted">
                          {cp.fileCount} file{cp.fileCount !== 1 ? 's' : ''} • +{cp.totalLinesAdded}
                          /-{cp.totalLinesRemoved}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  {agentCheckpoints.length > 10 && (
                    <DropdownMenuItem disabled className="text-xs text-text-muted">
                      +{agentCheckpoints.length - 10} more checkpoints
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Pending approval badge */}
            {pendingApprovalCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400 animate-pulse">
                <Shield className="h-3 w-3" />
                {pendingApprovalCount}
              </span>
            )}

            {/* Attention badge */}
            {hasAttention && (
              <button
                onClick={onOpenAttentionPanel}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer transition-all',
                  hasUnread && 'animate-pulse',
                  highestPriorityAttention?.type === 'error' && 'bg-red-500/20 text-red-400',
                  highestPriorityAttention?.type === 'needs_approval' &&
                    'bg-yellow-500/20 text-yellow-400',
                  highestPriorityAttention?.type === 'completed' &&
                    'bg-green-500/20 text-green-400',
                  highestPriorityAttention?.type === 'waiting_input' &&
                    'bg-blue-500/20 text-blue-400',
                  !hasUnread && 'opacity-60'
                )}
                title={highestPriorityAttention?.title}
              >
                <Bell className="h-3 w-3" />
                {hasUnread ? (
                  <>
                    <span className="font-semibold">{unreadCount}</span>
                    {unreadCount !== agentAttentionsCount && (
                      <span className="text-[10px] opacity-70">/{agentAttentionsCount}</span>
                    )}
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse"
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <>
                    <span>{agentAttentionsCount}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
                  </>
                )}
              </button>
            )}

            {/* Worktree status badge */}
            <WorktreeStatus worktree={agentWorktree} />
          </div>
        </div>
      </div>

      {/* Settings dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Agent Settings</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRename} className="cursor-pointer">
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onTogglePlanMode}
            disabled={isTogglingPlanMode}
            className="cursor-pointer"
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            {agent.mode === 'plan' ? `Exit Plan Mode` : 'Enter Plan Mode'}
            {agent.mode === 'plan' && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            )}
          </DropdownMenuItem>
          {currentModelInfo?.supportsThinking && (
            <DropdownMenuItem onClick={onOpenThinkingDialog} className="cursor-pointer">
              <Brain className="mr-2 h-4 w-4" />
              Extended Thinking
              {agent.thinkingConfig?.enabled && (
                <span className="ml-auto text-purple-400">
                  {Math.round(agent.thinkingConfig.budgetTokens / 1000)}K
                </span>
              )}
            </DropdownMenuItem>
          )}
          {onToggleBrowserCapture && (
            <DropdownMenuItem onClick={onToggleBrowserCapture} className="cursor-pointer">
              <Globe className="mr-2 h-4 w-4" />
              Browser Capture
              {(browserCaptureEnabled || browserAutoInclude) && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Settings2 className="mr-2 h-4 w-4" />
              Change Model
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {/* Flagship */}
              <DropdownMenuLabel className="text-xs text-text-primary">Flagship</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.flagship.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                  >
                    <span>{model.shortName}</span>
                    <ModelCapabilityBadges model={model} compact />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {/* Balanced */}
              <DropdownMenuLabel className="text-xs text-text-primary">Balanced</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.balanced.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                  >
                    <span>{model.shortName}</span>
                    <ModelCapabilityBadges model={model} compact />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {/* Fast */}
              <DropdownMenuLabel className="text-xs text-text-primary">Fast</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.fast.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                  >
                    <span>{model.shortName}</span>
                    <ModelCapabilityBadges model={model} compact />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {/* Your API Keys */}
              {modelsByTier.userApi.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-accent-primary">
                    Your API Keys
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                    {modelsByTier.userApi.map((model) => (
                      <DropdownMenuRadioItem
                        key={model.id}
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer hover:bg-purple-500/20 data-[state=checked]:bg-purple-500/30"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}

              {/* Connect Providers Link */}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link
                  href="/settings/connections"
                  className="flex items-center gap-2 text-text-secondary hover:text-text-primary"
                >
                  <Link2 className="h-4 w-4" />
                  <span>
                    {modelsByTier.userApi.length > 0
                      ? 'Manage Connected Accounts'
                      : 'Connect Your API Keys'}
                  </span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={onOpenVoiceSettings} className="cursor-pointer">
            <Volume2 className="mr-2 h-4 w-4" />
            Voice Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenModeSettings} className="cursor-pointer">
            <Shield className="mr-2 h-4 w-4" />
            Mode Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDuplicate}
            disabled={isDuplicating}
            className="cursor-pointer"
          >
            {isDuplicating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            {isDuplicating ? 'Duplicating...' : 'Duplicate'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-red-400 focus:text-red-400 cursor-pointer"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
