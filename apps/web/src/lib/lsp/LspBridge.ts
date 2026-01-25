/**
 * LSP-Monaco Bridge
 *
 * Bridges LSP protocol responses to Monaco editor providers,
 * enabling IntelliSense features powered by real language servers.
 */

import type * as monaco from '@codingame/monaco-vscode-editor-api';
import type {
  editor,
  languages,
  Position as MonacoPosition,
  CancellationToken,
  IRange,
} from '@codingame/monaco-vscode-editor-api';
import type { LspClient } from './LspClient';
import {
  createLspClient,
  disconnectLspClient,
  type Position,
  type CompletionItem,
  type CompletionList,
  type Location,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from './LspClient';

// ============================================================================
// Types
// ============================================================================

export interface LspBridgeConfig {
  wsUrl: string;
  workspaceId: string;
  rootUri: string;
}

// ============================================================================
// Conversion Utilities
// ============================================================================

function monacoToLspPosition(position: MonacoPosition): Position {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  };
}

function lspToMonacoRange(range: { start: Position; end: Position }): IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function lspCompletionKindToMonaco(kind?: number): languages.CompletionItemKind {
  // LSP CompletionItemKind to Monaco CompletionItemKind
  const kindMap: Record<number, languages.CompletionItemKind> = {
    1: 0, // Text
    2: 1, // Method
    3: 2, // Function
    4: 3, // Constructor
    5: 4, // Field
    6: 5, // Variable
    7: 6, // Class
    8: 7, // Interface
    9: 8, // Module
    10: 9, // Property
    11: 10, // Unit
    12: 11, // Value
    13: 12, // Enum
    14: 13, // Keyword
    15: 14, // Snippet
    16: 15, // Color
    17: 16, // File
    18: 17, // Reference
    19: 18, // Folder
    20: 19, // EnumMember
    21: 20, // Constant
    22: 21, // Struct
    23: 22, // Event
    24: 23, // Operator
    25: 24, // TypeParameter
  };
  return kindMap[kind || 1] ?? 0;
}

function lspDiagnosticSeverityToMonaco(severity?: number): number {
  switch (severity) {
    case 1:
      return 8; // Error
    case 2:
      return 4; // Warning
    case 3:
      return 2; // Information
    case 4:
      return 1; // Hint
    default:
      return 2;
  }
}

function extractMarkdownContent(
  content:
    | string
    | { kind: string; value: string }
    | Array<string | { kind: string; value: string }>
): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c.value)).join('\n\n');
  }
  return content.value;
}

// ============================================================================
// LSP Bridge Class
// ============================================================================

export class LspBridge {
  private config: LspBridgeConfig;
  private clients = new Map<string, LspClient>();
  private disposables: Array<{ dispose: () => void }> = [];
  private monacoInstance: typeof monaco | null = null;

  constructor(config: LspBridgeConfig) {
    this.config = config;
  }

  /**
   * Initialize the bridge with Monaco
   */
  initialize(monacoRef: typeof monaco): void {
    this.monacoInstance = monacoRef;
  }

  /**
   * Connect to LSP server for a language
   */
  async connectLanguage(language: string): Promise<LspClient> {
    if (this.clients.has(language)) {
      return this.clients.get(language)!;
    }

    const client = createLspClient({
      wsUrl: this.config.wsUrl,
      workspaceId: this.config.workspaceId,
      language,
      rootUri: this.config.rootUri,
      onDiagnostics: (params) => this.handleDiagnostics(params),
      onError: (error) => console.error('LSP error:', error),
      onConnectionChange: (_connected) => {
        // LSP connection state changed
      },
    });

    await client.connect();
    this.clients.set(language, client);

    // Register Monaco providers for this language
    this.registerProviders(language, client);

    return client;
  }

  /**
   * Disconnect from LSP server for a language
   */
  disconnectLanguage(language: string): void {
    const client = this.clients.get(language);
    if (client) {
      client.disconnect();
      this.clients.delete(language);
      disconnectLspClient(this.config.workspaceId, language);
    }
  }

  /**
   * Disconnect all languages
   */
  disconnectAll(): void {
    for (const [language] of this.clients) {
      this.disconnectLanguage(language);
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /**
   * Handle diagnostics from LSP server
   */
  private handleDiagnostics(params: PublishDiagnosticsParams): void {
    if (!this.monacoInstance) return;

    const model = this.monacoInstance.editor
      .getModels()
      .find((m) => m.uri.toString() === params.uri);
    if (!model) return;

    const markers = params.diagnostics.map((d: Diagnostic) => ({
      severity: lspDiagnosticSeverityToMonaco(d.severity),
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      message: d.message,
      source: d.source || 'lsp',
      code: d.code?.toString(),
    }));

    this.monacoInstance.editor.setModelMarkers(model, 'lsp', markers);
  }

  /**
   * Register Monaco language providers
   */
  private registerProviders(language: string, client: LspClient): void {
    if (!this.monacoInstance) return;

    // Completion Provider
    this.disposables.push(
      this.monacoInstance.languages.registerCompletionItemProvider(language, {
        triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '#'],
        provideCompletionItems: async (
          model: editor.ITextModel,
          position: MonacoPosition,
          _context: languages.CompletionContext,
          _token: CancellationToken
        ): Promise<languages.CompletionList | null> => {
          try {
            const uri = model.uri.toString();
            const lspPosition = monacoToLspPosition(position);
            const result = await client.getCompletions(uri, lspPosition);

            const items = Array.isArray(result) ? result : (result as CompletionList).items;

            return {
              suggestions: items.map((item: CompletionItem) => {
                const baseItem = {
                  label: item.label,
                  kind: lspCompletionKindToMonaco(item.kind),
                  detail: item.detail,
                  documentation: item.documentation
                    ? { value: extractMarkdownContent(item.documentation) }
                    : undefined,
                  insertText: item.insertText || item.label,
                  insertTextRules:
                    item.insertTextFormat === 2
                      ? 4 // InsertAsSnippet
                      : undefined,
                };
                // Only add range if textEdit is present
                if (item.textEdit) {
                  return { ...baseItem, range: lspToMonacoRange(item.textEdit.range) };
                }
                return baseItem;
              }) as languages.CompletionItem[],
            };
          } catch {
            // LSP completion not available for this context
            return null;
          }
        },
      })
    );

    // Hover Provider
    this.disposables.push(
      this.monacoInstance.languages.registerHoverProvider(language, {
        provideHover: async (
          model: editor.ITextModel,
          position: MonacoPosition,
          _token: CancellationToken
        ): Promise<languages.Hover | null> => {
          try {
            const uri = model.uri.toString();
            const lspPosition = monacoToLspPosition(position);
            const hover = await client.getHover(uri, lspPosition);

            if (!hover) return null;

            return {
              contents: [{ value: extractMarkdownContent(hover.contents) }],
              range: hover.range ? lspToMonacoRange(hover.range) : undefined,
            };
          } catch {
            // LSP hover not available for this context
            return null;
          }
        },
      })
    );

    // Definition Provider
    this.disposables.push(
      this.monacoInstance.languages.registerDefinitionProvider(language, {
        provideDefinition: async (
          model: editor.ITextModel,
          position: MonacoPosition,
          _token: CancellationToken
        ): Promise<languages.Definition | null> => {
          try {
            const uri = model.uri.toString();
            const lspPosition = monacoToLspPosition(position);
            const result = await client.getDefinition(uri, lspPosition);

            if (!result) return null;

            const locations = Array.isArray(result) ? result : [result];
            return locations.map((loc: Location) => ({
              uri: this.monacoInstance!.Uri.parse(loc.uri),
              range: lspToMonacoRange(loc.range),
            }));
          } catch {
            // LSP definition not available for this context
            return null;
          }
        },
      })
    );

    // References Provider
    this.disposables.push(
      this.monacoInstance.languages.registerReferenceProvider(language, {
        provideReferences: async (
          model: editor.ITextModel,
          position: MonacoPosition,
          context: languages.ReferenceContext,
          _token: CancellationToken
        ): Promise<languages.Location[] | null> => {
          try {
            const uri = model.uri.toString();
            const lspPosition = monacoToLspPosition(position);
            const result = await client.getReferences(uri, lspPosition, context.includeDeclaration);

            return result.map((loc: Location) => ({
              uri: this.monacoInstance!.Uri.parse(loc.uri),
              range: lspToMonacoRange(loc.range),
            }));
          } catch {
            // LSP references not available for this context
            return null;
          }
        },
      })
    );

    // Signature Help Provider
    this.disposables.push(
      this.monacoInstance.languages.registerSignatureHelpProvider(language, {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: async (
          model: editor.ITextModel,
          position: MonacoPosition,
          _token: CancellationToken,
          _context: languages.SignatureHelpContext
        ): Promise<languages.SignatureHelpResult | null> => {
          try {
            const uri = model.uri.toString();
            const lspPosition = monacoToLspPosition(position);
            const result = await client.getSignatureHelp(uri, lspPosition);

            if (!result) return null;

            return {
              value: {
                signatures: result.signatures.map((sig) => ({
                  label: sig.label,
                  documentation: sig.documentation ? { value: sig.documentation } : undefined,
                  parameters:
                    sig.parameters?.map((p) => ({
                      label: p.label,
                      documentation: p.documentation ? { value: p.documentation } : undefined,
                    })) || [],
                })),
                activeSignature: result.activeSignature ?? 0,
                activeParameter: result.activeParameter ?? 0,
              },
              dispose: () => {},
            };
          } catch {
            // LSP signature help not available for this context
            return null;
          }
        },
      })
    );

    // Rename Provider
    this.disposables.push(
      this.monacoInstance.languages.registerRenameProvider(language, {
        provideRenameEdits: async (
          model: editor.ITextModel,
          position: MonacoPosition,
          newName: string,
          _token: CancellationToken
        ): Promise<languages.WorkspaceEdit | null> => {
          try {
            const uri = model.uri.toString();
            const lspPosition = monacoToLspPosition(position);
            const result = await client.rename(uri, lspPosition, newName);

            // Convert LSP WorkspaceEdit to Monaco WorkspaceEdit
            // This is a simplified version
            return result as languages.WorkspaceEdit;
          } catch {
            // LSP rename not available for this context
            return null;
          }
        },
      })
    );

    // Document Formatting Provider
    this.disposables.push(
      this.monacoInstance.languages.registerDocumentFormattingEditProvider(language, {
        provideDocumentFormattingEdits: async (
          model: editor.ITextModel,
          _options: languages.FormattingOptions,
          _token: CancellationToken
        ): Promise<languages.TextEdit[] | null> => {
          try {
            const uri = model.uri.toString();
            const result = (await client.formatDocument(uri)) as {
              range: { start: Position; end: Position };
              newText: string;
            }[];

            return result.map((edit) => ({
              range: lspToMonacoRange(edit.range),
              text: edit.newText,
            }));
          } catch (error) {
            console.error('Format error:', error);
            return null;
          }
        },
      })
    );
  }

  /**
   * Sync a document to the LSP server
   */
  syncDocument(uri: string, languageId: string, text: string): void {
    const client = this.clients.get(languageId);
    if (client) {
      client.didOpen(uri, languageId, text);
    }
  }

  /**
   * Notify document change
   */
  notifyChange(uri: string, languageId: string, text: string): void {
    const client = this.clients.get(languageId);
    if (client) {
      client.didChange(uri, text);
    }
  }

  /**
   * Notify document save
   */
  notifySave(uri: string, languageId: string, text?: string): void {
    const client = this.clients.get(languageId);
    if (client) {
      client.didSave(uri, text);
    }
  }

  /**
   * Notify document close
   */
  notifyClose(uri: string, languageId: string): void {
    const client = this.clients.get(languageId);
    if (client) {
      client.didClose(uri);
    }
  }
}

// ============================================================================
// React Hook
// ============================================================================

import { useEffect, useRef } from 'react';

export function useLspBridge(
  monacoInstance: typeof monaco | null,
  config: LspBridgeConfig | null,
  languages: string[] = ['typescript', 'javascript', 'python']
): LspBridge | null {
  const bridgeRef = useRef<LspBridge | null>(null);
  const languagesKey = languages.join(',');

  useEffect(() => {
    if (!monacoInstance || !config) {
      bridgeRef.current?.disconnectAll();
      bridgeRef.current = null;
      return;
    }

    const bridge = new LspBridge(config);
    bridge.initialize(monacoInstance);
    bridgeRef.current = bridge;

    // Connect to all specified languages
    Promise.all(languages.map((lang) => bridge.connectLanguage(lang).catch(console.error)));

    return () => {
      bridge.disconnectAll();
      bridgeRef.current = null;
    };
  }, [monacoInstance, config, languages, languagesKey]);

  return bridgeRef.current;
}
