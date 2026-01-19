/**
 * Snippet Manager for Monaco Editor
 *
 * Handles snippet storage, expansion, and integration with Monaco's
 * completion provider system.
 */

import * as monaco from '@codingame/monaco-vscode-editor-api';

// ============================================================================
// Types
// ============================================================================

export interface Snippet {
  prefix: string;
  name: string;
  description: string;
  body: string | string[];
  scope?: string[]; // Language IDs this snippet applies to
  isUserDefined?: boolean;
}

export interface SnippetCollection {
  [key: string]: Snippet;
}

export interface SnippetRegistry {
  [language: string]: SnippetCollection;
}

// ============================================================================
// Snippet Manager Class
// ============================================================================

export class SnippetManager {
  private snippets: SnippetRegistry = {};
  private userSnippets: SnippetRegistry = {};
  private disposables: Array<{ dispose: () => void }> = [];

  /**
   * Register built-in snippets for a language
   */
  registerSnippets(language: string, snippets: SnippetCollection): void {
    if (!this.snippets[language]) {
      this.snippets[language] = {};
    }
    Object.assign(this.snippets[language], snippets);
  }

  /**
   * Register user-defined snippets
   */
  registerUserSnippets(language: string, snippets: SnippetCollection): void {
    if (!this.userSnippets[language]) {
      this.userSnippets[language] = {};
    }
    Object.assign(this.userSnippets[language], snippets);
  }

  /**
   * Get all snippets for a language (user snippets take precedence)
   */
  getSnippetsForLanguage(language: string): Snippet[] {
    const builtIn = this.snippets[language] || {};
    const user = this.userSnippets[language] || {};
    const all = { ...builtIn, ...user };

    // Also include global snippets (scope: all or undefined)
    for (const lang of Object.keys(this.snippets)) {
      const langSnippets = this.snippets[lang];
      if (!langSnippets) continue;
      for (const [key, snippet] of Object.entries(langSnippets)) {
        if (snippet.scope?.includes('*') || snippet.scope?.includes(language)) {
          all[`${lang}:${key}`] = snippet;
        }
      }
    }

    return Object.values(all);
  }

  /**
   * Find snippets matching a prefix
   */
  findMatchingSnippets(language: string, prefix: string): Snippet[] {
    const snippets = this.getSnippetsForLanguage(language);
    const lowerPrefix = prefix.toLowerCase();

    return snippets.filter(
      (s) =>
        s.prefix.toLowerCase().startsWith(lowerPrefix) || s.name.toLowerCase().includes(lowerPrefix)
    );
  }

  /**
   * Expand a snippet body with tab stops and placeholders
   */
  expandSnippetBody(body: string | string[]): string {
    const text = Array.isArray(body) ? body.join('\n') : body;
    // Monaco handles the snippet syntax, just return as-is
    return text;
  }

  /**
   * Convert snippets to Monaco completion items
   */
  toCompletionItems(
    snippets: Snippet[],
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }
  ): monaco.languages.CompletionItem[] {
    return snippets.map((snippet) => ({
      label: snippet.prefix,
      kind: monaco.languages.CompletionItemKind.Snippet,
      documentation: {
        value: `**${snippet.name}**\n\n${snippet.description}\n\n\`\`\`\n${this.expandSnippetBody(snippet.body)}\n\`\`\``,
      },
      insertText: this.expandSnippetBody(snippet.body),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      detail: snippet.isUserDefined ? 'User Snippet' : 'Built-in',
      sortText: snippet.isUserDefined ? '0' : '1', // User snippets first
    }));
  }

  /**
   * Register as a Monaco completion provider
   */
  registerCompletionProvider(monacoInstance: typeof monaco, language: string | string[]): void {
    const languageIds = Array.isArray(language) ? language : [language];

    for (const lang of languageIds) {
      const disposable = monacoInstance.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['!', '.', '@'],
        provideCompletionItems: (
          model: monaco.editor.ITextModel,
          position: monaco.Position
        ): monaco.languages.ProviderResult<monaco.languages.CompletionList> => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          };

          const snippets = this.findMatchingSnippets(lang, word.word);
          const suggestions = this.toCompletionItems(snippets, range);

          return { suggestions };
        },
      });

      this.disposables.push(disposable);
    }
  }

  /**
   * Clean up all registered providers
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  /**
   * Export user snippets to JSON
   */
  exportUserSnippets(): string {
    return JSON.stringify(this.userSnippets, null, 2);
  }

  /**
   * Import user snippets from JSON
   */
  importUserSnippets(json: string): void {
    try {
      const imported = JSON.parse(json) as SnippetRegistry;
      for (const [language, snippets] of Object.entries(imported)) {
        this.registerUserSnippets(language, snippets);
      }
    } catch (error) {
      console.error('Failed to import snippets:', error);
    }
  }
}

// ============================================================================
// Snippet Syntax Reference
// ============================================================================

/**
 * Monaco/VS Code snippet syntax reference:
 *
 * Tab stops:
 *   $1, $2, ... - Tab stops (cursor positions)
 *   $0 - Final cursor position
 *
 * Placeholders:
 *   ${1:default} - Tab stop with default text
 *   ${1|one,two,three|} - Tab stop with choices
 *
 * Variables:
 *   $TM_SELECTED_TEXT - Selected text
 *   $TM_CURRENT_LINE - Current line
 *   $TM_CURRENT_WORD - Current word
 *   $TM_LINE_INDEX - Line number (0-indexed)
 *   $TM_LINE_NUMBER - Line number (1-indexed)
 *   $TM_FILENAME - File name
 *   $TM_FILENAME_BASE - File name without extension
 *   $TM_DIRECTORY - Directory path
 *   $TM_FILEPATH - Full file path
 *   $CLIPBOARD - Clipboard contents
 *   $WORKSPACE_NAME - Workspace name
 *
 * Date/Time:
 *   $CURRENT_YEAR, $CURRENT_YEAR_SHORT
 *   $CURRENT_MONTH, $CURRENT_MONTH_NAME, $CURRENT_MONTH_NAME_SHORT
 *   $CURRENT_DATE, $CURRENT_DAY_NAME, $CURRENT_DAY_NAME_SHORT
 *   $CURRENT_HOUR, $CURRENT_MINUTE, $CURRENT_SECOND
 *   $CURRENT_SECONDS_UNIX
 *
 * Transformations:
 *   ${1/pattern/replacement/flags} - Regex transform
 *   ${TM_FILENAME/(.*)\\..+$/$1/} - Example: file name without extension
 */

// ============================================================================
// Singleton Instance
// ============================================================================

let snippetManagerInstance: SnippetManager | null = null;

export function getSnippetManager(): SnippetManager {
  if (!snippetManagerInstance) {
    snippetManagerInstance = new SnippetManager();
  }
  return snippetManagerInstance;
}
