'use client';

import { useCallback, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModelSearchProps {
  /** Current search query */
  value: string;
  /** Callback when query changes */
  onChange: (query: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional classes */
  className?: string;
  /** Auto focus on mount */
  autoFocus?: boolean;
}

/**
 * ModelSearch provides a search input for filtering models.
 *
 * Features:
 * - Search icon on the left
 * - Clear button (X) on the right when there's text
 * - Passes value directly to onChange (debouncing handled by parent/hook)
 * - Accessible with proper aria-labels
 * - Dark theme compatible
 */
export function ModelSearch({
  value,
  onChange,
  placeholder = 'Search models...',
  className,
  autoFocus = false,
}: ModelSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange('');
    // Keep focus on input after clearing
    inputRef.current?.focus();
  }, [onChange]);

  const handleClearKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleClear();
      }
    },
    [handleClear]
  );

  return (
    <div className={cn('relative', className)}>
      {/* Search icon */}
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none"
        aria-hidden="true"
      />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Search models"
        className={cn(
          'flex h-10 w-full rounded-md border border-border-default bg-elevated text-sm text-text-primary',
          'placeholder:text-text-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'pl-9 pr-9 py-2'
        )}
      />

      {/* Clear button - only shown when there's text */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          onKeyDown={handleClearKeyDown}
          aria-label="Clear search"
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded',
            'text-text-muted hover:text-text-primary',
            'hover:bg-overlay transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary'
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
