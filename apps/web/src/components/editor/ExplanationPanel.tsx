'use client';

import { useState, useCallback } from 'react';
import { X, Lightbulb, Copy, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { explainCode as explainCodeApi } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export interface CodeExplanation {
  summary: string;
  explanation: string;
  concepts: string[];
}

interface ExplanationPanelProps {
  code: string;
  language: string;
  onClose: () => void;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function ExplanationPanel({ code, language, onClose, className }: ExplanationPanelProps) {
  const [explanation, setExplanation] = useState<CodeExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Fetch explanation on mount
  useState(() => {
    explainCodeApi(code, language)
      .then((result) => setExplanation(result as CodeExplanation))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  });

  const handleCopy = useCallback(async () => {
    if (!explanation) return;

    const text = `## Summary\n${explanation.summary}\n\n## Explanation\n${explanation.explanation}\n\n## Concepts\n${explanation.concepts.join(', ')}`;

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [explanation]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn(
        'flex h-full w-80 flex-col border-l border-border-default bg-elevated',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-accent-warning" />
          <span className="text-sm font-medium text-text-primary">Code Explanation</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Copy explanation"
          >
            {copied ? (
              <Check className="h-4 w-4 text-accent-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
            <p className="mt-2 text-sm text-text-muted">Analyzing code...</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-accent-error/10 p-4 text-sm text-accent-error">{error}</div>
        )}

        {explanation && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg bg-overlay p-3">
              <h4 className="mb-1 text-xs font-medium uppercase text-text-muted">Summary</h4>
              <p className="text-sm text-text-primary">{explanation.summary}</p>
            </div>

            {/* Explanation */}
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="mb-2 flex w-full items-center justify-between text-left"
              >
                <h4 className="text-xs font-medium uppercase text-text-muted">Explanation</h4>
                {expanded ? (
                  <ChevronUp className="h-4 w-4 text-text-muted" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                )}
              </button>
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="prose prose-sm prose-invert max-w-none">
                      {explanation.explanation.split('\n').map((paragraph, i) => (
                        <p key={i} className="mb-2 text-sm text-text-secondary">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Concepts */}
            {explanation.concepts.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase text-text-muted">Key Concepts</h4>
                <div className="flex flex-wrap gap-1.5">
                  {explanation.concepts.map((concept, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-accent-primary/10 px-2.5 py-0.5 text-xs text-accent-primary"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Code preview */}
      <div className="border-t border-border-subtle">
        <div className="px-4 py-2">
          <h4 className="mb-1 text-xs font-medium uppercase text-text-muted">Selected Code</h4>
        </div>
        <pre className="max-h-32 overflow-auto bg-surface p-4 font-mono text-xs text-text-secondary">
          <code>{code.length > 500 ? code.slice(0, 500) + '...' : code}</code>
        </pre>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Hook for using explanation panel
// ============================================================================

import { createContext, useContext, type ReactNode } from 'react';

interface ExplanationContextValue {
  showExplanation: (code: string, language: string) => void;
  hideExplanation: () => void;
  isOpen: boolean;
}

const ExplanationContext = createContext<ExplanationContextValue | null>(null);

export function ExplanationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    code: string;
    language: string;
  }>({
    isOpen: false,
    code: '',
    language: '',
  });

  const showExplanation = useCallback((code: string, language: string) => {
    setState({ isOpen: true, code, language });
  }, []);

  const hideExplanation = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  return (
    <ExplanationContext.Provider value={{ showExplanation, hideExplanation, isOpen: state.isOpen }}>
      {children}
      <AnimatePresence>
        {state.isOpen && (
          <ExplanationPanel
            code={state.code}
            language={state.language}
            onClose={hideExplanation}
            className="fixed right-0 top-0 z-50 h-screen"
          />
        )}
      </AnimatePresence>
    </ExplanationContext.Provider>
  );
}

export function useExplanation(): ExplanationContextValue {
  const context = useContext(ExplanationContext);
  if (!context) {
    throw new Error('useExplanation must be used within ExplanationProvider');
  }
  return context;
}
