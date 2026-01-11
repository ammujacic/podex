'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  MessageCircleQuestion,
  Send,
  Loader2,
  FileCode,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Sparkles,
  Search,
  AlertCircle,
} from 'lucide-react';

interface SearchSource {
  filePath: string;
  startLine: number;
  endLine: number;
  contentPreview: string;
  score: number;
  highlights: string[];
}

interface QAResult {
  query: string;
  answer: string;
  sources: SearchSource[];
  confidence: number;
  generatedAt: string;
}

interface QAHistory {
  id: string;
  query: string;
  answer: string;
  sources: SearchSource[];
  confidence: number;
  feedback?: 'positive' | 'negative';
  timestamp: Date;
}

interface CodebaseQAProps {
  sessionId: string;
  className?: string;
  onAsk?: (question: string) => Promise<QAResult>;
  onIndex?: () => Promise<{ chunks: number }>;
  onViewFile?: (filePath: string, line?: number) => void;
  onFeedback?: (historyId: string, feedback: 'positive' | 'negative') => void;
}

export function CodebaseQA({
  sessionId: _sessionId,
  className,
  onAsk,
  onIndex,
  onViewFile,
  onFeedback,
}: CodebaseQAProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [history, setHistory] = useState<QAHistory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const currentQuery = query.trim();
    setQuery('');
    setLoading(true);
    setError(null);

    try {
      const result = await onAsk?.(currentQuery);

      if (result) {
        const historyItem: QAHistory = {
          id: `qa-${Date.now()}`,
          query: result.query,
          answer: result.answer,
          sources: result.sources,
          confidence: result.confidence,
          timestamp: new Date(),
        };
        setHistory((prev) => [...prev, historyItem]);
      }
    } catch {
      setError('Failed to get answer. Please try again.');
      // Still add to history so user can see what was asked
      setHistory((prev) => [
        ...prev,
        {
          id: `qa-${Date.now()}`,
          query: currentQuery,
          answer: 'Failed to get answer. Please try again.',
          sources: [],
          confidence: 0,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleIndex = async () => {
    setIndexing(true);
    try {
      const result = await onIndex?.();
      if (result) {
        // Show success message
      }
    } catch {
      setError('Failed to index codebase');
    } finally {
      setIndexing(false);
    }
  };

  const handleFeedback = (historyId: string, feedback: 'positive' | 'negative') => {
    setHistory((prev) =>
      prev.map((item) => (item.id === historyId ? { ...item, feedback } : item))
    );
    onFeedback?.(historyId, feedback);
  };

  const suggestedQuestions = [
    'How does authentication work?',
    'Where are API endpoints defined?',
    'What database is used?',
    'How are errors handled?',
  ];

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="w-5 h-5 text-accent-primary" />
          <div>
            <h3 className="font-semibold">Codebase Q&A</h3>
            <p className="text-xs text-text-muted">Ask questions about your code</p>
          </div>
        </div>
        <button
          onClick={handleIndex}
          disabled={indexing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border-subtle hover:bg-surface-hover disabled:opacity-50"
          title="Re-index codebase"
        >
          {indexing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Index
        </button>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles className="w-12 h-12 mb-3 text-accent-primary opacity-50" />
            <p className="text-lg font-medium">Ask anything about your codebase</p>
            <p className="text-sm text-text-muted mt-1">
              Get answers with references to specific files and lines
            </p>

            {/* Suggested Questions */}
            <div className="mt-6 w-full max-w-md">
              <p className="text-xs text-text-muted mb-2">Try asking:</p>
              <div className="grid grid-cols-2 gap-2">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuery(q);
                      inputRef.current?.focus();
                    }}
                    className="px-3 py-2 text-sm text-left rounded border border-border-subtle hover:border-accent-primary hover:bg-accent-primary/5 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          history.map((item) => (
            <QAHistoryItem
              key={item.id}
              item={item}
              onViewFile={onViewFile}
              onFeedback={(feedback) => handleFeedback(item.id, feedback)}
            />
          ))
        )}

        {loading && (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-surface-secondary">
            <Loader2 className="w-4 h-4 animate-spin text-accent-primary" />
            <span className="text-sm text-text-muted">Searching codebase...</span>
          </div>
        )}

        <div ref={historyEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-500 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your code..."
              disabled={loading}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim() || loading}
            className="p-2.5 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

interface QAHistoryItemProps {
  item: QAHistory;
  onViewFile?: (filePath: string, line?: number) => void;
  onFeedback: (feedback: 'positive' | 'negative') => void;
}

function QAHistoryItem({ item, onViewFile, onFeedback }: QAHistoryItemProps) {
  const [showSources, setShowSources] = useState(false);

  const confidenceColor =
    item.confidence >= 0.7
      ? 'text-green-500'
      : item.confidence >= 0.4
        ? 'text-yellow-500'
        : 'text-red-500';

  return (
    <div className="space-y-3">
      {/* Question */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-surface-secondary flex items-center justify-center flex-shrink-0">
          <MessageCircleQuestion className="w-4 h-4 text-text-muted" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{item.query}</p>
          <p className="text-xs text-text-muted mt-0.5">{item.timestamp.toLocaleTimeString()}</p>
        </div>
      </div>

      {/* Answer */}
      <div className="flex items-start gap-3 ml-11">
        <div className="flex-1 p-4 rounded-lg bg-surface-secondary">
          <div className="prose prose-sm prose-invert max-w-none">
            <p className="whitespace-pre-wrap">{item.answer}</p>
          </div>

          {/* Confidence and Sources Toggle */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
            <div className="flex items-center gap-3 text-xs">
              <span className={cn('flex items-center gap-1', confidenceColor)}>
                <Sparkles className="w-3 h-3" />
                {Math.round(item.confidence * 100)}% confidence
              </span>
              {item.sources.length > 0 && (
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="text-text-muted hover:text-text-primary flex items-center gap-1"
                >
                  <FileCode className="w-3 h-3" />
                  {item.sources.length} source{item.sources.length > 1 ? 's' : ''}
                </button>
              )}
            </div>

            {/* Feedback */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onFeedback('positive')}
                className={cn(
                  'p-1.5 rounded hover:bg-green-500/20',
                  item.feedback === 'positive' ? 'text-green-500' : 'text-text-muted'
                )}
                title="Helpful"
              >
                <ThumbsUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => onFeedback('negative')}
                className={cn(
                  'p-1.5 rounded hover:bg-red-500/20',
                  item.feedback === 'negative' ? 'text-red-500' : 'text-text-muted'
                )}
                title="Not helpful"
              >
                <ThumbsDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sources */}
          {showSources && item.sources.length > 0 && (
            <div className="mt-3 space-y-2">
              {item.sources.map((source, i) => (
                <div key={i} className="p-2 rounded bg-surface-primary border border-border-subtle">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => onViewFile?.(source.filePath, source.startLine)}
                      className="text-sm text-accent-primary hover:underline flex items-center gap-1"
                    >
                      <FileCode className="w-3 h-3" />
                      {source.filePath}:{source.startLine}-{source.endLine}
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <span className="text-xs text-text-muted">
                      {Math.round(source.score * 100)}% match
                    </span>
                  </div>
                  <pre className="mt-1 text-xs text-text-muted overflow-x-auto">
                    {source.contentPreview}
                  </pre>
                  {source.highlights.length > 0 && (
                    <div className="mt-1 text-xs text-yellow-500 italic">
                      {source.highlights[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CodebaseQA;
