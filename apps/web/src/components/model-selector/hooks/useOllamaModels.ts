'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LocalModel, OllamaTagsResponse, OllamaModel } from '../types';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const API_TAGS_PATH = '/api/tags';

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
  /** Manually trigger a refresh/re-scan */
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
 * Extract quantization level from model name or details
 */
function extractQuantization(model: OllamaModel): string | undefined {
  // Check if quantization is in the details
  if (model.details?.quantization_level) {
    return model.details.quantization_level;
  }

  // Try to extract from the model name (e.g., "llama2:7b-q4_0")
  const nameMatch = model.name.match(/[qQ](\d+)(?:_(\d+|K|k))?/i);
  if (nameMatch) {
    return nameMatch[0].toUpperCase();
  }

  return undefined;
}

/**
 * Transform Ollama API response model to our LocalModel format
 */
function transformOllamaModel(model: OllamaModel): LocalModel {
  // Use the model name as the display name, but clean it up
  const firstPart = model.name.split(':')[0];
  const nameParts = firstPart ? firstPart.split('/') : [model.name];
  const baseName = nameParts[nameParts.length - 1] ?? model.name;
  const displayName = baseName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); // Title case

  return {
    id: model.name,
    name: displayName,
    size: formatBytes(model.size),
    quantization: extractQuantization(model),
    modifiedAt: new Date(model.modified_at),
  };
}

/**
 * Hook for auto-discovering local Ollama models.
 *
 * Features:
 * - Auto-discovers models on mount (optional)
 * - Handles connection errors gracefully
 * - Provides refresh function for manual re-scan
 * - Transforms Ollama API response to LocalModel format
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

  const discover = useCallback(async () => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const url = `${baseUrl}${API_TAGS_PATH}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }

      const data: OllamaTagsResponse = await response.json();

      if (!isMountedRef.current) return;

      if (!data.models || !Array.isArray(data.models)) {
        setModels([]);
        setIsConnected(true);
        setError(null);
      } else {
        const transformedModels = data.models.map(transformOllamaModel);
        // Sort by modified date (most recent first)
        transformedModels.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
        setModels(transformedModels);
        setIsConnected(true);
        setError(null);
      }
    } catch (err) {
      if (!isMountedRef.current) return;

      setIsConnected(false);
      setModels([]);

      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setError('Connection to Ollama timed out. Is Ollama running?');
        } else if (
          err.message.includes('Failed to fetch') ||
          err.message.includes('NetworkError')
        ) {
          setError('Could not connect to Ollama. Make sure Ollama is running at ' + baseUrl);
        } else {
          setError(err.message);
        }
      } else {
        setError('An unknown error occurred while connecting to Ollama');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [baseUrl]);

  // Auto-discover on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (autoDiscover) {
      discover();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [autoDiscover, discover]);

  return {
    models,
    isLoading,
    error,
    refresh: discover,
    isConnected,
  };
}
