'use client';

import { useState } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  Edit3,
  ChevronDown,
  ChevronUp,
  Loader2,
  GitPullRequest,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generatePRDescription } from '@/lib/ai/generators';

// ============================================================================
// Types
// ============================================================================

interface PRDescriptionGeneratorProps {
  baseBranch: string;
  headBranch: string;
  commits: Array<{
    message: string;
    hash: string;
    author: string;
    date: string;
  }>;
  diffSummary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  diff: string;
  linkedIssues?: string[];
  onGenerated: (description: { title: string; body: string }) => void;
  className?: string;
}

interface GeneratedPR {
  title: string;
  summary: string;
  changes: string[];
  testPlan?: string;
  checklist?: string[];
}

// ============================================================================
// Main Component
// ============================================================================

export function PRDescriptionGenerator({
  baseBranch,
  headBranch,
  commits,
  diffSummary,
  diff,
  linkedIssues,
  onGenerated,
  className,
}: PRDescriptionGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedPR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedBody, setEditedBody] = useState('');

  // Sections visibility
  const [showSummary, setShowSummary] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [showTestPlan, setShowTestPlan] = useState(true);
  const [showChecklist, setShowChecklist] = useState(true);

  const generate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const result = await generatePRDescription({
        baseBranch,
        headBranch,
        commits,
        diffSummary,
        diff,
        linkedIssues,
      });

      setGenerated(result);
      setEditedTitle(result.title);
      setEditedBody(formatBody(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate description');
    } finally {
      setIsGenerating(false);
    }
  };

  const formatBody = (pr: GeneratedPR): string => {
    let body = '';

    if (pr.summary) {
      body += `## Summary\n${pr.summary}\n\n`;
    }

    if (pr.changes.length > 0) {
      body += `## Changes\n${pr.changes.map((c) => `- ${c}`).join('\n')}\n\n`;
    }

    if (pr.testPlan) {
      body += `## Test Plan\n${pr.testPlan}\n\n`;
    }

    if (pr.checklist && pr.checklist.length > 0) {
      body += `## Checklist\n${pr.checklist.map((c) => `- [ ] ${c}`).join('\n')}\n`;
    }

    return body.trim();
  };

  const handleCopy = () => {
    const text = `# ${editedTitle}\n\n${editedBody}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUse = () => {
    onGenerated({
      title: editedTitle,
      body: editedBody,
    });
  };

  return (
    <div className={cn('rounded-lg border border-border-subtle bg-elevated', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">AI PR Description</span>
        </div>
        <button
          onClick={generate}
          disabled={isGenerating || commits.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-accent-primary text-void disabled:opacity-50"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {/* Context info */}
      <div className="px-4 py-2 bg-surface border-b border-border-subtle text-xs text-text-muted flex items-center gap-4">
        <span>{commits.length} commits</span>
        <span>{diffSummary.filesChanged} files</span>
        <span className="text-green-400">+{diffSummary.additions}</span>
        <span className="text-red-400">-{diffSummary.deletions}</span>
      </div>

      {/* Error */}
      {error && <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10">{error}</div>}

      {/* Generated content */}
      {generated && (
        <div className="p-4">
          {isEditing ? (
            <div className="space-y-4">
              {/* Editable title */}
              <div>
                <label className="text-xs text-text-muted mb-1 block">Title</label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-surface border border-border-default text-text-primary focus:outline-none focus:border-accent-primary"
                />
              </div>

              {/* Editable body */}
              <div>
                <label className="text-xs text-text-muted mb-1 block">Description</label>
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={15}
                  className="w-full px-3 py-2 rounded bg-surface border border-border-default text-text-primary font-mono text-sm focus:outline-none focus:border-accent-primary resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Title */}
              <div>
                <h3 className="text-lg font-semibold text-text-primary">{generated.title}</h3>
              </div>

              {/* Summary */}
              <div>
                <button
                  onClick={() => setShowSummary(!showSummary)}
                  className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
                >
                  {showSummary ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                  Summary
                </button>
                {showSummary && (
                  <p className="text-sm text-text-secondary pl-6">{generated.summary}</p>
                )}
              </div>

              {/* Changes */}
              {generated.changes.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowChanges(!showChanges)}
                    className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
                  >
                    {showChanges ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                    Changes ({generated.changes.length})
                  </button>
                  {showChanges && (
                    <ul className="text-sm text-text-secondary pl-6 space-y-1">
                      {generated.changes.map((change, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-accent-primary">•</span>
                          {change}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Test Plan */}
              {generated.testPlan && (
                <div>
                  <button
                    onClick={() => setShowTestPlan(!showTestPlan)}
                    className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
                  >
                    {showTestPlan ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                    Test Plan
                  </button>
                  {showTestPlan && (
                    <p className="text-sm text-text-secondary pl-6">{generated.testPlan}</p>
                  )}
                </div>
              )}

              {/* Checklist */}
              {generated.checklist && generated.checklist.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowChecklist(!showChecklist)}
                    className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
                  >
                    {showChecklist ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                    Checklist ({generated.checklist.length})
                  </button>
                  {showChecklist && (
                    <ul className="text-sm text-text-secondary pl-6 space-y-1">
                      {generated.checklist.map((item, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <input type="checkbox" className="rounded border-border-default" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* No content placeholder */}
      {!generated && !error && (
        <div className="p-8 text-center text-sm text-text-muted">
          Click "Generate" to create a PR description based on your commits
        </div>
      )}

      {/* Actions */}
      {generated && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-surface">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm',
                isEditing
                  ? 'bg-accent-primary/20 text-accent-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
              )}
            >
              <Edit3 className="h-4 w-4" />
              {isEditing ? 'Preview' : 'Edit'}
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={generate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </button>
          </div>
          <button
            onClick={handleUse}
            className="px-4 py-1.5 rounded text-sm bg-accent-primary text-void"
          >
            Use This Description
          </button>
        </div>
      )}
    </div>
  );
}
