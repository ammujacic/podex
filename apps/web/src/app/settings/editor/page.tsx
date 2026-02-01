'use client';

import { useState } from 'react';
import { Code, Type, Ruler, WrapText, MousePointer, Zap, Eye, Save, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorSettingsStore, type EditorSettings } from '@/stores/editorSettings';

// ============================================================================
// Setting Components
// ============================================================================

interface SettingSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function SettingSection({ title, icon, children }: SettingSectionProps) {
  return (
    <div className="mb-8">
      <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex-1">
        <div className="text-sm text-text-primary">{label}</div>
        {description && <div className="text-xs text-text-muted mt-0.5">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

function Toggle({ value, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors',
        value ? 'bg-accent-primary' : 'bg-overlay'
      )}
    >
      <span
        className={cn(
          'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
          value ? 'left-6' : 'left-1'
        )}
      />
    </button>
  );
}

interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

function Select<T extends string>({ value, onChange, options }: SelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="px-3 py-1.5 rounded bg-elevated border border-border-default text-sm text-text-primary"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

function NumberInput({ value, onChange, min, max, step = 1 }: NumberInputProps) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-20 px-3 py-1.5 rounded bg-elevated border border-border-default text-sm text-text-primary text-right"
    />
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function EditorSettingsPage() {
  const settings = useEditorSettingsStore();
  const [hasChanges, setHasChanges] = useState(false);

  const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
    settings.updateSetting(key, value);
    setHasChanges(true);
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Code className="h-6 w-6" />
            Editor Settings
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Customize your code editor appearance and behavior
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              settings.resetToDefaults();
              setHasChanges(false);
            }}
            className="px-3 py-1.5 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-overlay flex items-center gap-1.5"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          {hasChanges && (
            <button
              onClick={() => setHasChanges(false)}
              className="px-3 py-1.5 rounded text-sm bg-accent-primary text-void flex items-center gap-1.5"
            >
              <Save className="h-4 w-4" />
              Saved
            </button>
          )}
        </div>
      </div>

      {/* Font Settings */}
      <SettingSection title="Font" icon={<Type className="h-4 w-4 text-accent-primary" />}>
        <SettingRow label="Font Family" description="Use a monospace font for best results">
          <input
            type="text"
            value={settings.fontFamily}
            onChange={(e) => update('fontFamily', e.target.value)}
            className="w-64 px-3 py-1.5 rounded bg-elevated border border-border-default text-sm text-text-primary"
          />
        </SettingRow>
        <SettingRow label="Font Size">
          <NumberInput
            value={settings.fontSize}
            onChange={(v) => update('fontSize', v)}
            min={8}
            max={32}
          />
        </SettingRow>
        <SettingRow label="Line Height">
          <NumberInput
            value={settings.lineHeight}
            onChange={(v) => update('lineHeight', v)}
            min={1}
            max={3}
            step={0.1}
          />
        </SettingRow>
        <SettingRow label="Font Ligatures" description="Enable ligatures like => and !==">
          <Toggle value={settings.fontLigatures} onChange={(v) => update('fontLigatures', v)} />
        </SettingRow>
      </SettingSection>

      {/* Display Settings */}
      <SettingSection title="Display" icon={<Eye className="h-4 w-4 text-accent-primary" />}>
        <SettingRow label="Line Numbers">
          <Select
            value={settings.lineNumbers}
            onChange={(v) => update('lineNumbers', v)}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
              { value: 'relative', label: 'Relative' },
              { value: 'interval', label: 'Interval' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Word Wrap">
          <Select
            value={settings.wordWrap}
            onChange={(v) => update('wordWrap', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
              { value: 'wordWrapColumn', label: 'At Column' },
              { value: 'bounded', label: 'Bounded' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Minimap" description="Show code minimap on the side">
          <Toggle value={settings.minimap} onChange={(v) => update('minimap', v)} />
        </SettingRow>
        <SettingRow label="Render Whitespace">
          <Select
            value={settings.renderWhitespace}
            onChange={(v) => update('renderWhitespace', v)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'boundary', label: 'Boundary' },
              { value: 'selection', label: 'Selection' },
              { value: 'trailing', label: 'Trailing' },
              { value: 'all', label: 'All' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Line Highlight">
          <Select
            value={settings.renderLineHighlight}
            onChange={(v) => update('renderLineHighlight', v)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'gutter', label: 'Gutter' },
              { value: 'line', label: 'Line' },
              { value: 'all', label: 'All' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      {/* Editing Settings */}
      <SettingSection title="Editing" icon={<WrapText className="h-4 w-4 text-accent-primary" />}>
        <SettingRow label="Tab Size">
          <NumberInput
            value={settings.tabSize}
            onChange={(v) => update('tabSize', v)}
            min={1}
            max={8}
          />
        </SettingRow>
        <SettingRow label="Insert Spaces" description="Use spaces instead of tabs">
          <Toggle value={settings.insertSpaces} onChange={(v) => update('insertSpaces', v)} />
        </SettingRow>
        <SettingRow label="Format on Save">
          <Toggle value={settings.formatOnSave} onChange={(v) => update('formatOnSave', v)} />
        </SettingRow>
        <SettingRow label="Format on Paste">
          <Toggle value={settings.formatOnPaste} onChange={(v) => update('formatOnPaste', v)} />
        </SettingRow>
        <SettingRow label="Auto Closing Brackets">
          <Select
            value={settings.autoClosingBrackets}
            onChange={(v) => update('autoClosingBrackets', v)}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'languageDefined', label: 'Language Defined' },
              { value: 'beforeWhitespace', label: 'Before Whitespace' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      {/* Cursor Settings */}
      <SettingSection
        title="Cursor"
        icon={<MousePointer className="h-4 w-4 text-accent-primary" />}
      >
        <SettingRow label="Cursor Style">
          <Select
            value={settings.cursorStyle}
            onChange={(v) => update('cursorStyle', v)}
            options={[
              { value: 'line', label: 'Line' },
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
              { value: 'line-thin', label: 'Line Thin' },
              { value: 'block-outline', label: 'Block Outline' },
              { value: 'underline-thin', label: 'Underline Thin' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Cursor Blinking">
          <Select
            value={settings.cursorBlinking}
            onChange={(v) => update('cursorBlinking', v)}
            options={[
              { value: 'blink', label: 'Blink' },
              { value: 'smooth', label: 'Smooth' },
              { value: 'phase', label: 'Phase' },
              { value: 'expand', label: 'Expand' },
              { value: 'solid', label: 'Solid' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Smooth Caret Animation">
          <Select
            value={settings.cursorSmoothCaretAnimation}
            onChange={(v) => update('cursorSmoothCaretAnimation', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'explicit', label: 'Explicit' },
              { value: 'on', label: 'On' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      {/* IntelliSense Settings */}
      <SettingSection title="IntelliSense" icon={<Zap className="h-4 w-4 text-accent-primary" />}>
        <SettingRow label="Quick Suggestions" description="Show suggestions as you type">
          <Toggle
            value={settings.quickSuggestions}
            onChange={(v) => update('quickSuggestions', v)}
          />
        </SettingRow>
        <SettingRow label="Parameter Hints" description="Show function parameter hints">
          <Toggle value={settings.parameterHints} onChange={(v) => update('parameterHints', v)} />
        </SettingRow>
        <SettingRow label="Accept Suggestion on Enter">
          <Select
            value={settings.acceptSuggestionOnEnter}
            onChange={(v) => update('acceptSuggestionOnEnter', v)}
            options={[
              { value: 'on', label: 'On' },
              { value: 'smart', label: 'Smart' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Snippet Suggestions">
          <Select
            value={settings.snippetSuggestions}
            onChange={(v) => update('snippetSuggestions', v)}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
              { value: 'inline', label: 'Inline' },
              { value: 'none', label: 'None' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      {/* Scrolling Settings */}
      <SettingSection title="Scrolling" icon={<Ruler className="h-4 w-4 text-accent-primary" />}>
        <SettingRow label="Smooth Scrolling">
          <Toggle value={settings.smoothScrolling} onChange={(v) => update('smoothScrolling', v)} />
        </SettingRow>
        <SettingRow label="Scroll Beyond Last Line">
          <Toggle
            value={settings.scrollBeyondLastLine}
            onChange={(v) => update('scrollBeyondLastLine', v)}
          />
        </SettingRow>
        <SettingRow label="Mouse Wheel Sensitivity">
          <NumberInput
            value={settings.mouseWheelScrollSensitivity}
            onChange={(v) => update('mouseWheelScrollSensitivity', v)}
            min={0.5}
            max={5}
            step={0.5}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
