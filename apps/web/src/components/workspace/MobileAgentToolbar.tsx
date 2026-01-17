'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Bell,
  Brain,
  ChevronDown,
  ClipboardList,
  Eye,
  EyeOff,
  HelpCircle,
  Loader2,
  Shield,
  Trash2,
  Zap,
  Copy,
  MoreVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { type Agent, type AgentMode, useSessionStore } from '@/stores/session';
import { useAttentionStore } from '@/stores/attention';
import {
  getAvailableModels,
  getUserProviderModels,
  updateAgentSettings,
  togglePlanMode,
  deleteAgent as deleteAgentApi,
  duplicateAgent as duplicateAgentApi,
  compactAgentContext,
  type PublicModel,
  type UserProviderModel,
} from '@/lib/api';
import { ContextUsageRing } from './ContextUsageRing';
import { MobileBottomSheet } from '@/components/ui/MobileBottomSheet';
import { ModelTierSection, UserModelsSection } from './ModelTierSection';
import { getModelDisplayName } from '@/lib/ui-utils';
import type { ThinkingConfig } from '@podex/shared';

interface MobileAgentToolbarProps {
  sessionId: string;
  agent: Agent;
}

// Mode configuration
const MODE_CONFIG: Record<
  AgentMode,
  { label: string; description: string; icon: typeof HelpCircle; color: string }
> = {
  ask: {
    label: 'Ask',
    description: 'Ask for confirmation before making changes',
    icon: HelpCircle,
    color: 'text-blue-400',
  },
  auto: {
    label: 'Auto',
    description: 'Automatically execute safe actions',
    icon: Zap,
    color: 'text-green-400',
  },
  plan: {
    label: 'Plan',
    description: 'Read-only planning mode',
    icon: ClipboardList,
    color: 'text-purple-400',
  },
  sovereign: {
    label: 'Sovereign',
    description: 'Full autonomous control',
    icon: Shield,
    color: 'text-red-400',
  },
};

// Thinking budget options
const THINKING_OPTIONS = [
  { label: 'Off', enabled: false, budgetTokens: 0 },
  { label: 'Low (5K tokens)', enabled: true, budgetTokens: 5000 },
  { label: 'Medium (10K tokens)', enabled: true, budgetTokens: 10000 },
  { label: 'High (20K tokens)', enabled: true, budgetTokens: 20000 },
];

export function MobileAgentToolbar({ sessionId, agent }: MobileAgentToolbarProps) {
  // Sheet visibility states
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Loading states
  const [isTogglingPlanMode, setIsTogglingPlanMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  // Models
  const [publicModels, setPublicModels] = useState<PublicModel[]>([]);
  const [userModels, setUserModels] = useState<UserProviderModel[]>([]);

  const { updateAgent, updateAgentThinking } = useSessionStore();

  // Attention state
  const {
    getAttentionsForAgent,
    getHighestPriorityAttention,
    getUnreadCountForAgent,
    hasUnreadForAgent,
    openPanel,
  } = useAttentionStore();
  const agentAttentions = getAttentionsForAgent(sessionId, agent.id);
  const highestPriorityAttention = getHighestPriorityAttention(sessionId, agent.id);
  const hasAttention = agentAttentions.length > 0;
  const unreadCount = getUnreadCountForAgent(sessionId, agent.id);
  const hasUnread = hasUnreadForAgent(sessionId, agent.id);

  // Load models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const [pub, user] = await Promise.all([getAvailableModels(), getUserProviderModels()]);
        setPublicModels(pub);
        setUserModels(user);
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    };
    loadModels();
  }, []);

  // Find current model info
  const currentModelInfo = useMemo(() => {
    const pubModel = publicModels.find((m) => m.model_id === agent.model);
    if (pubModel) return pubModel;
    const userModel = userModels.find((m) => m.model_id === agent.model);
    return userModel || null;
  }, [publicModels, userModels, agent.model]);

  // Group models by tier
  const modelsByTier = useMemo(() => {
    const flagship = publicModels.filter((m) => m.cost_tier === 'premium');
    const balanced = publicModels.filter((m) => m.cost_tier === 'high' || m.cost_tier === 'medium');
    const fast = publicModels.filter((m) => m.cost_tier === 'low');
    return { flagship, balanced, fast };
  }, [publicModels]);

  const currentModeConfig = MODE_CONFIG[agent.mode] || MODE_CONFIG.ask;
  const supportsThinking = currentModelInfo?.capabilities?.thinking === true;
  const supportsVision = currentModelInfo?.capabilities?.vision === true;

  // Handlers
  const handleChangeModel = useCallback(
    async (modelId: string) => {
      setShowModelMenu(false);
      try {
        await updateAgentSettings(sessionId, agent.id, { model: modelId });
        updateAgent(sessionId, agent.id, { model: modelId });
        toast.success(`Model changed to ${getModelDisplayName(modelId)}`);
      } catch (err) {
        console.error('Failed to change model:', err);
        toast.error('Failed to change model');
      }
    },
    [sessionId, agent.id, updateAgent]
  );

  const handleChangeMode = useCallback(
    (mode: AgentMode) => {
      setShowModeMenu(false);
      updateAgent(sessionId, agent.id, { mode });
      toast.success(`Mode changed to ${MODE_CONFIG[mode].label}`);
    },
    [sessionId, agent.id, updateAgent]
  );

  const handleTogglePlanMode = useCallback(async () => {
    setIsTogglingPlanMode(true);
    try {
      await togglePlanMode(sessionId, agent.id);
      toast.success(agent.mode === 'plan' ? 'Exited Plan mode' : 'Entered Plan mode');
    } catch (err) {
      console.error('Failed to toggle plan mode:', err);
      toast.error('Failed to toggle Plan mode');
    } finally {
      setIsTogglingPlanMode(false);
    }
  }, [sessionId, agent.id, agent.mode]);

  const handleToggleThinking = useCallback(
    (enabled: boolean, budgetTokens: number = 10000) => {
      setShowThinkingMenu(false);
      const config: ThinkingConfig = { enabled, budgetTokens };
      updateAgentThinking(sessionId, agent.id, config);
      toast.success(enabled ? 'Extended thinking enabled' : 'Extended thinking disabled');
    },
    [sessionId, agent.id, updateAgentThinking]
  );

  const handleCompactContext = useCallback(async () => {
    setIsCompacting(true);
    try {
      await compactAgentContext(agent.id);
      toast.success('Context compacted successfully');
    } catch (err) {
      console.error('Failed to compact context:', err);
      toast.error('Failed to compact context');
    } finally {
      setIsCompacting(false);
      setShowContextMenu(false);
    }
  }, [agent.id]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteAgentApi(sessionId, agent.id);
      toast.success('Agent deleted');
    } catch (err) {
      console.error('Failed to delete agent:', err);
      toast.error('Failed to delete agent');
    } finally {
      setIsDeleting(false);
      setShowMoreMenu(false);
    }
  }, [sessionId, agent.id]);

  const handleDuplicate = useCallback(async () => {
    setIsDuplicating(true);
    try {
      await duplicateAgentApi(sessionId, agent.id);
      toast.success('Agent duplicated');
    } catch (err) {
      console.error('Failed to duplicate agent:', err);
      toast.error('Failed to duplicate agent');
    } finally {
      setIsDuplicating(false);
      setShowMoreMenu(false);
    }
  }, [sessionId, agent.id]);

  return (
    <>
      {/* Toolbar */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle bg-surface overflow-x-auto scrollbar-hide"
        role="toolbar"
        aria-label="Agent controls"
      >
        {/* Model selector */}
        <button
          onClick={() => setShowModelMenu(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 min-h-[44px]"
          aria-label={`Current model: ${currentModelInfo?.display_name || agent.model}`}
        >
          <span className="truncate max-w-[80px]">
            {currentModelInfo?.display_name ||
              agent.modelDisplayName ||
              getModelDisplayName(agent.model)}
          </span>
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>

        {/* Mode selector */}
        <button
          onClick={() => setShowModeMenu(true)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0 min-h-[44px]',
            'bg-surface-hover hover:bg-surface-active',
            currentModeConfig.color
          )}
          aria-label={`Current mode: ${currentModeConfig.label}`}
        >
          <currentModeConfig.icon className="h-3 w-3" aria-hidden="true" />
          <span>{currentModeConfig.label}</span>
        </button>

        {/* Plan mode toggle */}
        <button
          onClick={handleTogglePlanMode}
          disabled={isTogglingPlanMode}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0 min-h-[44px]',
            agent.mode === 'plan'
              ? 'bg-blue-500/30 text-blue-400 ring-1 ring-blue-400/50'
              : 'bg-surface-hover text-text-muted hover:text-text-primary',
            isTogglingPlanMode && 'opacity-50'
          )}
          aria-pressed={agent.mode === 'plan'}
          aria-label={agent.mode === 'plan' ? 'Exit plan mode' : 'Enter plan mode'}
        >
          {isTogglingPlanMode ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardList className="h-3 w-3" aria-hidden="true" />
          )}
          <span>Plan</span>
        </button>

        {/* Thinking toggle */}
        {supportsThinking && (
          <button
            onClick={() => setShowThinkingMenu(true)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0 min-h-[44px]',
              agent.thinkingConfig?.enabled
                ? 'bg-purple-500/30 text-purple-400 ring-1 ring-purple-400/50'
                : 'bg-surface-hover text-text-muted hover:text-text-primary'
            )}
            aria-label={
              agent.thinkingConfig?.enabled
                ? `Thinking enabled: ${agent.thinkingConfig.budgetTokens} tokens`
                : 'Enable thinking'
            }
          >
            <Brain className="h-3 w-3" aria-hidden="true" />
            <span>Think</span>
            {agent.thinkingConfig?.enabled && (
              <span className="text-purple-300">
                {Math.round((agent.thinkingConfig.budgetTokens || 0) / 1000)}K
              </span>
            )}
          </button>
        )}

        {/* Context usage */}
        <button
          onClick={() => setShowContextMenu(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 min-h-[44px]"
          aria-label="View context usage"
        >
          <ContextUsageRing agentId={agent.id} size="sm" />
        </button>

        {/* Vision indicator */}
        <span
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs flex-shrink-0 min-h-[44px]',
            supportsVision ? 'text-green-400' : 'text-text-muted'
          )}
          aria-label={supportsVision ? 'Vision supported' : 'Vision not supported'}
        >
          {supportsVision ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </span>

        {/* Attention badge */}
        {hasAttention && (
          <button
            onClick={openPanel}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 min-h-[44px]',
              hasUnread && 'animate-pulse',
              highestPriorityAttention?.type === 'error' && 'bg-red-500/20 text-red-400',
              highestPriorityAttention?.type === 'needs_approval' &&
                'bg-yellow-500/20 text-yellow-400',
              highestPriorityAttention?.type === 'completed' && 'bg-green-500/20 text-green-400',
              highestPriorityAttention?.type === 'waiting_input' && 'bg-blue-500/20 text-blue-400',
              !hasUnread && 'opacity-60'
            )}
            aria-label={`${unreadCount} notifications${hasUnread ? ', unread' : ''}`}
          >
            <Bell className="h-3 w-3" aria-hidden="true" />
            {hasUnread ? (
              <>
                <span className="font-semibold">{unreadCount}</span>
                <span
                  className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse"
                  aria-hidden="true"
                />
              </>
            ) : (
              <>
                <span>{agentAttentions.length}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
              </>
            )}
          </button>
        )}

        {/* More menu */}
        <button
          onClick={() => setShowMoreMenu(true)}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 ml-auto"
          aria-label="More options"
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Model selection sheet */}
      <MobileBottomSheet
        isOpen={showModelMenu}
        onClose={() => setShowModelMenu(false)}
        title="Select Model"
        height="auto"
      >
        <div className="space-y-4">
          <ModelTierSection
            title="Flagship"
            titleColor="text-amber-400"
            models={modelsByTier.flagship}
            currentModel={agent.model}
            onSelect={handleChangeModel}
          />
          <ModelTierSection
            title="Balanced"
            titleColor="text-blue-400"
            models={modelsByTier.balanced}
            currentModel={agent.model}
            onSelect={handleChangeModel}
          />
          <ModelTierSection
            title="Fast"
            titleColor="text-green-400"
            models={modelsByTier.fast}
            currentModel={agent.model}
            onSelect={handleChangeModel}
          />
          <UserModelsSection
            models={userModels}
            currentModel={agent.model}
            onSelect={handleChangeModel}
          />
        </div>
      </MobileBottomSheet>

      {/* Mode selection sheet */}
      <MobileBottomSheet
        isOpen={showModeMenu}
        onClose={() => setShowModeMenu(false)}
        title="Select Mode"
        height="auto"
      >
        <div className="space-y-2" role="listbox" aria-label="Agent modes">
          {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG.ask][]).map(
            ([mode, config]) => (
              <button
                key={mode}
                onClick={() => handleChangeMode(mode)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors min-h-[56px]',
                  agent.mode === mode
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                )}
                role="option"
                aria-selected={agent.mode === mode}
              >
                <config.icon className={cn('h-5 w-5', config.color)} aria-hidden="true" />
                <div className="text-left">
                  <p className="font-medium">{config.label}</p>
                  <p className="text-xs text-text-secondary">{config.description}</p>
                </div>
              </button>
            )
          )}
        </div>
      </MobileBottomSheet>

      {/* Thinking config sheet */}
      <MobileBottomSheet
        isOpen={showThinkingMenu}
        onClose={() => setShowThinkingMenu(false)}
        title="Extended Thinking"
        height="auto"
      >
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Extended thinking allows the AI to reason more deeply before responding.
          </p>
          <div className="space-y-2" role="listbox" aria-label="Thinking budget">
            {THINKING_OPTIONS.map((option) => {
              const isSelected = option.enabled
                ? agent.thinkingConfig?.enabled &&
                  agent.thinkingConfig?.budgetTokens === option.budgetTokens
                : !agent.thinkingConfig?.enabled;

              return (
                <button
                  key={option.label}
                  onClick={() => handleToggleThinking(option.enabled, option.budgetTokens)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors min-h-[48px]',
                    isSelected
                      ? 'bg-accent-primary/20 text-accent-primary'
                      : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                  )}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </MobileBottomSheet>

      {/* Context management sheet */}
      <MobileBottomSheet
        isOpen={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        title="Context Management"
        height="auto"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-center py-4">
            <ContextUsageRing agentId={agent.id} size="lg" />
          </div>
          <p className="text-sm text-text-secondary text-center">
            Compact context to free up space when the context window is filling up.
          </p>
          <button
            onClick={handleCompactContext}
            disabled={isCompacting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-accent-primary text-text-inverse hover:bg-accent-primary/90 transition-colors disabled:opacity-50 min-h-[48px]"
          >
            {isCompacting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Compacting...</span>
              </>
            ) : (
              <span>Compact Context</span>
            )}
          </button>
        </div>
      </MobileBottomSheet>

      {/* More menu sheet */}
      <MobileBottomSheet
        isOpen={showMoreMenu}
        onClose={() => setShowMoreMenu(false)}
        title="Agent Settings"
        height="auto"
      >
        <div className="space-y-2">
          <button
            onClick={handleDuplicate}
            disabled={isDuplicating}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-hover text-text-primary hover:bg-surface-active transition-colors min-h-[48px]"
          >
            {isDuplicating ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Copy className="h-5 w-5" aria-hidden="true" />
            )}
            <span>Duplicate Agent</span>
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors min-h-[48px]"
          >
            {isDeleting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            )}
            <span>Delete Agent</span>
          </button>
        </div>
      </MobileBottomSheet>
    </>
  );
}
