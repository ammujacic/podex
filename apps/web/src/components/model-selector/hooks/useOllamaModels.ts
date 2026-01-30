'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getLocalLLMConfig, discoverLocalModels } from '@/lib/api';
import type { LocalModel } from '../types';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export interface UseOllamaModelsOptions {
  /** Custom Ollama base URL (default: http://localhost:11434) */
  baseUrl?: string;
  /** Whether to auto-discover on mount (default: true) */
  autoDiscover?: boolean;
}

export interface UseOllamaModelsReturn {
  /** List of discovered local models */
  models: LocalModel[];
  /** Whether the discovery is in progress */
  isLoading: boolean;
  /** Error message if discovery failed */
  error: string | null;
  /** Manually trigger a refresh/re-scan via backend */
  refresh: () => Promise<void>;
  /** Whether Ollama is connected and responding */
  isConnected: boolean;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Extract quantization level from model name
 */
function extractQuantization(modelName: string): string | undefined {
  // Try to extract from the model name (e.g., "llama2:7b-q4_0")
  const nameMatch = modelName.match(/[qQ](\d+)(?:_(\d+|K|k))?/i);
  if (nameMatch) {
    return nameMatch[0].toUpperCase();
  }
  return undefined;
}

/**
 * Transform discovered model from backend to our LocalModel format
 */
function transformDiscoveredModel(model: { id: string; name: string; size?: number }): LocalModel {
  // Use the model name as the display name, but clean it up
  const firstPart = model.name.split(':')[0];
  const nameParts = firstPart ? firstPart.split('/') : [model.name];
  const baseName = nameParts[nameParts.length - 1] ?? model.name;
  const displayName = baseName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: model.id || model.name,
    name: displayName,
    size: model.size ? formatBytes(model.size) : 'Unknown',
    quantization: extractQuantization(model.name),
    modifiedAt: new Date(),
  };
}

/**
 * Hook for discovering local Ollama models via the backend API.
 *
 * This hook uses the backend to discover and cache Ollama models,
 * rather than calling Ollama directly from the browser.
 *
 * Features:
 * - Loads cached models from user config on mount
 * - Provides refresh function to re-discover via backend
 * - Transforms backend response to LocalModel format
 *
 * @example
 * ```tsx
 * function LocalModelsSection() {
 *   const { models, isLoading, error, refresh, isConnected } = useOllamaModels();
 *
 *   if (error) {
 *     return <div>Error: {error} <button onClick={refresh}>Retry</button></div>;
 *   }
 *
 *   return (
 *     <div>
 *       {isConnected && <span>Connected to Ollama</span>}
 *       {models.map(model => <div key={model.id}>{model.name} ({model.size})</div>)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useOllamaModels(options: UseOllamaModelsOptions = {}): UseOllamaModelsReturn {
  const { baseUrl = DEFAULT_OLLAMA_URL, autoDiscover = true } = options;

  const [models, setModels] = useState<LocalModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true);

  // Load cached models from user config
  const loadCachedModels = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      const config = await getLocalLLMConfig();
      if (!isMountedRef.current) return;

      const ollamaConfig = config?.ollama;
      if (ollamaConfig?.models && Array.isArray(ollamaConfig.models)) {
        const transformedModels = ollamaConfig.models.map(transformDiscoveredModel);
        setModels(transformedModels);
        setIsConnected(true);
        setError(null);
      }
    } catch {
      // Silently fail on load - will try discovery
      if (isMountedRef.current) {
        setModels([]);
      }
    }
  }, []);

  // Discover models via backend API
  const discover = useCallback(async () => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await discoverLocalModels({
        provider: 'ollama',
        base_url: baseUrl,
      });

      if (!isMountedRef.current) return;

      if (!response.success) {
        setIsConnected(false);
        setModels([]);
        setError(response.error || 'Failed to discover models');
        return;
      }

      if (!response.models || response.models.length === 0) {
        setModels([]);
        setIsConnected(true);
        setError(null);
      } else {
        const transformedModels = response.models.map(transformDiscoveredModel);
        setModels(transformedModels);
        setIsConnected(true);
        setError(null);
      }
    } catch (err) {
      if (!isMountedRef.current) return;

      setIsConnected(false);
      setModels([]);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred while discovering models');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [baseUrl]);

  // Load cached models on mount, then optionally discover
  useEffect(() => {
    isMountedRef.current = true;

    const init = async () => {
      // First try to load cached models
      await loadCachedModels();

      // Then discover fresh models if autoDiscover is enabled
      if (autoDiscover) {
        await discover();
      }
    };

    init();

    return () => {
      isMountedRef.current = false;
    };
  }, [autoDiscover, discover, loadCachedModels]);

  return {
    models,
    isLoading,
    error,
    refresh: discover,
    isConnected,
  };
}
