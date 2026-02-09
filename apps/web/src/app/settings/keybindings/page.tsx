'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Keyboard,
  Search,
  RotateCcw,
  Edit3,
  AlertCircle,
  Check,
  X,
  Monitor,
  Code,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKeybindingsStore, type Keybinding } from '@/stores/keybindings';
import { getKeybindingInfo } from '@/hooks/useKeybindingsSync';

// ============================================================================
// Key Recording
// ============================================================================

function useKeyRecorder(onRecord: (keys: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const startRecording = useCallback(() => {
    setIsRecording(true);
    setRecordedKeys([]);
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (recordedKeys.length > 0) {
      onRecord(recordedKeys.join(' '));
    }
    setRecordedKeys([]);
  }, [recordedKeys, onRecord]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        stopRecording();
        return;
      }

      const parts: string[] = [];
      if (e.metaKey) parts.push('Cmd');
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
        parts.push(key);
      }

      if (parts.length > 0) {
        const combo = parts.join('+');
        setRecordedKeys((prev) => [...prev, combo]);

        // Auto-complete after 500ms of no additional keys
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(stopRecording, 500);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isRecording, stopRecording]);

  return { isRecording, recordedKeys, startRecording, stopRecording };
}

// ============================================================================
// Keybinding Row
// ============================================================================

interface KeybindingRowProps {
  keybinding: Keybinding;
  onEdit: () => void;
  onReset: () => void;
  isEditing: boolean;
  onSave: (keys: string[]) => void;
  onCancel: () => void;
}

function KeybindingRow({
  keybinding,
  onEdit,
  onReset,
  isEditing,
  onSave,
  onCancel,
}: KeybindingRowProps) {
  const [newKeys, setNewKeys] = useState<string[]>(keybinding.keys);

  const handleRecord = useCallback((recorded: string) => {
    setNewKeys([recorded]);
  }, []);

  const { isRecording, recordedKeys, startRecording } = useKeyRecorder(handleRecord);

  const handleSave = () => {
    onSave(newKeys);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 border-b border-border-subtle',
        isEditing && 'bg-accent-primary/5'
      )}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary">{keybinding.label}</span>
          {keybinding.isCustom && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-primary/20 text-accent-primary">
              Modified
            </span>
          )}
          {/* Command type badge */}
          {(() => {
            const info = getKeybindingInfo(keybinding);
            return info.isEditorCommand ? (
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                <Code className="w-3 h-3" />
                Editor
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                <Monitor className="w-3 h-3" />
                App
              </span>
            );
          })()}
        </div>
        <div className="text-xs text-text-muted">{keybinding.command}</div>
      </div>

      <div className="flex items-center gap-2">
        {isEditing ? (
          <>
            <div
              onClick={startRecording}
              className={cn(
                'min-w-32 px-3 py-1.5 rounded border cursor-pointer',
                isRecording
                  ? 'border-accent-primary bg-accent-primary/10'
                  : 'border-border-default bg-elevated hover:border-accent-primary'
              )}
            >
              {isRecording ? (
                <span className="text-sm text-accent-primary animate-pulse">
                  {recordedKeys.length > 0 ? recordedKeys.join(' ') : 'Press keys...'}
                </span>
              ) : (
                <div className="flex gap-1">
                  {newKeys.map((key, i) => (
                    <kbd
                      key={i}
                      className="px-2 py-0.5 rounded bg-surface text-xs font-mono text-text-primary"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleSave}
              className="p-1.5 rounded bg-accent-primary text-void hover:bg-accent-secondary"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={onCancel}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex gap-1 min-w-32">
              {keybinding.keys.map((key, i) => (
                <kbd
                  key={i}
                  className="px-2 py-0.5 rounded bg-elevated text-xs font-mono text-text-secondary"
                >
                  {key}
                </kbd>
              ))}
            </div>
            <button
              onClick={onEdit}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            >
              <Edit3 className="h-4 w-4" />
            </button>
            {keybinding.isCustom && (
              <button
                onClick={onReset}
                className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
                title="Reset to default"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function KeybindingsPage() {
  const { keybindings, updateKeybinding, resetKeybinding, resetAll } = useKeybindingsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Get unique categories
  const categories = Array.from(new Set(keybindings.map((k) => k.category)));

  // Filter keybindings
  const filteredKeybindings = keybindings.filter((k) => {
    const matchesSearch =
      searchQuery === '' ||
      k.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.keys.some((key) => key.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === null || k.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Group by category
  const groupedKeybindings = filteredKeybindings.reduce<Record<string, Keybinding[]>>((acc, k) => {
    const category = k.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category]!.push(k);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="pb-6 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <Keyboard className="h-6 w-6" />
              Keyboard Shortcuts
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Customize keyboard shortcuts for your workflow
            </p>
          </div>
          <button
            onClick={resetAll}
            className="px-3 py-1.5 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-overlay flex items-center gap-1.5"
          >
            <RotateCcw className="h-4 w-4" />
            Reset All
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search keybindings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={cn(
              'px-3 py-1 rounded-full text-xs whitespace-nowrap',
              selectedCategory === null
                ? 'bg-accent-primary text-void'
                : 'bg-overlay text-text-muted hover:text-text-primary'
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'px-3 py-1 rounded-full text-xs whitespace-nowrap',
                selectedCategory === cat
                  ? 'bg-accent-primary text-void'
                  : 'bg-overlay text-text-muted hover:text-text-primary'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Keybindings list */}
      <div className="mt-6">
        {Object.entries(groupedKeybindings).map(([category, bindings]) => (
          <div key={category}>
            <div className="px-4 py-2 bg-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
              {category}
            </div>
            {bindings.map((binding) => (
              <KeybindingRow
                key={binding.id}
                keybinding={binding}
                onEdit={() => setEditingId(binding.id)}
                onReset={() => resetKeybinding(binding.id)}
                isEditing={editingId === binding.id}
                onSave={(keys) => {
                  updateKeybinding(binding.id, keys);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Help */}
      <div className="mt-6 py-3 border-t border-border-subtle text-xs text-text-muted flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Click the edit button and press keys to record a new shortcut. Press Escape to cancel.
      </div>
    </div>
  );
}
