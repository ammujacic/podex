'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
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
  Key,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { type Agent, type AgentMode, useSessionStore } from '@/stores/session';
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
import type { ThinkingConfig } from '@podex/shared';

interface MobileAgentToolbarProps {
  sessionId: string;
  agent: Agent;
}

// Mode configuration
const MODE_CONFIG: Record<AgentMode, { label: string; icon: typeof HelpCircle; color: string }> = {
  ask: { label: 'Ask', icon: HelpCircle, color: 'text-blue-400' },
  auto: { label: 'Auto', icon: Zap, color: 'text-green-400' },
  plan: { label: 'Plan', icon: ClipboardList, color: 'text-purple-400' },
  sovereign: { label: 'Sovereign', icon: Shield, color: 'text-red-400' },
};

// Helper function to get model display name
function getModelDisplayName(modelId: string): string {
  const displayNames: Record<string, string> = {
    'claude-sonnet-4-20250514': 'Sonnet 4',
    'claude-opus-4-20250514': 'Opus 4',
    'claude-3-5-sonnet-latest': 'Sonnet 3.5',
    'claude-3-5-haiku-latest': 'Haiku 3.5',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    o1: 'o1',
    'o1-mini': 'o1 Mini',
    'o3-mini': 'o3 Mini',
    'gemini-2.0-flash': 'Gemini 2.0',
    'gemini-1.5-pro': 'Gemini 1.5 Pro',
  };
  return displayNames[modelId] || modelId.split('/').pop() || modelId;
}

export function MobileAgentToolbar({ sessionId, agent }: MobileAgentToolbarProps) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isTogglingPlanMode, setIsTogglingPlanMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  // Load models
  const [publicModels, setPublicModels] = useState<PublicModel[]>([]);
  const [userModels, setUserModels] = useState<UserProviderModel[]>([]);

  const { updateAgent, updateAgentThinking } = useSessionStore();

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
    return { flagship, balanced, fast, userApi: userModels };
  }, [publicModels, userModels]);

  const currentModeConfig = MODE_CONFIG[agent.mode] || MODE_CONFIG.ask;

  // Handle model change
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

  // Handle mode change - mode is stored locally only
  const handleChangeMode = useCallback(
    (mode: AgentMode) => {
      setShowModeMenu(false);
      updateAgent(sessionId, agent.id, { mode });
      toast.success(`Mode changed to ${MODE_CONFIG[mode].label}`);
    },
    [sessionId, agent.id, updateAgent]
  );

  // Handle plan mode toggle
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

  // Handle thinking toggle - stored locally via session store
  const handleToggleThinking = useCallback(
    (enabled: boolean, budgetTokens: number = 10000) => {
      setShowThinkingMenu(false);
      const config: ThinkingConfig = { enabled, budgetTokens };
      updateAgentThinking(sessionId, agent.id, config);
      toast.success(enabled ? 'Extended thinking enabled' : 'Extended thinking disabled');
    },
    [sessionId, agent.id, updateAgentThinking]
  );

  // Handle compact context
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

  // Handle delete agent
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

  // Handle duplicate agent
  const handleDuplicate = useCallback(async () => {
    setIsDuplicating(true);
    try {
      await duplicateAgentApi(sessionId, agent.id);
      // The store will be updated via websocket
      toast.success('Agent duplicated');
    } catch (err) {
      console.error('Failed to duplicate agent:', err);
      toast.error('Failed to duplicate agent');
    } finally {
      setIsDuplicating(false);
      setShowMoreMenu(false);
    }
  }, [sessionId, agent.id]);

  const supportsThinking = currentModelInfo?.capabilities?.thinking === true;
  const supportsVision = currentModelInfo?.capabilities?.vision === true;

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle bg-surface overflow-x-auto scrollbar-hide">
        {/* Model selector */}
        <button
          onClick={() => setShowModelMenu(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
        >
          <span className="truncate max-w-[80px]">
            {currentModelInfo?.display_name ||
              agent.modelDisplayName ||
              getModelDisplayName(agent.model)}
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {/* Mode selector */}
        <button
          onClick={() => setShowModeMenu(true)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0',
            'bg-surface-hover hover:bg-surface-active',
            currentModeConfig.color
          )}
        >
          <currentModeConfig.icon className="h-3 w-3" />
          <span>{currentModeConfig.label}</span>
        </button>

        {/* Plan mode toggle */}
        <button
          onClick={handleTogglePlanMode}
          disabled={isTogglingPlanMode}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0',
            agent.mode === 'plan'
              ? 'bg-blue-500/30 text-blue-400 ring-1 ring-blue-400/50'
              : 'bg-surface-hover text-text-muted hover:text-text-primary',
            isTogglingPlanMode && 'opacity-50'
          )}
        >
          {isTogglingPlanMode ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ClipboardList className="h-3 w-3" />
          )}
          <span>Plan</span>
        </button>

        {/* Thinking toggle (if supported) */}
        {supportsThinking && (
          <button
            onClick={() => setShowThinkingMenu(true)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0',
              agent.thinkingConfig?.enabled
                ? 'bg-purple-500/30 text-purple-400 ring-1 ring-purple-400/50'
                : 'bg-surface-hover text-text-muted hover:text-text-primary'
            )}
          >
            <Brain className="h-3 w-3" />
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
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
        >
          <ContextUsageRing agentId={agent.id} size="sm" />
        </button>

        {/* Vision indicator */}
        {supportsVision ? (
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-green-400 flex-shrink-0">
            <Eye className="h-3 w-3" />
          </span>
        ) : (
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-muted flex-shrink-0">
            <EyeOff className="h-3 w-3" />
          </span>
        )}

        {/* More menu */}
        <button
          onClick={() => setShowMoreMenu(true)}
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-surface-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 ml-auto"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* Model selection sheet */}
      {showModelMenu && (
        <MobileBottomSheet title="Select Model" onClose={() => setShowModelMenu(false)}>
          <div className="space-y-4">
            {/* Flagship */}
            {modelsByTier.flagship.length > 0 && (
              <ModelTierSection
                title="Flagship"
                titleColor="text-amber-400"
                models={modelsByTier.flagship}
                currentModel={agent.model}
                onSelect={handleChangeModel}
              />
            )}
            {/* Balanced */}
            {modelsByTier.balanced.length > 0 && (
              <ModelTierSection
                title="Balanced"
                titleColor="text-blue-400"
                models={modelsByTier.balanced}
                currentModel={agent.model}
                onSelect={handleChangeModel}
              />
            )}
            {/* Fast */}
            {modelsByTier.fast.length > 0 && (
              <ModelTierSection
                title="Fast"
                titleColor="text-green-400"
                models={modelsByTier.fast}
                currentModel={agent.model}
                onSelect={handleChangeModel}
              />
            )}
            {/* User API keys */}
            {modelsByTier.userApi.length > 0 && (
              <div>
                <p className="text-xs font-medium text-purple-400 mb-2 flex items-center gap-1">
                  <Key className="h-3 w-3" />
                  Your API Keys
                </p>
                <div className="space-y-1">
                  {modelsByTier.userApi.map((model) => (
                    <button
                      key={model.model_id}
                      onClick={() => handleChangeModel(model.model_id)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors',
                        agent.model === model.model_id
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                      )}
                    >
                      <span className="flex items-center gap-1">
                        <Key className="h-3 w-3 text-purple-400" />
                        {model.display_name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </MobileBottomSheet>
      )}

      {/* Mode selection sheet */}
      {showModeMenu && (
        <MobileBottomSheet title="Select Mode" onClose={() => setShowModeMenu(false)}>
          <div className="space-y-2">
            {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG.ask][]).map(
              ([mode, config]) => (
                <button
                  key={mode}
                  onClick={() => handleChangeMode(mode)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors',
                    agent.mode === mode
                      ? 'bg-accent-primary/20 text-accent-primary'
                      : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                  )}
                >
                  <config.icon className={cn('h-5 w-5', config.color)} />
                  <div className="text-left">
                    <p className="font-medium">{config.label}</p>
                    <p className="text-xs text-text-secondary">
                      {mode === 'ask' && 'Ask for confirmation before making changes'}
                      {mode === 'auto' && 'Automatically execute safe actions'}
                      {mode === 'plan' && 'Read-only planning mode'}
                      {mode === 'sovereign' && 'Full autonomous control'}
                    </p>
                  </div>
                </button>
              )
            )}
          </div>
        </MobileBottomSheet>
      )}

      {/* Thinking config sheet */}
      {showThinkingMenu && (
        <MobileBottomSheet title="Extended Thinking" onClose={() => setShowThinkingMenu(false)}>
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Extended thinking allows the AI to reason more deeply before responding.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleToggleThinking(false)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors',
                  !agent.thinkingConfig?.enabled
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                )}
              >
                <span>Off</span>
              </button>
              <button
                onClick={() => handleToggleThinking(true, 5000)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors',
                  agent.thinkingConfig?.enabled && agent.thinkingConfig?.budgetTokens === 5000
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                )}
              >
                <span>Low (5K tokens)</span>
              </button>
              <button
                onClick={() => handleToggleThinking(true, 10000)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors',
                  agent.thinkingConfig?.enabled && agent.thinkingConfig?.budgetTokens === 10000
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                )}
              >
                <span>Medium (10K tokens)</span>
              </button>
              <button
                onClick={() => handleToggleThinking(true, 20000)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors',
                  agent.thinkingConfig?.enabled && agent.thinkingConfig?.budgetTokens === 20000
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                )}
              >
                <span>High (20K tokens)</span>
              </button>
            </div>
          </div>
        </MobileBottomSheet>
      )}

      {/* Context management sheet */}
      {showContextMenu && (
        <MobileBottomSheet title="Context Management" onClose={() => setShowContextMenu(false)}>
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
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-accent-primary text-text-inverse hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
            >
              {isCompacting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Compacting...</span>
                </>
              ) : (
                <span>Compact Context</span>
              )}
            </button>
          </div>
        </MobileBottomSheet>
      )}

      {/* More menu sheet */}
      {showMoreMenu && (
        <MobileBottomSheet title="Agent Settings" onClose={() => setShowMoreMenu(false)}>
          <div className="space-y-2">
            <button
              onClick={handleDuplicate}
              disabled={isDuplicating}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-hover text-text-primary hover:bg-surface-active transition-colors"
            >
              {isDuplicating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Copy className="h-5 w-5" />
              )}
              <span>Duplicate Agent</span>
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              {isDeleting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Trash2 className="h-5 w-5" />
              )}
              <span>Delete Agent</span>
            </button>
          </div>
        </MobileBottomSheet>
      )}
    </>
  );
}

// Helper component for bottom sheets
function MobileBottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 bg-surface border-t border-border-default rounded-t-2xl max-h-[70vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1.5 bg-border-strong rounded-full" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>
        <div className="px-4 pb-4">{children}</div>
        <div className="h-safe-bottom" />
      </div>
    </div>
  );
}

// Helper component for model tier sections
function ModelTierSection({
  title,
  titleColor,
  models,
  currentModel,
  onSelect,
}: {
  title: string;
  titleColor: string;
  models: PublicModel[];
  currentModel: string;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div>
      <p className={cn('text-xs font-medium mb-2', titleColor)}>{title}</p>
      <div className="space-y-1">
        {models.map((model) => (
          <button
            key={model.model_id}
            onClick={() => onSelect(model.model_id)}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors',
              currentModel === model.model_id
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-surface-hover text-text-primary hover:bg-surface-active'
            )}
          >
            <span>{model.display_name}</span>
            <div className="flex items-center gap-1 text-xs text-text-tertiary">
              {model.capabilities?.vision && <Eye className="h-3 w-3 text-green-400" />}
              {model.capabilities?.thinking && <Brain className="h-3 w-3 text-purple-400" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
