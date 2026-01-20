'use client';

import { useState, useEffect } from 'react';
import { Palette, Check, Moon, Sun, Sparkles, ChevronRight, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore, getAllThemes, getThemePresets } from '@/lib/themes/ThemeManager';
import type { ThemePreset } from '@/lib/themes/types';

// ============================================================================
// Theme Preview Card
// ============================================================================

interface ThemePreviewCardProps {
  theme: ThemePreset;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
}

function ThemePreviewCard({ theme, isSelected, onSelect, onPreview }: ThemePreviewCardProps) {
  return (
    <div
      className={cn(
        'relative p-4 rounded-lg border-2 cursor-pointer transition-all',
        isSelected
          ? 'border-accent-primary bg-accent-primary/10'
          : 'border-border-subtle hover:border-border-default'
      )}
      onClick={onSelect}
    >
      {/* Preview */}
      <div
        className="w-full aspect-video rounded mb-3 overflow-hidden"
        style={{ backgroundColor: theme.preview.background }}
      >
        {/* Mock editor preview */}
        <div className="h-full p-2 flex flex-col">
          <div className="flex gap-1 mb-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <div className="w-2 h-2 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="h-1.5 w-12 rounded" style={{ backgroundColor: theme.preview.accent }} />
            <div
              className="h-1.5 w-20 rounded opacity-50"
              style={{ backgroundColor: theme.preview.foreground }}
            />
            <div
              className="h-1.5 w-16 rounded opacity-30"
              style={{ backgroundColor: theme.preview.foreground }}
            />
            <div
              className="h-1.5 w-14 rounded"
              style={{ backgroundColor: theme.preview.accent, opacity: 0.7 }}
            />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-text-primary">{theme.name}</h4>
          <div className="flex items-center gap-1 text-xs text-text-muted">
            {theme.type === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
            <span className="capitalize">{theme.type}</span>
          </div>
        </div>
        {isSelected && (
          <div className="w-6 h-6 rounded-full bg-accent-primary flex items-center justify-center">
            <Check className="h-4 w-4 text-void" />
          </div>
        )}
      </div>

      {/* Preview on hover button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPreview();
        }}
        className="absolute top-2 right-2 p-1.5 rounded bg-void/80 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
        title="Preview theme"
      >
        <Eye className="h-3 w-3" />
      </button>
    </div>
  );
}

// ============================================================================
// Theme Color Editor
// ============================================================================

interface ColorSwatchProps {
  label: string;
  color: string;
  onChange?: (color: string) => void;
  editable?: boolean;
}

function ColorSwatch({ label, color, onChange, editable = false }: ColorSwatchProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div
          className="w-6 h-6 rounded border border-border-default"
          style={{ backgroundColor: color }}
        />
        {editable && (
          <input
            type="color"
            value={color}
            onChange={(e) => onChange?.(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-text-secondary truncate">{label}</span>
      </div>
      <code className="text-xs font-mono text-text-muted">{color}</code>
    </div>
  );
}

// ============================================================================
// Main Theme Selector
// ============================================================================

interface ThemeSelectorProps {
  className?: string;
  compact?: boolean;
}

export function ThemeSelector({ className, compact = false }: ThemeSelectorProps) {
  const { currentThemeId, setTheme } = useThemeStore();
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [showColorEditor, setShowColorEditor] = useState(false);
  const [activeTab, setActiveTab] = useState<'dark' | 'light'>('dark');

  const presets = getThemePresets();
  const themes = getAllThemes();
  const currentTheme = themes.find((t) => t.id === currentThemeId);
  const activeTheme = themes.find((t) => t.id === (previewThemeId || currentThemeId));

  // Keep active tab in sync with the current theme type
  useEffect(() => {
    if (currentTheme?.type === 'dark' || currentTheme?.type === 'light') {
      setActiveTab(currentTheme.type);
    }
  }, [currentTheme?.type]);

  // Reset preview when component unmounts or selection changes
  useEffect(() => {
    return () => {
      if (previewThemeId && previewThemeId !== currentThemeId) {
        setTheme(currentThemeId);
      }
    };
  }, [previewThemeId, currentThemeId, setTheme]);

  const handlePreview = (themeId: string) => {
    setPreviewThemeId(themeId);
    setTheme(themeId);
  };

  const handleSelect = (themeId: string) => {
    setPreviewThemeId(null);
    setTheme(themeId);
  };

  const cancelPreview = () => {
    if (previewThemeId && currentThemeId !== previewThemeId) {
      setTheme(currentThemeId);
    }
    setPreviewThemeId(null);
  };

  if (compact) {
    return (
      <div className={cn('relative', className)}>
        <select
          value={currentThemeId}
          onChange={(e) => setTheme(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-default text-text-primary text-sm appearance-none cursor-pointer"
        >
          <optgroup label="Dark Themes">
            {presets
              .filter((p) => p.type === 'dark')
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Light Themes">
            {presets
              .filter((p) => p.type === 'light')
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
          </optgroup>
        </select>
        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted rotate-90" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Theme</h2>
        </div>
        {previewThemeId && (
          <button
            onClick={cancelPreview}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            Cancel preview
          </button>
        )}
      </div>

      {/* Dark / Light tabs */}
      <div className="px-4 pt-2 pb-1 border-b border-border-subtle">
        <div className="inline-flex rounded-lg bg-elevated border border-border-subtle p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('dark')}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              activeTab === 'dark'
                ? 'bg-void text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
          >
            <Moon className="h-3 w-3" />
            <span>Dark</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('light')}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              activeTab === 'light'
                ? 'bg-void text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
          >
            <Sun className="h-3 w-3" />
            <span>Light</span>
          </button>
        </div>
      </div>

      {/* Preview indicator */}
      {previewThemeId && (
        <div className="px-4 py-2 bg-warning/10 border-b border-warning/30 text-warning text-sm flex items-center gap-2">
          <Eye className="h-4 w-4" />
          Previewing: {themes.find((t) => t.id === previewThemeId)?.name}
        </div>
      )}

      {/* Theme grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Active tab themes */}
        <div className="mb-6">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            {activeTab === 'dark' ? (
              <>
                <Moon className="h-3 w-3" />
                <span>Dark Themes</span>
              </>
            ) : (
              <>
                <Sun className="h-3 w-3" />
                <span>Light Themes</span>
              </>
            )}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {presets
              .filter((p) => p.type === activeTab)
              .map((preset) => (
                <ThemePreviewCard
                  key={preset.id}
                  theme={preset}
                  isSelected={currentThemeId === preset.id}
                  onSelect={() => handleSelect(preset.id)}
                  onPreview={() => handlePreview(preset.id)}
                />
              ))}
          </div>
        </div>

        {/* Color details */}
        {activeTheme && (
          <div className="border-t border-border-subtle pt-4">
            <button
              onClick={() => setShowColorEditor(!showColorEditor)}
              className="w-full flex items-center justify-between text-sm text-text-secondary hover:text-text-primary mb-3"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                View color palette
              </span>
              <ChevronRight
                className={cn('h-4 w-4 transition-transform', showColorEditor && 'rotate-90')}
              />
            </button>

            {showColorEditor && (
              <div className="space-y-4 p-3 rounded-lg bg-elevated">
                {/* Core colors */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">Background</h4>
                  <div className="space-y-2">
                    <ColorSwatch label="Void" color={activeTheme.colors.void} />
                    <ColorSwatch label="Surface" color={activeTheme.colors.surface} />
                    <ColorSwatch label="Elevated" color={activeTheme.colors.elevated} />
                    <ColorSwatch label="Overlay" color={activeTheme.colors.overlay} />
                  </div>
                </div>

                {/* Text colors */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">Text</h4>
                  <div className="space-y-2">
                    <ColorSwatch label="Primary" color={activeTheme.colors.textPrimary} />
                    <ColorSwatch label="Secondary" color={activeTheme.colors.textSecondary} />
                    <ColorSwatch label="Muted" color={activeTheme.colors.textMuted} />
                  </div>
                </div>

                {/* Accent colors */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">Accent</h4>
                  <div className="space-y-2">
                    <ColorSwatch label="Primary" color={activeTheme.colors.accentPrimary} />
                    <ColorSwatch label="Secondary" color={activeTheme.colors.accentSecondary} />
                    <ColorSwatch label="Muted" color={activeTheme.colors.accentMuted} />
                  </div>
                </div>

                {/* Semantic colors */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">Semantic</h4>
                  <div className="space-y-2">
                    <ColorSwatch label="Success" color={activeTheme.colors.success} />
                    <ColorSwatch label="Warning" color={activeTheme.colors.warning} />
                    <ColorSwatch label="Error" color={activeTheme.colors.error} />
                    <ColorSwatch label="Info" color={activeTheme.colors.info} />
                  </div>
                </div>

                {/* Syntax colors */}
                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">Syntax</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <ColorSwatch label="Keyword" color={activeTheme.colors.syntax.keyword} />
                    <ColorSwatch label="String" color={activeTheme.colors.syntax.string} />
                    <ColorSwatch label="Number" color={activeTheme.colors.syntax.number} />
                    <ColorSwatch label="Comment" color={activeTheme.colors.syntax.comment} />
                    <ColorSwatch label="Function" color={activeTheme.colors.syntax.function} />
                    <ColorSwatch label="Type" color={activeTheme.colors.syntax.type} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border-subtle bg-elevated">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Current: {currentTheme?.name}</span>
          <span className="flex items-center gap-1">
            {currentTheme?.type === 'dark' ? (
              <Moon className="h-3 w-3" />
            ) : (
              <Sun className="h-3 w-3" />
            )}
            {currentTheme?.type}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Quick Theme Switcher (for header/toolbar)
// ============================================================================

interface QuickThemeSwitcherProps {
  className?: string;
}

export function QuickThemeSwitcher({ className }: QuickThemeSwitcherProps) {
  const { currentThemeId, setTheme } = useThemeStore();
  const themes = getAllThemes();
  const currentTheme = themes.find((t) => t.id === currentThemeId);

  // Quick toggle between dark/light
  const toggleDarkLight = () => {
    if (currentTheme?.type === 'dark') {
      // Switch to first light theme
      const lightTheme = themes.find((t) => t.type === 'light');
      if (lightTheme) setTheme(lightTheme.id);
    } else {
      // Switch to first dark theme
      const darkTheme = themes.find((t) => t.type === 'dark');
      if (darkTheme) setTheme(darkTheme.id);
    }
  };

  return (
    <button
      onClick={toggleDarkLight}
      className={cn(
        'p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors',
        className
      )}
      title={`Switch to ${currentTheme?.type === 'dark' ? 'light' : 'dark'} mode`}
    >
      {currentTheme?.type === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
