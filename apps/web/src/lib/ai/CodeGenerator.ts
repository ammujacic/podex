/**
 * AI Code Generator
 *
 * Detects TODO comments and special generation markers in code,
 * then offers to generate code based on the comment description.
 */

import type * as monaco from '@codingame/monaco-vscode-editor-api';
import type {
  editor,
  languages,
  CancellationToken,
  IRange,
} from '@codingame/monaco-vscode-editor-api';

// ============================================================================
// Types
// ============================================================================

export interface GenerationMarker {
  line: number;
  column: number;
  endColumn: number;
  type: 'todo' | 'generate' | 'implement';
  description: string;
}

export interface GenerationRequest {
  prefix: string;
  description: string;
  suffix: string;
  language: string;
}

export interface GenerationResult {
  code: string;
  explanation: string;
}

export interface CodeGeneratorConfig {
  apiUrl: string;
  enabled: boolean;
  patterns: RegExp[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CodeGeneratorConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  enabled: true,
  patterns: [
    /\/\/\s*TODO:\s*(.+)$/i, // // TODO: description
    /\/\/\s*GENERATE:\s*(.+)$/i, // // GENERATE: description
    /\/\/\s*IMPLEMENT:\s*(.+)$/i, // // IMPLEMENT: description
    /#\s*TODO:\s*(.+)$/i, // # TODO: description (Python)
    /#\s*GENERATE:\s*(.+)$/i, // # GENERATE: description
    /\/\*\s*TODO:\s*(.+?)\s*\*\//i, // /* TODO: description */
    /\/\*\s*GENERATE:\s*(.+?)\s*\*\//i, // /* GENERATE: description */
  ],
};

// ============================================================================
// Code Generator Class
// ============================================================================

export class CodeGenerator {
  private config: CodeGeneratorConfig;

  constructor(config: Partial<CodeGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CodeGeneratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Find generation markers in code
   */
  findMarkers(model: editor.ITextModel): GenerationMarker[] {
    const markers: GenerationMarker[] = [];
    const lineCount = model.getLineCount();

    for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
      const lineContent = model.getLineContent(lineNum);

      for (const pattern of this.config.patterns) {
        const match = lineContent.match(pattern);
        const fullMatch = match?.[0];
        const captureGroup = match?.[1];
        if (match && fullMatch && captureGroup) {
          const description = captureGroup.trim();
          const startColumn = lineContent.indexOf(fullMatch) + 1;

          let type: 'todo' | 'generate' | 'implement' = 'todo';
          if (lineContent.toLowerCase().includes('generate')) {
            type = 'generate';
          } else if (lineContent.toLowerCase().includes('implement')) {
            type = 'implement';
          }

          markers.push({
            line: lineNum,
            column: startColumn,
            endColumn: startColumn + fullMatch.length,
            type,
            description,
          });
          break; // Only match first pattern per line
        }
      }
    }

    return markers;
  }

  /**
   * Generate code from description
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    try {
      // Use the completion endpoint with a modified prompt
      const response = await fetch(`${this.config.apiUrl}/api/completion/inline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prefix: request.prefix + `\n// ${request.description}\n`,
          suffix: request.suffix,
          language: request.language,
          max_tokens: 512, // More tokens for generation
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate code');
      }

      const data = await response.json();
      return {
        code: data.completion || '',
        explanation: '',
      };
    } catch (error) {
      console.error('Code generation error:', error);
      return { code: '', explanation: '' };
    }
  }

  /**
   * Create code action provider for Monaco
   */
  createCodeActionProvider(): languages.CodeActionProvider {
    return {
      provideCodeActions: (
        model: editor.ITextModel,
        range: IRange,
        _context: languages.CodeActionContext,
        _token: CancellationToken
      ): languages.ProviderResult<languages.CodeActionList> => {
        const markers = this.findMarkers(model);
        const actions: languages.CodeAction[] = [];

        // Find markers on the current line
        const currentLineMarkers = markers.filter(
          (m) => m.line >= range.startLineNumber && m.line <= range.endLineNumber
        );

        for (const marker of currentLineMarkers) {
          actions.push({
            title: `Generate: ${marker.description.slice(0, 50)}${marker.description.length > 50 ? '...' : ''}`,
            kind: 'quickfix',
            isPreferred: true,
            command: {
              id: 'ai.generateFromComment',
              title: 'Generate Code',
              arguments: [
                {
                  line: marker.line,
                  description: marker.description,
                },
              ],
            },
          });
        }

        return {
          actions,
          dispose: () => {},
        };
      },
    };
  }

  /**
   * Create decorations for generation markers
   */
  createDecorations(
    markers: GenerationMarker[],
    editor: editor.IStandaloneCodeEditor
  ): editor.IEditorDecorationsCollection {
    const decorations = markers.map((marker) => ({
      range: {
        startLineNumber: marker.line,
        startColumn: marker.column,
        endLineNumber: marker.line,
        endColumn: marker.endColumn,
      },
      options: {
        inlineClassName: 'generate-marker',
        glyphMarginClassName: 'generate-glyph',
        glyphMarginHoverMessage: {
          value: `**Generate Code**\n\nClick the lightbulb or press Ctrl+. to generate code for:\n\n*${marker.description}*`,
        },
        after: {
          content: ' ✨',
          inlineClassName: 'generate-indicator',
        },
      },
    }));

    return editor.createDecorationsCollection(decorations);
  }

  /**
   * Register generator with Monaco
   */
  register(monacoInstance: typeof monaco, languages?: string[]): { dispose: () => void } {
    const targetLanguages = languages || [
      'typescript',
      'javascript',
      'python',
      'go',
      'rust',
      'java',
    ];

    const disposables: Array<{ dispose: () => void }> = [];

    // Register code action provider for each language
    for (const lang of targetLanguages) {
      const disposable = monacoInstance.languages.registerCodeActionProvider(
        lang,
        this.createCodeActionProvider()
      );
      disposables.push(disposable);
    }

    // Register the command
    const commandDisposable = monacoInstance.editor.registerCommand(
      'ai.generateFromComment',
      async (_accessor, args) => {
        const { line, description, editorId } = args as {
          line: number;
          description: string;
          editorId?: string;
        };
        // Get editor by ID if provided, or find first available editor
        const editors = monacoInstance.editor.getEditors();
        const activeEditor = editorId ? editors.find((e) => e.getId() === editorId) : editors[0];
        if (!activeEditor) return;

        const model = activeEditor.getModel();
        if (!model) return;

        // Get context around the line
        const lineCount = model.getLineCount();
        const prefixEnd = line;
        const suffixStart = line + 1;

        const prefix = model.getValueInRange({
          startLineNumber: Math.max(1, prefixEnd - 30),
          startColumn: 1,
          endLineNumber: prefixEnd,
          endColumn: model.getLineMaxColumn(prefixEnd),
        });

        const suffix = model.getValueInRange({
          startLineNumber: suffixStart,
          startColumn: 1,
          endLineNumber: Math.min(lineCount, suffixStart + 10),
          endColumn: model.getLineMaxColumn(Math.min(lineCount, suffixStart + 10)),
        });

        // Generate code
        const result = await this.generate({
          prefix,
          description,
          suffix,
          language: model.getLanguageId(),
        });

        if (result.code) {
          // Insert the generated code
          const insertPosition = {
            lineNumber: line + 1,
            column: 1,
          };

          activeEditor.executeEdits('ai-generator', [
            {
              range: {
                startLineNumber: insertPosition.lineNumber,
                startColumn: 1,
                endLineNumber: insertPosition.lineNumber,
                endColumn: 1,
              },
              text: result.code + '\n',
            },
          ]);
        }
      }
    );
    disposables.push(commandDisposable);

    return {
      dispose: () => {
        disposables.forEach((d) => d.dispose());
      },
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let codeGeneratorInstance: CodeGenerator | null = null;

export function getCodeGenerator(): CodeGenerator {
  if (!codeGeneratorInstance) {
    codeGeneratorInstance = new CodeGenerator();
  }
  return codeGeneratorInstance;
}

// ============================================================================
// CSS for Generation Markers
// ============================================================================

export const generatorStyles = `
  .generate-marker {
    background-color: rgba(168, 85, 247, 0.15);
    border-bottom: 1px dashed #a855f7;
  }

  .generate-glyph {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .generate-glyph::before {
    content: '✨';
    font-size: 12px;
  }

  .generate-indicator {
    color: #a855f7;
    font-size: 10px;
  }
`;

// ============================================================================
// React Hook
// ============================================================================

import { useEffect, useRef } from 'react';

export function useCodeGenerator(
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

    const generator = getCodeGenerator();
    generator.updateConfig({ enabled });
    disposableRef.current = generator.register(monacoInstance);

    return () => {
      disposableRef.current?.dispose();
      disposableRef.current = null;
    };
  }, [monacoInstance, enabled]);
}
