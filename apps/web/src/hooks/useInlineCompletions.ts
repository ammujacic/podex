'use client';

import { useEffect, useRef, useCallback } from 'react';
import type * as monacoApi from '@codingame/monaco-vscode-editor-api';
import { useEditorStore } from '@/stores/editor';
import {
  registerInlineCompletionsProvider,
  unregisterInlineCompletionsProvider,
} from '@/lib/editor/inlineCompletions';

type Monaco = typeof monacoApi;

// ============================================================================
// Hook
// ============================================================================

interface UseInlineCompletionsOptions {
  /** Monaco instance */
  monaco: Monaco | null;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Minimum prefix length before triggering completion */
  minPrefixLength?: number;
}

/**
 * Hook to manage AI-powered inline code completions.
 *
 * Registers a Monaco InlineCompletionsProvider that fetches completions
 * from the backend API using Vertex AI (default) or Ollama (local mode).
 *
 * @example
 * ```tsx
 * const { isEnabled, toggleEnabled } = useInlineCompletions({
 *   monaco: monacoRef.current,
 * });
 * ```
 */
export function useInlineCompletions({
  monaco,
  maxTokens = 128,
  minPrefixLength = 10,
}: UseInlineCompletionsOptions) {
  const settings = useEditorStore((s) => s.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);
  const registeredRef = useRef(false);

  const { completionsEnabled, completionsDebounceMs } = settings;

  // Register/update provider when settings change
  useEffect(() => {
    if (!monaco) {
      return;
    }

    // Register provider with current config
    registerInlineCompletionsProvider(monaco, {
      enabled: completionsEnabled,
      debounceMs: completionsDebounceMs,
      maxTokens,
      minPrefixLength,
    });
    registeredRef.current = true;

    // Cleanup on unmount
    return () => {
      unregisterInlineCompletionsProvider();
      registeredRef.current = false;
    };
  }, [monaco, completionsEnabled, completionsDebounceMs, maxTokens, minPrefixLength]);

  // Toggle completions enabled
  const toggleEnabled = useCallback(() => {
    updateSettings({ completionsEnabled: !completionsEnabled });
  }, [completionsEnabled, updateSettings]);

  // Set enabled state
  const setEnabled = useCallback(
    (enabled: boolean) => {
      updateSettings({ completionsEnabled: enabled });
    },
    [updateSettings]
  );

  // Set debounce delay
  const setDebounceMs = useCallback(
    (debounceMs: number) => {
      updateSettings({ completionsDebounceMs: debounceMs });
    },
    [updateSettings]
  );

  return {
    isEnabled: completionsEnabled,
    debounceMs: completionsDebounceMs,
    toggleEnabled,
    setEnabled,
    setDebounceMs,
  };
}
