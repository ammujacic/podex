'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Trash2,
  Search,
  RefreshCw,
  Tag,
  Calendar,
  Loader2,
  AlertTriangle,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';
import { getMemories, getMemoriesStats, deleteMemory, clearAllMemories } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

interface Memory {
  id: string;
  content: string;
  memory_type: string;
  tags: string[] | null;
  importance: number;
  session_id: string | null;
  project_id: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}

interface MemoryStats {
  total_memories: number;
  by_type: Record<string, number>;
  by_session: number;
  by_project: number;
  average_importance: number;
  oldest_memory: string | null;
  newest_memory: string | null;
}

// ============================================================================
// Memory Type Badge
// ============================================================================

function MemoryTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    fact: { label: 'Fact', className: 'bg-blue-500/20 text-blue-400' },
    preference: { label: 'Preference', className: 'bg-purple-500/20 text-purple-400' },
    context: { label: 'Context', className: 'bg-yellow-500/20 text-yellow-400' },
    code_pattern: { label: 'Pattern', className: 'bg-green-500/20 text-green-400' },
    error_solution: { label: 'Solution', className: 'bg-red-500/20 text-red-400' },
    wiki: { label: 'Wiki', className: 'bg-cyan-500/20 text-cyan-400' },
  };

  const cfg = config[type] || { label: type, className: 'bg-gray-500/20 text-gray-400' };

  return (
    <span className={cn('px-2 py-0.5 text-xs font-medium rounded', cfg.className)}>
      {cfg.label}
    </span>
  );
}

// ============================================================================
// Memory Card
// ============================================================================

function MemoryCard({
  memory,
  onDelete,
  isDeleting,
}: {
  memory: Memory;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface border border-border-default rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2 mb-2">
            <MemoryTypeBadge type={memory.memory_type} />
            {memory.tags && memory.tags.length > 0 && (
              <div className="flex items-center gap-1">
                <Tag className="w-3 h-3 text-text-muted" />
                <span className="text-xs text-text-muted">
                  {memory.tags.slice(0, 3).join(', ')}
                  {memory.tags.length > 3 && ` +${memory.tags.length - 3}`}
                </span>
              </div>
            )}
          </div>
          <p className={cn('text-sm text-text-primary', !expanded && 'line-clamp-2')}>
            {memory.content}
          </p>
          {expanded && (
            <div className="mt-3 pt-3 border-t border-border-subtle text-xs text-text-muted">
              <div className="grid grid-cols-2 gap-2">
                <div>Importance: {(memory.importance * 100).toFixed(0)}%</div>
                <div>
                  Created:{' '}
                  {new Date(memory.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => onDelete(memory.id)}
          disabled={isDeleting}
          className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors disabled:opacity-50"
          title="Delete memory"
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Stats Card
// ============================================================================

function StatsCard({ stats }: { stats: MemoryStats | null }) {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Brain className="w-4 h-4" />
          <span className="text-xs">Total Memories</span>
        </div>
        <p className="text-2xl font-semibold text-text-primary">{stats.total_memories}</p>
      </div>
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs">Avg. Importance</span>
        </div>
        <p className="text-2xl font-semibold text-text-primary">
          {(stats.average_importance * 100).toFixed(0)}%
        </p>
      </div>
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Tag className="w-4 h-4" />
          <span className="text-xs">By Type</span>
        </div>
        <p className="text-sm text-text-primary">{Object.keys(stats.by_type).length} types</p>
      </div>
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Calendar className="w-4 h-4" />
          <span className="text-xs">Date Range</span>
        </div>
        <p className="text-xs text-text-primary">
          {stats.oldest_memory ? new Date(stats.oldest_memory).toLocaleDateString() : 'N/A'} -{' '}
          {stats.newest_memory ? new Date(stats.newest_memory).toLocaleDateString() : 'N/A'}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function MemorySettingsPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchMemories = useCallback(async () => {
    try {
      const data = await getMemories({
        page,
        page_size: 20,
        search: searchQuery || undefined,
        category: selectedType || undefined,
      });
      const transformedMemories: Memory[] = data.memories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        memory_type: memory.category,
        tags: null, // Default since API doesn't provide tags
        importance: 0.5, // Default importance
        session_id: null, // Default since API doesn't provide
        project_id: null, // Default since API doesn't provide
        access_count: 0, // Default since API doesn't provide
        created_at: memory.created_at,
        updated_at: memory.updated_at,
      }));
      setMemories(transformedMemories);
      setTotalPages(data.total_pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    }
  }, [page, searchQuery, selectedType]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getMemoriesStats();
      setStats(data as MemoryStats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([fetchMemories(), fetchStats()]);
      setIsLoading(false);
    };
    load();
  }, [fetchMemories, fetchStats]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await clearAllMemories();
      setMemories([]);
      setShowClearConfirm(false);
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear memories');
    } finally {
      setIsClearing(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchMemories();
  };

  const memoryTypes = ['fact', 'preference', 'context', 'code_pattern', 'error_solution', 'wiki'];

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
          <Brain className="w-6 h-6" />
          Agent Memory
        </h1>
        <p className="text-text-muted mt-1">Manage memories stored by your AI agents</p>
      </div>

      {/* Stats */}
      <StatsCard stats={stats} />

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
          />
        </form>

        <select
          value={selectedType || ''}
          onChange={(e) => {
            setSelectedType(e.target.value || null);
            setPage(1);
          }}
          className="px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
        >
          <option value="">All Types</option>
          {memoryTypes.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>

        <Button
          onClick={() => {
            fetchMemories();
            fetchStats();
          }}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Memories List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          <span className="ml-2 text-text-muted">Loading memories...</span>
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-12">
          <Brain className="w-12 h-12 mx-auto text-text-muted opacity-30 mb-4" />
          <p className="text-text-muted">No memories found</p>
          <p className="text-sm text-text-muted mt-1">
            Memories are created when agents learn from your interactions
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onDelete={handleDelete}
              isDeleting={deletingId === memory.id}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Danger Zone */}
      <section className="mt-12 pt-8 border-t border-border-default">
        <h2 className="text-lg font-medium text-red-400 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Danger Zone
        </h2>
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Clear All Memories</p>
              <p className="text-sm text-text-muted">
                Permanently delete all memories. This action cannot be undone.
              </p>
            </div>
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" onClick={handleClearAll} disabled={isClearing}>
                  {isClearing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-1" />
                  )}
                  Confirm
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setShowClearConfirm(true)}>
                <Trash2 className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
