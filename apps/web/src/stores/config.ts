/**
 * Platform configuration store.
 *
 * Manages platform settings, LLM providers, and agent role configs
 * fetched from the backend API. No fallbacks - errors are shown to users.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  getPlatformConfig,
  getPlatformSettings,
  getProviders,
  type LLMProvider,
  type PlatformSetting,
  type WorkspaceDefaults,
  type ThinkingPresets,
  type TimeoutOption,
  type VoiceLanguage,
  type AgentModeConfig,
  type SidebarLayoutDefaults,
  type GridConfigDefaults,
  type CardDimensions,
  type ContextCompactionDefaults,
  type ContextUsageDefaults,
  type AICompletionConfig,
  type CodeGeneratorConfig,
  type BugDetectorConfig,
  type EditorAIConfig,
  type TimeRangeOption,
  type StorageQuotaDefaults,
  type EditorDefaults,
  type VoiceDefaults,
  type FeatureFlags,
  type PlatformLimits,
  type PreviewPortConfig,
} from '@/lib/api';
import { getAgentRoleConfigs, type AgentRoleConfig } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface ConfigState {
  // Loading state
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Raw data from API
  platformSettings: PlatformSetting[];
  settingsMap: Record<string, unknown>;
  providers: LLMProvider[];
  agentRoles: AgentRoleConfig[];

  // Computed/cached values
  _workspaceDefaults: WorkspaceDefaults | null;
  _thinkingPresets: ThinkingPresets | null;
  _timeoutOptions: TimeoutOption[] | null;
  _voiceLanguages: VoiceLanguage[] | null;
  _agentModeConfig: AgentModeConfig | null;

  // Selectors - return null if not loaded (no fallbacks)
  getWorkspaceDefaults: () => WorkspaceDefaults | null;
  getThinkingPresets: () => ThinkingPresets | null;
  getTimeoutOptions: () => TimeoutOption[] | null;
  getVoiceLanguages: () => VoiceLanguage[] | null;
  getAgentModeConfig: () => AgentModeConfig | null;
  getProvider: (slug: string) => LLMProvider | undefined;
  getAgentRole: (role: string) => AgentRoleConfig | undefined;
  getSetting: <T = unknown>(key: string) => T | null;

  // New selectors for additional settings
  getSidebarLayoutDefaults: () => SidebarLayoutDefaults | null;
  getGridConfigDefaults: () => GridConfigDefaults | null;
  getCardDimensions: () => CardDimensions | null;
  getContextCompactionDefaults: () => ContextCompactionDefaults | null;
  getContextUsageDefaults: () => ContextUsageDefaults | null;
  getAICompletionConfig: () => AICompletionConfig | null;
  getCodeGeneratorConfig: () => CodeGeneratorConfig | null;
  getBugDetectorConfig: () => BugDetectorConfig | null;
  getEditorAIConfig: () => EditorAIConfig | null;
  getTimeRangeOptions: () => TimeRangeOption[] | null;
  getStorageQuotaDefaults: () => StorageQuotaDefaults | null;
  getEditorDefaults: () => EditorDefaults | null;
  getVoiceDefaults: () => VoiceDefaults | null;
  getFeatureFlags: () => FeatureFlags | null;
  getPlatformLimits: () => PlatformLimits | null;
  getDefaultPreviewPorts: () => PreviewPortConfig[] | null;

  // Actions
  initialize: () => Promise<void>;
  fetchPlatformSettings: () => Promise<void>;
  fetchProviders: () => Promise<void>;
  fetchAgentRoles: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

export const useConfigStore = create<ConfigState>()(
  devtools(
    (set, get) => ({
      // Initial state
      isLoading: false,
      isInitialized: false,
      error: null,
      platformSettings: [],
      settingsMap: {},
      providers: [],
      agentRoles: [],
      _workspaceDefaults: null,
      _thinkingPresets: null,
      _timeoutOptions: null,
      _voiceLanguages: null,
      _agentModeConfig: null,

      // Selectors - return null if not loaded (no fallbacks)
      getWorkspaceDefaults: () => {
        const state = get();
        if (state._workspaceDefaults) return state._workspaceDefaults;
        const setting = state.settingsMap['workspace_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as WorkspaceDefaults;
        }
        return null;
      },

      getThinkingPresets: () => {
        const state = get();
        if (state._thinkingPresets) return state._thinkingPresets;
        const setting = state.settingsMap['thinking_presets'];
        if (setting && typeof setting === 'object') {
          return setting as ThinkingPresets;
        }
        return null;
      },

      getTimeoutOptions: () => {
        const state = get();
        if (state._timeoutOptions) return state._timeoutOptions;
        const setting = state.settingsMap['timeout_options'];
        if (Array.isArray(setting)) {
          return setting as TimeoutOption[];
        }
        return null;
      },

      getVoiceLanguages: () => {
        const state = get();
        if (state._voiceLanguages) return state._voiceLanguages;
        const setting = state.settingsMap['supported_languages'];
        if (Array.isArray(setting)) {
          return setting as VoiceLanguage[];
        }
        return null;
      },

      getAgentModeConfig: () => {
        const state = get();
        if (state._agentModeConfig) return state._agentModeConfig;
        const setting = state.settingsMap['agent_mode_config'];
        if (setting && typeof setting === 'object') {
          return setting as AgentModeConfig;
        }
        return null;
      },

      getProvider: (slug: string) => {
        return get().providers.find((p) => p.slug === slug);
      },

      getAgentRole: (role: string) => {
        return get().agentRoles.find((r) => r.role === role);
      },

      getSetting: <T = unknown>(key: string): T | null => {
        const value = get().settingsMap[key];
        if (value !== undefined) return value as T;
        return null;
      },

      // New selectors for additional settings
      getSidebarLayoutDefaults: () => {
        const setting = get().settingsMap['sidebar_layout_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as SidebarLayoutDefaults;
        }
        return null;
      },

      getGridConfigDefaults: () => {
        const setting = get().settingsMap['grid_config_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as GridConfigDefaults;
        }
        return null;
      },

      getCardDimensions: () => {
        const setting = get().settingsMap['card_dimensions'];
        if (setting && typeof setting === 'object') {
          return setting as CardDimensions;
        }
        return null;
      },

      getContextCompactionDefaults: () => {
        const setting = get().settingsMap['context_compaction_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as ContextCompactionDefaults;
        }
        return null;
      },

      getContextUsageDefaults: () => {
        const setting = get().settingsMap['context_usage_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as ContextUsageDefaults;
        }
        return null;
      },

      getAICompletionConfig: () => {
        const setting = get().settingsMap['ai_completion_config'];
        if (setting && typeof setting === 'object') {
          return setting as AICompletionConfig;
        }
        return null;
      },

      getCodeGeneratorConfig: () => {
        const setting = get().settingsMap['code_generator_config'];
        if (setting && typeof setting === 'object') {
          return setting as CodeGeneratorConfig;
        }
        return null;
      },

      getBugDetectorConfig: () => {
        const setting = get().settingsMap['bug_detector_config'];
        if (setting && typeof setting === 'object') {
          return setting as BugDetectorConfig;
        }
        return null;
      },

      getEditorAIConfig: () => {
        const setting = get().settingsMap['editor_ai_config'];
        if (setting && typeof setting === 'object') {
          return setting as EditorAIConfig;
        }
        return null;
      },

      getTimeRangeOptions: () => {
        const setting = get().settingsMap['time_range_options'];
        if (Array.isArray(setting)) {
          return setting as TimeRangeOption[];
        }
        return null;
      },

      getStorageQuotaDefaults: () => {
        const setting = get().settingsMap['storage_quota_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as StorageQuotaDefaults;
        }
        return null;
      },

      getEditorDefaults: () => {
        const setting = get().settingsMap['editor_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as EditorDefaults;
        }
        return null;
      },

      getVoiceDefaults: () => {
        const setting = get().settingsMap['voice_defaults'];
        if (setting && typeof setting === 'object') {
          return setting as VoiceDefaults;
        }
        return null;
      },

      getFeatureFlags: () => {
        const setting = get().settingsMap['feature_flags'];
        if (setting && typeof setting === 'object') {
          return setting as FeatureFlags;
        }
        return null;
      },

      getPlatformLimits: () => {
        const setting = get().settingsMap['platform_limits'];
        if (setting && typeof setting === 'object') {
          return setting as PlatformLimits;
        }
        return null;
      },

      getDefaultPreviewPorts: () => {
        const setting = get().settingsMap['default_preview_ports'];
        if (Array.isArray(setting)) {
          return setting as PreviewPortConfig[];
        }
        return null;
      },

      clearError: () => set({ error: null }),

      // Actions
      initialize: async () => {
        const state = get();
        if (state.isInitialized || state.isLoading) return;

        set({ isLoading: true, error: null });

        try {
          // Fetch all config data in parallel - no silent catches
          const [configData, rolesResponse] = await Promise.all([
            getPlatformConfig(),
            getAgentRoleConfigs(),
          ]);

          // Build settings map from config
          const settingsMap = configData.settings || {};

          set({
            settingsMap,
            providers: configData.providers || [],
            agentRoles: rolesResponse.roles,
            isInitialized: true,
            isLoading: false,
            error: null,
            // Cache computed values
            _workspaceDefaults:
              (settingsMap['workspace_defaults'] as WorkspaceDefaults | undefined) || null,
            _thinkingPresets:
              (settingsMap['thinking_presets'] as ThinkingPresets | undefined) || null,
            _timeoutOptions:
              (settingsMap['timeout_options'] as TimeoutOption[] | undefined) || null,
            _voiceLanguages:
              (settingsMap['supported_languages'] as VoiceLanguage[] | undefined) || null,
            _agentModeConfig:
              (settingsMap['agent_mode_config'] as AgentModeConfig | undefined) || null,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load platform configuration';
          console.error('Config store initialization failed:', error);
          set({
            error: errorMessage,
            isLoading: false,
            isInitialized: false, // Keep as not initialized so retry is possible
          });
        }
      },

      fetchPlatformSettings: async () => {
        try {
          const settings = await getPlatformSettings();
          const settingsMap: Record<string, unknown> = {};
          for (const setting of settings) {
            settingsMap[setting.key] = setting.value;
          }
          set({
            platformSettings: settings,
            settingsMap,
            error: null,
            _workspaceDefaults:
              (settingsMap['workspace_defaults'] as WorkspaceDefaults | undefined) || null,
            _thinkingPresets:
              (settingsMap['thinking_presets'] as ThinkingPresets | undefined) || null,
            _timeoutOptions:
              (settingsMap['timeout_options'] as TimeoutOption[] | undefined) || null,
            _voiceLanguages:
              (settingsMap['supported_languages'] as VoiceLanguage[] | undefined) || null,
            _agentModeConfig:
              (settingsMap['agent_mode_config'] as AgentModeConfig | undefined) || null,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to fetch platform settings';
          console.error('Failed to fetch platform settings:', error);
          set({ error: errorMessage });
          throw error;
        }
      },

      fetchProviders: async () => {
        try {
          const providers = await getProviders();
          set({ providers, error: null });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch providers';
          console.error('Failed to fetch providers:', error);
          set({ error: errorMessage });
          throw error;
        }
      },

      fetchAgentRoles: async () => {
        try {
          const rolesResponse = await getAgentRoleConfigs();
          set({ agentRoles: rolesResponse.roles, error: null });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to fetch agent roles';
          console.error('Failed to fetch agent roles:', error);
          set({ error: errorMessage });
          throw error;
        }
      },

      refresh: async () => {
        set({ isLoading: true, error: null });
        try {
          await Promise.all([
            get().fetchPlatformSettings(),
            get().fetchProviders(),
            get().fetchAgentRoles(),
          ]);
        } catch {
          // Individual errors are already set by the fetch functions
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    { name: 'config-store' }
  )
);

// Helper hook to initialize config on app load
export function useInitializeConfig() {
  const initialize = useConfigStore((state) => state.initialize);
  const isInitialized = useConfigStore((state) => state.isInitialized);
  const isLoading = useConfigStore((state) => state.isLoading);
  const error = useConfigStore((state) => state.error);
  const clearError = useConfigStore((state) => state.clearError);
  const user = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.isInitialized);

  const shouldInitialize = authInitialized && !!user;

  useEffect(() => {
    if (shouldInitialize && !isInitialized && !isLoading && !error) {
      initialize();
    }
  }, [shouldInitialize, isInitialized, isLoading, error, initialize]);

  return {
    isInitialized,
    isLoading,
    error,
    retry: () => {
      clearError();
      initialize();
    },
  };
}

// Helper hook for components that need config data
export function useConfigData() {
  const isInitialized = useConfigStore((state) => state.isInitialized);
  const isLoading = useConfigStore((state) => state.isLoading);
  const error = useConfigStore((state) => state.error);
  const providers = useConfigStore((state) => state.providers);
  const agentRoles = useConfigStore((state) => state.agentRoles);
  const getThinkingPresets = useConfigStore((state) => state.getThinkingPresets);
  const getTimeoutOptions = useConfigStore((state) => state.getTimeoutOptions);
  const getVoiceLanguages = useConfigStore((state) => state.getVoiceLanguages);
  const getWorkspaceDefaults = useConfigStore((state) => state.getWorkspaceDefaults);
  const getAgentModeConfig = useConfigStore((state) => state.getAgentModeConfig);
  const refresh = useConfigStore((state) => state.refresh);

  return {
    isInitialized,
    isLoading,
    error,
    providers,
    agentRoles,
    thinkingPresets: getThinkingPresets(),
    timeoutOptions: getTimeoutOptions(),
    voiceLanguages: getVoiceLanguages(),
    workspaceDefaults: getWorkspaceDefaults(),
    agentModeConfig: getAgentModeConfig(),
    refresh,
  };
}
