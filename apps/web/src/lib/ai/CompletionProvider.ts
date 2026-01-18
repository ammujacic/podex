/**
 * AI Code Completion Provider
 *
 * Provides Copilot-style inline code completions using the backend AI service.
 * Integrates with Monaco Editor's InlineCompletionsProvider.
 */

import type * as monaco from '@codingame/monaco-vscode-editor-api';
import type {
  languages,
  editor,
  Position,
  CancellationToken,
} from '@codingame/monaco-vscode-editor-api';

// ============================================================================
// Types
// ============================================================================

export interface CompletionRequest {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  cursorLine: number;
  cursorColumn: number;
}

export interface CompletionResponse {
  completion: string;
  confidence: number;
  cached: boolean;
}

export interface CompletionProviderConfig {
  apiUrl: string;
  debounceMs: number;
  maxPrefixLines: number;
  maxSuffixLines: number;
  minTriggerLength: number;
  enabled: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CompletionProviderConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  debounceMs: 300,
  maxPrefixLines: 50,
  maxSuffixLines: 10,
  minTriggerLength: 3,
  enabled: true,
};

// ============================================================================
// Completion Cache
// ============================================================================

interface CacheEntry {
  completion: string;
  timestamp: number;
}

class CompletionCache {
  private cache = new Map<string, CacheEntry>();
  private maxAge = 60000; // 1 minute
  private maxSize = 100;

  private generateKey(request: CompletionRequest): string {
    // Use last 200 chars of prefix as key for reasonable caching
    const prefixKey = request.prefix.slice(-200);
    return `${request.language}:${prefixKey}`;
  }

  get(request: CompletionRequest): string | null {
    const key = this.generateKey(request);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry.completion;
  }

  set(request: CompletionRequest, completion: string): void {
    const key = this.generateKey(request);

    // Evict old entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      completion,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Completion Provider Class
// ============================================================================

export class AICompletionProvider {
  private config: CompletionProviderConfig;
  private cache: CompletionCache;
  private pendingRequest: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRegistered = false;
  private disposable: { dispose: () => void } | null = null;

  constructor(config: Partial<CompletionProviderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new CompletionCache();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompletionProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Enable/disable completions
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.cancelPendingRequest();
    }
  }

  /**
   * Cancel any pending completion request
   */
  cancelPendingRequest(): void {
    if (this.pendingRequest) {
      this.pendingRequest.abort();
      this.pendingRequest = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Extract code context from the editor model
   */
  private extractContext(
    model: editor.ITextModel,
    position: Position
  ): { prefix: string; suffix: string } {
    const lineCount = model.getLineCount();

    // Get prefix (lines before cursor)
    const prefixStartLine = Math.max(1, position.lineNumber - this.config.maxPrefixLines);
    const prefixRange = {
      startLineNumber: prefixStartLine,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    };
    const prefix = model.getValueInRange(prefixRange);

    // Get suffix (lines after cursor)
    const suffixEndLine = Math.min(lineCount, position.lineNumber + this.config.maxSuffixLines);
    const suffixRange = {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: suffixEndLine,
      endColumn: model.getLineMaxColumn(suffixEndLine),
    };
    const suffix = model.getValueInRange(suffixRange);

    return { prefix, suffix };
  }

  /**
   * Fetch completion from the API
   */
  private async fetchCompletion(request: CompletionRequest): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(request);
    if (cached) {
      return cached;
    }

    // Cancel any pending request
    this.cancelPendingRequest();

    // Create new abort controller
    this.pendingRequest = new AbortController();

    try {
      const response = await fetch(`${this.config.apiUrl}/api/completion/inline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for authentication
        body: JSON.stringify({
          prefix: request.prefix,
          suffix: request.suffix,
          language: request.language,
          file_path: request.filePath,
        }),
        signal: this.pendingRequest.signal,
      });

      if (!response.ok) {
        console.warn('Completion API error:', response.status);
        return null;
      }

      const data: CompletionResponse = await response.json();

      // Cache the result
      this.cache.set(request, data.completion);

      return data.completion;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled, this is expected
        return null;
      }
      console.warn('Completion fetch error:', error);
      return null;
    } finally {
      this.pendingRequest = null;
    }
  }

  /**
   * Create Monaco InlineCompletionsProvider
   */
  createMonacoProvider(): languages.InlineCompletionsProvider {
    return {
      provideInlineCompletions: async (
        model: editor.ITextModel,
        position: Position,
        context: languages.InlineCompletionContext,
        token: CancellationToken
      ): Promise<languages.InlineCompletions | null> => {
        if (!this.config.enabled) {
          return null;
        }

        // Check if triggered automatically or explicitly
        const isExplicit = context.triggerKind === 1; // Explicit

        // Get the current line text before cursor
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        // Skip if line is too short (unless explicit trigger)
        if (!isExplicit && textBeforeCursor.trim().length < this.config.minTriggerLength) {
          return null;
        }

        // Skip in comments (basic heuristic)
        const trimmed = textBeforeCursor.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
          return null;
        }

        // Extract context
        const { prefix, suffix } = this.extractContext(model, position);
        const language = model.getLanguageId();
        const filePath = model.uri.path;

        const request: CompletionRequest = {
          prefix,
          suffix,
          language,
          filePath,
          cursorLine: position.lineNumber,
          cursorColumn: position.column,
        };

        // Debounce the request
        return new Promise((resolve) => {
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }

          this.debounceTimer = setTimeout(async () => {
            // Check if cancelled
            if (token.isCancellationRequested) {
              resolve(null);
              return;
            }

            const completion = await this.fetchCompletion(request);

            if (!completion || token.isCancellationRequested) {
              resolve(null);
              return;
            }

            // Return the inline completion
            resolve({
              items: [
                {
                  insertText: completion,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  },
                },
              ],
            });
          }, this.config.debounceMs);
        });
      },
      disposeInlineCompletions: () => {
        // Cleanup if needed
      },
    };
  }

  /**
   * Register the provider with Monaco (only registers once)
   */
  register(monacoInstance: typeof monaco, languages?: string[]): { dispose: () => void } {
    // Prevent duplicate registrations
    if (this.isRegistered && this.disposable) {
      return this.disposable;
    }

    const provider = this.createMonacoProvider();
    const targetLanguages = languages || ['*'];

    const disposables = targetLanguages.map((lang) =>
      monacoInstance.languages.registerInlineCompletionsProvider(lang, provider)
    );

    this.isRegistered = true;
    this.disposable = {
      dispose: () => {
        disposables.forEach((d) => d.dispose());
        this.cancelPendingRequest();
        this.cache.clear();
        this.isRegistered = false;
        this.disposable = null;
      },
    };

    return this.disposable;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let completionProviderInstance: AICompletionProvider | null = null;

export function getCompletionProvider(): AICompletionProvider {
  if (!completionProviderInstance) {
    completionProviderInstance = new AICompletionProvider();
  }
  return completionProviderInstance;
}

// ============================================================================
// React Hook
// ============================================================================

import { useEffect, useRef } from 'react';

export function useAICompletions(
  monacoInstance: typeof monaco | null,
  enabled: boolean = true
): void {
  const disposableRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    if (!monacoInstance || !enabled) {
      disposableRef.current?.dispose();
      disposableRef.current = null;
      return;
    }

    const provider = getCompletionProvider();
    provider.setEnabled(enabled);
    disposableRef.current = provider.register(monacoInstance);

    return () => {
      disposableRef.current?.dispose();
      disposableRef.current = null;
    };
  }, [monacoInstance, enabled]);
}
