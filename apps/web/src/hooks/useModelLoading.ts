/**
 * Hook for loading and managing model information.
 * Centralizes model fetching, conversion, and tier grouping.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getAvailableModels,
  getUserProviderModels,
  type PublicModel,
  type UserProviderModel,
} from '@/lib/api';
import type { ModelInfo, LLMProvider } from '@podex/shared';

// Extended ModelInfo with user API flag
export type ExtendedModelInfo = ModelInfo & { isUserKey?: boolean };

export interface ModelsByTier {
  flagship: ExtendedModelInfo[];
  balanced: ExtendedModelInfo[];
  fast: ExtendedModelInfo[];
  userApi: ExtendedModelInfo[];
}

interface UseModelLoadingResult {
  /** All backend models */
  backendModels: PublicModel[];
  /** All user-provided models */
  userProviderModels: UserProviderModel[];
  /** Whether models are loading */
  isLoading: boolean;
  /** Get model info for a specific model ID */
  getModelInfo: (modelId: string) => ExtendedModelInfo | undefined;
  /** Get display name for a model */
  getModelDisplayName: (modelId: string, agentDisplayName?: string) => string;
  /** Models grouped by tier */
  modelsByTier: ModelsByTier;
  /** Convert backend model to ExtendedModelInfo */
  backendModelToInfo: (model: PublicModel, isUserKey?: boolean) => ExtendedModelInfo;
  /** Convert user model to ExtendedModelInfo */
  userModelToInfo: (model: UserProviderModel) => ExtendedModelInfo;
}

/**
 * Hook for loading platform and user models.
 * Provides model info lookup, tier grouping, and display name formatting.
 */
export function useModelLoading(): UseModelLoadingResult {
  const [backendModels, setBackendModels] = useState<PublicModel[]>([]);
  const [userProviderModels, setUserProviderModels] = useState<UserProviderModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch models on mount
  useEffect(() => {
    let mounted = true;

    async function loadModels() {
      setIsLoading(true);
      try {
        const [platformModels, userModels] = await Promise.all([
          getAvailableModels().catch(() => [] as PublicModel[]),
          getUserProviderModels().catch(() => [] as UserProviderModel[]),
        ]);

        if (mounted) {
          setBackendModels(platformModels);
          setUserProviderModels(userModels);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadModels();
    return () => {
      mounted = false;
    };
  }, []);

  // Model conversion helpers
  const backendModelToInfo = useCallback(
    (m: PublicModel, isUserKey = false): ExtendedModelInfo => ({
      id: m.model_id,
      provider: (isUserKey ? m.provider : 'podex') as LLMProvider,
      displayName: m.display_name,
      shortName: m.display_name.replace(' (User API)', ''),
      tier:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'flagship'
          : m.cost_tier === 'medium'
            ? 'balanced'
            : 'fast',
      contextWindow: m.context_window,
      maxOutputTokens: m.max_output_tokens,
      supportsVision: m.capabilities.vision,
      supportsThinking: m.capabilities.thinking,
      thinkingStatus: m.capabilities.thinking
        ? 'available'
        : m.capabilities.thinking_coming_soon
          ? 'coming_soon'
          : 'not_supported',
      capabilities: [
        'chat',
        'code',
        ...(m.capabilities.vision ? (['vision'] as const) : []),
        ...(m.capabilities.tool_use ? (['function_calling'] as const) : []),
      ],
      goodFor: m.good_for || [],
      description: m.description || '',
      reasoningEffort:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'high'
          : m.cost_tier === 'medium'
            ? 'medium'
            : 'low',
      isUserKey,
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  const userModelToInfo = useCallback(
    (m: UserProviderModel): ExtendedModelInfo => ({
      id: m.model_id,
      provider: m.provider as LLMProvider,
      displayName: m.display_name,
      shortName: m.display_name.replace(' (User API)', ''),
      tier:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'flagship'
          : m.cost_tier === 'medium'
            ? 'balanced'
            : 'fast',
      contextWindow: m.context_window,
      maxOutputTokens: m.max_output_tokens,
      supportsVision: m.capabilities.vision,
      supportsThinking: m.capabilities.thinking,
      thinkingStatus: m.capabilities.thinking
        ? 'available'
        : m.capabilities.thinking_coming_soon
          ? 'coming_soon'
          : 'not_supported',
      capabilities: [
        'chat',
        'code',
        ...(m.capabilities.vision ? (['vision'] as const) : []),
        ...(m.capabilities.tool_use ? (['function_calling'] as const) : []),
      ],
      goodFor: m.good_for || [],
      description: m.description || '',
      reasoningEffort:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'high'
          : m.cost_tier === 'medium'
            ? 'medium'
            : 'low',
      isUserKey: true,
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  // Get model info for a specific ID
  const getModelInfo = useCallback(
    (modelId: string): ExtendedModelInfo | undefined => {
      const userModel = userProviderModels.find((m) => m.model_id === modelId);
      if (userModel) return userModelToInfo(userModel);

      const backendModel = backendModels.find((m) => m.model_id === modelId);
      if (backendModel) return backendModelToInfo(backendModel);

      return undefined;
    },
    [backendModels, userProviderModels, backendModelToInfo, userModelToInfo]
  );

  // Get display name for a model
  const getModelDisplayName = useCallback(
    (modelId: string, agentDisplayName?: string): string => {
      if (agentDisplayName) {
        return agentDisplayName;
      }

      const userModel = userProviderModels.find((m) => m.model_id === modelId);
      if (userModel) {
        return userModel.display_name.replace(' (User API)', '');
      }

      const backendModel = backendModels.find((m) => m.model_id === modelId);
      if (backendModel) {
        return backendModel.display_name;
      }

      return modelId;
    },
    [backendModels, userProviderModels]
  );

  // Group models by tier
  const modelsByTier = useMemo<ModelsByTier>(() => {
    const flagship: ExtendedModelInfo[] = [];
    const balanced: ExtendedModelInfo[] = [];
    const fast: ExtendedModelInfo[] = [];
    const userApi: ExtendedModelInfo[] = [];

    for (const m of backendModels) {
      const info = backendModelToInfo(m);
      if (m.cost_tier === 'premium' || m.cost_tier === 'high') {
        flagship.push(info);
      } else if (m.cost_tier === 'medium') {
        balanced.push(info);
      } else {
        fast.push(info);
      }
    }

    for (const m of userProviderModels) {
      userApi.push(userModelToInfo(m));
    }

    return { flagship, balanced, fast, userApi };
  }, [backendModels, userProviderModels, backendModelToInfo, userModelToInfo]);

  return {
    backendModels,
    userProviderModels,
    isLoading,
    getModelInfo,
    getModelDisplayName,
    modelsByTier,
    backendModelToInfo,
    userModelToInfo,
  };
}
