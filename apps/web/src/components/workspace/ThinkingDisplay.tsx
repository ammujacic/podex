'use client';

import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Brain, ChevronDown, ChevronRight, Loader2, Lightbulb, Clock } from 'lucide-react';

interface ThinkingBlock {
  id: string;
  content: string;
  timestamp: number;
  duration?: number;
}

interface ThinkingDisplayProps {
  thinking: ThinkingBlock | ThinkingBlock[] | null;
  isActive?: boolean;
  defaultExpanded?: boolean;
  className?: string;
  maxHeight?: number;
  showDuration?: boolean;
}

export function ThinkingDisplay({
  thinking,
  isActive = false,
  defaultExpanded = false,
  className,
  maxHeight = 300,
  showDuration = true,
}: ThinkingDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [displayedContent, setDisplayedContent] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const blocks = Array.isArray(thinking) ? thinking : thinking ? [thinking] : [];
  const latestBlock = blocks[blocks.length - 1];
  const totalContent = blocks.map((b) => b.content).join('\n\n');

  // Animate thinking text when active
  useEffect(() => {
    if (!isActive || !latestBlock) {
      setDisplayedContent(totalContent);
      return;
    }

    // Typewriter effect for active thinking
    let currentIndex = displayedContent.length;
    const targetLength = totalContent.length;

    if (currentIndex >= targetLength) return;

    const interval = setInterval(() => {
      currentIndex += 3; // Characters per tick
      setDisplayedContent(totalContent.slice(0, currentIndex));

      if (currentIndex >= targetLength) {
        clearInterval(interval);
      }
    }, 20);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalContent, isActive]);

  // Auto-scroll to bottom when content updates
  useEffect(() => {
    if (contentRef.current && isActive) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedContent, isActive]);

  if (!thinking || blocks.length === 0) {
    return null;
  }

  const totalDuration = blocks.reduce((acc, b) => acc + (b.duration || 0), 0);

  return (
    <div
      className={cn(
        'rounded-lg border transition-colors',
        isActive
          ? 'border-purple-500/30 bg-purple-500/5'
          : 'border-border-subtle bg-surface-secondary/50',
        className
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}

        <Brain
          className={cn('w-4 h-4', isActive ? 'text-purple-500 animate-pulse' : 'text-purple-400')}
        />

        <span className="text-sm font-medium text-purple-400">
          {isActive ? 'Thinking...' : 'Thought Process'}
        </span>

        {isActive && <Loader2 className="w-3 h-3 ml-1 animate-spin text-purple-400" />}

        <div className="flex-1" />

        {showDuration && totalDuration > 0 && (
          <span className="flex items-center gap-1 text-xs text-text-muted">
            <Clock className="w-3 h-3" />
            {formatDuration(totalDuration)}
          </span>
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div ref={contentRef} className="px-3 pb-3 overflow-y-auto" style={{ maxHeight }}>
          <div className="space-y-3">
            {blocks.map((block, index) => (
              <ThinkingBlockItem
                key={block.id}
                block={block}
                isLatest={index === blocks.length - 1}
                isActive={isActive && index === blocks.length - 1}
                content={
                  index === blocks.length - 1
                    ? displayedContent.slice(
                        blocks.slice(0, index).reduce((acc, b) => acc + b.content.length + 2, 0)
                      )
                    : block.content
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Collapsed Preview */}
      {!isExpanded && latestBlock && (
        <div className="px-3 pb-2">
          <p className="text-xs text-text-muted italic truncate">
            {latestBlock.content.slice(0, 100)}...
          </p>
        </div>
      )}
    </div>
  );
}

interface ThinkingBlockItemProps {
  block: ThinkingBlock;
  content: string;
  isLatest: boolean;
  isActive: boolean;
}

function ThinkingBlockItem({ block: _block, content, isLatest, isActive }: ThinkingBlockItemProps) {
  // Parse thinking content for structure
  const sections = parseThinkingContent(content);

  return (
    <div
      className={cn('rounded-lg p-3', isLatest ? 'bg-purple-500/10' : 'bg-surface-secondary/30')}
    >
      {sections.map((section, i) => (
        <div key={i} className="mb-2 last:mb-0">
          {section.type === 'heading' && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-purple-400 mb-1">
              <Lightbulb className="w-3 h-3" />
              {section.content}
            </div>
          )}

          {section.type === 'list' && (
            <ul className="space-y-1 text-sm text-text-secondary">
              {section.items?.map((item, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          {section.type === 'text' && (
            <p className="text-sm text-text-secondary whitespace-pre-wrap">
              {section.content}
              {isActive && i === sections.length - 1 && (
                <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5" />
              )}
            </p>
          )}

          {section.type === 'code' && (
            <pre className="mt-1 p-2 text-xs font-mono bg-black/20 rounded overflow-x-auto">
              {section.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

interface ThinkingSection {
  type: 'heading' | 'list' | 'text' | 'code';
  content: string;
  items?: string[];
}

function parseThinkingContent(content: string): ThinkingSection[] {
  const sections: ThinkingSection[] = [];
  const lines = content.split('\n');
  let currentSection: ThinkingSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for headings
    if (trimmed.match(/^(##?|###)\s+/)) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        type: 'heading',
        content: trimmed.replace(/^#+\s+/, ''),
      };
      continue;
    }

    // Check for list items
    if (trimmed.match(/^[-*•]\s+/)) {
      const itemContent = trimmed.replace(/^[-*•]\s+/, '');
      if (currentSection?.type === 'list') {
        currentSection.items?.push(itemContent);
      } else {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          type: 'list',
          content: '',
          items: [itemContent],
        };
      }
      continue;
    }

    // Check for code blocks
    if (trimmed.startsWith('```')) {
      if (currentSection?.type === 'code') {
        sections.push(currentSection);
        currentSection = null;
      } else {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          type: 'code',
          content: '',
        };
      }
      continue;
    }

    // Regular text
    if (currentSection?.type === 'code') {
      currentSection.content += line + '\n';
    } else if (trimmed) {
      if (currentSection?.type === 'text') {
        currentSection.content += '\n' + trimmed;
      } else {
        if (currentSection) sections.push(currentSection);
        currentSection = {
          type: 'text',
          content: trimmed,
        };
      }
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections.length > 0 ? sections : [{ type: 'text', content }];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export default ThinkingDisplay;
