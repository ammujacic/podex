'use client';

import { useState } from 'react';
import { Sparkles, Copy, Check, RefreshCw, Settings, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateCommitMessage } from '@/lib/ai/generators';

// ============================================================================
// Types
// ============================================================================

interface CommitMessageGeneratorProps {
  stagedDiff: string;
  unstagedDiff: string;
  fileChanges: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  recentCommits?: Array<{ message: string; hash: string }>;
  onSelect: (message: { subject: string; body?: string }) => void;
  className?: string;
}

type CommitStyle = 'conventional' | 'simple' | 'detailed';

// ============================================================================
// Main Component
// ============================================================================

export function CommitMessageGenerator({
  stagedDiff,
  unstagedDiff,
  fileChanges,
  recentCommits,
  onSelect,
  className,
}: CommitMessageGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ subject: string; body?: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [style, setStyle] = useState<CommitStyle>('conventional');
  const [includeScope, setIncludeScope] = useState(true);
  const [includeBody, setIncludeBody] = useState(true);

  const generate = async () => {
    if (!stagedDiff || fileChanges.length === 0) {
      setError('No staged changes to generate message for');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Generate 3 suggestions with slight variations
      const results = await Promise.all([
        generateCommitMessage(
          { stagedDiff, unstagedDiff, fileChanges, recentCommits },
          { style, includeScope, includeBody, temperature: 0.7 }
        ),
        generateCommitMessage(
          { stagedDiff, unstagedDiff, fileChanges, recentCommits },
          { style, includeScope, includeBody, temperature: 0.9 }
        ),
        generateCommitMessage(
          { stagedDiff, unstagedDiff, fileChanges, recentCommits },
          { style, includeScope, includeBody: false, temperature: 0.7 }
        ),
      ]);

      // Deduplicate by subject
      const unique = results.filter(
        (r, i, arr) => arr.findIndex((a) => a.subject === r.subject) === i
      );

      setSuggestions(unique);
      setSelectedIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate message');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (selectedIndex === null) return;
    const msg = suggestions[selectedIndex];
    if (!msg) return;
    const text = msg.body ? `${msg.subject}\n\n${msg.body}` : msg.subject;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelect = () => {
    if (selectedIndex === null) return;
    const msg = suggestions[selectedIndex];
    if (!msg) return;
    onSelect(msg);
  };

  return (
    <div className={cn('rounded-lg border border-border-subtle bg-elevated', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">AI Commit Message</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              'p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary',
              showSettings && 'bg-overlay text-text-primary'
            )}
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            onClick={generate}
            disabled={isGenerating || fileChanges.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-accent-primary text-void disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-border-subtle bg-surface space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Style</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as CommitStyle)}
              className="px-2 py-1 rounded bg-elevated border border-border-default text-sm text-text-primary"
            >
              <option value="conventional">Conventional Commits</option>
              <option value="simple">Simple</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Include scope</span>
            <button
              onClick={() => setIncludeScope(!includeScope)}
              className={cn(
                'w-8 h-5 rounded-full transition-colors',
                includeScope ? 'bg-accent-primary' : 'bg-overlay'
              )}
            >
              <span
                className={cn(
                  'block w-3 h-3 rounded-full bg-white transition-transform',
                  includeScope ? 'translate-x-4' : 'translate-x-1'
                )}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Include body</span>
            <button
              onClick={() => setIncludeBody(!includeBody)}
              className={cn(
                'w-8 h-5 rounded-full transition-colors',
                includeBody ? 'bg-accent-primary' : 'bg-overlay'
              )}
            >
              <span
                className={cn(
                  'block w-3 h-3 rounded-full bg-white transition-transform',
                  includeBody ? 'translate-x-4' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10">{error}</div>}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="p-4 space-y-2">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => setSelectedIndex(index)}
              className={cn(
                'w-full text-left p-3 rounded-lg border transition-colors',
                selectedIndex === index
                  ? 'border-accent-primary bg-accent-primary/10'
                  : 'border-border-subtle hover:border-border-default'
              )}
            >
              <div className="text-sm font-mono text-text-primary mb-1">{suggestion.subject}</div>
              {suggestion.body && (
                <div className="text-xs text-text-muted line-clamp-2">{suggestion.body}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* No suggestions placeholder */}
      {suggestions.length === 0 && !error && (
        <div className="p-8 text-center text-sm text-text-muted">
          {fileChanges.length === 0
            ? 'Stage some changes to generate a commit message'
            : 'Click "Generate" to create commit message suggestions'}
        </div>
      )}

      {/* Actions */}
      {suggestions.length > 0 && selectedIndex !== null && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-surface">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleSelect}
            className="px-4 py-1.5 rounded text-sm bg-accent-primary text-void"
          >
            Use This Message
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Compact Version (for inline use)
// ============================================================================

interface CompactCommitMessageGeneratorProps {
  stagedDiff: string;
  fileChanges: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  onGenerated: (message: string) => void;
  className?: string;
}

export function CompactCommitMessageGenerator({
  stagedDiff,
  fileChanges,
  onGenerated,
  className,
}: CompactCommitMessageGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async () => {
    if (!stagedDiff || fileChanges.length === 0) return;

    setIsGenerating(true);
    try {
      const result = await generateCommitMessage(
        { stagedDiff, unstagedDiff: '', fileChanges },
        { style: 'conventional', includeBody: false }
      );
      onGenerated(result.subject);
    } catch {
      // Ignore errors in compact mode
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      onClick={generate}
      disabled={isGenerating || fileChanges.length === 0}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
        'text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50',
        className
      )}
      title="Generate commit message with AI"
    >
      {isGenerating ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {isGenerating ? 'Generating...' : 'AI Message'}
    </button>
  );
}
