/**
 * Comprehensive tests for useModelLoading hook
 * Tests model loading, conversion, and tier grouping functionality
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useModelLoading, type ExtendedModelInfo } from '../useModelLoading';
import * as api from '@/lib/api';
import type { PublicModel, UserProviderModel } from '@/lib/api';

// Mock API
vi.mock('@/lib/api', () => ({
  getAvailableModels: vi.fn(),
  getUserProviderModels: vi.fn(),
}));

// Mock PublicModel data
const mockPremiumModel: PublicModel = {
  model_id: 'claude-opus-4-5',
  provider: 'anthropic',
  display_name: 'Claude Opus 4.5',
  cost_tier: 'premium',
  context_window: 200000,
  max_output_tokens: 8192,
  capabilities: {
    vision: true,
    thinking: true,
    thinking_coming_soon: false,
    tool_use: true,
  },
  good_for: ['Complex reasoning', 'Code generation'],
  description: 'Most capable Claude model',
  input_cost_per_million: 15.0,
  output_cost_per_million: 75.0,
};

const mockMediumModel: PublicModel = {
  model_id: 'claude-sonnet-4',
  provider: 'anthropic',
  display_name: 'Claude Sonnet 4',
  cost_tier: 'medium',
  context_window: 200000,
  max_output_tokens: 8192,
  capabilities: {
    vision: true,
    thinking: false,
    thinking_coming_soon: true,
    tool_use: true,
  },
  good_for: ['General tasks', 'Balanced performance'],
  description: 'Balanced Claude model',
  input_cost_per_million: 3.0,
  output_cost_per_million: 15.0,
};

const mockLowModel: PublicModel = {
  model_id: 'claude-haiku-4-5',
  provider: 'anthropic',
  display_name: 'Claude Haiku 4.5',
  cost_tier: 'low',
  context_window: 200000,
  max_output_tokens: 4096,
  capabilities: {
    vision: true,
    thinking: false,
    thinking_coming_soon: false,
    tool_use: true,
  },
  good_for: ['Fast responses', 'Simple tasks'],
  description: 'Fast and efficient Claude model',
  input_cost_per_million: 0.25,
  output_cost_per_million: 1.25,
};

const mockHighModel: PublicModel = {
  model_id: 'gpt-4-turbo',
  provider: 'openai',
  display_name: 'GPT-4 Turbo',
  cost_tier: 'high',
  context_window: 128000,
  max_output_tokens: 4096,
  capabilities: {
    vision: true,
    thinking: false,
    thinking_coming_soon: false,
    tool_use: true,
  },
  good_for: ['Coding', 'Analysis'],
  description: 'OpenAI flagship model',
  input_cost_per_million: 10.0,
  output_cost_per_million: 30.0,
};

// Mock UserProviderModel data
const mockUserModel: UserProviderModel = {
  model_id: 'user-claude-opus',
  provider: 'anthropic',
  display_name: 'Claude Opus (Direct)',
  cost_tier: 'premium',
  context_window: 200000,
  max_output_tokens: 8192,
  capabilities: {
    vision: true,
    thinking: true,
    thinking_coming_soon: false,
    tool_use: true,
  },
  good_for: ['Complex reasoning'],
  description: 'User API key model',
  input_cost_per_million: 15.0,
  output_cost_per_million: 75.0,
};

const mockUserModelLow: UserProviderModel = {
  model_id: 'user-haiku',
  provider: 'anthropic',
  display_name: 'Haiku (Direct)',
  cost_tier: 'low',
  context_window: 200000,
  max_output_tokens: 4096,
  capabilities: {
    vision: false,
    thinking: false,
    thinking_coming_soon: false,
    tool_use: true,
  },
  good_for: ['Quick tasks'],
  description: 'User fast model',
  input_cost_per_million: null,
  output_cost_per_million: null,
};

describe('useModelLoading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getAvailableModels).mockResolvedValue([]);
    vi.mocked(api.getUserProviderModels).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Initialization Tests
  // ========================================================================

  describe('Initialization', () => {
    it('should initialize with empty backend models', () => {
      const { result } = renderHook(() => useModelLoading());

      expect(result.current.backendModels).toEqual([]);
    });

    it('should initialize with empty user provider models', () => {
      const { result } = renderHook(() => useModelLoading());

      expect(result.current.userProviderModels).toEqual([]);
    });

    it('should initialize with isLoading true', () => {
      const { result } = renderHook(() => useModelLoading());

      expect(result.current.isLoading).toBe(true);
    });

    it('should fetch models on mount', async () => {
      renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(api.getAvailableModels).toHaveBeenCalled();
        expect(api.getUserProviderModels).toHaveBeenCalled();
      });
    });

    it('should set isLoading to false after fetch completes', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  // ========================================================================
  // Model Loading Tests
  // ========================================================================

  describe('Model Loading', () => {
    it('should load backend models', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel, mockMediumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.backendModels).toHaveLength(2);
        expect(result.current.backendModels[0]?.model_id).toBe('claude-opus-4-5');
      });
    });

    it('should load user provider models', async () => {
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.userProviderModels).toHaveLength(1);
        expect(result.current.userProviderModels[0]?.model_id).toBe('user-claude-opus');
      });
    });

    it('should handle backend models fetch error gracefully', async () => {
      vi.mocked(api.getAvailableModels).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.backendModels).toEqual([]);
      });
    });

    it('should handle user models fetch error gracefully', async () => {
      vi.mocked(api.getUserProviderModels).mockRejectedValue(new Error('Auth error'));

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.userProviderModels).toEqual([]);
      });
    });

    it('should handle both fetches failing gracefully', async () => {
      vi.mocked(api.getAvailableModels).mockRejectedValue(new Error('Error 1'));
      vi.mocked(api.getUserProviderModels).mockRejectedValue(new Error('Error 2'));

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.backendModels).toEqual([]);
        expect(result.current.userProviderModels).toEqual([]);
      });
    });

    it('should fetch both model types in parallel', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel]);
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.backendModels).toHaveLength(1);
        expect(result.current.userProviderModels).toHaveLength(1);
      });
    });
  });

  // ========================================================================
  // backendModelToInfo Tests
  // ========================================================================

  describe('backendModelToInfo', () => {
    it('should convert backend model to ExtendedModelInfo', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockPremiumModel);

      expect(info.id).toBe('claude-opus-4-5');
      expect(info.provider).toBe('podex');
      expect(info.displayName).toBe('Claude Opus 4.5');
      expect(info.tier).toBe('flagship');
      expect(info.contextWindow).toBe(200000);
      expect(info.supportsVision).toBe(true);
      expect(info.supportsThinking).toBe(true);
    });

    it('should set provider to original when isUserKey is true', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockPremiumModel, true);

      expect(info.provider).toBe('anthropic');
      expect(info.isUserKey).toBe(true);
    });

    it('should map premium cost tier to flagship', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockPremiumModel);
      expect(info.tier).toBe('flagship');
    });

    it('should map high cost tier to flagship', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockHighModel);
      expect(info.tier).toBe('flagship');
    });

    it('should map medium cost tier to balanced', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockMediumModel);
      expect(info.tier).toBe('balanced');
    });

    it('should map low cost tier to fast', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockLowModel);
      expect(info.tier).toBe('fast');
    });

    it('should generate short name from display name', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockPremiumModel);
      // shortName preserves vendor prefix, only strips ' (User API)' suffix
      expect(info.shortName).toBe('Claude Opus 4.5');
    });

    it('should set thinking status correctly', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Model with thinking enabled
      let info = result.current.backendModelToInfo(mockPremiumModel);
      expect(info.thinkingStatus).toBe('available');

      // Model with thinking coming soon
      info = result.current.backendModelToInfo(mockMediumModel);
      expect(info.thinkingStatus).toBe('coming_soon');

      // Model without thinking
      info = result.current.backendModelToInfo(mockLowModel);
      expect(info.thinkingStatus).toBe('not_supported');
    });

    it('should include capabilities array', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockPremiumModel);

      expect(info.capabilities).toContain('chat');
      expect(info.capabilities).toContain('code');
      expect(info.capabilities).toContain('vision');
      expect(info.capabilities).toContain('function_calling');
    });

    it('should include pricing information', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockPremiumModel);

      expect(info.inputPricePerMillion).toBe(15.0);
      expect(info.outputPricePerMillion).toBe(75.0);
    });

    it('should handle null pricing', async () => {
      const modelWithNullPricing: PublicModel = {
        ...mockLowModel,
        input_cost_per_million: null,
        output_cost_per_million: null,
      };

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithNullPricing);

      expect(info.inputPricePerMillion).toBeUndefined();
      expect(info.outputPricePerMillion).toBeUndefined();
    });
  });

  // ========================================================================
  // userModelToInfo Tests
  // ========================================================================

  describe('userModelToInfo', () => {
    it('should convert user model to ExtendedModelInfo', async () => {
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.userModelToInfo(mockUserModel);

      expect(info.id).toBe('user-claude-opus');
      expect(info.provider).toBe('anthropic');
      expect(info.isUserKey).toBe(true);
    });

    it('should set tier based on cost tier', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let info = result.current.userModelToInfo(mockUserModel);
      expect(info.tier).toBe('flagship');

      info = result.current.userModelToInfo(mockUserModelLow);
      expect(info.tier).toBe('fast');
    });

    it('should generate short name from display name', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.userModelToInfo(mockUserModel);
      // shortName preserves the display name, only strips ' (User API)' suffix
      expect(info.shortName).toBe('Claude Opus (Direct)');
    });

    it('should handle models without vision capability', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.userModelToInfo(mockUserModelLow);

      expect(info.supportsVision).toBe(false);
      expect(info.capabilities).not.toContain('vision');
    });
  });

  // ========================================================================
  // getModelInfo Tests
  // ========================================================================

  describe('getModelInfo', () => {
    it('should return model info for backend model', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.getModelInfo('claude-opus-4-5');

      expect(info).toBeDefined();
      expect(info?.id).toBe('claude-opus-4-5');
    });

    it('should return model info for user model', async () => {
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.getModelInfo('user-claude-opus');

      expect(info).toBeDefined();
      expect(info?.id).toBe('user-claude-opus');
      expect(info?.isUserKey).toBe(true);
    });

    it('should return undefined for unknown model', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.getModelInfo('unknown-model');

      expect(info).toBeUndefined();
    });

    it('should prioritize user model over backend model', async () => {
      const sameIdBackend: PublicModel = {
        ...mockPremiumModel,
        model_id: 'shared-model',
      };
      const sameIdUser: UserProviderModel = {
        ...mockUserModel,
        model_id: 'shared-model',
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([sameIdBackend]);
      vi.mocked(api.getUserProviderModels).mockResolvedValue([sameIdUser]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.getModelInfo('shared-model');

      expect(info?.isUserKey).toBe(true);
    });
  });

  // ========================================================================
  // getModelDisplayName Tests
  // ========================================================================

  describe('getModelDisplayName', () => {
    it('should return agent display name if provided', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Returns agentDisplayName directly without modification
      const name = result.current.getModelDisplayName('any-model', 'Claude Custom Agent');

      expect(name).toBe('Claude Custom Agent');
    });

    it('should return formatted name for user model', async () => {
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Returns display_name with only ' (User API)' suffix stripped
      const name = result.current.getModelDisplayName('user-claude-opus');

      expect(name).toBe('Claude Opus (Direct)');
    });

    it('should return formatted name for backend model', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Returns backend model's display_name directly
      const name = result.current.getModelDisplayName('claude-opus-4-5');

      expect(name).toBe('Claude Opus 4.5');
    });

    it('should return modelId for unknown model', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const name = result.current.getModelDisplayName('unknown-model-id');

      expect(name).toBe('unknown-model-id');
    });

    it('should return display name with vendor prefix for non-Anthropic models', async () => {
      const llamaModel: PublicModel = {
        ...mockLowModel,
        model_id: 'llama-3-8b',
        display_name: 'Llama 3 8B',
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([llamaModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Returns display_name directly, preserving vendor prefix
      const name = result.current.getModelDisplayName('llama-3-8b');

      expect(name).toBe('Llama 3 8B');
    });
  });

  // ========================================================================
  // modelsByTier Tests
  // ========================================================================

  describe('modelsByTier', () => {
    it('should group models by tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([
        mockPremiumModel,
        mockHighModel,
        mockMediumModel,
        mockLowModel,
      ]);
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.flagship).toHaveLength(2);
      expect(result.current.modelsByTier.balanced).toHaveLength(1);
      expect(result.current.modelsByTier.fast).toHaveLength(1);
      expect(result.current.modelsByTier.userApi).toHaveLength(1);
    });

    it('should put premium models in flagship tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.flagship).toHaveLength(1);
      expect(result.current.modelsByTier.flagship[0]?.id).toBe('claude-opus-4-5');
    });

    it('should put high models in flagship tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockHighModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.flagship).toHaveLength(1);
    });

    it('should put medium models in balanced tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockMediumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.balanced).toHaveLength(1);
    });

    it('should put low models in fast tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockLowModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.fast).toHaveLength(1);
    });

    it('should put user models in userApi tier', async () => {
      vi.mocked(api.getUserProviderModels).mockResolvedValue([mockUserModel, mockUserModelLow]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.userApi).toHaveLength(2);
    });

    it('should return empty arrays when no models', async () => {
      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.modelsByTier.flagship).toEqual([]);
      expect(result.current.modelsByTier.balanced).toEqual([]);
      expect(result.current.modelsByTier.fast).toEqual([]);
      expect(result.current.modelsByTier.userApi).toEqual([]);
    });
  });

  // ========================================================================
  // Unmount Cleanup Tests
  // ========================================================================

  describe('Unmount Cleanup', () => {
    it('should not update state after unmount', async () => {
      let resolveModels: (value: PublicModel[]) => void;
      vi.mocked(api.getAvailableModels).mockReturnValue(
        new Promise((resolve) => {
          resolveModels = resolve;
        })
      );

      const { result, unmount } = renderHook(() => useModelLoading());

      expect(result.current.isLoading).toBe(true);

      // Unmount before promise resolves
      unmount();

      // Resolve the promise after unmount
      await act(async () => {
        resolveModels!([mockPremiumModel]);
      });

      // Should not throw error
    });
  });

  // ========================================================================
  // Edge Cases Tests
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle empty good_for array', async () => {
      const modelWithEmptyGoodFor: PublicModel = {
        ...mockLowModel,
        good_for: [],
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([modelWithEmptyGoodFor]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithEmptyGoodFor);
      expect(info.goodFor).toEqual([]);
    });

    it('should handle empty description', async () => {
      const modelWithEmptyDesc: PublicModel = {
        ...mockLowModel,
        description: '',
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([modelWithEmptyDesc]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithEmptyDesc);
      expect(info.description).toBe('');
    });

    it('should handle null good_for', async () => {
      const modelWithNullGoodFor: PublicModel = {
        ...mockLowModel,
        good_for: null as any,
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([modelWithNullGoodFor]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithNullGoodFor);
      expect(info.goodFor).toEqual([]);
    });

    it('should handle null description', async () => {
      const modelWithNullDesc: PublicModel = {
        ...mockLowModel,
        description: null as any,
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([modelWithNullDesc]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithNullDesc);
      expect(info.description).toBe('');
    });

    it('should handle model without tool_use capability', async () => {
      const modelWithoutToolUse: PublicModel = {
        ...mockLowModel,
        capabilities: {
          ...mockLowModel.capabilities,
          tool_use: false,
        },
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([modelWithoutToolUse]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithoutToolUse);
      expect(info.capabilities).not.toContain('function_calling');
    });

    it('should handle model without vision capability', async () => {
      const modelWithoutVision: PublicModel = {
        ...mockLowModel,
        capabilities: {
          ...mockLowModel.capabilities,
          vision: false,
        },
      };

      vi.mocked(api.getAvailableModels).mockResolvedValue([modelWithoutVision]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(modelWithoutVision);
      expect(info.supportsVision).toBe(false);
      expect(info.capabilities).not.toContain('vision');
    });
  });

  // ========================================================================
  // Reasoning Effort Tests
  // ========================================================================

  describe('Reasoning Effort', () => {
    it('should set high reasoning effort for premium/high tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockPremiumModel, mockHighModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let info = result.current.backendModelToInfo(mockPremiumModel);
      expect(info.reasoningEffort).toBe('high');

      info = result.current.backendModelToInfo(mockHighModel);
      expect(info.reasoningEffort).toBe('high');
    });

    it('should set medium reasoning effort for medium tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockMediumModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockMediumModel);
      expect(info.reasoningEffort).toBe('medium');
    });

    it('should set low reasoning effort for low tier', async () => {
      vi.mocked(api.getAvailableModels).mockResolvedValue([mockLowModel]);

      const { result } = renderHook(() => useModelLoading());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const info = result.current.backendModelToInfo(mockLowModel);
      expect(info.reasoningEffort).toBe('low');
    });
  });
});
