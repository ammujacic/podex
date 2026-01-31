/**
 * Podex brand color palette for CLI.
 * These colors match the web application's design system.
 */

export const colors = {
  // Primary brand colors
  primary: {
    purple: '#8B5CF6',
    purpleLight: '#A78BFA',
    purpleDark: '#7C3AED',
  },

  // Secondary accent
  secondary: {
    cyan: '#06B6D4',
    cyanLight: '#22D3EE',
    cyanDark: '#0891B2',
  },

  // Feedback colors
  feedback: {
    success: '#22c55e',
    successLight: '#4ade80',
    successDark: '#16a34a',
    warning: '#f59e0b',
    warningLight: '#fbbf24',
    warningDark: '#d97706',
    error: '#ef4444',
    errorLight: '#f87171',
    errorDark: '#dc2626',
    info: '#3b82f6',
    infoLight: '#60a5fa',
    infoDark: '#2563eb',
  },

  // Neutral colors for backgrounds and text
  neutral: {
    background: '#07070a',
    surface: '#18181b',
    surfaceLight: '#27272a',
    border: '#3f3f46',
    borderLight: '#52525b',
    text: '#f0f0f5',
    textSecondary: '#a1a1aa',
    textMuted: '#71717a',
  },

  // Agent-specific colors for multi-agent display
  agents: [
    '#8B5CF6', // Purple (primary)
    '#06B6D4', // Cyan
    '#22c55e', // Green
    '#f97316', // Orange
    '#ec4899', // Pink
    '#eab308', // Yellow
    '#14b8a6', // Teal
    '#f43f5e', // Rose
  ],
} as const;

// Terminal-safe color names for Ink/Chalk
export const terminalColors = {
  primary: 'magenta',
  secondary: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  muted: 'gray',
  text: 'white',
} as const;

export type Colors = typeof colors;
export type TerminalColors = typeof terminalColors;
