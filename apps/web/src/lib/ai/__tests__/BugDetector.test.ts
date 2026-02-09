/**
 * Tests for AI Bug Detector
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BugDetector, getBugDetector, bugGlyphStyles, type DetectedBug } from '../BugDetector';

// Mock the API module
vi.mock('@/lib/api', () => ({
  detectBugs: vi.fn(),
}));

import { detectBugs } from '@/lib/api';

// Mock React hooks
vi.mock('react', () => ({
  useEffect: vi.fn((fn) => fn()),
  useRef: vi.fn(() => ({ current: null })),
}));

const mockDetectBugs = vi.mocked(detectBugs);

describe('BugDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ============================================================================
  // BugDetector Class Tests
  // ============================================================================

  describe('BugDetector', () => {
    describe('constructor', () => {
      it('should create instance with default config', () => {
        const detector = new BugDetector();
        expect(detector).toBeInstanceOf(BugDetector);
      });

      it('should create instance with custom config', () => {
        const detector = new BugDetector({
          debounceMs: 10000,
          enabled: false,
          minCodeLength: 100,
        });
        expect(detector).toBeInstanceOf(BugDetector);
      });

      it('should merge custom config with defaults', () => {
        const detector = new BugDetector({
          debounceMs: 2000,
        });
        expect(detector).toBeInstanceOf(BugDetector);
      });
    });

    describe('updateConfig', () => {
      it('should update configuration', () => {
        const detector = new BugDetector();
        detector.updateConfig({ debounceMs: 3000 });
        expect(detector).toBeInstanceOf(BugDetector);
      });

      it('should partially update configuration', () => {
        const detector = new BugDetector({ debounceMs: 5000, enabled: true });
        detector.updateConfig({ enabled: false });
        expect(detector).toBeInstanceOf(BugDetector);
      });
    });

    describe('analyze', () => {
      it('should analyze code and return bugs', async () => {
        const detector = new BugDetector();

        mockDetectBugs.mockResolvedValue({
          bugs: [
            {
              line: 5,
              column: 1,
              severity: 'error',
              message: 'Undefined variable',
              suggestion: 'Define the variable before use',
            },
          ],
          analysis_time_ms: 150,
        });

        const result = await detector.analyze(
          'const x = undefined_var; plus more code here to meet length',
          'javascript'
        );

        expect(result.bugs).toHaveLength(1);
        expect(result.bugs[0].severity).toBe('error');
        expect(result.analysisTimeMs).toBe(150);
      });

      it('should return empty result for short code', async () => {
        const detector = new BugDetector({ minCodeLength: 50 });

        const result = await detector.analyze('x', 'javascript');

        expect(result.bugs).toHaveLength(0);
        expect(result.analysisTimeMs).toBe(0);
        // Short code should not call the API
      });

      it('should handle API errors gracefully', async () => {
        const detector = new BugDetector({ minCodeLength: 10 });

        mockDetectBugs.mockRejectedValue(new Error('API Error'));

        const result = await detector.analyze(
          'const x = 1; const y = 2; const z = 3;',
          'javascript'
        );

        expect(result.bugs).toHaveLength(0);
        expect(result.analysisTimeMs).toBe(0);
      });

      it('should handle empty bugs array in response', async () => {
        const detector = new BugDetector({ minCodeLength: 10 });

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 50,
        });

        const result = await detector.analyze(
          'const x = 1; const y = 2; const z = 3;',
          'javascript'
        );

        expect(result.bugs).toHaveLength(0);
        expect(result.analysisTimeMs).toBe(50);
      });

      it('should handle undefined bugs in response', async () => {
        const detector = new BugDetector({ minCodeLength: 10 });

        mockDetectBugs.mockResolvedValue({
          bugs: undefined as any,
          analysis_time_ms: undefined as any,
        });

        const result = await detector.analyze(
          'const x = 1; const y = 2; const z = 3;',
          'javascript'
        );

        expect(result.bugs).toHaveLength(0);
      });

      it('should detect multiple bugs', async () => {
        const detector = new BugDetector({ minCodeLength: 10 });

        mockDetectBugs.mockResolvedValue({
          bugs: [
            { line: 1, column: 1, severity: 'error', message: 'Error 1', suggestion: '' },
            { line: 3, column: 1, severity: 'warning', message: 'Warning 1', suggestion: '' },
            { line: 5, column: 1, severity: 'info', message: 'Info 1', suggestion: '' },
          ],
          analysis_time_ms: 200,
        });

        const result = await detector.analyze(
          'const x = 1; const y = 2; const z = 3;',
          'javascript'
        );

        expect(result.bugs).toHaveLength(3);
      });
    });

    describe('bugsToMarkers', () => {
      it('should convert bugs to Monaco markers', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          {
            line: 1,
            column: 5,
            severity: 'error',
            message: 'Test error',
            suggestion: 'Fix it',
          },
        ];

        const mockModel = createMockModel(['const x = undefined_var;']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers).toHaveLength(1);
        expect(markers[0].startLineNumber).toBe(1);
        expect(markers[0].startColumn).toBe(5);
        expect(markers[0].source).toBe('AI Bug Detector');
      });

      it('should include suggestion in marker message', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          {
            line: 1,
            column: 1,
            severity: 'warning',
            message: 'Unused variable',
            suggestion: 'Remove or use the variable',
          },
        ];

        const mockModel = createMockModel(['const unused = 1;']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers[0].message).toContain('Unused variable');
        expect(markers[0].message).toContain('Suggestion: Remove or use the variable');
      });

      it('should not include suggestion if empty', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          {
            line: 1,
            column: 1,
            severity: 'info',
            message: 'Info message',
            suggestion: '',
          },
        ];

        const mockModel = createMockModel(['const x = 1;']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers[0].message).not.toContain('Suggestion');
      });

      it('should convert error severity to Monaco severity 8', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'error', message: 'Error', suggestion: '' },
        ];

        const mockModel = createMockModel(['code']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers[0].severity).toBe(8);
      });

      it('should convert warning severity to Monaco severity 4', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'warning', message: 'Warning', suggestion: '' },
        ];

        const mockModel = createMockModel(['code']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers[0].severity).toBe(4);
      });

      it('should convert info severity to Monaco severity 2', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'info', message: 'Info', suggestion: '' },
        ];

        const mockModel = createMockModel(['code']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers[0].severity).toBe(2);
      });

      it('should set endColumn to end of line', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'error', message: 'Error', suggestion: '' },
        ];

        const mockModel = createMockModel(['const x = 1;']);

        const markers = detector.bugsToMarkers(bugs, mockModel as any);

        expect(markers[0].endColumn).toBe(13); // length + 1
      });
    });

    describe('createDecorations', () => {
      it('should create decorations for bugs', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'error', message: 'Error', suggestion: '' },
        ];

        const mockEditor = {
          createDecorationsCollection: vi.fn(() => ({ dispose: vi.fn() })),
        };

        const decorations = detector.createDecorations(bugs, mockEditor as any);

        expect(mockEditor.createDecorationsCollection).toHaveBeenCalled();
        expect(decorations).toHaveProperty('dispose');
      });

      it('should create decorations with correct glyph class', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'error', message: 'Error', suggestion: '' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        detector.createDecorations(bugs, mockEditor as any);

        expect(passedDecorations[0].options.glyphMarginClassName).toBe('bug-glyph bug-glyph-error');
      });

      it('should include hover message with severity and message', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'warning', message: 'Test warning', suggestion: '' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        detector.createDecorations(bugs, mockEditor as any);

        expect(passedDecorations[0].options.glyphMarginHoverMessage.value).toContain('WARNING');
        expect(passedDecorations[0].options.glyphMarginHoverMessage.value).toContain(
          'Test warning'
        );
      });

      it('should include suggestion in hover message', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'error', message: 'Error', suggestion: 'Fix this' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        detector.createDecorations(bugs, mockEditor as any);

        expect(passedDecorations[0].options.glyphMarginHoverMessage.value).toContain('Fix this');
      });

      it('should set correct overview ruler color for error', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'error', message: 'Error', suggestion: '' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        detector.createDecorations(bugs, mockEditor as any);

        expect(passedDecorations[0].options.overviewRuler.color).toBe('#ef4444');
      });

      it('should set correct overview ruler color for warning', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'warning', message: 'Warning', suggestion: '' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        detector.createDecorations(bugs, mockEditor as any);

        expect(passedDecorations[0].options.overviewRuler.color).toBe('#f59e0b');
      });

      it('should set correct overview ruler color for info', () => {
        const detector = new BugDetector();

        const bugs: DetectedBug[] = [
          { line: 1, column: 1, severity: 'info', message: 'Info', suggestion: '' },
        ];

        let passedDecorations: any[] = [];
        const mockEditor = {
          createDecorationsCollection: vi.fn((decorations) => {
            passedDecorations = decorations;
            return { dispose: vi.fn() };
          }),
        };

        detector.createDecorations(bugs, mockEditor as any);

        expect(passedDecorations[0].options.overviewRuler.color).toBe('#00e5ff');
      });
    });

    describe('analyzeAndUpdate', () => {
      it('should analyze and update Monaco markers', async () => {
        const detector = new BugDetector({ minCodeLength: 10 });

        mockDetectBugs.mockResolvedValue({
          bugs: [{ line: 1, column: 1, severity: 'error', message: 'Error', suggestion: '' }],
          analysis_time_ms: 100,
        });

        const mockModel = createMockModel(['const x = undefined_var; and more code here']);
        const mockEditor = {
          getModel: () => mockModel,
        };
        const mockMonaco = createMockMonaco();

        const bugs = await detector.analyzeAndUpdate(mockEditor as any, mockMonaco as any);

        expect(bugs.length).toBeGreaterThanOrEqual(1);
        expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalledWith(
          mockModel,
          'ai-bug-detector',
          expect.any(Array)
        );
      });

      it('should return empty array if no model', async () => {
        const detector = new BugDetector();

        const mockEditor = {
          getModel: () => null,
        };
        const mockMonaco = createMockMonaco();

        const bugs = await detector.analyzeAndUpdate(mockEditor as any, mockMonaco as any);

        expect(bugs).toHaveLength(0);
      });

      it('should cancel previous pending request', async () => {
        const detector = new BugDetector();

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 100,
        });

        const mockModel = createMockModel(['const x = 1;'.repeat(10)]);
        const mockEditor = {
          getModel: () => mockModel,
        };
        const mockMonaco = createMockMonaco();

        // Start first analysis
        const promise1 = detector.analyzeAndUpdate(mockEditor as any, mockMonaco as any);
        // Start second analysis immediately
        const promise2 = detector.analyzeAndUpdate(mockEditor as any, mockMonaco as any);

        await Promise.all([promise1, promise2]);

        // Both should complete
        expect(mockDetectBugs).toHaveBeenCalledTimes(2);
      });
    });

    describe('scheduleAnalysis', () => {
      it('should debounce analysis', async () => {
        const detector = new BugDetector({ debounceMs: 1000, enabled: true, autoAnalyze: true });

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 50,
        });

        const mockModel = createMockModel(['const x = 1;'.repeat(10)]);
        const mockEditor = {
          getModel: () => mockModel,
        };
        const mockMonaco = createMockMonaco();

        // Schedule multiple analyses
        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);
        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);
        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);

        // Before debounce time
        await vi.advanceTimersByTimeAsync(500);
        expect(mockDetectBugs).not.toHaveBeenCalled();

        // After debounce time
        await vi.advanceTimersByTimeAsync(600);
        expect(mockDetectBugs).toHaveBeenCalledTimes(1);
      });

      it('should not schedule if disabled', () => {
        const detector = new BugDetector({ enabled: false });

        const mockModel = createMockModel(['const x = 1;']);
        const mockEditor = {
          getModel: () => mockModel,
        };
        const mockMonaco = createMockMonaco();

        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);

        vi.advanceTimersByTime(10000);
        expect(mockDetectBugs).not.toHaveBeenCalled();
      });

      it('should not schedule if autoAnalyze is false', () => {
        const detector = new BugDetector({ enabled: true, autoAnalyze: false });

        const mockModel = createMockModel(['const x = 1;']);
        const mockEditor = {
          getModel: () => mockModel,
        };
        const mockMonaco = createMockMonaco();

        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);

        vi.advanceTimersByTime(10000);
        expect(mockDetectBugs).not.toHaveBeenCalled();
      });

      it('should not schedule if no model', () => {
        const detector = new BugDetector({ enabled: true, autoAnalyze: true });

        const mockEditor = {
          getModel: () => null,
        };
        const mockMonaco = createMockMonaco();

        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);

        vi.advanceTimersByTime(10000);
        expect(mockDetectBugs).not.toHaveBeenCalled();
      });
    });

    describe('clearAll', () => {
      it('should clear all timers', () => {
        const detector = new BugDetector({ debounceMs: 5000, enabled: true, autoAnalyze: true });

        const mockModel = createMockModel(['const x = 1;'.repeat(10)]);
        const mockEditor = {
          getModel: () => mockModel,
        };
        const mockMonaco = createMockMonaco();

        detector.scheduleAnalysis(mockEditor as any, mockMonaco as any);
        detector.clearAll(mockMonaco as any);

        vi.advanceTimersByTime(10000);
        expect(mockDetectBugs).not.toHaveBeenCalled();
      });

      it('should clear all markers', () => {
        const detector = new BugDetector();
        const mockModel1 = createMockModel(['code1']);
        const mockModel2 = createMockModel(['code2']);
        const mockMonaco = createMockMonaco();
        mockMonaco.editor.getModels.mockReturnValue([mockModel1, mockModel2]);

        detector.clearAll(mockMonaco as any);

        expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalledWith(
          mockModel1,
          'ai-bug-detector',
          []
        );
        expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalledWith(
          mockModel2,
          'ai-bug-detector',
          []
        );
      });
    });

    describe('setupAutoAnalysis', () => {
      it('should setup content change listener', () => {
        const detector = new BugDetector({ enabled: true, autoAnalyze: true });

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 50,
        });

        const onDidChangeContent = vi.fn(() => ({ dispose: vi.fn() }));
        const mockModel = {
          ...createMockModel(['const x = 1;'.repeat(10)]),
          onDidChangeContent,
        };
        const mockEditor = {
          getModel: () => mockModel,
          onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
        };
        const mockMonaco = createMockMonaco();

        const disposable = detector.setupAutoAnalysis(mockEditor as any, mockMonaco as any);

        expect(onDidChangeContent).toHaveBeenCalled();
        expect(disposable).toHaveProperty('dispose');
      });

      it('should setup key down listener for save', () => {
        const detector = new BugDetector({ enabled: true, autoAnalyze: true });

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 50,
        });

        const onKeyDown = vi.fn(() => ({ dispose: vi.fn() }));
        const mockModel = {
          ...createMockModel(['const x = 1;'.repeat(10)]),
          onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
        };
        const mockEditor = {
          getModel: () => mockModel,
          onKeyDown,
        };
        const mockMonaco = createMockMonaco();

        detector.setupAutoAnalysis(mockEditor as any, mockMonaco as any);

        expect(onKeyDown).toHaveBeenCalled();
      });

      it('should run initial analysis', async () => {
        const detector = new BugDetector({ enabled: true, autoAnalyze: true });

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 50,
        });

        const mockModel = {
          ...createMockModel(['const x = 1;'.repeat(10)]),
          onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
        };
        const mockEditor = {
          getModel: () => mockModel,
          onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
        };
        const mockMonaco = createMockMonaco();

        detector.setupAutoAnalysis(mockEditor as any, mockMonaco as any);

        // Wait for initial analysis
        await vi.advanceTimersByTimeAsync(0);

        expect(mockDetectBugs).toHaveBeenCalled();
      });

      it('should return empty disposable if no model', () => {
        const detector = new BugDetector();

        const mockEditor = {
          getModel: () => null,
        };
        const mockMonaco = createMockMonaco();

        const disposable = detector.setupAutoAnalysis(mockEditor as any, mockMonaco as any);

        expect(disposable).toHaveProperty('dispose');
        disposable.dispose(); // Should not throw
      });

      it('should clean up on dispose', () => {
        const detector = new BugDetector({ enabled: true, autoAnalyze: true });

        mockDetectBugs.mockResolvedValue({
          bugs: [],
          analysis_time_ms: 50,
        });

        const contentDispose = vi.fn();
        const keyDownDispose = vi.fn();
        const mockModel = {
          ...createMockModel(['const x = 1;'.repeat(10)]),
          onDidChangeContent: vi.fn(() => ({ dispose: contentDispose })),
        };
        const mockEditor = {
          getModel: () => mockModel,
          onKeyDown: vi.fn(() => ({ dispose: keyDownDispose })),
        };
        const mockMonaco = createMockMonaco();

        const disposable = detector.setupAutoAnalysis(mockEditor as any, mockMonaco as any);
        disposable.dispose();

        expect(contentDispose).toHaveBeenCalled();
        expect(keyDownDispose).toHaveBeenCalled();
        expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalledWith(
          mockModel,
          'ai-bug-detector',
          []
        );
      });
    });
  });

  // ============================================================================
  // Singleton Instance Tests
  // ============================================================================

  describe('getBugDetector', () => {
    it('should return singleton instance', () => {
      const instance1 = getBugDetector();
      const instance2 = getBugDetector();

      expect(instance1).toBe(instance2);
    });

    it('should return BugDetector instance', () => {
      const instance = getBugDetector();
      expect(instance).toBeInstanceOf(BugDetector);
    });
  });

  // ============================================================================
  // CSS Styles Tests
  // ============================================================================

  describe('bugGlyphStyles', () => {
    it('should export CSS styles', () => {
      expect(typeof bugGlyphStyles).toBe('string');
    });

    it('should include bug-glyph class', () => {
      expect(bugGlyphStyles).toContain('.bug-glyph');
    });

    it('should include bug-glyph-error class', () => {
      expect(bugGlyphStyles).toContain('.bug-glyph-error');
    });

    it('should include bug-glyph-warning class', () => {
      expect(bugGlyphStyles).toContain('.bug-glyph-warning');
    });

    it('should include bug-glyph-info class', () => {
      expect(bugGlyphStyles).toContain('.bug-glyph-info');
    });

    it('should define error color', () => {
      expect(bugGlyphStyles).toContain('#ef4444');
    });

    it('should define warning color', () => {
      expect(bugGlyphStyles).toContain('#f59e0b');
    });

    it('should define info color', () => {
      expect(bugGlyphStyles).toContain('#00e5ff');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockModel(lines: string[]) {
  return {
    getLineCount: () => lines.length,
    getLineContent: (lineNum: number) => lines[lineNum - 1] || '',
    getLanguageId: () => 'typescript',
    getValue: () => lines.join('\n'),
    uri: {
      path: '/test/file.ts',
      toString: () => 'file:///test/file.ts',
    },
  };
}

function createMockMonaco() {
  return {
    editor: {
      setModelMarkers: vi.fn(),
      getModels: vi.fn(() => []),
    },
  };
}
