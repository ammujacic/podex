// ============================================================================
// Theme Type Definitions
// ============================================================================

export interface ThemeColors {
  // Background colors
  void: string;
  surface: string;
  elevated: string;
  overlay: string;

  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Border colors
  borderDefault: string;
  borderSubtle: string;

  // Accent colors
  accentPrimary: string;
  accentSecondary: string;
  accentMuted: string;

  // Semantic colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // Code syntax highlighting
  syntax: {
    keyword: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    variable: string;
    type: string;
    operator: string;
    property: string;
    punctuation: string;
    className: string;
    constant: string;
    parameter: string;
    tag: string;
    attribute: string;
  };

  // Editor specific
  editor: {
    background: string;
    foreground: string;
    lineHighlight: string;
    selection: string;
    cursor: string;
    gutterBackground: string;
    gutterForeground: string;
    lineNumber: string;
    lineNumberActive: string;
    matchingBracket: string;
    indentGuide: string;
    activeIndentGuide: string;
    findMatch: string;
    findMatchHighlight: string;
  };

  // Terminal
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

export interface Theme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: ThemeColors;
  monacoTheme: string; // Monaco theme ID to use
}

export interface ThemePreset {
  id: string;
  name: string;
  type: 'dark' | 'light';
  preview: {
    background: string;
    accent: string;
    foreground: string;
  };
}
