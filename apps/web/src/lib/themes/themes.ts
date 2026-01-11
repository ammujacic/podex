import type { Theme } from './types';

// ============================================================================
// Terminal Noir (Default Dark Theme)
// ============================================================================

export const terminalNoir: Theme = {
  id: 'terminal-noir',
  name: 'Terminal Noir',
  type: 'dark',
  monacoTheme: 'terminal-noir',
  colors: {
    void: '#0a0a0a',
    surface: '#111111',
    elevated: '#1a1a1a',
    overlay: '#222222',

    textPrimary: '#e4e4e4',
    textSecondary: '#a0a0a0',
    textMuted: '#666666',

    borderDefault: '#333333',
    borderSubtle: '#262626',

    accentPrimary: '#00ff9d',
    accentSecondary: '#00cc7d',
    accentMuted: '#00994d',

    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',

    syntax: {
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      comment: '#6272a4',
      function: '#50fa7b',
      variable: '#f8f8f2',
      type: '#8be9fd',
      operator: '#ff79c6',
      property: '#66d9ef',
      punctuation: '#f8f8f2',
      className: '#8be9fd',
      constant: '#bd93f9',
      parameter: '#ffb86c',
      tag: '#ff79c6',
      attribute: '#50fa7b',
    },

    editor: {
      background: '#0a0a0a',
      foreground: '#e4e4e4',
      lineHighlight: '#1a1a1a',
      selection: '#44475a',
      cursor: '#00ff9d',
      gutterBackground: '#0a0a0a',
      gutterForeground: '#666666',
      lineNumber: '#666666',
      lineNumberActive: '#a0a0a0',
      matchingBracket: '#44475a',
      indentGuide: '#333333',
      activeIndentGuide: '#666666',
      findMatch: '#ffd93d33',
      findMatchHighlight: '#ffd93d22',
    },

    terminal: {
      background: '#0a0a0a',
      foreground: '#e4e4e4',
      cursor: '#00ff9d',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
};

// ============================================================================
// Light Theme
// ============================================================================

export const lightTheme: Theme = {
  id: 'light',
  name: 'Light',
  type: 'light',
  monacoTheme: 'vs',
  colors: {
    void: '#ffffff',
    surface: '#f8f9fa',
    elevated: '#f1f3f5',
    overlay: '#e9ecef',

    textPrimary: '#212529',
    textSecondary: '#495057',
    textMuted: '#adb5bd',

    borderDefault: '#dee2e6',
    borderSubtle: '#e9ecef',

    accentPrimary: '#228be6',
    accentSecondary: '#1c7ed6',
    accentMuted: '#339af0',

    success: '#40c057',
    warning: '#fab005',
    error: '#fa5252',
    info: '#339af0',

    syntax: {
      keyword: '#d73a49',
      string: '#032f62',
      number: '#005cc5',
      comment: '#6a737d',
      function: '#6f42c1',
      variable: '#24292e',
      type: '#22863a',
      operator: '#d73a49',
      property: '#005cc5',
      punctuation: '#24292e',
      className: '#6f42c1',
      constant: '#005cc5',
      parameter: '#e36209',
      tag: '#22863a',
      attribute: '#6f42c1',
    },

    editor: {
      background: '#ffffff',
      foreground: '#24292e',
      lineHighlight: '#f6f8fa',
      selection: '#c8e1ff',
      cursor: '#228be6',
      gutterBackground: '#ffffff',
      gutterForeground: '#babbbc',
      lineNumber: '#babbbc',
      lineNumberActive: '#24292e',
      matchingBracket: '#c8e1ff',
      indentGuide: '#eff1f3',
      activeIndentGuide: '#d7dbe0',
      findMatch: '#ffdf5d66',
      findMatchHighlight: '#ffdf5d44',
    },

    terminal: {
      background: '#ffffff',
      foreground: '#24292e',
      cursor: '#228be6',
      black: '#24292e',
      red: '#d73a49',
      green: '#22863a',
      yellow: '#b08800',
      blue: '#0366d6',
      magenta: '#6f42c1',
      cyan: '#1b7c83',
      white: '#6a737d',
      brightBlack: '#959da5',
      brightRed: '#cb2431',
      brightGreen: '#28a745',
      brightYellow: '#dbab09',
      brightBlue: '#2188ff',
      brightMagenta: '#8a63d2',
      brightCyan: '#3192aa',
      brightWhite: '#d1d5da',
    },
  },
};

// ============================================================================
// Monokai
// ============================================================================

export const monokai: Theme = {
  id: 'monokai',
  name: 'Monokai',
  type: 'dark',
  monacoTheme: 'monokai',
  colors: {
    void: '#272822',
    surface: '#2d2e27',
    elevated: '#3e3d32',
    overlay: '#49483e',

    textPrimary: '#f8f8f2',
    textSecondary: '#cfcfc2',
    textMuted: '#75715e',

    borderDefault: '#49483e',
    borderSubtle: '#3e3d32',

    accentPrimary: '#a6e22e',
    accentSecondary: '#e6db74',
    accentMuted: '#66d9ef',

    success: '#a6e22e',
    warning: '#e6db74',
    error: '#f92672',
    info: '#66d9ef',

    syntax: {
      keyword: '#f92672',
      string: '#e6db74',
      number: '#ae81ff',
      comment: '#75715e',
      function: '#a6e22e',
      variable: '#f8f8f2',
      type: '#66d9ef',
      operator: '#f92672',
      property: '#a6e22e',
      punctuation: '#f8f8f2',
      className: '#66d9ef',
      constant: '#ae81ff',
      parameter: '#fd971f',
      tag: '#f92672',
      attribute: '#a6e22e',
    },

    editor: {
      background: '#272822',
      foreground: '#f8f8f2',
      lineHighlight: '#3e3d32',
      selection: '#49483e',
      cursor: '#f8f8f2',
      gutterBackground: '#272822',
      gutterForeground: '#75715e',
      lineNumber: '#75715e',
      lineNumberActive: '#f8f8f2',
      matchingBracket: '#49483e',
      indentGuide: '#3e3d32',
      activeIndentGuide: '#75715e',
      findMatch: '#e6db7433',
      findMatchHighlight: '#e6db7422',
    },

    terminal: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
  },
};

// ============================================================================
// Dracula
// ============================================================================

export const dracula: Theme = {
  id: 'dracula',
  name: 'Dracula',
  type: 'dark',
  monacoTheme: 'dracula',
  colors: {
    void: '#282a36',
    surface: '#2d303e',
    elevated: '#343746',
    overlay: '#44475a',

    textPrimary: '#f8f8f2',
    textSecondary: '#ced4da',
    textMuted: '#6272a4',

    borderDefault: '#44475a',
    borderSubtle: '#343746',

    accentPrimary: '#bd93f9',
    accentSecondary: '#ff79c6',
    accentMuted: '#6272a4',

    success: '#50fa7b',
    warning: '#f1fa8c',
    error: '#ff5555',
    info: '#8be9fd',

    syntax: {
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      comment: '#6272a4',
      function: '#50fa7b',
      variable: '#f8f8f2',
      type: '#8be9fd',
      operator: '#ff79c6',
      property: '#66d9ef',
      punctuation: '#f8f8f2',
      className: '#8be9fd',
      constant: '#bd93f9',
      parameter: '#ffb86c',
      tag: '#ff79c6',
      attribute: '#50fa7b',
    },

    editor: {
      background: '#282a36',
      foreground: '#f8f8f2',
      lineHighlight: '#44475a',
      selection: '#44475a',
      cursor: '#f8f8f2',
      gutterBackground: '#282a36',
      gutterForeground: '#6272a4',
      lineNumber: '#6272a4',
      lineNumberActive: '#f8f8f2',
      matchingBracket: '#44475a',
      indentGuide: '#343746',
      activeIndentGuide: '#6272a4',
      findMatch: '#f1fa8c33',
      findMatchHighlight: '#f1fa8c22',
    },

    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
};

// ============================================================================
// One Dark Pro
// ============================================================================

export const oneDarkPro: Theme = {
  id: 'one-dark-pro',
  name: 'One Dark Pro',
  type: 'dark',
  monacoTheme: 'one-dark-pro',
  colors: {
    void: '#282c34',
    surface: '#2c313a',
    elevated: '#333842',
    overlay: '#3b4048',

    textPrimary: '#abb2bf',
    textSecondary: '#9da5b4',
    textMuted: '#5c6370',

    borderDefault: '#3b4048',
    borderSubtle: '#333842',

    accentPrimary: '#61afef',
    accentSecondary: '#c678dd',
    accentMuted: '#4d78cc',

    success: '#98c379',
    warning: '#e5c07b',
    error: '#e06c75',
    info: '#61afef',

    syntax: {
      keyword: '#c678dd',
      string: '#98c379',
      number: '#d19a66',
      comment: '#5c6370',
      function: '#61afef',
      variable: '#e06c75',
      type: '#e5c07b',
      operator: '#56b6c2',
      property: '#e06c75',
      punctuation: '#abb2bf',
      className: '#e5c07b',
      constant: '#d19a66',
      parameter: '#abb2bf',
      tag: '#e06c75',
      attribute: '#d19a66',
    },

    editor: {
      background: '#282c34',
      foreground: '#abb2bf',
      lineHighlight: '#2c313a',
      selection: '#3e4451',
      cursor: '#528bff',
      gutterBackground: '#282c34',
      gutterForeground: '#5c6370',
      lineNumber: '#5c6370',
      lineNumberActive: '#abb2bf',
      matchingBracket: '#3e4451',
      indentGuide: '#3b4048',
      activeIndentGuide: '#5c6370',
      findMatch: '#e5c07b33',
      findMatchHighlight: '#e5c07b22',
    },

    terminal: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },
};

// ============================================================================
// GitHub Dark
// ============================================================================

export const githubDark: Theme = {
  id: 'github-dark',
  name: 'GitHub Dark',
  type: 'dark',
  monacoTheme: 'github-dark',
  colors: {
    void: '#0d1117',
    surface: '#161b22',
    elevated: '#21262d',
    overlay: '#30363d',

    textPrimary: '#c9d1d9',
    textSecondary: '#8b949e',
    textMuted: '#484f58',

    borderDefault: '#30363d',
    borderSubtle: '#21262d',

    accentPrimary: '#58a6ff',
    accentSecondary: '#1f6feb',
    accentMuted: '#388bfd',

    success: '#3fb950',
    warning: '#d29922',
    error: '#f85149',
    info: '#58a6ff',

    syntax: {
      keyword: '#ff7b72',
      string: '#a5d6ff',
      number: '#79c0ff',
      comment: '#8b949e',
      function: '#d2a8ff',
      variable: '#ffa657',
      type: '#79c0ff',
      operator: '#ff7b72',
      property: '#79c0ff',
      punctuation: '#c9d1d9',
      className: '#f0883e',
      constant: '#79c0ff',
      parameter: '#ffa657',
      tag: '#7ee787',
      attribute: '#79c0ff',
    },

    editor: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      lineHighlight: '#161b22',
      selection: '#264f78',
      cursor: '#58a6ff',
      gutterBackground: '#0d1117',
      gutterForeground: '#484f58',
      lineNumber: '#484f58',
      lineNumberActive: '#c9d1d9',
      matchingBracket: '#264f78',
      indentGuide: '#21262d',
      activeIndentGuide: '#30363d',
      findMatch: '#d29922aa',
      findMatchHighlight: '#d2992266',
    },

    terminal: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    },
  },
};

// ============================================================================
// GitHub Light
// ============================================================================

export const githubLight: Theme = {
  id: 'github-light',
  name: 'GitHub Light',
  type: 'light',
  monacoTheme: 'github-light',
  colors: {
    void: '#ffffff',
    surface: '#f6f8fa',
    elevated: '#eaeef2',
    overlay: '#d0d7de',

    textPrimary: '#24292f',
    textSecondary: '#57606a',
    textMuted: '#8c959f',

    borderDefault: '#d0d7de',
    borderSubtle: '#eaeef2',

    accentPrimary: '#0969da',
    accentSecondary: '#0550ae',
    accentMuted: '#218bff',

    success: '#1a7f37',
    warning: '#9a6700',
    error: '#cf222e',
    info: '#0969da',

    syntax: {
      keyword: '#cf222e',
      string: '#0a3069',
      number: '#0550ae',
      comment: '#6e7781',
      function: '#8250df',
      variable: '#953800',
      type: '#0550ae',
      operator: '#cf222e',
      property: '#0550ae',
      punctuation: '#24292f',
      className: '#953800',
      constant: '#0550ae',
      parameter: '#953800',
      tag: '#116329',
      attribute: '#0550ae',
    },

    editor: {
      background: '#ffffff',
      foreground: '#24292f',
      lineHighlight: '#f6f8fa',
      selection: '#b6e3ff',
      cursor: '#0969da',
      gutterBackground: '#ffffff',
      gutterForeground: '#8c959f',
      lineNumber: '#8c959f',
      lineNumberActive: '#24292f',
      matchingBracket: '#b6e3ff',
      indentGuide: '#eaeef2',
      activeIndentGuide: '#d0d7de',
      findMatch: '#bf8700aa',
      findMatchHighlight: '#bf870066',
    },

    terminal: {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#0969da',
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f',
    },
  },
};

// ============================================================================
// High Contrast Dark
// ============================================================================

export const highContrastDark: Theme = {
  id: 'high-contrast-dark',
  name: 'High Contrast Dark',
  type: 'dark',
  monacoTheme: 'hc-black',
  colors: {
    void: '#000000',
    surface: '#0a0a0a',
    elevated: '#141414',
    overlay: '#1f1f1f',

    textPrimary: '#ffffff',
    textSecondary: '#e0e0e0',
    textMuted: '#999999',

    borderDefault: '#6fc3df',
    borderSubtle: '#333333',

    accentPrimary: '#6fc3df',
    accentSecondary: '#3794ff',
    accentMuted: '#007acc',

    success: '#89d185',
    warning: '#cca700',
    error: '#f48771',
    info: '#6fc3df',

    syntax: {
      keyword: '#569cd6',
      string: '#ce9178',
      number: '#b5cea8',
      comment: '#6a9955',
      function: '#dcdcaa',
      variable: '#9cdcfe',
      type: '#4ec9b0',
      operator: '#d4d4d4',
      property: '#9cdcfe',
      punctuation: '#ffffff',
      className: '#4ec9b0',
      constant: '#4fc1ff',
      parameter: '#9cdcfe',
      tag: '#569cd6',
      attribute: '#9cdcfe',
    },

    editor: {
      background: '#000000',
      foreground: '#ffffff',
      lineHighlight: '#141414',
      selection: '#264f78',
      cursor: '#ffffff',
      gutterBackground: '#000000',
      gutterForeground: '#999999',
      lineNumber: '#999999',
      lineNumberActive: '#ffffff',
      matchingBracket: '#0066ff',
      indentGuide: '#333333',
      activeIndentGuide: '#6fc3df',
      findMatch: '#515c6a',
      findMatchHighlight: '#ea5c00',
    },

    terminal: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
    },
  },
};

// ============================================================================
// Export all themes
// ============================================================================

export const themes: Theme[] = [
  terminalNoir,
  lightTheme,
  monokai,
  dracula,
  oneDarkPro,
  githubDark,
  githubLight,
  highContrastDark,
];

export const themeMap: Record<string, Theme> = themes.reduce(
  (acc, theme) => ({ ...acc, [theme.id]: theme }),
  {}
);
