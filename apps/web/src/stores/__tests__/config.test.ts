import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConfigStore } from '../config';
import * as api from '@/lib/api';
import type {
  LLMProvider,
  PlatformSetting,
  WorkspaceDefaults,
  ThinkingPresets,
  TimeoutOption,
  VoiceLanguage,
  AgentModeConfig,
  SidebarLayoutDefaults,
  GridConfigDefaults,
  CardDimensions,
  ContextCompactionDefaults,
  ContextUsageDefaults,
  AICompletionConfig,
  CodeGeneratorConfig,
  BugDetectorConfig,
  EditorAIConfig,
  TimeRangeOption,
  StorageQuotaDefaults,
  EditorDefaults,
  VoiceDefaults,
  FeatureFlags,
  PlatformLimits,
  PreviewPortConfig,
  AgentRoleConfig,
} from '@/lib/api';

// Mock the auth store
vi.mock('../auth', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 'user-1', email: 'test@example.com' },
    isInitialized: true,
  })),
}));

// Mock API functions
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api');
  return {
    ...actual,
    getPlatformConfig: vi.fn(),
    getPlatformSettings: vi.fn(),
    getProviders: vi.fn(),
    getAgentRoleConfigs: vi.fn(),
  };
});

// Mock data
const mockProviders: LLMProvider[] = [
  {
    id: 'provider-1',
    slug: 'anthropic',
    name: 'Anthropic',
    is_enabled: true,
    models: [
      {
        id: 'model-1',
        name: 'claude-opus-4-5-20251101',
        display_name: 'Claude Opus 4.5',
        input_cost_per_1k: 0.015,
        output_cost_per_1k: 0.075,
        context_window: 200000,
        max_output_tokens: 16384,
        supports_streaming: true,
        supports_tools: true,
        supports_vision: true,
        is_enabled: true,
      },
      {
        id: 'model-2',
        name: 'claude-sonnet-4-5-20250929',
        display_name: 'Claude Sonnet 4.5',
        input_cost_per_1k: 0.003,
        output_cost_per_1k: 0.015,
        context_window: 200000,
        max_output_tokens: 8192,
        supports_streaming: true,
        supports_tools: true,
        supports_vision: false,
        is_enabled: true,
      },
    ],
  },
  {
    id: 'provider-2',
    slug: 'openai',
    name: 'OpenAI',
    is_enabled: true,
    models: [
      {
        id: 'model-3',
        name: 'gpt-4',
        display_name: 'GPT-4',
        input_cost_per_1k: 0.03,
        output_cost_per_1k: 0.06,
        context_window: 8192,
        max_output_tokens: 4096,
        supports_streaming: true,
        supports_tools: true,
        supports_vision: false,
        is_enabled: true,
      },
    ],
  },
];

const mockAgentRoles: AgentRoleConfig[] = [
  {
    role: 'architect',
    name: 'Architect',
    description: 'Designs system architecture and makes high-level decisions',
    color: '#7C3AED',
    default_model: 'claude-opus-4-5-20251101',
    default_temperature: 0.7,
    suggested_tools: ['read_file', 'search_files', 'list_directory'],
  },
  {
    role: 'coder',
    name: 'Developer',
    description: 'Writes and modifies code',
    color: '#10B981',
    default_model: 'claude-sonnet-4-5-20250929',
    default_temperature: 0.5,
    suggested_tools: ['read_file', 'write_file', 'edit_file'],
  },
];

const mockWorkspaceDefaults: WorkspaceDefaults = {
  tier: 'basic',
  timeout_minutes: 60,
  standby_delay_minutes: 10,
  max_concurrent: 5,
  auto_shutdown_minutes: 120,
  storage_gb: 10,
};

const mockThinkingPresets: ThinkingPresets = {
  quick: { label: 'Quick', tokens: 1000 },
  normal: { label: 'Normal', tokens: 5000 },
  deep: { label: 'Deep', tokens: 10000 },
};

const mockTimeoutOptions: TimeoutOption[] = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
];

const mockVoiceLanguages: VoiceLanguage[] = [
  { code: 'en-US', name: 'English (US)', voice_id: 'en-US-Neural2-D' },
  { code: 'es-ES', name: 'Spanish (Spain)', voice_id: 'es-ES-Neural2-A' },
];

const mockAgentModeConfig: AgentModeConfig = {
  ask: { label: 'Ask', description: 'Ask questions and get answers' },
  code: { label: 'Code', description: 'Write and modify code' },
  plan: { label: 'Plan', description: 'Create execution plans' },
};

const mockSidebarLayoutDefaults: SidebarLayoutDefaults = {
  left_width: 240,
  right_width: 320,
  collapsed_width: 48,
};

const mockGridConfigDefaults: GridConfigDefaults = {
  columns: 3,
  rows: 2,
  gap: 16,
  min_card_width: 320,
  min_card_height: 400,
};

const mockCardDimensions: CardDimensions = {
  agent: { width: 400, height: 600 },
  editor: { width: 600, height: 700 },
  terminal: { width: 500, height: 400 },
  preview: { width: 500, height: 500 },
};

const mockContextCompactionDefaults: ContextCompactionDefaults = {
  enabled: true,
  max_tokens: 150000,
  target_tokens: 100000,
  strategy: 'sliding_window',
};

const mockContextUsageDefaults: ContextUsageDefaults = {
  warning_threshold: 0.8,
  critical_threshold: 0.95,
  show_usage_indicator: true,
};

const mockDefaultDotfiles: string[] = ['.bashrc', '.zshrc', '.gitconfig'];

const mockAICompletionConfig: AICompletionConfig = {
  enabled: true,
  model: 'claude-sonnet-4-5-20250929',
  trigger_delay_ms: 500,
  max_suggestions: 3,
};

const mockCodeGeneratorConfig: CodeGeneratorConfig = {
  model: 'claude-opus-4-5-20251101',
  temperature: 0.3,
  max_tokens: 4096,
};

const mockBugDetectorConfig: BugDetectorConfig = {
  enabled: true,
  model: 'claude-sonnet-4-5-20250929',
  scan_on_save: false,
  severity_threshold: 'medium',
};

const mockEditorAIConfig: EditorAIConfig = {
  inline_completion: true,
  code_generation: true,
  bug_detection: false,
};

const mockTimeRangeOptions: TimeRangeOption[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const mockStorageQuotaDefaults: StorageQuotaDefaults = {
  workspace_gb: 10,
  total_gb: 50,
  warning_threshold: 0.8,
};

const mockEditorDefaults: EditorDefaults = {
  theme: 'vs-dark',
  font_size: 14,
  font_family: 'Monaco, monospace',
  tab_size: 2,
  word_wrap: false,
  minimap_enabled: true,
  line_numbers: true,
  bracket_matching: true,
};

const mockVoiceDefaults: VoiceDefaults = {
  enabled: false,
  language: 'en-US',
  voice_id: 'en-US-Neural2-D',
  speed: 1.0,
  pitch: 0,
};

const mockFeatureFlags: FeatureFlags = {
  voice_commands: true,
  gpu_workspaces: true,
  planning_mode: true,
  browser_context: false,
  multi_agent_collaboration: true,
  context_compaction: true,
  ai_completion: true,
  code_generation: true,
  bug_detection: false,
};

const mockPlatformLimits: PlatformLimits = {
  max_sessions_per_user: 10,
  max_agents_per_session: 5,
  max_message_length: 10000,
  max_file_size_mb: 100,
  max_workspace_storage_gb: 50,
};

const mockDefaultPreviewPorts: PreviewPortConfig[] = [
  { port: 3000, label: 'Development Server', auto_open: true },
  { port: 8080, label: 'HTTP Server', auto_open: false },
];

const mockPlatformSettings: Record<string, unknown> = {
  workspace_defaults: mockWorkspaceDefaults,
  thinking_presets: mockThinkingPresets,
  timeout_options: mockTimeoutOptions,
  supported_languages: mockVoiceLanguages,
  agent_mode_config: mockAgentModeConfig,
  sidebar_layout_defaults: mockSidebarLayoutDefaults,
  grid_config_defaults: mockGridConfigDefaults,
  card_dimensions: mockCardDimensions,
  context_compaction_defaults: mockContextCompactionDefaults,
  context_usage_defaults: mockContextUsageDefaults,
  default_dotfiles: mockDefaultDotfiles,
  ai_completion_config: mockAICompletionConfig,
  code_generator_config: mockCodeGeneratorConfig,
  bug_detector_config: mockBugDetectorConfig,
  editor_ai_config: mockEditorAIConfig,
  time_range_options: mockTimeRangeOptions,
  storage_quota_defaults: mockStorageQuotaDefaults,
  editor_defaults: mockEditorDefaults,
  voice_defaults: mockVoiceDefaults,
  feature_flags: mockFeatureFlags,
  platform_limits: mockPlatformLimits,
  default_preview_ports: mockDefaultPreviewPorts,
};

const mockPlatformConfig = {
  settings: mockPlatformSettings,
  providers: mockProviders,
};

describe('configStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useConfigStore.setState({
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
      });
    });

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has not loaded configuration', () => {
      const { result } = renderHook(() => useConfigStore());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isInitialized).toBe(false);
    });

    it('has no error', () => {
      const { result } = renderHook(() => useConfigStore());
      expect(result.current.error).toBeNull();
    });

    it('has empty providers array', () => {
      const { result } = renderHook(() => useConfigStore());
      expect(result.current.providers).toEqual([]);
    });

    it('has empty agent roles array', () => {
      const { result } = renderHook(() => useConfigStore());
      expect(result.current.agentRoles).toEqual([]);
    });
  });

  // ========================================================================
  // Configuration Loading
  // ========================================================================

  describe('Configuration Loading', () => {
    describe('initialize', () => {
      it('loads config from server successfully', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.isInitialized).toBe(true);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
      });

      it('sets loading state during initialization', async () => {
        let resolveConfig: (value: any) => void;
        const configPromise = new Promise((resolve) => {
          resolveConfig = resolve;
        });
        vi.mocked(api.getPlatformConfig).mockReturnValue(configPromise as any);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        const initPromise = act(async () => {
          result.current.initialize();
        });

        await waitFor(() => {
          expect(result.current.isLoading).toBe(true);
        });

        resolveConfig!(mockPlatformConfig);
        await initPromise;

        expect(result.current.isLoading).toBe(false);
      });

      it('loads providers from config', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.providers).toEqual(mockProviders);
      });

      it('loads agent roles from API', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.agentRoles).toEqual(mockAgentRoles);
      });

      it('caches computed values on initialization', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.getWorkspaceDefaults()).toEqual(mockWorkspaceDefaults);
        expect(result.current.getThinkingPresets()).toEqual(mockThinkingPresets);
        expect(result.current.getTimeoutOptions()).toEqual(mockTimeoutOptions);
      });

      it('handles initialization error', async () => {
        const error = new Error('Network error');
        vi.mocked(api.getPlatformConfig).mockRejectedValue(error);

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.error).toBe('Network error');
        expect(result.current.isInitialized).toBe(false);
        expect(result.current.isLoading).toBe(false);
      });

      it('does not re-initialize if already initialized', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(api.getPlatformConfig).toHaveBeenCalledTimes(1);

        await act(async () => {
          await result.current.initialize();
        });

        // Should not call API again
        expect(api.getPlatformConfig).toHaveBeenCalledTimes(1);
      });

      it('does not re-initialize if already loading', async () => {
        let resolveConfig: (value: any) => void;
        const configPromise = new Promise((resolve) => {
          resolveConfig = resolve;
        });
        vi.mocked(api.getPlatformConfig).mockReturnValue(configPromise as any);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        act(() => {
          result.current.initialize();
        });

        await waitFor(() => {
          expect(result.current.isLoading).toBe(true);
        });

        // Try to initialize again while loading
        act(() => {
          result.current.initialize();
        });

        // Should only have one API call
        expect(api.getPlatformConfig).toHaveBeenCalledTimes(1);

        resolveConfig!(mockPlatformConfig);
      });

      it('builds settings map from config', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.settingsMap).toEqual(mockPlatformSettings);
      });

      it('handles empty config response gracefully', async () => {
        vi.mocked(api.getPlatformConfig).mockResolvedValue({
          settings: {},
          providers: [],
        });
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: [] });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.initialize();
        });

        expect(result.current.isInitialized).toBe(true);
        expect(result.current.providers).toEqual([]);
        expect(result.current.agentRoles).toEqual([]);
      });
    });

    describe('fetchPlatformSettings', () => {
      it('fetches and stores platform settings', async () => {
        const settingsArray: PlatformSetting[] = [
          {
            id: '1',
            key: 'workspace_defaults',
            value: mockWorkspaceDefaults,
            category: 'workspace',
          },
          { id: '2', key: 'thinking_presets', value: mockThinkingPresets, category: 'agent' },
        ];
        vi.mocked(api.getPlatformSettings).mockResolvedValue(settingsArray);

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.fetchPlatformSettings();
        });

        expect(result.current.platformSettings).toEqual(settingsArray);
        expect(result.current.settingsMap['workspace_defaults']).toEqual(mockWorkspaceDefaults);
        expect(result.current.settingsMap['thinking_presets']).toEqual(mockThinkingPresets);
      });

      it('throws error on fetch failure', async () => {
        const error = new Error('Fetch failed');
        vi.mocked(api.getPlatformSettings).mockRejectedValue(error);

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          try {
            await result.current.fetchPlatformSettings();
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Fetch failed');
      });
    });
  });

  // ========================================================================
  // Configuration Updates
  // ========================================================================

  describe('Configuration Updates', () => {
    describe('refresh', () => {
      it('refreshes all configuration data', async () => {
        const settingsArray: PlatformSetting[] = [
          {
            id: '1',
            key: 'workspace_defaults',
            value: mockWorkspaceDefaults,
            category: 'workspace',
          },
        ];
        vi.mocked(api.getPlatformSettings).mockResolvedValue(settingsArray);
        vi.mocked(api.getProviders).mockResolvedValue(mockProviders);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.refresh();
        });

        expect(api.getPlatformSettings).toHaveBeenCalled();
        expect(api.getProviders).toHaveBeenCalled();
        expect(api.getAgentRoleConfigs).toHaveBeenCalled();
      });

      it('sets loading state during refresh', async () => {
        let resolveSettings: (value: any) => void;
        const settingsPromise = new Promise((resolve) => {
          resolveSettings = resolve;
        });
        vi.mocked(api.getPlatformSettings).mockReturnValue(settingsPromise as any);
        vi.mocked(api.getProviders).mockResolvedValue(mockProviders);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        const refreshPromise = act(async () => {
          result.current.refresh();
        });

        await waitFor(() => {
          expect(result.current.isLoading).toBe(true);
        });

        resolveSettings!([]);
        await refreshPromise;

        expect(result.current.isLoading).toBe(false);
      });

      it('clears error on successful refresh', async () => {
        const settingsArray: PlatformSetting[] = [];
        vi.mocked(api.getPlatformSettings).mockResolvedValue(settingsArray);
        vi.mocked(api.getProviders).mockResolvedValue(mockProviders);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        act(() => {
          useConfigStore.setState({ error: 'Previous error' });
        });

        await act(async () => {
          await result.current.refresh();
        });

        expect(result.current.error).toBeNull();
      });

      it('handles partial refresh failures gracefully', async () => {
        vi.mocked(api.getPlatformSettings).mockRejectedValue(new Error('Settings error'));
        vi.mocked(api.getProviders).mockResolvedValue(mockProviders);
        vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

        const { result } = renderHook(() => useConfigStore());

        await act(async () => {
          await result.current.refresh();
        });

        // Should complete and set isLoading to false even with partial failure
        expect(result.current.isLoading).toBe(false);
        // Note: The error from fetchPlatformSettings gets overwritten by the successful
        // fetchProviders and fetchAgentRoles which set error: null on success
        // This is current behavior - in a batch refresh, successful fetches clear errors
        expect(result.current.error).toBeNull();
      });
    });

    describe('clearError', () => {
      it('clears error state', () => {
        const { result } = renderHook(() => useConfigStore());

        act(() => {
          useConfigStore.setState({ error: 'Test error' });
        });

        expect(result.current.error).toBe('Test error');

        act(() => {
          result.current.clearError();
        });

        expect(result.current.error).toBeNull();
      });
    });
  });

  // ========================================================================
  // Feature Flags
  // ========================================================================

  describe('Feature Flags', () => {
    beforeEach(async () => {
      vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
      vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

      const { result } = renderHook(() => useConfigStore());
      await act(async () => {
        await result.current.initialize();
      });
    });

    it('returns feature flags', () => {
      const { result } = renderHook(() => useConfigStore());
      const flags = result.current.getFeatureFlags();
      expect(flags).toEqual(mockFeatureFlags);
    });

    it('returns individual feature flag values', () => {
      const { result } = renderHook(() => useConfigStore());
      const flags = result.current.getFeatureFlags();
      expect(flags?.voice_commands).toBe(true);
      expect(flags?.gpu_workspaces).toBe(true);
      expect(flags?.browser_context).toBe(false);
    });

    it('returns null when feature flags not loaded', () => {
      const { result } = renderHook(() => useConfigStore());

      act(() => {
        useConfigStore.setState({
          settingsMap: {},
          isInitialized: false,
        });
      });

      expect(result.current.getFeatureFlags()).toBeNull();
    });

    it('supports environment-specific flags', () => {
      const { result } = renderHook(() => useConfigStore());

      const customFlags = {
        ...mockFeatureFlags,
        experimental_feature: true,
      };

      act(() => {
        useConfigStore.setState({
          settingsMap: { feature_flags: customFlags },
        });
      });

      const flags = result.current.getFeatureFlags();
      expect(flags).toHaveProperty('experimental_feature', true);
    });

    it('handles missing feature flags gracefully', () => {
      const { result } = renderHook(() => useConfigStore());

      act(() => {
        useConfigStore.setState({
          settingsMap: { feature_flags: undefined },
        });
      });

      expect(result.current.getFeatureFlags()).toBeNull();
    });

    it('handles invalid feature flags type gracefully', () => {
      const { result } = renderHook(() => useConfigStore());

      act(() => {
        useConfigStore.setState({
          settingsMap: { feature_flags: 'invalid' },
        });
      });

      expect(result.current.getFeatureFlags()).toBeNull();
    });

    it('supports feature flag overrides', () => {
      const { result } = renderHook(() => useConfigStore());

      const overriddenFlags = {
        ...mockFeatureFlags,
        gpu_workspaces: false, // Override from true to false
        new_feature: true, // Add new flag
      };

      act(() => {
        useConfigStore.setState({
          settingsMap: { feature_flags: overriddenFlags },
        });
      });

      const flags = result.current.getFeatureFlags();
      expect(flags?.gpu_workspaces).toBe(false);
      expect(flags).toHaveProperty('new_feature', true);
    });
  });

  // ========================================================================
  // Model Configuration
  // ========================================================================

  describe('Model Configuration', () => {
    beforeEach(async () => {
      vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
      vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

      const { result } = renderHook(() => useConfigStore());
      await act(async () => {
        await result.current.initialize();
      });
    });

    it('returns list of available providers', () => {
      const { result } = renderHook(() => useConfigStore());
      expect(result.current.providers).toHaveLength(2);
      expect(result.current.providers[0].slug).toBe('anthropic');
      expect(result.current.providers[1].slug).toBe('openai');
    });

    it('gets provider by slug', () => {
      const { result } = renderHook(() => useConfigStore());
      const provider = result.current.getProvider('anthropic');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('Anthropic');
    });

    it('returns undefined for non-existent provider', () => {
      const { result } = renderHook(() => useConfigStore());
      const provider = result.current.getProvider('non-existent');
      expect(provider).toBeUndefined();
    });

    it('provides model capabilities information', () => {
      const { result } = renderHook(() => useConfigStore());
      const provider = result.current.getProvider('anthropic');
      const model = provider?.models[0];

      expect(model?.supports_streaming).toBe(true);
      expect(model?.supports_tools).toBe(true);
      expect(model?.supports_vision).toBe(true);
    });

    it('provides model pricing information', () => {
      const { result } = renderHook(() => useConfigStore());
      const provider = result.current.getProvider('anthropic');
      const opusModel = provider?.models[0];
      const sonnetModel = provider?.models[1];

      expect(opusModel?.input_cost_per_1k).toBe(0.015);
      expect(opusModel?.output_cost_per_1k).toBe(0.075);
      expect(sonnetModel?.input_cost_per_1k).toBe(0.003);
      expect(sonnetModel?.output_cost_per_1k).toBe(0.015);
    });
  });

  // ========================================================================
  // Workspace Configuration
  // ========================================================================

  describe('Workspace Configuration', () => {
    beforeEach(async () => {
      vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
      vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

      const { result } = renderHook(() => useConfigStore());
      await act(async () => {
        await result.current.initialize();
      });
    });

    it('returns default workspace settings', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getWorkspaceDefaults();
      expect(defaults).toEqual(mockWorkspaceDefaults);
    });

    it('provides workspace timeout configuration', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getWorkspaceDefaults();
      expect(defaults?.timeout_minutes).toBe(60);
      expect(defaults?.auto_shutdown_minutes).toBe(120);
    });

    it('provides workspace resource limits', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getWorkspaceDefaults();
      expect(defaults?.max_concurrent).toBe(5);
      expect(defaults?.storage_gb).toBe(10);
    });

    it('returns storage quota defaults', () => {
      const { result } = renderHook(() => useConfigStore());
      const quotas = result.current.getStorageQuotaDefaults();
      expect(quotas?.workspace_gb).toBe(10);
      expect(quotas?.total_gb).toBe(50);
      expect(quotas?.warning_threshold).toBe(0.8);
    });

    it('returns default preview ports', () => {
      const { result } = renderHook(() => useConfigStore());
      const ports = result.current.getDefaultPreviewPorts();
      expect(ports).toHaveLength(2);
      expect(ports?.[0].port).toBe(3000);
      expect(ports?.[0].auto_open).toBe(true);
    });
  });

  // ========================================================================
  // Editor Configuration
  // ========================================================================

  describe('Editor Configuration', () => {
    beforeEach(async () => {
      vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
      vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

      const { result } = renderHook(() => useConfigStore());
      await act(async () => {
        await result.current.initialize();
      });
    });

    it('returns default editor settings', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getEditorDefaults();
      expect(defaults).toEqual(mockEditorDefaults);
    });

    it('provides theme configuration', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getEditorDefaults();
      expect(defaults?.theme).toBe('vs-dark');
    });

    it('provides font configuration', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getEditorDefaults();
      expect(defaults?.font_size).toBe(14);
      expect(defaults?.font_family).toBe('Monaco, monospace');
    });

    it('provides editor feature settings', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getEditorDefaults();
      expect(defaults?.minimap_enabled).toBe(true);
      expect(defaults?.line_numbers).toBe(true);
      expect(defaults?.bracket_matching).toBe(true);
    });

    it('returns AI completion config', () => {
      const { result } = renderHook(() => useConfigStore());
      const config = result.current.getAICompletionConfig();
      expect(config?.enabled).toBe(true);
      expect(config?.model).toBe('claude-sonnet-4-5-20250929');
      expect(config?.trigger_delay_ms).toBe(500);
    });
  });

  // ========================================================================
  // Additional Selectors
  // ========================================================================

  describe('Additional Selectors', () => {
    beforeEach(async () => {
      vi.mocked(api.getPlatformConfig).mockResolvedValue(mockPlatformConfig);
      vi.mocked(api.getAgentRoleConfigs).mockResolvedValue({ roles: mockAgentRoles });

      const { result } = renderHook(() => useConfigStore());
      await act(async () => {
        await result.current.initialize();
      });
    });

    it('returns agent role by name', () => {
      const { result } = renderHook(() => useConfigStore());
      const role = result.current.getAgentRole('architect');
      expect(role).toBeDefined();
      expect(role?.name).toBe('Architect');
      expect(role?.default_model).toBe('claude-opus-4-5-20251101');
    });

    it('returns undefined for non-existent agent role', () => {
      const { result } = renderHook(() => useConfigStore());
      const role = result.current.getAgentRole('non-existent');
      expect(role).toBeUndefined();
    });

    it('returns generic setting by key', () => {
      const { result } = renderHook(() => useConfigStore());
      const dotfiles = result.current.getSetting<string[]>('default_dotfiles');
      expect(dotfiles).toEqual(mockDefaultDotfiles);
    });

    it('returns null for non-existent setting', () => {
      const { result } = renderHook(() => useConfigStore());
      const value = result.current.getSetting('non_existent_key');
      expect(value).toBeNull();
    });

    it('returns thinking presets', () => {
      const { result } = renderHook(() => useConfigStore());
      const presets = result.current.getThinkingPresets();
      expect(presets?.quick.tokens).toBe(1000);
      expect(presets?.normal.tokens).toBe(5000);
      expect(presets?.deep.tokens).toBe(10000);
    });

    it('returns timeout options', () => {
      const { result } = renderHook(() => useConfigStore());
      const options = result.current.getTimeoutOptions();
      expect(options).toHaveLength(3);
      expect(options?.[0].value).toBe(30);
    });

    it('returns voice languages', () => {
      const { result } = renderHook(() => useConfigStore());
      const languages = result.current.getVoiceLanguages();
      expect(languages).toHaveLength(2);
      expect(languages?.[0].code).toBe('en-US');
    });

    it('returns agent mode config', () => {
      const { result } = renderHook(() => useConfigStore());
      const config = result.current.getAgentModeConfig();
      expect(config?.ask.label).toBe('Ask');
      expect(config?.code.label).toBe('Code');
      expect(config?.plan.label).toBe('Plan');
    });

    it('returns sidebar layout defaults', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getSidebarLayoutDefaults();
      expect(defaults?.left_width).toBe(240);
      expect(defaults?.right_width).toBe(320);
    });

    it('returns grid config defaults', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getGridConfigDefaults();
      expect(defaults?.columns).toBe(3);
      expect(defaults?.rows).toBe(2);
      expect(defaults?.gap).toBe(16);
    });

    it('returns card dimensions', () => {
      const { result } = renderHook(() => useConfigStore());
      const dimensions = result.current.getCardDimensions();
      expect(dimensions?.agent.width).toBe(400);
      expect(dimensions?.editor.height).toBe(700);
    });

    it('returns context compaction defaults', () => {
      const { result } = renderHook(() => useConfigStore());
      const defaults = result.current.getContextCompactionDefaults();
      expect(defaults?.enabled).toBe(true);
      expect(defaults?.max_tokens).toBe(150000);
      expect(defaults?.strategy).toBe('sliding_window');
    });

    it('returns platform limits', () => {
      const { result } = renderHook(() => useConfigStore());
      const limits = result.current.getPlatformLimits();
      expect(limits?.max_sessions_per_user).toBe(10);
      expect(limits?.max_agents_per_session).toBe(5);
    });
  });
});
