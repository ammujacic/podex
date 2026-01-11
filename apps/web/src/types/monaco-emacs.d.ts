declare module 'monaco-emacs' {
  import type { editor } from 'monaco-editor';

  export interface EmacsExtensionInstance {
    start: () => void;
    dispose: () => void;
  }

  export class EmacsExtension implements EmacsExtensionInstance {
    constructor(editor: editor.IStandaloneCodeEditor);
    start(): void;
    dispose(): void;
  }
}
