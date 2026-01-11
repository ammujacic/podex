declare module 'monaco-vim' {
  import type { editor } from 'monaco-editor';

  export interface VimModeInstance {
    dispose: () => void;
  }

  export interface VimStatic {
    defineEx: (name: string, alias: string, callback: () => void) => void;
    map: (keys: string, cmd: string, context?: string) => void;
  }

  export interface VimModeClass {
    Vim: VimStatic;
  }

  export function initVimMode(
    editor: editor.IStandaloneCodeEditor,
    statusBar: HTMLElement
  ): VimModeInstance;

  export const VimMode: VimModeClass;
}
