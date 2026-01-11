/**
 * Tests for ThemeSelector component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeSelector } from '@/components/settings/ThemeSelector';

// Mock the theme store
vi.mock('@/lib/themes/ThemeManager', () => ({
  useThemeStore: () => ({
    currentThemeId: 'podex-dark',
    setTheme: vi.fn(),
  }),
  getAllThemes: () => [
    {
      id: 'podex-dark',
      name: 'Podex Dark',
      type: 'dark',
      preview: { background: '#1a1a1a', foreground: '#ffffff', accent: '#3b82f6' },
      colors: {
        void: '#0a0a0a',
        surface: '#1a1a1a',
        elevated: '#2a2a2a',
        overlay: '#3a3a3a',
        textPrimary: '#ffffff',
        textSecondary: '#a0a0a0',
        textMuted: '#666666',
        accentPrimary: '#3b82f6',
        accentSecondary: '#8b5cf6',
        accentMuted: '#3b82f680',
        success: '#22c55e',
        warning: '#eab308',
        error: '#ef4444',
        info: '#3b82f6',
        syntax: {
          keyword: '#c678dd',
          string: '#98c379',
          number: '#d19a66',
          comment: '#5c6370',
          function: '#61afef',
          type: '#e5c07b',
        },
      },
    },
    {
      id: 'podex-light',
      name: 'Podex Light',
      type: 'light',
      preview: { background: '#ffffff', foreground: '#1a1a1a', accent: '#3b82f6' },
      colors: {
        void: '#ffffff',
        surface: '#f5f5f5',
        elevated: '#e5e5e5',
        overlay: '#d5d5d5',
        textPrimary: '#1a1a1a',
        textSecondary: '#4a4a4a',
        textMuted: '#8a8a8a',
        accentPrimary: '#3b82f6',
        accentSecondary: '#8b5cf6',
        accentMuted: '#3b82f680',
        success: '#22c55e',
        warning: '#eab308',
        error: '#ef4444',
        info: '#3b82f6',
        syntax: {
          keyword: '#c678dd',
          string: '#50a14f',
          number: '#986801',
          comment: '#a0a1a7',
          function: '#4078f2',
          type: '#c18401',
        },
      },
    },
  ],
  getThemePresets: () => [
    {
      id: 'podex-dark',
      name: 'Podex Dark',
      type: 'dark',
      preview: { background: '#1a1a1a', foreground: '#ffffff', accent: '#3b82f6' },
    },
    {
      id: 'podex-light',
      name: 'Podex Light',
      type: 'light',
      preview: { background: '#ffffff', foreground: '#1a1a1a', accent: '#3b82f6' },
    },
  ],
}));

describe('ThemeSelector', () => {
  it('renders the theme selector', () => {
    render(<ThemeSelector />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('shows dark themes section', () => {
    render(<ThemeSelector />);
    expect(screen.getByText('Dark Themes')).toBeInTheDocument();
  });

  it('shows light themes section', () => {
    render(<ThemeSelector />);
    expect(screen.getByText('Light Themes')).toBeInTheDocument();
  });

  it('renders in compact mode', () => {
    render(<ThemeSelector compact={true} />);
    // In compact mode, it renders a select dropdown
    expect(document.querySelector('select')).toBeInTheDocument();
  });

  it('displays theme header', () => {
    render(<ThemeSelector />);
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });

  it('accepts className prop', () => {
    const { container } = render(<ThemeSelector className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
