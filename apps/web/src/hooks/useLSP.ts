/**
 * React hook for LSP (Language Server Protocol) integration.
 * Provides code diagnostics (errors, warnings) for workspace files.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getFileDiagnostics,
  getBatchDiagnostics,
  getSupportedLanguages,
  type LSPDiagnostic,
  type DiagnosticsResponse,
  type SupportedLanguagesResponse,
} from '@/lib/api';

export interface UseLSPOptions {
  /** Workspace ID to get diagnostics for */
  workspaceId: string;
  /** Whether to automatically fetch diagnostics on mount */
  autoFetch?: boolean;
  /** Debounce delay for file change diagnostics (ms) */
  debounceMs?: number;
}

export interface UseLSPReturn {
  /** Map of file path to diagnostics */
  diagnostics: Map<string, LSPDiagnostic[]>;
  /** Whether diagnostics are currently loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Supported languages in the workspace */
  supportedLanguages: SupportedLanguagesResponse | null;
  /** Fetch diagnostics for a single file */
  fetchFileDiagnostics: (filePath: string) => Promise<DiagnosticsResponse | null>;
  /** Fetch diagnostics for multiple files */
  fetchBatchDiagnostics: (filePaths: string[]) => Promise<void>;
  /** Fetch supported languages */
  fetchSupportedLanguages: () => Promise<void>;
  /** Clear diagnostics for a file */
  clearFileDiagnostics: (filePath: string) => void;
  /** Clear all diagnostics */
  clearAllDiagnostics: () => void;
  /** Get diagnostics count by severity */
  getDiagnosticsCounts: () => { errors: number; warnings: number; info: number; hints: number };
}

/**
 * Hook to manage LSP diagnostics for a workspace.
 */
export function useLSP({
  workspaceId,
  autoFetch = false,
  debounceMs: _debounceMs = 500,
}: UseLSPOptions): UseLSPReturn {
  const [diagnostics, setDiagnostics] = useState<Map<string, LSPDiagnostic[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportedLanguages, setSupportedLanguages] = useState<SupportedLanguagesResponse | null>(
    null
  );

  // Debounce timer ref (reserved for future debounced batch fetching)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Fetch diagnostics for a single file.
   */
  const fetchFileDiagnostics = useCallback(
    async (filePath: string): Promise<DiagnosticsResponse | null> => {
      if (!workspaceId) return null;

      setLoading(true);
      setError(null);

      try {
        const response = await getFileDiagnostics(workspaceId, filePath);
        setDiagnostics((prev) => {
          const next = new Map(prev);
          next.set(filePath, response.diagnostics);
          return next;
        });
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch diagnostics';
        setError(message);
        console.error('LSP diagnostics error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  /**
   * Fetch diagnostics for multiple files.
   */
  const fetchBatchDiagnostics = useCallback(
    async (filePaths: string[]): Promise<void> => {
      if (!workspaceId || filePaths.length === 0) return;

      setLoading(true);
      setError(null);

      try {
        const response = await getBatchDiagnostics(workspaceId, filePaths);
        setDiagnostics((prev) => {
          const next = new Map(prev);
          for (const result of response.results) {
            next.set(result.file_path, result.diagnostics);
          }
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch batch diagnostics';
        setError(message);
        console.error('LSP batch diagnostics error:', err);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  /**
   * Fetch supported languages for the workspace.
   */
  const fetchSupportedLanguages = useCallback(async (): Promise<void> => {
    if (!workspaceId) return;

    try {
      const response = await getSupportedLanguages(workspaceId);
      setSupportedLanguages(response);
    } catch (err) {
      console.error('Failed to fetch supported languages:', err);
    }
  }, [workspaceId]);

  /**
   * Clear diagnostics for a specific file.
   */
  const clearFileDiagnostics = useCallback((filePath: string): void => {
    setDiagnostics((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  /**
   * Clear all diagnostics.
   */
  const clearAllDiagnostics = useCallback((): void => {
    setDiagnostics(new Map());
  }, []);

  /**
   * Get counts of diagnostics by severity.
   */
  const getDiagnosticsCounts = useCallback((): {
    errors: number;
    warnings: number;
    info: number;
    hints: number;
  } => {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let hints = 0;

    for (const fileDiags of diagnostics.values()) {
      for (const diag of fileDiags) {
        switch (diag.severity) {
          case 'error':
            errors++;
            break;
          case 'warning':
            warnings++;
            break;
          case 'information':
            info++;
            break;
          case 'hint':
            hints++;
            break;
        }
      }
    }

    return { errors, warnings, info, hints };
  }, [diagnostics]);

  // Auto-fetch supported languages on mount
  useEffect(() => {
    if (autoFetch && workspaceId) {
      fetchSupportedLanguages();
    }
  }, [autoFetch, workspaceId, fetchSupportedLanguages]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    const timerRef = debounceTimerRef;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    diagnostics,
    loading,
    error,
    supportedLanguages,
    fetchFileDiagnostics,
    fetchBatchDiagnostics,
    fetchSupportedLanguages,
    clearFileDiagnostics,
    clearAllDiagnostics,
    getDiagnosticsCounts,
  };
}

/**
 * Convert LSP severity to Monaco marker severity.
 */
export function lspSeverityToMonaco(severity: LSPDiagnostic['severity']): 1 | 2 | 4 | 8 {
  // Monaco MarkerSeverity: Hint = 1, Info = 2, Warning = 4, Error = 8
  switch (severity) {
    case 'error':
      return 8;
    case 'warning':
      return 4;
    case 'information':
      return 2;
    case 'hint':
      return 1;
  }
}

/**
 * Convert LSP diagnostics to Monaco editor markers.
 */
export function diagnosticsToMonacoMarkers(diagnostics: LSPDiagnostic[]): Array<{
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: 1 | 2 | 4 | 8;
  source?: string;
  code?: string;
}> {
  return diagnostics.map((diag) => ({
    startLineNumber: diag.line,
    startColumn: diag.column,
    endLineNumber: diag.end_line,
    endColumn: diag.end_column,
    message: diag.message,
    severity: lspSeverityToMonaco(diag.severity),
    source: diag.source || undefined,
    code: diag.code || undefined,
  }));
}
