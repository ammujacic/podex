'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/Skeleton';
import { Loader2, Terminal, Code } from 'lucide-react';

// Loading skeleton for the code editor
function EditorLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        <Code className="h-4 w-4 text-text-muted animate-pulse" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex-1 p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

// Loading skeleton for terminal
function TerminalLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-text-muted" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-6 w-6 rounded" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center bg-[#0d0d12]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-accent-primary" />
          <span className="text-sm text-text-muted">Loading terminal...</span>
        </div>
      </div>
    </div>
  );
}

// Loading skeleton for agent card
function AgentCardLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col bg-surface border border-border-default rounded-xl p-4">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-5 w-24 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-primary" />
      </div>
    </div>
  );
}

// Lazy-loaded CodeEditor
export const LazyCodeEditor = dynamic(
  () => import('./CodeEditor').then((mod) => ({ default: mod.CodeEditor })),
  {
    loading: () => <EditorLoadingSkeleton />,
    ssr: false,
  }
);

// Lazy-loaded TerminalPanel
export const LazyTerminalPanel = dynamic(
  () => import('./TerminalPanel').then((mod) => ({ default: mod.TerminalPanel })),
  {
    loading: () => <TerminalLoadingSkeleton />,
    ssr: false,
  }
);

// Lazy-loaded AgentCard
export const LazyAgentCard = dynamic(
  () => import('./AgentCard').then((mod) => ({ default: mod.AgentCard })),
  {
    loading: () => <AgentCardLoadingSkeleton />,
    ssr: false,
  }
);

// Lazy-loaded GitPanel
export const LazyGitPanel = dynamic(
  () => import('./GitPanel').then((mod) => ({ default: mod.GitPanel })),
  {
    loading: () => (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    ),
    ssr: false,
  }
);

// Re-export getLanguageFromPath for convenience
export { getLanguageFromPath } from '@/lib/vscode/languageUtils';
