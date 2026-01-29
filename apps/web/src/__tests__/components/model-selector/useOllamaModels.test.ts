/**
 * Tests for useOllamaModels hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useOllamaModels } from '@/components/model-selector/hooks/useOllamaModels';
import type { OllamaTagsResponse } from '@/components/model-selector/types';

// Mock fetch globally
const mockFetch = vi.fn();

describe('useOllamaModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockOllamaResponse: OllamaTagsResponse = {
    models: [
      {
        name: 'llama2:7b',
        model: 'llama2:7b',
        modified_at: '2024-01-15T10:30:00Z',
        size: 3825819519,
        digest: 'abc123',
        details: {
          family: 'llama',
          parameter_size: '7B',
          quantization_level: 'Q4_0',
        },
      },
      {
        name: 'codellama:13b',
        model: 'codellama:13b',
        modified_at: '2024-01-14T08:00:00Z',
        size: 7365960704,
        digest: 'def456',
        details: {
          family: 'llama',
          parameter_size: '13B',
        },
      },
      {
        name: 'mistral:7b-q8_0',
        model: 'mistral:7b-q8_0',
        modified_at: '2024-01-16T12:00:00Z',
        size: 7365960704,
        digest: 'ghi789',
      },
    ],
  };

  describe('successful discovery', () => {
    it('should fetch models on mount when autoDiscover is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      const { result } = renderHook(() => useOllamaModels());

      // Initially loading
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models.length).toBe(3);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should not fetch on mount when autoDiscover is false', () => {
      const { result } = renderHook(() => useOllamaModels({ autoDiscover: false }));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.current.models).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('should transform Ollama models correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const llama2 = result.current.models.find((m) => m.id === 'llama2:7b');
      expect(llama2).toBeDefined();
      expect(llama2?.name).toBe('Llama2');
      expect(llama2?.quantization).toBe('Q4_0');
      expect(llama2?.size).toBe('3.6 GB');
      expect(llama2?.modifiedAt).toBeInstanceOf(Date);
    });

    it('should extract quantization from model name when not in details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const mistral = result.current.models.find((m) => m.id === 'mistral:7b-q8_0');
      expect(mistral?.quantization).toBe('Q8_0');
    });

    it('should sort models by modified date (most recent first)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // mistral is most recent (Jan 16), then llama2 (Jan 15), then codellama (Jan 14)
      expect(result.current.models[0].id).toBe('mistral:7b-q8_0');
      expect(result.current.models[1].id).toBe('llama2:7b');
      expect(result.current.models[2].id).toBe('codellama:13b');
    });
  });

  describe('error handling', () => {
    it('should handle connection errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('Could not connect to Ollama');
      expect(result.current.isConnected).toBe(false);
      expect(result.current.models).toEqual([]);
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('500');
      expect(result.current.isConnected).toBe(false);
    });

    it('should handle timeout errors', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toContain('timed out');
      expect(result.current.isConnected).toBe(false);
    });

    it('should handle empty model list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models).toEqual([]);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should handle malformed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // Missing models field
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models).toEqual([]);
      expect(result.current.isConnected).toBe(true);
    });
  });

  describe('refresh functionality', () => {
    it('should refetch models when refresh is called', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models).toEqual([]);

      // Now add a model and refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.models.length).toBe(3);
    });

    it('should clear previous error on successful refresh', async () => {
      // First call fails
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.isConnected).toBe(true);
    });
  });

  describe('custom baseUrl', () => {
    it('should use custom baseUrl when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      renderHook(() => useOllamaModels({ baseUrl: 'http://custom:1234' }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('http://custom:1234/api/tags', expect.any(Object));
      });
    });

    it('should use default URL when baseUrl not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOllamaResponse,
      });

      renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:11434/api/tags',
          expect.any(Object)
        );
      });
    });
  });

  describe('format helpers', () => {
    it('should format bytes correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: 'small',
              model: 'small',
              modified_at: '2024-01-15T10:00:00Z',
              size: 1024,
              digest: 'abc',
            },
            {
              name: 'medium',
              model: 'medium',
              modified_at: '2024-01-15T10:00:00Z',
              size: 1024 * 1024,
              digest: 'def',
            },
            {
              name: 'large',
              model: 'large',
              modified_at: '2024-01-15T10:00:00Z',
              size: 1024 * 1024 * 1024,
              digest: 'ghi',
            },
          ],
        }),
      });

      const { result } = renderHook(() => useOllamaModels());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const small = result.current.models.find((m) => m.id === 'small');
      const medium = result.current.models.find((m) => m.id === 'medium');
      const large = result.current.models.find((m) => m.id === 'large');

      expect(small?.size).toBe('1 KB');
      expect(medium?.size).toBe('1 MB');
      expect(large?.size).toBe('1 GB');
    });
  });
});
