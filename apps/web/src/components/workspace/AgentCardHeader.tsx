'use client';

import React from 'react';
import {
  Bell,
  Brain,
  ChevronDown,
  ClipboardList,
  Copy,
  ImageOff,
  Key,
  KeyRound,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Settings2,
  Shield,
  Slash,
  Trash2,
  Undo2,
  Volume2,
} from 'lucide-react';
import { ClaudeIcon, GeminiIcon, OpenAIIcon, PodexIcon } from '@/components/icons';
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
import type { Agent } from '@/stores/session';
import type { ModelInfo } from '@podex/shared';
import type { Worktree } from '@/stores/worktrees';
import type { Checkpoint } from '@/stores/checkpoints';

// Extended ModelInfo with user API flag
type ExtendedModelInfo = ModelInfo & { isUserKey?: boolean };

interface AgentCardHeaderProps {
  agent: Agent;
  sessionId: string;
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
  // Claude Code specific callbacks (optional - only used for claude-code agents)
  onOpenSlashCommands?: () => void;
  onReauthenticate?: () => void;
}

/**
 * Agent card header with identity, status, badges, and controls.
 */
export const AgentCardHeader = React.memo<AgentCardHeaderProps>(function AgentCardHeader({
  agent,
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
  onOpenSlashCommands,
  onReauthenticate,
}) {
  // CLI agent type checks
  const isClaudeCodeAgent = agent.role === 'claude-code';
  const isOpenAICodexAgent = agent.role === 'openai-codex';
  const isGeminiCliAgent = agent.role === 'gemini-cli';
  const isCliAgent = isClaudeCodeAgent || isOpenAICodexAgent || isGeminiCliAgent;

  const Icon = getRoleIcon(agent.role);
  const textColor = getAgentTextColor(agent.color);
  const currentModeConfig = getModeConfig(agent.mode);

  return (
    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={cn('rounded-md bg-elevated p-2', textColor)} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Claude Code badge */}
            {isClaudeCodeAgent && (
              <span
                className="flex items-center justify-center w-5 h-5 rounded bg-[#FF6B35]/20"
                title="Claude Code Agent"
              >
                <ClaudeIcon className="h-3 w-3 text-[#FF6B35]" />
              </span>
            )}
            {/* OpenAI Codex badge */}
            {isOpenAICodexAgent && (
              <span
                className="flex items-center justify-center w-5 h-5 rounded bg-[#10A37F]/20"
                title="OpenAI Codex Agent"
              >
                <OpenAIIcon className="h-3 w-3 text-[#10A37F]" />
              </span>
            )}
            {/* Gemini CLI badge */}
            {isGeminiCliAgent && (
              <span
                className="flex items-center justify-center w-5 h-5 rounded bg-[#4285F4]/20"
                title="Gemini CLI Agent"
              >
                <GeminiIcon className="h-3 w-3 text-[#4285F4]" />
              </span>
            )}
            {/* Podex native agent badge */}
            {!isCliAgent && agent.role !== 'custom' && (
              <span className="flex items-center justify-center w-5 h-5" title="Podex Agent">
                <PodexIcon size={20} />
              </span>
            )}
            <span className="font-medium text-text-primary">{agent.name}</span>

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
            <ContextUsageRing agentId={agent.id} size="sm" onClick={onOpenCompaction} />

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

            {/* Plan mode toggle button */}
            <button
              onClick={onTogglePlanMode}
              disabled={isTogglingPlanMode}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer',
                agent.mode === 'plan'
                  ? 'bg-blue-500/30 text-blue-400 ring-1 ring-blue-400/50 hover:bg-blue-500/40'
                  : 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-primary',
                isTogglingPlanMode && 'opacity-50 cursor-not-allowed'
              )}
              title={
                agent.mode === 'plan'
                  ? `Exit Plan mode (return to ${agent.previousMode || 'Ask'})`
                  : 'Enter Plan mode (read-only)'
              }
            >
              <ClipboardList className="h-3 w-3" />
              <span>Plan</span>
              {agent.mode === 'plan' && (
                <span
                  className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"
                  aria-hidden="true"
                />
              )}
            </button>

            {/* Extended Thinking toggle */}
            {currentModelInfo?.supportsThinking && (
              <button
                onClick={onOpenThinkingDialog}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer',
                  agent.thinkingConfig?.enabled
                    ? 'bg-purple-500/30 text-purple-400 ring-1 ring-purple-400/50 hover:bg-purple-500/40'
                    : 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-primary'
                )}
                title={
                  agent.thinkingConfig?.enabled
                    ? `Extended Thinking: ${agent.thinkingConfig.budgetTokens.toLocaleString()} tokens`
                    : 'Enable Extended Thinking'
                }
              >
                <Brain className="h-3 w-3" />
                <span>Think</span>
                {agent.thinkingConfig?.enabled ? (
                  <>
                    <span className="text-purple-300">
                      {Math.round(agent.thinkingConfig.budgetTokens / 1000)}K
                    </span>
                    <span
                      className="ml-0.5 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse"
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <span className="text-text-muted/60">Off</span>
                )}
              </button>
            )}

            {/* Thinking coming soon badge */}
            {currentModelInfo?.thinkingStatus === 'coming_soon' && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-gray-500/20 text-gray-400"
                title="Extended thinking coming soon for this model"
              >
                <Brain className="h-3 w-3" />
                Soon
              </span>
            )}

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
                        <div className="flex items-center justify-between">
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

          {/* Model selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer">
                {getModelDisplayName(agent.model)}
                {currentModelInfo && <ModelCapabilityBadges model={currentModelInfo} compact />}
                {!currentModelInfo?.supportsVision && (
                  <span
                    className="text-yellow-500/70"
                    title={`${currentModelInfo?.displayName ?? 'This model'} does not support image input`}
                  >
                    <ImageOff className="h-3 w-3" />
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Select Model</DropdownMenuLabel>
              <DropdownMenuSeparator />

              {/* Flagship Tier */}
              <DropdownMenuLabel className="text-xs text-amber-400">Flagship</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.flagship.map((model) => (
                  <ModelTooltip key={model.id} model={model} side="right">
                    <DropdownMenuRadioItem
                      value={model.id}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{model.shortName}</span>
                      <ModelCapabilityBadges model={model} compact />
                    </DropdownMenuRadioItem>
                  </ModelTooltip>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />

              {/* Balanced Tier */}
              <DropdownMenuLabel className="text-xs text-blue-400">Balanced</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.balanced.map((model) => (
                  <ModelTooltip key={model.id} model={model} side="right">
                    <DropdownMenuRadioItem
                      value={model.id}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{model.shortName}</span>
                      <ModelCapabilityBadges model={model} compact />
                    </DropdownMenuRadioItem>
                  </ModelTooltip>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />

              {/* Fast Tier */}
              <DropdownMenuLabel className="text-xs text-green-400">Fast</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.fast.map((model) => (
                  <ModelTooltip key={model.id} model={model} side="right">
                    <DropdownMenuRadioItem
                      value={model.id}
                      className="flex items-center justify-between cursor-pointer"
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
                  <DropdownMenuLabel className="text-xs text-purple-400 flex items-center gap-1">
                    <Key className="h-3 w-3" />
                    Your API Keys
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                    {modelsByTier.userApi.map((model) => (
                      <ModelTooltip key={model.id} model={model} side="right">
                        <DropdownMenuRadioItem
                          value={model.id}
                          className="flex items-center justify-between cursor-pointer"
                        >
                          <span className="flex items-center gap-1">
                            <Key className="h-3 w-3 text-purple-400" />
                            {model.shortName}
                          </span>
                          <ModelCapabilityBadges model={model} compact />
                        </DropdownMenuRadioItem>
                      </ModelTooltip>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Settings2 className="mr-2 h-4 w-4" />
              Change Model
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {/* Flagship */}
              <DropdownMenuLabel className="text-xs text-amber-400">Flagship</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.flagship.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <span>{model.shortName}</span>
                    <ModelCapabilityBadges model={model} compact />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {/* Balanced */}
              <DropdownMenuLabel className="text-xs text-blue-400">Balanced</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.balanced.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <span>{model.shortName}</span>
                    <ModelCapabilityBadges model={model} compact />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {/* Fast */}
              <DropdownMenuLabel className="text-xs text-green-400">Fast</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                {modelsByTier.fast.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    className="flex items-center justify-between cursor-pointer"
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
                  <DropdownMenuLabel className="text-xs text-purple-400 flex items-center gap-1">
                    <Key className="h-3 w-3" />
                    Your API Keys
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={agent.model} onValueChange={onChangeModel}>
                    {modelsByTier.userApi.map((model) => (
                      <DropdownMenuRadioItem
                        key={model.id}
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-1">
                          <Key className="h-3 w-3 text-purple-400" />
                          {model.shortName}
                        </span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
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
          {/* CLI Agent specific options */}
          {isCliAgent && onOpenSlashCommands && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel
                className={cn(
                  'text-xs flex items-center gap-1',
                  isClaudeCodeAgent && 'text-[#FF6B35]',
                  isOpenAICodexAgent && 'text-[#10A37F]',
                  isGeminiCliAgent && 'text-[#4285F4]'
                )}
              >
                {isClaudeCodeAgent && <ClaudeIcon className="h-3 w-3" />}
                {isOpenAICodexAgent && <OpenAIIcon className="h-3 w-3" />}
                {isGeminiCliAgent && <GeminiIcon className="h-3 w-3" />}
                {isClaudeCodeAgent && 'Claude Code'}
                {isOpenAICodexAgent && 'OpenAI Codex'}
                {isGeminiCliAgent && 'Gemini CLI'}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={onOpenSlashCommands} className="cursor-pointer">
                <Slash className="mr-2 h-4 w-4" />
                Slash Commands
              </DropdownMenuItem>
              {onReauthenticate && (
                <DropdownMenuItem onClick={onReauthenticate} className="cursor-pointer">
                  <KeyRound className="mr-2 h-4 w-4" />
                  Re-authenticate
                </DropdownMenuItem>
              )}
            </>
          )}
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
