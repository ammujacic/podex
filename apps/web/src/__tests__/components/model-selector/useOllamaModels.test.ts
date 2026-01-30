/**
 * Tests for useOllamaModels hook
 *
 * This hook uses backend API functions (getLocalLLMConfig, discoverLocalModels)
 * instead of calling Ollama directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useOllamaModels } from '@/components/model-selector/hooks/useOllamaModels';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const { mockGetLocalLLMConfig, mockDiscoverLocalModels } = vi.hoisted(() => ({
  mockGetLocalLLMConfig: vi.fn(),
  mockDiscoverLocalModels: vi.fn(),
}));

// Mock @/lib/api functions - use importActual to preserve other exports
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api');
  return {
    ...actual,
    getLocalLLMConfig: () => mockGetLocalLLMConfig(),
    discoverLocalModels: (params: unknown) => mockDiscoverLocalModels(params),
  };
});

// Mock response data that would come from backend API
const mockDiscoverResponse = {
  success: true,
  models: [
    {
      id: 'llama2:7b',
      name: 'llama2:7b',
      size: 3825819519,
    },
    {
      id: 'codellama:13b',
      name: 'codellama:13b',
      size: 7365960704,
    },
    {
      id: 'mistral:7b-q8_0',
      name: 'mistral:7b-q8_0',
      size: 7365960704,
    },
  ],
};

// Helper to set up successful discovery mocks (with Ollama already configured)
function setupSuccessfulDiscovery() {
  // Return config with base_url to indicate Ollama is configured
  mockGetLocalLLMConfig.mockImplementation(() =>
    Promise.resolve({
      ollama: {
        base_url: 'http://localhost:11434',
        models: [],
      },
    })
  );
  mockDiscoverLocalModels.mockImplementation(() => Promise.resolve(mockDiscoverResponse));
}

// Helper to set up unconfigured state (no Ollama setup)
function setupUnconfigured() {
  mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(null));
  mockDiscoverLocalModels.mockImplementation(() => Promise.resolve(mockDiscoverResponse));
}

describe('useOllamaModels', () => {
  beforeEach(() => {
    // Reset mocks explicitly - vi.resetAllMocks can be unreliable
    mockGetLocalLLMConfig.mockReset();
    mockDiscoverLocalModels.mockReset();
  });

  describe('successful discovery', () => {
    it('should discover models on mount when autoDiscover is true and Ollama is configured', async () => {
      setupSuccessfulDiscovery();

      const { result } = renderHook(() => useOllamaModels());

      // Wait for models to be loaded
      await waitFor(() => {
        expect(result.current.models.length).toBe(3);
      });

      // Verify final state
      expect(result.current.isConnected).toBe(true);
      expect(result.current.isConfigured).toBe(true);
      expect(result.current.error).toBeNull();
      expect(mockDiscoverLocalModels).toHaveBeenCalled();
    });

    it('should not auto-discover when Ollama is not configured', async () => {
      setupUnconfigured();

      const { result } = renderHook(() => useOllamaModels());

      // Wait a tick to ensure loading completes
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not attempt discovery when not configured
      expect(mockDiscoverLocalModels).not.toHaveBeenCalled();
      expect(result.current.models).toEqual([]);
      expect(result.current.isConfigured).toBe(false);
    });

    it('should not fetch on mount when autoDiscover is false', async () => {
      setupSuccessfulDiscovery();

      const { result } = renderHook(() => useOllamaModels({ autoDiscover: false }));

      // Wait a tick to ensure no async calls are made
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockDiscoverLocalModels).not.toHaveBeenCalled();
      // Should still show as configured based on loaded config
      expect(result.current.isConfigured).toBe(true);
    });

    it('should transform discovered models correctly', async () => {
      setupSuccessfulDiscovery();

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.models.length).toBe(3);
      });

      const llama2 = result.current.models.find((m) => m.id === 'llama2:7b');
      expect(llama2).toBeDefined();
      expect(llama2?.name).toBe('Llama2');
      expect(llama2?.size).toBe('3.6 GB');
      expect(llama2?.modifiedAt).toBeInstanceOf(Date);
    });

    it('should extract quantization from model name', async () => {
      setupSuccessfulDiscovery();

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.models.length).toBe(3);
      });

      const mistral = result.current.models.find((m) => m.id === 'mistral:7b-q8_0');
      expect(mistral?.quantization).toBe('Q8_0');
    });

    it('should load cached models from config on mount and auto-discover', async () => {
      mockGetLocalLLMConfig.mockImplementation(() =>
        Promise.resolve({
          ollama: {
            base_url: 'http://localhost:11434',
            models: [{ id: 'cached-model', name: 'cached-model', size: 1000000 }],
          },
        })
      );
      mockDiscoverLocalModels.mockImplementation(() => Promise.resolve(mockDiscoverResponse));

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.models.length).toBe(3);
      });

      // Should have models from discovery (which overrides cached)
      expect(result.current.models.length).toBe(3);
      // Should be marked as configured
      expect(result.current.isConfigured).toBe(true);
    });
  });

  describe('error handling', () => {
    // Helper to set up config that marks Ollama as configured
    const configuredOllama = {
      ollama: {
        base_url: 'http://localhost:11434',
        models: [],
      },
    };

    it('should handle discovery errors gracefully', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(configuredOllama));
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.reject(new Error('Could not connect to Ollama'))
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Could not connect to Ollama');
      expect(result.current.isConnected).toBe(false);
      expect(result.current.models).toEqual([]);
      // Still marked as configured (user intentionally set it up)
      expect(result.current.isConfigured).toBe(true);
    });

    it('should handle API error response', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(configuredOllama));
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.resolve({
          success: false,
          error: 'Ollama service unavailable',
        })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Ollama service unavailable');
      expect(result.current.isConnected).toBe(false);
    });

    it('should handle empty model list', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(configuredOllama));
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.resolve({
          success: true,
          models: [],
        })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models).toEqual([]);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should handle missing models field gracefully', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(configuredOllama));
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.resolve({
          success: true,
          // models field is undefined
        })
      );

      const { result } = renderHook(() => useOllamaModels());

      // Wait for discovery to complete - isConnected becomes true on success
      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      expect(result.current.models).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('refresh functionality', () => {
    // Helper to set up config that marks Ollama as configured
    const configuredOllama = {
      ollama: {
        base_url: 'http://localhost:11434',
        models: [],
      },
    };

    it('should refetch models when refresh is called', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(configuredOllama));
      // Start with empty models
      mockDiscoverLocalModels.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          models: [],
        })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models).toEqual([]);

      // Now return models on refresh
      mockDiscoverLocalModels.mockImplementationOnce(() => Promise.resolve(mockDiscoverResponse));

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.models.length).toBe(3);
    });

    it('should clear previous error on successful refresh', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(configuredOllama));
      // First call fails
      mockDiscoverLocalModels.mockImplementationOnce(() =>
        Promise.reject(new Error('Connection failed'))
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      // Second call succeeds
      mockDiscoverLocalModels.mockImplementationOnce(() => Promise.resolve(mockDiscoverResponse));

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.isConnected).toBe(true);
    });

    it('should work even when Ollama is not configured (manual refresh)', async () => {
      // Not configured initially
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(null));

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not auto-discover
      expect(mockDiscoverLocalModels).not.toHaveBeenCalled();
      expect(result.current.isConfigured).toBe(false);

      // Manual refresh should still work
      mockDiscoverLocalModels.mockImplementationOnce(() => Promise.resolve(mockDiscoverResponse));

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.models.length).toBe(3);
    });
  });

  describe('custom baseUrl', () => {
    it('should pass custom baseUrl to discover API when configured', async () => {
      // Set up with custom URL in config
      mockGetLocalLLMConfig.mockImplementation(() =>
        Promise.resolve({
          ollama: {
            base_url: 'http://custom:1234',
            models: [],
          },
        })
      );
      mockDiscoverLocalModels.mockImplementation(() => Promise.resolve(mockDiscoverResponse));

      renderHook(() => useOllamaModels({ baseUrl: 'http://custom:1234' }));

      await waitFor(() => {
        expect(mockDiscoverLocalModels).toHaveBeenCalledWith({
          provider: 'ollama',
          base_url: 'http://custom:1234',
        });
      });
    });

    it('should use default URL when baseUrl not provided', async () => {
      setupSuccessfulDiscovery();

      renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(mockDiscoverLocalModels).toHaveBeenCalledWith({
          provider: 'ollama',
          base_url: 'http://localhost:11434',
        });
      });
    });
  });

  describe('format helpers', () => {
    it('should format bytes correctly', async () => {
      // Set up as configured to trigger auto-discovery
      mockGetLocalLLMConfig.mockImplementation(() =>
        Promise.resolve({
          ollama: {
            base_url: 'http://localhost:11434',
            models: [],
          },
        })
      );
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.resolve({
          success: true,
          models: [
            { id: 'small', name: 'small', size: 1024 },
            { id: 'medium', name: 'medium', size: 1024 * 1024 },
            { id: 'large', name: 'large', size: 1024 * 1024 * 1024 },
          ],
        })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.models.length).toBe(3);
      });

      const small = result.current.models.find((m) => m.id === 'small');
      const medium = result.current.models.find((m) => m.id === 'medium');
      const large = result.current.models.find((m) => m.id === 'large');

      expect(small?.size).toBe('1 KB');
      expect(medium?.size).toBe('1 MB');
      expect(large?.size).toBe('1 GB');
    });
  });

  describe('isConfigured state', () => {
    it('should be true when base_url is set', async () => {
      mockGetLocalLLMConfig.mockImplementation(() =>
        Promise.resolve({
          ollama: {
            base_url: 'http://localhost:11434',
            models: [],
          },
        })
      );
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.resolve({ success: true, models: [] })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });
    });

    it('should be true when cached models exist', async () => {
      mockGetLocalLLMConfig.mockImplementation(() =>
        Promise.resolve({
          ollama: {
            models: [{ id: 'test', name: 'test', size: 1000 }],
          },
        })
      );
      mockDiscoverLocalModels.mockImplementation(() =>
        Promise.resolve({ success: true, models: [] })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });
    });

    it('should be false when no config exists', async () => {
      mockGetLocalLLMConfig.mockImplementation(() => Promise.resolve(null));

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isConfigured).toBe(false);
    });

    it('should be false when config has empty ollama section', async () => {
      mockGetLocalLLMConfig.mockImplementation(() =>
        Promise.resolve({
          ollama: {},
        })
      );

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isConfigured).toBe(false);
    });
  });
});
