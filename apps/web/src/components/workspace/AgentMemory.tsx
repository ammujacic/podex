'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Edit2,
  Tag,
  Clock,
  User,
  Folder,
  X,
  Check,
  Star,
  Info,
  Code,
  Bug,
  Settings,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'context'
  | 'wiki'
  | 'code_pattern'
  | 'error_solution';
export type MemoryScope = 'user' | 'session' | 'project';

export interface Memory {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  tags: string[];
  importance: number; // 0-1
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

// ============================================================================
// Constants
// ============================================================================

const memoryTypeConfig: Record<
  MemoryType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  fact: { label: 'Fact', icon: <Info className="h-4 w-4" />, color: 'text-blue-400' },
  preference: {
    label: 'Preference',
    icon: <Settings className="h-4 w-4" />,
    color: 'text-purple-400',
  },
  context: { label: 'Context', icon: <Folder className="h-4 w-4" />, color: 'text-yellow-400' },
  wiki: { label: 'Wiki', icon: <FileText className="h-4 w-4" />, color: 'text-green-400' },
  code_pattern: {
    label: 'Code Pattern',
    icon: <Code className="h-4 w-4" />,
    color: 'text-cyan-400',
  },
  error_solution: { label: 'Error Fix', icon: <Bug className="h-4 w-4" />, color: 'text-red-400' },
};

const memoryScopeConfig: Record<MemoryScope, { label: string; icon: React.ReactNode }> = {
  user: { label: 'User', icon: <User className="h-4 w-4" /> },
  session: { label: 'Session', icon: <Clock className="h-4 w-4" /> },
  project: { label: 'Project', icon: <Folder className="h-4 w-4" /> },
};

// ============================================================================
// Memory Card Component
// ============================================================================

interface MemoryCardProps {
  memory: Memory;
  onEdit: (memory: Memory) => void;
  onDelete: (memoryId: string) => void;
  onUpdateImportance: (memoryId: string, importance: number) => void;
}

function MemoryCard({ memory, onEdit, onDelete, onUpdateImportance }: MemoryCardProps) {
  const typeConfig = memoryTypeConfig[memory.type];
  const scopeConfig = memoryScopeConfig[memory.scope];

  return (
    <div className="border border-border-subtle rounded-lg p-4 bg-surface hover:border-border-default transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex items-center gap-1', typeConfig.color)}>
            {typeConfig.icon}
            <span className="text-xs font-medium">{typeConfig.label}</span>
          </span>
          <span className="text-xs text-text-muted flex items-center gap-1">
            {scopeConfig.icon}
            {scopeConfig.label}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Importance stars */}
          <div className="flex items-center gap-0.5">
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((threshold) => (
              <button
                key={threshold}
                onClick={() => onUpdateImportance(memory.id, threshold)}
                className="p-0.5"
              >
                <Star
                  className={cn(
                    'h-3.5 w-3.5',
                    memory.importance >= threshold
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-text-muted'
                  )}
                />
              </button>
            ))}
          </div>

          <button
            onClick={() => onEdit(memory)}
            className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            className="p-1 rounded hover:bg-overlay text-text-muted hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <p className="text-sm text-text-secondary mb-3 line-clamp-3">{memory.content}</p>

      {/* Tags */}
      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {memory.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-elevated text-text-muted"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(memory.updatedAt).toLocaleDateString()}
        </span>
        <span>Used {memory.accessCount} times</span>
      </div>
    </div>
  );
}

// ============================================================================
// Memory Editor Modal
// ============================================================================

interface MemoryEditorProps {
  memory?: Memory;
  onSave: (memory: Partial<Memory>) => void;
  onClose: () => void;
}

function MemoryEditor({ memory, onSave, onClose }: MemoryEditorProps) {
  const [content, setContent] = useState(memory?.content || '');
  const [type, setType] = useState<MemoryType>(memory?.type || 'fact');
  const [scope, setScope] = useState<MemoryScope>(memory?.scope || 'session');
  const [tags, setTags] = useState<string[]>(memory?.tags || []);
  const [importance, setImportance] = useState(memory?.importance || 0.5);
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleSave = () => {
    onSave({
      id: memory?.id,
      content,
      type,
      scope,
      tags,
      importance,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h3 className="text-lg font-semibold text-text-primary">
            {memory ? 'Edit Memory' : 'Add Memory'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Type & Scope */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MemoryType)}
                className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-elevated text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                {Object.entries(memoryTypeConfig).map(([key, config]) => (
                  <option key={key} value={key}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as MemoryScope)}
                className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-elevated text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                {Object.entries(memoryScopeConfig).map(([key, config]) => (
                  <option key={key} value={key}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="What should the agent remember?"
              className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-elevated text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-elevated text-text-secondary"
                >
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-400">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                placeholder="Add tag..."
                className="flex-1 px-3 py-2 rounded-lg border border-border-subtle bg-elevated text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
              <button
                onClick={handleAddTag}
                className="px-3 py-2 rounded-lg bg-overlay hover:bg-elevated text-text-secondary"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Importance */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Importance: {Math.round(importance * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={importance}
              onChange={(e) => setImportance(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle bg-elevated">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-overlay hover:bg-elevated text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface AgentMemoryProps {
  sessionId: string;
  className?: string;
}

export function AgentMemory({ sessionId, className }: AgentMemoryProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<MemoryScope | 'all'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | undefined>();

  // Load memories
  useEffect(() => {
    async function loadMemories() {
      setLoading(true);
      try {
        // In real implementation, fetch from API
        // const data = await api.get<Memory[]>(`/api/sessions/${sessionId}/memories`);
        // setMemories(data);

        // Mock data for now
        setMemories([
          {
            id: '1',
            type: 'preference',
            scope: 'user',
            content: 'Prefers TypeScript over JavaScript for type safety',
            tags: ['language', 'typescript'],
            importance: 0.8,
            accessCount: 15,
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-15'),
          },
          {
            id: '2',
            type: 'code_pattern',
            scope: 'project',
            content: 'Uses Zustand for state management with devtools middleware',
            tags: ['state', 'zustand'],
            importance: 0.7,
            accessCount: 8,
            createdAt: new Date('2024-01-05'),
            updatedAt: new Date('2024-01-10'),
          },
          {
            id: '3',
            type: 'error_solution',
            scope: 'session',
            content:
              'Fixed hydration error by wrapping component in dynamic import with ssr: false',
            tags: ['nextjs', 'hydration', 'error'],
            importance: 0.9,
            accessCount: 3,
            createdAt: new Date('2024-01-14'),
            updatedAt: new Date('2024-01-14'),
          },
        ]);
      } catch (error) {
        console.error('Failed to load memories:', error);
      } finally {
        setLoading(false);
      }
    }

    loadMemories();
  }, [sessionId]);

  // Filter memories
  const filteredMemories = useMemo(() => {
    return memories.filter((memory) => {
      if (typeFilter !== 'all' && memory.type !== typeFilter) return false;
      if (scopeFilter !== 'all' && memory.scope !== scopeFilter) return false;
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !memory.content.toLowerCase().includes(searchLower) &&
          !memory.tags.some((t) => t.toLowerCase().includes(searchLower))
        ) {
          return false;
        }
      }
      return true;
    });
  }, [memories, typeFilter, scopeFilter, search]);

  // Handlers
  const handleEdit = (memory: Memory) => {
    setEditingMemory(memory);
    setEditorOpen(true);
  };

  const handleDelete = async (memoryId: string) => {
    // In real implementation, delete via API
    setMemories((prev) => prev.filter((m) => m.id !== memoryId));
  };

  const handleUpdateImportance = async (memoryId: string, importance: number) => {
    setMemories((prev) => prev.map((m) => (m.id === memoryId ? { ...m, importance } : m)));
  };

  const handleSave = async (memoryData: Partial<Memory>) => {
    if (memoryData.id) {
      // Update existing
      setMemories((prev) =>
        prev.map((m) =>
          m.id === memoryData.id ? { ...m, ...memoryData, updatedAt: new Date() } : m
        )
      );
    } else {
      // Create new
      const newMemory: Memory = {
        id: `new-${Date.now()}`,
        type: memoryData.type || 'fact',
        scope: memoryData.scope || 'session',
        content: memoryData.content || '',
        tags: memoryData.tags || [],
        importance: memoryData.importance || 0.5,
        accessCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setMemories((prev) => [newMemory, ...prev]);
    }
    setEditorOpen(false);
    setEditingMemory(undefined);
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Agent Memory</h2>
          <span className="text-sm text-text-muted">({memories.length})</span>
        </div>
        <button
          onClick={() => {
            setEditingMemory(undefined);
            setEditorOpen(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          Add Memory
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-elevated">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary text-sm"
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as MemoryType | 'all')}
          className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          <option value="all">All Types</option>
          {Object.entries(memoryTypeConfig).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>

        {/* Scope filter */}
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as MemoryScope | 'all')}
          className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          <option value="all">All Scopes</option>
          {Object.entries(memoryScopeConfig).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>
      </div>

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted">
            Loading memories...
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <Brain className="h-8 w-8 mb-2 opacity-50" />
            <p>No memories found</p>
            <p className="text-xs">Add memories to help agents remember important context</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredMemories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdateImportance={handleUpdateImportance}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <MemoryEditor
          memory={editingMemory}
          onSave={handleSave}
          onClose={() => {
            setEditorOpen(false);
            setEditingMemory(undefined);
          }}
        />
      )}
    </div>
  );
}
