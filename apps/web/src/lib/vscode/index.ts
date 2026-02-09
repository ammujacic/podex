/**
 * VS Code editor integration using @codingame/monaco-vscode-api.
 *
 * This module provides a Monaco editor with full VS Code API compatibility,
 * enabling support for real VS Code extensions from Open VSX.
 */

export {
  initializeVSCodeServices,
  areServicesInitialized,
  getInitializationPromise,
} from './initServices';

export { getLanguageFromPath } from './languageUtils';

export { VSCodeEditor, type VSCodeEditorProps, type VSCodeEditorRef } from './VSCodeEditor';
