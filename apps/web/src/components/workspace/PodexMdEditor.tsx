'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  FileText,
  Save,
  RefreshCw,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  AlertCircle,
  Info,
  Code,
  List,
  Settings,
  Loader2,
} from 'lucide-react';

interface ProjectContext {
  projectName: string;
  description: string;
  techStack: string[];
  architecture: string;
  keyPatterns: string[];
  importantFiles: string[];
  codingConventions: string[];
  commonCommands: Record<string, string>;
  knownIssues: string[];
  recentChanges: string[];
  customInstructions: string;
  lastModified: string | null;
}

interface PodexMdEditorProps {
  sessionId: string;
  className?: string;
  initialContext?: ProjectContext;
  onSave?: (context: ProjectContext) => Promise<void>;
  onLoad?: () => Promise<ProjectContext | null>;
}

const EMPTY_CONTEXT: ProjectContext = {
  projectName: '',
  description: '',
  techStack: [],
  architecture: '',
  keyPatterns: [],
  importantFiles: [],
  codingConventions: [],
  commonCommands: {},
  knownIssues: [],
  recentChanges: [],
  customInstructions: '',
  lastModified: null,
};

const SECTIONS = [
  { key: 'description', label: 'Description', icon: Info, type: 'text' },
  { key: 'techStack', label: 'Tech Stack', icon: Code, type: 'list' },
  { key: 'architecture', label: 'Architecture', icon: Settings, type: 'text' },
  { key: 'keyPatterns', label: 'Key Patterns', icon: List, type: 'list' },
  { key: 'importantFiles', label: 'Important Files', icon: FileText, type: 'list' },
  { key: 'codingConventions', label: 'Coding Conventions', icon: Check, type: 'list' },
  { key: 'commonCommands', label: 'Common Commands', icon: Code, type: 'commands' },
  { key: 'knownIssues', label: 'Known Issues', icon: AlertCircle, type: 'list' },
  { key: 'recentChanges', label: 'Recent Changes', icon: RefreshCw, type: 'list' },
  { key: 'customInstructions', label: 'Custom Instructions', icon: Settings, type: 'text' },
] as const;

export function PodexMdEditor({
  sessionId,
  className,
  initialContext,
  onSave,
  onLoad,
}: PodexMdEditorProps) {
  const [context, setContext] = useState<ProjectContext>(initialContext || EMPTY_CONTEXT);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['description']));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await onLoad?.();
      if (loaded) {
        setContext(loaded);
      }
    } catch {
      setError('Failed to load PODEX.md');
    } finally {
      setLoading(false);
    }
  }, [onLoad]);

  useEffect(() => {
    if (!initialContext && onLoad) {
      loadContext();
    }
  }, [sessionId, initialContext, onLoad, loadContext]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave?.(context);
      setHasChanges(false);
    } catch {
      setError('Failed to save PODEX.md');
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof ProjectContext>(key: K, value: ProjectContext[K]) => {
    setContext((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const addListItem = (
    key:
      | 'techStack'
      | 'keyPatterns'
      | 'importantFiles'
      | 'codingConventions'
      | 'knownIssues'
      | 'recentChanges'
  ) => {
    updateField(key, [...context[key], '']);
  };

  const updateListItem = (
    key:
      | 'techStack'
      | 'keyPatterns'
      | 'importantFiles'
      | 'codingConventions'
      | 'knownIssues'
      | 'recentChanges',
    index: number,
    value: string
  ) => {
    const newList = [...context[key]];
    newList[index] = value;
    updateField(key, newList);
  };

  const removeListItem = (
    key:
      | 'techStack'
      | 'keyPatterns'
      | 'importantFiles'
      | 'codingConventions'
      | 'knownIssues'
      | 'recentChanges',
    index: number
  ) => {
    updateField(
      key,
      context[key].filter((_, i) => i !== index)
    );
  };

  const addCommand = () => {
    updateField('commonCommands', { ...context.commonCommands, '': '' });
  };

  const updateCommand = (oldKey: string, newKey: string, value: string) => {
    const newCommands = { ...context.commonCommands };
    if (oldKey !== newKey) {
      delete newCommands[oldKey];
    }
    newCommands[newKey] = value;
    updateField('commonCommands', newCommands);
  };

  const removeCommand = (key: string) => {
    const newCommands = { ...context.commonCommands };
    delete newCommands[key];
    updateField('commonCommands', newCommands);
  };

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-accent-primary" />
          <div>
            <h3 className="font-semibold">PODEX.md</h3>
            <p className="text-xs text-text-muted">Project memory for AI context</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-500">
              Unsaved
            </span>
          )}
          <button
            onClick={loadContext}
            className="p-2 rounded hover:bg-surface-hover text-text-muted"
            title="Reload"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-500 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Project Name */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <label className="text-sm font-medium mb-1 block">Project Name</label>
        <input
          type="text"
          value={context.projectName}
          onChange={(e) => updateField('projectName', e.target.value)}
          placeholder="My Awesome Project"
          className="w-full px-3 py-2 text-lg font-semibold rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
        />
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isExpanded = expandedSections.has(section.key);

          return (
            <div key={section.key} className="border-b border-border-subtle">
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surface-hover transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-text-muted" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-text-muted" />
                )}
                <Icon className="w-4 h-4 text-accent-primary" />
                <span className="font-medium">{section.label}</span>
                {section.type === 'list' && (
                  <span className="ml-auto text-xs text-text-muted">
                    {(context[section.key] as string[]).length} items
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pl-10">
                  {section.type === 'text' && (
                    <textarea
                      value={context[section.key] as string}
                      onChange={(e) =>
                        updateField(section.key as keyof ProjectContext, e.target.value)
                      }
                      placeholder={`Enter ${section.label.toLowerCase()}...`}
                      rows={4}
                      className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary resize-none"
                    />
                  )}

                  {section.type === 'list' && (
                    <div className="space-y-2">
                      {(context[section.key] as string[]).map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) =>
                              updateListItem(
                                section.key as
                                  | 'techStack'
                                  | 'keyPatterns'
                                  | 'importantFiles'
                                  | 'codingConventions'
                                  | 'knownIssues'
                                  | 'recentChanges',
                                i,
                                e.target.value
                              )
                            }
                            placeholder="Enter item..."
                            className="flex-1 px-3 py-1.5 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
                          />
                          <button
                            onClick={() =>
                              removeListItem(
                                section.key as
                                  | 'techStack'
                                  | 'keyPatterns'
                                  | 'importantFiles'
                                  | 'codingConventions'
                                  | 'knownIssues'
                                  | 'recentChanges',
                                i
                              )
                            }
                            className="p-1.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          addListItem(
                            section.key as
                              | 'techStack'
                              | 'keyPatterns'
                              | 'importantFiles'
                              | 'codingConventions'
                              | 'knownIssues'
                              | 'recentChanges'
                          )
                        }
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
                      >
                        <Plus className="w-4 h-4" />
                        Add item
                      </button>
                    </div>
                  )}

                  {section.type === 'commands' && (
                    <div className="space-y-2">
                      {Object.entries(context.commonCommands).map(([cmd, desc], i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={cmd}
                            onChange={(e) => updateCommand(cmd, e.target.value, desc)}
                            placeholder="command"
                            className="w-1/3 px-3 py-1.5 text-sm font-mono rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
                          />
                          <span className="text-text-muted">:</span>
                          <input
                            type="text"
                            value={desc}
                            onChange={(e) => updateCommand(cmd, cmd, e.target.value)}
                            placeholder="description"
                            className="flex-1 px-3 py-1.5 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
                          />
                          <button
                            onClick={() => removeCommand(cmd)}
                            className="p-1.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={addCommand}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
                      >
                        <Plus className="w-4 h-4" />
                        Add command
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Last Modified */}
      {context.lastModified && (
        <div className="px-4 py-2 text-xs text-text-muted border-t border-border-subtle">
          Last modified: {new Date(context.lastModified).toLocaleString()}
        </div>
      )}
    </div>
  );
}

export default PodexMdEditor;
