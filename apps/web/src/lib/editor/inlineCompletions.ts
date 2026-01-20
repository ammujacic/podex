/**
 * Monaco Editor Inline Completions Provider
 *
 * Provides AI-powered code completions using the Anthropic API
 * through Google Vertex AI (default) or Ollama (local mode fallback).
 */

import type * as monaco from '@codingame/monaco-vscode-editor-api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ============================================================================
// Types
// ============================================================================

export interface InlineCompletionRequest {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  maxTokens?: number;
  model?: string | null; // User-selected model (platform, user API key, or local)
}

export interface InlineCompletionResponse {
  completion: string;
  confidence: number;
  cached: boolean;
}

export interface CompletionProviderConfig {
  enabled: boolean;
  debounceMs: number;
  maxTokens: number;
  minPrefixLength: number;
  model?: string | null; // User-selected model for completions
}

// ============================================================================
// API Client
// ============================================================================

async function fetchInlineCompletion(
  request: InlineCompletionRequest,
  signal?: AbortSignal
): Promise<InlineCompletionResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/completion/inline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      signal,
      body: JSON.stringify({
        prefix: request.prefix,
        suffix: request.suffix,
        language: request.language,
        file_path: request.filePath,
        max_tokens: request.maxTokens || 128,
        model: request.model || null,
      }),
    });

    if (!response.ok) {
      console.warn('Completion request failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    // Ignore aborted requests
    if (error instanceof Error && error.name === 'AbortError') {
      return null;
    }
    console.warn('Completion error:', error);
    return null;
  }
}

// ============================================================================
// Monaco Provider Factory
// ============================================================================

/**
 * Creates a Monaco InlineCompletionsProvider that fetches AI completions.
 */
export function createInlineCompletionsProvider(
  config: CompletionProviderConfig
): monaco.languages.InlineCompletionsProvider {
  // Track active requests for cancellation
  let activeController: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    // Provider identifier
    provideInlineCompletions: async (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      _context: monaco.languages.InlineCompletionContext,
      token: monaco.CancellationToken
    ): Promise<monaco.languages.InlineCompletions | null> => {
      // Skip if disabled
      if (!config.enabled) {
        return null;
      }

      // Cancel any previous pending request
      if (activeController) {
        activeController.abort();
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Get code context
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      // Skip if prefix is too short
      if (textBeforeCursor.trim().length < config.minPrefixLength) {
        return null;
      }

      const textAfterCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: model.getLineCount(),
        endColumn: model.getLineMaxColumn(model.getLineCount()),
      });

      const language = model.getLanguageId();
      const uri = model.uri.toString();

      // Create new abort controller
      activeController = new AbortController();
      const signal = activeController.signal;

      // Listen for cancellation
      token.onCancellationRequested(() => {
        activeController?.abort();
      });

      return new Promise((resolve) => {
        // Debounce the request
        debounceTimer = setTimeout(async () => {
          try {
            const result = await fetchInlineCompletion(
              {
                prefix: textBeforeCursor,
                suffix: textAfterCursor,
                language,
                filePath: uri,
                maxTokens: config.maxTokens,
                model: config.model,
              },
              signal
            );

            if (!result || !result.completion) {
              resolve(null);
              return;
            }

            // Return inline completion items
            resolve({
              items: [
                {
                  insertText: result.completion,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  },
                },
              ],
            });
          } catch {
            resolve(null);
          }
        }, config.debounceMs);
      });
    },

    // Cleanup when completions are dismissed
    disposeInlineCompletions: () => {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}

// ============================================================================
// Registration Helper
// ============================================================================

let registeredDisposable: { dispose: () => void } | null = null;

/**
 * Register the inline completions provider with Monaco.
 * Returns a disposable to unregister the provider.
 */
export function registerInlineCompletionsProvider(
  monacoInstance: typeof monaco,
  config: CompletionProviderConfig
): { dispose: () => void } {
  // Dispose previous registration if exists
  if (registeredDisposable) {
    registeredDisposable.dispose();
  }

  const provider = createInlineCompletionsProvider(config);

  // Register for all languages
  registeredDisposable = monacoInstance.languages.registerInlineCompletionsProvider(
    { pattern: '**' }, // All files
    provider
  );

  return registeredDisposable;
}

/**
 * Unregister the current inline completions provider.
 */
export function unregisterInlineCompletionsProvider(): void {
  if (registeredDisposable) {
    registeredDisposable.dispose();
    registeredDisposable = null;
  }
}
