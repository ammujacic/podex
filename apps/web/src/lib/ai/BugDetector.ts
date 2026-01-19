/**
 * AI Bug Detector
 *
 * Analyzes code for potential bugs and displays them as Monaco decorations.
 * Runs automatically on file save or after a typing pause.
 */

import type * as monaco from '@codingame/monaco-vscode-editor-api';
import type { editor } from '@codingame/monaco-vscode-editor-api';

// ============================================================================
// Types
// ============================================================================

export interface DetectedBug {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

export interface BugDetectionResult {
  bugs: DetectedBug[];
  analysisTimeMs: number;
}

export interface BugDetectorConfig {
  apiUrl: string;
  debounceMs: number;
  enabled: boolean;
  minCodeLength: number;
  autoAnalyze: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: BugDetectorConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  debounceMs: 5000, // 5 seconds after typing stops
  enabled: true,
  minCodeLength: 50,
  autoAnalyze: true,
};

// ============================================================================
// Bug Detector Class
// ============================================================================

export class BugDetector {
  private config: BugDetectorConfig;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingRequests: Map<string, AbortController> = new Map();

  constructor(config: Partial<BugDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BugDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Analyze code for bugs
   */
  async analyze(code: string, language: string): Promise<BugDetectionResult> {
    if (code.length < this.config.minCodeLength) {
      return { bugs: [], analysisTimeMs: 0 };
    }

    const controller = new AbortController();

    try {
      const response = await fetch(`${this.config.apiUrl}/api/completion/detect-bugs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          language,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn('Bug detection API error:', response.status);
        return { bugs: [], analysisTimeMs: 0 };
      }

      const data = await response.json();
      return {
        bugs: data.bugs || [],
        analysisTimeMs: data.analysis_time_ms || 0,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { bugs: [], analysisTimeMs: 0 };
      }
      console.warn('Bug detection error:', error);
      return { bugs: [], analysisTimeMs: 0 };
    }
  }

  /**
   * Convert detected bugs to Monaco markers
   */
  bugsToMarkers(bugs: DetectedBug[], model: editor.ITextModel): editor.IMarkerData[] {
    return bugs.map((bug) => {
      const lineContent = model.getLineContent(bug.line);
      const endColumn = lineContent.length + 1;

      return {
        severity: this.severityToMonaco(bug.severity),
        message: bug.message + (bug.suggestion ? `\n\nSuggestion: ${bug.suggestion}` : ''),
        startLineNumber: bug.line,
        startColumn: bug.column,
        endLineNumber: bug.line,
        endColumn: endColumn,
        source: 'AI Bug Detector',
      };
    });
  }

  /**
   * Convert severity to Monaco MarkerSeverity
   */
  private severityToMonaco(severity: 'error' | 'warning' | 'info'): number {
    // Monaco MarkerSeverity values
    switch (severity) {
      case 'error':
        return 8; // MarkerSeverity.Error
      case 'warning':
        return 4; // MarkerSeverity.Warning
      case 'info':
        return 2; // MarkerSeverity.Info
      default:
        return 2;
    }
  }

  /**
   * Create Monaco decorations for bugs
   */
  createDecorations(
    bugs: DetectedBug[],
    editor: editor.IStandaloneCodeEditor
  ): editor.IEditorDecorationsCollection {
    const decorations = bugs.map((bug) => ({
      range: {
        startLineNumber: bug.line,
        startColumn: 1,
        endLineNumber: bug.line,
        endColumn: 1,
      },
      options: {
        isWholeLine: false,
        glyphMarginClassName: this.getGlyphClass(bug.severity),
        glyphMarginHoverMessage: {
          value: `**${bug.severity.toUpperCase()}**: ${bug.message}${
            bug.suggestion ? `\n\n*Suggestion:* ${bug.suggestion}` : ''
          }`,
        },
        overviewRuler: {
          color: this.getSeverityColor(bug.severity),
          position: 4, // Right
        },
      },
    }));

    return editor.createDecorationsCollection(decorations);
  }

  /**
   * Get glyph margin class for severity
   */
  private getGlyphClass(severity: 'error' | 'warning' | 'info'): string {
    return `bug-glyph bug-glyph-${severity}`;
  }

  /**
   * Get color for severity
   */
  private getSeverityColor(severity: 'error' | 'warning' | 'info'): string {
    switch (severity) {
      case 'error':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'info':
        return '#00e5ff';
      default:
        return '#9898a8';
    }
  }

  /**
   * Analyze and update markers for an editor
   */
  async analyzeAndUpdate(
    editor: editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco
  ): Promise<DetectedBug[]> {
    const model = editor.getModel();
    if (!model) return [];

    const code = model.getValue();
    const language = model.getLanguageId();
    const modelUri = model.uri.toString();

    // Cancel any pending request for this model
    const existingController = this.pendingRequests.get(modelUri);
    if (existingController) {
      existingController.abort();
    }

    // Analyze the code
    const result = await this.analyze(code, language);

    // Update Monaco markers
    const markers = this.bugsToMarkers(result.bugs, model);
    monacoInstance.editor.setModelMarkers(model, 'ai-bug-detector', markers);

    return result.bugs;
  }

  /**
   * Schedule analysis with debounce
   */
  scheduleAnalysis(
    editorInstance: editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco
  ): void {
    if (!this.config.enabled || !this.config.autoAnalyze) return;

    const model = editorInstance.getModel();
    if (!model) return;

    const modelUri = model.uri.toString();

    // Clear existing timer
    const existingTimer = this.debounceTimers.get(modelUri);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new analysis
    const timer = setTimeout(() => {
      this.analyzeAndUpdate(editorInstance, monacoInstance);
      this.debounceTimers.delete(modelUri);
    }, this.config.debounceMs);

    this.debounceTimers.set(modelUri, timer);
  }

  /**
   * Clear all analysis timers and markers
   */
  clearAll(monacoInstance: typeof monaco): void {
    // Clear all timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Cancel all pending requests
    for (const controller of this.pendingRequests.values()) {
      controller.abort();
    }
    this.pendingRequests.clear();

    // Clear all markers
    for (const model of monacoInstance.editor.getModels()) {
      monacoInstance.editor.setModelMarkers(model, 'ai-bug-detector', []);
    }
  }

  /**
   * Setup auto-analysis for an editor
   */
  setupAutoAnalysis(
    editorInstance: editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco
  ): { dispose: () => void } {
    const model = editorInstance.getModel();
    if (!model) {
      return { dispose: () => {} };
    }

    // Analyze on content change (debounced)
    const contentChangeDisposable = model.onDidChangeContent(() => {
      this.scheduleAnalysis(editorInstance, monacoInstance);
    });

    // Analyze immediately on save
    const saveDisposable = editorInstance.onKeyDown((e) => {
      // Ctrl/Cmd + S
      if ((e.ctrlKey || e.metaKey) && e.keyCode === 49) {
        // KeyCode.KeyS
        this.analyzeAndUpdate(editorInstance, monacoInstance);
      }
    });

    // Initial analysis
    this.analyzeAndUpdate(editorInstance, monacoInstance);

    return {
      dispose: () => {
        contentChangeDisposable.dispose();
        saveDisposable.dispose();

        const modelUri = model.uri.toString();

        // Clear timer for this model
        const timer = this.debounceTimers.get(modelUri);
        if (timer) {
          clearTimeout(timer);
          this.debounceTimers.delete(modelUri);
        }

        // Clear markers for this model
        monacoInstance.editor.setModelMarkers(model, 'ai-bug-detector', []);
      },
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let bugDetectorInstance: BugDetector | null = null;

export function getBugDetector(): BugDetector {
  if (!bugDetectorInstance) {
    bugDetectorInstance = new BugDetector();
  }
  return bugDetectorInstance;
}

// ============================================================================
// CSS for Bug Glyphs
// ============================================================================

export const bugGlyphStyles = `
  .bug-glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    margin-left: 2px;
  }

  .bug-glyph::before {
    content: '';
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .bug-glyph-error::before {
    background-color: #ef4444;
    box-shadow: 0 0 4px #ef4444;
  }

  .bug-glyph-warning::before {
    background-color: #f59e0b;
    box-shadow: 0 0 4px #f59e0b;
  }

  .bug-glyph-info::before {
    background-color: #00e5ff;
    box-shadow: 0 0 4px #00e5ff;
  }
`;

// ============================================================================
// React Hook
// ============================================================================

import { useEffect, useRef } from 'react';

export function useBugDetector(
  editorInstance: editor.IStandaloneCodeEditor | null,
  monacoInstance: typeof monaco | null,
  enabled: boolean = true
): void {
  const disposableRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    if (!editorInstance || !monacoInstance || !enabled) {
      disposableRef.current?.dispose();
      disposableRef.current = null;
      return;
    }

    const detector = getBugDetector();
    detector.updateConfig({ enabled });
    disposableRef.current = detector.setupAutoAnalysis(editorInstance, monacoInstance);

    return () => {
      disposableRef.current?.dispose();
      disposableRef.current = null;
    };
  }, [editorInstance, monacoInstance, enabled]);
}
