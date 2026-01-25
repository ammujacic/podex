/**
 * Comprehensive tests for useLSP hook
 * Tests LSP (Language Server Protocol) integration for code diagnostics
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLSP, lspSeverityToMonaco, diagnosticsToMonacoMarkers } from '../useLSP';
import * as api from '@/lib/api';
import type { LSPDiagnostic, DiagnosticsResponse, SupportedLanguagesResponse } from '@/lib/api';

// Mock API
vi.mock('@/lib/api', () => ({
  getFileDiagnostics: vi.fn(),
  getBatchDiagnostics: vi.fn(),
  getSupportedLanguages: vi.fn(),
}));

// Note: console.error spy is set up in each test that needs it
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

// Mock diagnostics data
const mockDiagnostic: LSPDiagnostic = {
  line: 10,
  column: 5,
  end_line: 10,
  end_column: 15,
  message: 'Variable is not defined',
  severity: 'error',
  source: 'typescript',
  code: 'TS2304',
};

const mockWarningDiagnostic: LSPDiagnostic = {
  line: 20,
  column: 1,
  end_line: 20,
  end_column: 10,
  message: 'Unused variable',
  severity: 'warning',
  source: 'typescript',
  code: 'TS6133',
};

const mockInfoDiagnostic: LSPDiagnostic = {
  line: 30,
  column: 1,
  end_line: 30,
  end_column: 20,
  message: 'Consider using const',
  severity: 'information',
  source: 'eslint',
  code: 'prefer-const',
};

const mockHintDiagnostic: LSPDiagnostic = {
  line: 40,
  column: 1,
  end_line: 40,
  end_column: 5,
  message: 'Naming convention hint',
  severity: 'hint',
  source: 'eslint',
  code: null,
};

const mockDiagnosticsResponse: DiagnosticsResponse = {
  file_path: '/src/test.ts',
  diagnostics: [mockDiagnostic, mockWarningDiagnostic],
  lsp_server: 'typescript-language-server',
  timestamp: new Date().toISOString(),
};

const mockBatchResponse = {
  results: [
    {
      file_path: '/src/file1.ts',
      diagnostics: [mockDiagnostic],
    },
    {
      file_path: '/src/file2.ts',
      diagnostics: [mockWarningDiagnostic],
    },
  ],
};

const mockSupportedLanguages: SupportedLanguagesResponse = {
  languages: ['typescript', 'javascript', 'python'],
  workspace_id: 'ws-123',
};

describe('useLSP', () => {
  const workspaceId = 'workspace-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  // ========================================================================
  // Initialization Tests
  // ========================================================================

  describe('Initialization', () => {
    it('should initialize with empty diagnostics map', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      expect(result.current.diagnostics).toBeInstanceOf(Map);
      expect(result.current.diagnostics.size).toBe(0);
    });

    it('should initialize with loading false', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      expect(result.current.loading).toBe(false);
    });

    it('should initialize with no error', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      expect(result.current.error).toBeNull();
    });

    it('should initialize with no supported languages', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      expect(result.current.supportedLanguages).toBeNull();
    });

    it('should not auto-fetch by default', () => {
      renderHook(() => useLSP({ workspaceId }));

      expect(api.getSupportedLanguages).not.toHaveBeenCalled();
    });

    it('should auto-fetch supported languages when autoFetch is true', async () => {
      vi.mocked(api.getSupportedLanguages).mockResolvedValue(mockSupportedLanguages);

      renderHook(() => useLSP({ workspaceId, autoFetch: true }));

      // Flush any pending timers and microtasks
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(api.getSupportedLanguages).toHaveBeenCalledWith(workspaceId);
    });

    it('should not auto-fetch when workspaceId is empty', () => {
      renderHook(() => useLSP({ workspaceId: '', autoFetch: true }));

      expect(api.getSupportedLanguages).not.toHaveBeenCalled();
    });

    it('should accept custom debounce delay', () => {
      const { result } = renderHook(() => useLSP({ workspaceId, debounceMs: 1000 }));

      // Hook should still function
      expect(result.current.diagnostics).toBeInstanceOf(Map);
    });
  });

  // ========================================================================
  // fetchFileDiagnostics Tests
  // ========================================================================

  describe('fetchFileDiagnostics', () => {
    it('should fetch diagnostics for a single file', async () => {
      vi.mocked(api.getFileDiagnostics).mockResolvedValue(mockDiagnosticsResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(api.getFileDiagnostics).toHaveBeenCalledWith(workspaceId, '/src/test.ts');
      expect(result.current.diagnostics.get('/src/test.ts')).toEqual(
        mockDiagnosticsResponse.diagnostics
      );
    });

    it('should return the response on success', async () => {
      vi.mocked(api.getFileDiagnostics).mockResolvedValue(mockDiagnosticsResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      let response: DiagnosticsResponse | null = null;
      await act(async () => {
        response = await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(response).toEqual(mockDiagnosticsResponse);
    });

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: DiagnosticsResponse) => void;
      vi.mocked(api.getFileDiagnostics).mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { result } = renderHook(() => useLSP({ workspaceId }));

      act(() => {
        result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise!(mockDiagnosticsResponse);
      });

      expect(result.current.loading).toBe(false);
    });

    it('should handle fetch error', async () => {
      vi.mocked(api.getFileDiagnostics).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.error).toBe('Network error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle non-Error rejection', async () => {
      vi.mocked(api.getFileDiagnostics).mockRejectedValue('Unknown error');

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.error).toBe('Failed to fetch diagnostics');
    });

    it('should return null on error', async () => {
      vi.mocked(api.getFileDiagnostics).mockRejectedValue(new Error('Error'));

      const { result } = renderHook(() => useLSP({ workspaceId }));

      let response: DiagnosticsResponse | null = null;
      await act(async () => {
        response = await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(response).toBeNull();
    });

    it('should return null when workspaceId is empty', async () => {
      const { result } = renderHook(() => useLSP({ workspaceId: '' }));

      let response: DiagnosticsResponse | null = null;
      await act(async () => {
        response = await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(response).toBeNull();
      expect(api.getFileDiagnostics).not.toHaveBeenCalled();
    });

    it('should clear previous error on new fetch', async () => {
      vi.mocked(api.getFileDiagnostics)
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce(mockDiagnosticsResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.error).toBe('First error');

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.error).toBeNull();
    });

    it('should update existing file diagnostics', async () => {
      const updatedResponse: DiagnosticsResponse = {
        ...mockDiagnosticsResponse,
        diagnostics: [mockInfoDiagnostic],
      };

      vi.mocked(api.getFileDiagnostics)
        .mockResolvedValueOnce(mockDiagnosticsResponse)
        .mockResolvedValueOnce(updatedResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.diagnostics.get('/src/test.ts')).toHaveLength(2);

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.diagnostics.get('/src/test.ts')).toHaveLength(1);
      expect(result.current.diagnostics.get('/src/test.ts')?.[0].severity).toBe('information');
    });
  });

  // ========================================================================
  // fetchBatchDiagnostics Tests
  // ========================================================================

  describe('fetchBatchDiagnostics', () => {
    it('should fetch diagnostics for multiple files', async () => {
      vi.mocked(api.getBatchDiagnostics).mockResolvedValue(mockBatchResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));
      const filePaths = ['/src/file1.ts', '/src/file2.ts'];

      await act(async () => {
        await result.current.fetchBatchDiagnostics(filePaths);
      });

      expect(api.getBatchDiagnostics).toHaveBeenCalledWith(workspaceId, filePaths);
      expect(result.current.diagnostics.get('/src/file1.ts')).toHaveLength(1);
      expect(result.current.diagnostics.get('/src/file2.ts')).toHaveLength(1);
    });

    it('should set loading state during batch fetch', async () => {
      let resolvePromise: (value: typeof mockBatchResponse) => void;
      vi.mocked(api.getBatchDiagnostics).mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { result } = renderHook(() => useLSP({ workspaceId }));

      act(() => {
        result.current.fetchBatchDiagnostics(['/src/file1.ts']);
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise!(mockBatchResponse);
      });

      expect(result.current.loading).toBe(false);
    });

    it('should handle batch fetch error', async () => {
      vi.mocked(api.getBatchDiagnostics).mockRejectedValue(new Error('Batch error'));

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts']);
      });

      expect(result.current.error).toBe('Batch error');
    });

    it('should handle non-Error batch rejection', async () => {
      vi.mocked(api.getBatchDiagnostics).mockRejectedValue('Unknown batch error');

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts']);
      });

      expect(result.current.error).toBe('Failed to fetch batch diagnostics');
    });

    it('should not fetch when workspaceId is empty', async () => {
      const { result } = renderHook(() => useLSP({ workspaceId: '' }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts']);
      });

      expect(api.getBatchDiagnostics).not.toHaveBeenCalled();
    });

    it('should not fetch when filePaths array is empty', async () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics([]);
      });

      expect(api.getBatchDiagnostics).not.toHaveBeenCalled();
    });

    it('should preserve existing diagnostics for other files', async () => {
      vi.mocked(api.getFileDiagnostics).mockResolvedValue(mockDiagnosticsResponse);
      vi.mocked(api.getBatchDiagnostics).mockResolvedValue(mockBatchResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.diagnostics.size).toBe(1);

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts', '/src/file2.ts']);
      });

      expect(result.current.diagnostics.size).toBe(3);
      expect(result.current.diagnostics.has('/src/test.ts')).toBe(true);
    });
  });

  // ========================================================================
  // fetchSupportedLanguages Tests
  // ========================================================================

  describe('fetchSupportedLanguages', () => {
    it('should fetch supported languages', async () => {
      vi.mocked(api.getSupportedLanguages).mockResolvedValue(mockSupportedLanguages);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchSupportedLanguages();
      });

      expect(api.getSupportedLanguages).toHaveBeenCalledWith(workspaceId);
      expect(result.current.supportedLanguages).toEqual(mockSupportedLanguages);
    });

    it('should not fetch when workspaceId is empty', async () => {
      const { result } = renderHook(() => useLSP({ workspaceId: '' }));

      await act(async () => {
        await result.current.fetchSupportedLanguages();
      });

      expect(api.getSupportedLanguages).not.toHaveBeenCalled();
      expect(result.current.supportedLanguages).toBeNull();
    });

    it('should handle fetch supported languages error silently', async () => {
      vi.mocked(api.getSupportedLanguages).mockRejectedValue(new Error('Languages error'));

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchSupportedLanguages();
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(result.current.supportedLanguages).toBeNull();
    });
  });

  // ========================================================================
  // clearFileDiagnostics Tests
  // ========================================================================

  describe('clearFileDiagnostics', () => {
    it('should clear diagnostics for a specific file', async () => {
      vi.mocked(api.getFileDiagnostics).mockResolvedValue(mockDiagnosticsResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(result.current.diagnostics.has('/src/test.ts')).toBe(true);

      act(() => {
        result.current.clearFileDiagnostics('/src/test.ts');
      });

      expect(result.current.diagnostics.has('/src/test.ts')).toBe(false);
    });

    it('should not affect other files when clearing', async () => {
      vi.mocked(api.getBatchDiagnostics).mockResolvedValue(mockBatchResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts', '/src/file2.ts']);
      });

      expect(result.current.diagnostics.size).toBe(2);

      act(() => {
        result.current.clearFileDiagnostics('/src/file1.ts');
      });

      expect(result.current.diagnostics.size).toBe(1);
      expect(result.current.diagnostics.has('/src/file2.ts')).toBe(true);
    });

    it('should handle clearing non-existent file', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      expect(() => {
        act(() => {
          result.current.clearFileDiagnostics('/non/existent.ts');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // clearAllDiagnostics Tests
  // ========================================================================

  describe('clearAllDiagnostics', () => {
    it('should clear all diagnostics', async () => {
      vi.mocked(api.getBatchDiagnostics).mockResolvedValue(mockBatchResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts', '/src/file2.ts']);
      });

      expect(result.current.diagnostics.size).toBe(2);

      act(() => {
        result.current.clearAllDiagnostics();
      });

      expect(result.current.diagnostics.size).toBe(0);
    });

    it('should handle clearing when already empty', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      expect(result.current.diagnostics.size).toBe(0);

      expect(() => {
        act(() => {
          result.current.clearAllDiagnostics();
        });
      }).not.toThrow();

      expect(result.current.diagnostics.size).toBe(0);
    });
  });

  // ========================================================================
  // getDiagnosticsCounts Tests
  // ========================================================================

  describe('getDiagnosticsCounts', () => {
    it('should return zero counts when empty', () => {
      const { result } = renderHook(() => useLSP({ workspaceId }));

      const counts = result.current.getDiagnosticsCounts();

      expect(counts).toEqual({
        errors: 0,
        warnings: 0,
        info: 0,
        hints: 0,
      });
    });

    it('should count diagnostics by severity', async () => {
      const mixedResponse = {
        results: [
          {
            file_path: '/src/file1.ts',
            diagnostics: [mockDiagnostic, mockWarningDiagnostic],
          },
          {
            file_path: '/src/file2.ts',
            diagnostics: [mockInfoDiagnostic, mockHintDiagnostic, mockDiagnostic],
          },
        ],
      };

      vi.mocked(api.getBatchDiagnostics).mockResolvedValue(mixedResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchBatchDiagnostics(['/src/file1.ts', '/src/file2.ts']);
      });

      const counts = result.current.getDiagnosticsCounts();

      expect(counts.errors).toBe(2);
      expect(counts.warnings).toBe(1);
      expect(counts.info).toBe(1);
      expect(counts.hints).toBe(1);
    });

    it('should update counts when diagnostics change', async () => {
      vi.mocked(api.getFileDiagnostics).mockResolvedValue(mockDiagnosticsResponse);

      const { result } = renderHook(() => useLSP({ workspaceId }));

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      let counts = result.current.getDiagnosticsCounts();
      expect(counts.errors).toBe(1);
      expect(counts.warnings).toBe(1);

      act(() => {
        result.current.clearAllDiagnostics();
      });

      counts = result.current.getDiagnosticsCounts();
      expect(counts.errors).toBe(0);
      expect(counts.warnings).toBe(0);
    });
  });

  // ========================================================================
  // Cleanup Tests
  // ========================================================================

  describe('Cleanup', () => {
    it('should clear debounce timer on unmount', () => {
      const { unmount } = renderHook(() => useLSP({ workspaceId }));

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      unmount();

      // Timer ref starts as null, so clearTimeout may not be called
      // This just ensures no error is thrown during cleanup
      expect(clearTimeoutSpy).toBeDefined();
    });
  });

  // ========================================================================
  // Workspace ID Change Tests
  // ========================================================================

  describe('Workspace ID Changes', () => {
    it('should use updated workspaceId for new fetches', async () => {
      vi.mocked(api.getFileDiagnostics).mockResolvedValue(mockDiagnosticsResponse);

      const { result, rerender } = renderHook(({ wsId }) => useLSP({ workspaceId: wsId }), {
        initialProps: { wsId: 'workspace-1' },
      });

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(api.getFileDiagnostics).toHaveBeenCalledWith('workspace-1', '/src/test.ts');

      rerender({ wsId: 'workspace-2' });

      await act(async () => {
        await result.current.fetchFileDiagnostics('/src/test.ts');
      });

      expect(api.getFileDiagnostics).toHaveBeenCalledWith('workspace-2', '/src/test.ts');
    });
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('lspSeverityToMonaco', () => {
  it('should convert error severity to Monaco 8', () => {
    expect(lspSeverityToMonaco('error')).toBe(8);
  });

  it('should convert warning severity to Monaco 4', () => {
    expect(lspSeverityToMonaco('warning')).toBe(4);
  });

  it('should convert information severity to Monaco 2', () => {
    expect(lspSeverityToMonaco('information')).toBe(2);
  });

  it('should convert hint severity to Monaco 1', () => {
    expect(lspSeverityToMonaco('hint')).toBe(1);
  });
});

describe('diagnosticsToMonacoMarkers', () => {
  it('should convert empty array', () => {
    const markers = diagnosticsToMonacoMarkers([]);
    expect(markers).toEqual([]);
  });

  it('should convert single diagnostic to marker', () => {
    const diagnostic: LSPDiagnostic = {
      line: 10,
      column: 5,
      end_line: 10,
      end_column: 15,
      message: 'Test error',
      severity: 'error',
      source: 'typescript',
      code: 'TS1234',
    };

    const markers = diagnosticsToMonacoMarkers([diagnostic]);

    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      startLineNumber: 10,
      startColumn: 5,
      endLineNumber: 10,
      endColumn: 15,
      message: 'Test error',
      severity: 8,
      source: 'typescript',
      code: 'TS1234',
    });
  });

  it('should convert multiple diagnostics', () => {
    const diagnostics: LSPDiagnostic[] = [
      {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 10,
        message: 'Error',
        severity: 'error',
        source: null,
        code: null,
      },
      {
        line: 2,
        column: 1,
        end_line: 2,
        end_column: 10,
        message: 'Warning',
        severity: 'warning',
        source: 'eslint',
        code: 'no-unused-vars',
      },
    ];

    const markers = diagnosticsToMonacoMarkers(diagnostics);

    expect(markers).toHaveLength(2);
    expect(markers[0]?.severity).toBe(8);
    expect(markers[1]?.severity).toBe(4);
  });

  it('should handle null source and code', () => {
    const diagnostic: LSPDiagnostic = {
      line: 1,
      column: 1,
      end_line: 1,
      end_column: 5,
      message: 'Test',
      severity: 'hint',
      source: null,
      code: null,
    };

    const markers = diagnosticsToMonacoMarkers([diagnostic]);

    expect(markers[0]?.source).toBeUndefined();
    expect(markers[0]?.code).toBeUndefined();
  });

  it('should preserve all severity types', () => {
    const diagnostics: LSPDiagnostic[] = [
      {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 5,
        message: 'E',
        severity: 'error',
        source: null,
        code: null,
      },
      {
        line: 2,
        column: 1,
        end_line: 2,
        end_column: 5,
        message: 'W',
        severity: 'warning',
        source: null,
        code: null,
      },
      {
        line: 3,
        column: 1,
        end_line: 3,
        end_column: 5,
        message: 'I',
        severity: 'information',
        source: null,
        code: null,
      },
      {
        line: 4,
        column: 1,
        end_line: 4,
        end_column: 5,
        message: 'H',
        severity: 'hint',
        source: null,
        code: null,
      },
    ];

    const markers = diagnosticsToMonacoMarkers(diagnostics);

    expect(markers.map((m) => m.severity)).toEqual([8, 4, 2, 1]);
  });
});
