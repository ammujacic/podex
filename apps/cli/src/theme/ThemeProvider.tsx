/**
 * Theme provider for consistent styling across CLI components.
 */

import React, { createContext, useContext } from 'react';
import { colors, terminalColors, type Colors, type TerminalColors } from './colors';
import {
  spacing,
  borders,
  icons,
  animation,
  type Spacing,
  type Borders,
  type Icons,
  type Animation,
} from './tokens';

export interface Theme {
  colors: Colors;
  terminalColors: TerminalColors;
  spacing: Spacing;
  borders: Borders;
  icons: Icons;
  animation: Animation;
}

const theme: Theme = {
  colors,
  terminalColors,
  spacing,
  borders,
  icons,
  animation,
};

const ThemeContext = createContext<Theme>(theme);

export interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Export theme for direct access when context is not needed
export { theme };
