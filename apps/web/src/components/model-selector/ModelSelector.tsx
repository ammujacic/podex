'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import { RefreshCw, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModelSearch } from './ModelSearch';
import { ModelFilters } from './ModelFilters';
import { ModelList } from './ModelList';
import { useModelFavorites } from './hooks/useModelFavorites';
import { useModelSearch } from './hooks/useModelSearch';
import { useOllamaModels } from './hooks/useOllamaModels';
import type { LLMModel, LocalModel, ModelTab } from './types';

export interface ModelSelectorProps {
  /** All available models from API (Podex tab) */
  models: LLMModel[];
  /** User's BYOK models (Your Keys tab) */
  userKeyModels?: LLMModel[];
  /** Currently selected model ID */
  selectedModelId?: string;
  /** Callback when model is selected */
  onSelectModel: (modelId: string) => void;
  /** Loading state for models */
  isLoading?: boolean;
  /** Optional class name */
  className?: string;
  /** Default tab */
  defaultTab?: ModelTab;
}

/**
 * Convert LocalModel from Ollama to LLMModel display format.
 * Model ID is prefixed with provider (e.g., "ollama/qwen2.5-coder:14b")
 * so the backend can correctly route to the local provider.
 */
function localModelToLLMModel(
  local: LocalModel,
  provider: 'ollama' | 'lmstudio' = 'ollama'
): LLMModel {
  return {
    model_id: `${provider}/${local.id}`,
    display_name: local.name,
    provider,
    family: 'local',
    description: null,
    cost_tier: 'low',
    context_window: 0, // Unknown for local
    max_output_tokens: 0,
    input_cost_per_million: 0, // Free
    output_cost_per_million: 0,
    is_default: false,
    capabilities: {
      vision: false,
      thinking: false,
      tool_use: false,
      streaming: true,
      json_mode: false,
    },
    good_for: ['local'],
    user_input_cost_per_million: 0,
    user_output_cost_per_million: 0,
    llm_margin_percent: 0,
    short_description: `${local.size}${local.quantization ? ` \u2022 ${local.quantization}` : ''}`,
  };
}

/**
 * ModelSelector is the main container component that orchestrates
 * model selection across three tabs: Podex, Your Keys, and Local.
 *
 * Features:
 * - Three tabs for different model sources
 * - Integrated search and filtering
 * - Favorites support
 * - Ollama local model discovery
 * - Loading, empty, and error states
 */
export function ModelSelector({
  models,
  userKeyModels = [],
  selectedModelId,
  onSelectModel,
  isLoading = false,
  className,
  defaultTab = 'podex',
}: ModelSelectorProps) {
  const [activeTab, setActiveTab] = useState<ModelTab>(defaultTab);
  const [showAllModels, setShowAllModels] = useState(true);

  // Favorites hook
  const { favorites } = useModelFavorites();

  // Podex search/filter hook
  const podexSearch = useModelSearch({
    models,
    favorites,
    showAllModels,
  });

  // Your Keys search hook (simpler - no category filters)
  const userKeysSearch = useModelSearch({
    models: userKeyModels,
    favorites,
    showAllModels: true, // Always show all for user keys
  });

  // Ollama models hook
  const {
    models: ollamaModels,
    isLoading: ollamaLoading,
    error: ollamaError,
    refresh: refreshOllama,
    isConnected: ollamaConnected,
    isConfigured: ollamaConfigured,
  } = useOllamaModels();

  // Convert Ollama models to LLMModel format (prefixed with "ollama/")
  const ollamaLLMModels = useMemo(() => {
    return ollamaModels.map((model) => localModelToLLMModel(model, 'ollama'));
  }, [ollamaModels]);

  // Local search hook
  const localSearch = useModelSearch({
    models: ollamaLLMModels,
    favorites,
    showAllModels: true, // Always show all for local
  });

  // Handle show all toggle
  const handleToggleShowAll = useCallback(() => {
    setShowAllModels((prev) => !prev);
  }, []);

  // Handle refresh for local tab
  const handleRefreshLocal = useCallback(() => {
    refreshOllama();
  }, [refreshOllama]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ModelTab)}
        className="flex flex-col h-full"
      >
        {/* Tab list */}
        <Tabs.List
          className="flex border-b border-border-subtle px-2"
          aria-label="Model source tabs"
        >
          <Tabs.Trigger
            value="podex"
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              'border-b-2 border-transparent -mb-px',
              'hover:text-text-primary',
              'data-[state=active]:border-accent-primary data-[state=active]:text-text-primary',
              'data-[state=inactive]:text-text-muted',
              'focus:outline-none focus-visible:text-text-primary'
            )}
          >
            Podex
          </Tabs.Trigger>
          <Tabs.Trigger
            value="your-keys"
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              'border-b-2 border-transparent -mb-px',
              'hover:text-text-primary',
              'data-[state=active]:border-accent-primary data-[state=active]:text-text-primary',
              'data-[state=inactive]:text-text-muted',
              'focus:outline-none focus-visible:text-text-primary'
            )}
          >
            Your Keys
          </Tabs.Trigger>
          <Tabs.Trigger
            value="local"
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              'border-b-2 border-transparent -mb-px',
              'hover:text-text-primary',
              'data-[state=active]:border-accent-primary data-[state=active]:text-text-primary',
              'data-[state=inactive]:text-text-muted',
              'focus:outline-none focus-visible:text-text-primary'
            )}
          >
            Local
          </Tabs.Trigger>
        </Tabs.List>

        {/* Podex Tab Content */}
        <Tabs.Content value="podex" className="flex-1 flex flex-col min-h-0 outline-none">
          {/* Search */}
          <div className="px-3 py-2">
            <ModelSearch
              value={podexSearch.searchQuery}
              onChange={podexSearch.setSearchQuery}
              placeholder="Search models..."
            />
          </div>

          {/* Filters */}
          <div className="px-3 pb-2">
            <ModelFilters
              activeCategories={podexSearch.activeCategories}
              onToggleCategory={podexSearch.toggleCategory}
              showAllToggle={true}
              showAll={showAllModels}
              onToggleShowAll={handleToggleShowAll}
            />
          </div>

          {/* Model List */}
          <div className="flex-1 min-h-0">
            <ModelList
              models={podexSearch.filteredModels}
              selectedModelId={selectedModelId}
              onSelectModel={onSelectModel}
              favorites={favorites}
              isLoading={isLoading}
              emptyMessage="No models match your search"
            />
          </div>
        </Tabs.Content>

        {/* Your Keys Tab Content */}
        <Tabs.Content value="your-keys" className="flex-1 flex flex-col min-h-0 outline-none">
          {userKeyModels.length > 0 ? (
            <>
              {/* Search */}
              <div className="px-3 py-2">
                <ModelSearch
                  value={userKeysSearch.searchQuery}
                  onChange={userKeysSearch.setSearchQuery}
                  placeholder="Search your models..."
                />
              </div>

              {/* Model List */}
              <div className="flex-1 min-h-0">
                <ModelList
                  models={userKeysSearch.filteredModels}
                  selectedModelId={selectedModelId}
                  onSelectModel={onSelectModel}
                  favorites={favorites}
                  emptyMessage="No models match your search"
                />
              </div>
            </>
          ) : (
            /* Empty state - prompt to configure API keys */
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center text-text-muted max-w-sm">
                <p className="mb-3">
                  Configure your API keys in Settings to use models with your own billing.
                </p>
                <Link
                  href="/settings/connections"
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg',
                    'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20',
                    'text-sm font-medium transition-colors'
                  )}
                >
                  <Settings className="h-4 w-4" />
                  Connected Accounts
                </Link>
              </div>
            </div>
          )}
        </Tabs.Content>

        {/* Local Tab Content */}
        <Tabs.Content value="local" className="flex-1 flex flex-col min-h-0 outline-none">
          {/* Search and refresh header */}
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="flex-1">
              <ModelSearch
                value={localSearch.searchQuery}
                onChange={localSearch.setSearchQuery}
                placeholder="Search local models..."
              />
            </div>
            <button
              type="button"
              onClick={handleRefreshLocal}
              disabled={ollamaLoading}
              aria-label="Refresh local models"
              className={cn(
                'p-2 rounded-md border border-border-default bg-elevated',
                'hover:bg-overlay hover:text-text-primary',
                'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-surface',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-colors'
              )}
            >
              <RefreshCw
                className={cn('h-4 w-4', ollamaLoading && 'animate-spin')}
                aria-hidden="true"
              />
            </button>
          </div>

          {/* Content based on state */}
          <div className="flex-1 min-h-0">
            {!ollamaConfigured ? (
              /* Not configured state - prompt to configure in settings */
              <div className="flex items-center justify-center h-full p-6">
                <div className="text-center text-text-muted max-w-sm">
                  <p className="mb-3">
                    Configure Ollama in Settings to use local models on your machine.
                  </p>
                  <Link
                    href="/settings/agents"
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2 rounded-lg',
                      'bg-green-500/10 text-green-400 hover:bg-green-500/20',
                      'text-sm font-medium transition-colors'
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    Configure Local Models
                  </Link>
                </div>
              </div>
            ) : ollamaLoading ? (
              /* Loading state */
              <div className="flex items-center justify-center h-full p-6">
                <div className="text-center text-text-muted">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" aria-hidden="true" />
                  <p>Discovering local models...</p>
                </div>
              </div>
            ) : ollamaError ? (
              /* Error state - configured but can't connect */
              <div className="flex items-center justify-center h-full p-6">
                <div className="text-center text-text-muted max-w-sm">
                  <p className="mb-3">
                    Could not connect to Ollama. Make sure it&apos;s running at localhost:11434
                  </p>
                  <Link
                    href="/settings/agents"
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2 rounded-lg',
                      'bg-overlay text-text-secondary hover:text-text-primary hover:bg-elevated',
                      'text-sm font-medium transition-colors'
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    Check Settings
                  </Link>
                </div>
              </div>
            ) : ollamaConnected && ollamaLLMModels.length === 0 ? (
              /* Empty state - connected but no models */
              <div className="flex items-center justify-center h-full p-6">
                <div className="text-center text-text-muted max-w-sm">
                  <p>
                    No local models found. Pull models with{' '}
                    <code className="text-text-primary bg-elevated px-1 rounded">
                      ollama pull &lt;model&gt;
                    </code>
                  </p>
                </div>
              </div>
            ) : (
              /* Model List */
              <ModelList
                models={localSearch.filteredModels}
                selectedModelId={selectedModelId}
                onSelectModel={onSelectModel}
                favorites={favorites}
                emptyMessage="No local models match your search"
              />
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
