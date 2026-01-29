'use client';

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { MODEL_CATEGORIES, type ModelCategory } from './types';

export interface ModelFiltersProps {
  /** Currently selected categories */
  activeCategories: ModelCategory[];
  /** Toggle callback for a category */
  onToggleCategory: (category: ModelCategory) => void;
  /** Show "Show all models" toggle */
  showAllToggle?: boolean;
  /** Current showAll state */
  showAll?: boolean;
  /** Toggle showAll callback */
  onToggleShowAll?: () => void;
  /** Additional className for the container */
  className?: string;
}

/**
 * ModelFilters displays a horizontal row of category filter chips.
 *
 * Features:
 * - Renders all categories from MODEL_CATEGORIES as clickable chips
 * - Active categories have primary/accent background color
 * - Inactive categories have outline/subtle styling
 * - Shows icon + label for each chip
 * - Optional "Show all models" toggle on the right
 * - Horizontal scroll on mobile
 */
export function ModelFilters({
  activeCategories,
  onToggleCategory,
  showAllToggle = false,
  showAll = false,
  onToggleShowAll,
  className,
}: ModelFiltersProps) {
  const handleChipClick = useCallback(
    (category: ModelCategory) => {
      onToggleCategory(category);
    },
    [onToggleCategory]
  );

  const handleChipKeyDown = useCallback(
    (event: React.KeyboardEvent, category: ModelCategory) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggleCategory(category);
      }
    },
    [onToggleCategory]
  );

  const handleShowAllClick = useCallback(() => {
    onToggleShowAll?.();
  }, [onToggleShowAll]);

  const handleShowAllKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggleShowAll?.();
      }
    },
    [onToggleShowAll]
  );

  return (
    <div
      role="group"
      aria-label="Filter by category"
      className={cn(
        'flex items-center gap-2 overflow-x-auto scrollbar-hide',
        className
      )}
    >
      {/* Category chips */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {MODEL_CATEGORIES.map((category) => {
          const isActive = activeCategories.includes(category.id);
          return (
            <button
              key={category.id}
              type="button"
              role="button"
              onClick={() => handleChipClick(category.id)}
              onKeyDown={(e) => handleChipKeyDown(e, category.id)}
              aria-pressed={isActive}
              aria-label={category.label}
              title={category.description}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium',
                'border transition-all duration-150 ease-in-out',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                'flex-shrink-0 whitespace-nowrap cursor-pointer',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                  : 'bg-background text-foreground border-border hover:bg-accent hover:border-accent-foreground/20'
              )}
            >
              <span className="text-sm" aria-hidden="true">
                {category.icon}
              </span>
              <span>{category.label}</span>
            </button>
          );
        })}
      </div>

      {/* Show all toggle */}
      {showAllToggle && (
        <div className="flex items-center gap-2 ml-auto flex-shrink-0 pl-4 border-l border-border">
          <label
            htmlFor="show-all-toggle"
            className="text-sm text-muted-foreground whitespace-nowrap cursor-pointer"
          >
            Show all (200+)
          </label>
          <button
            id="show-all-toggle"
            type="button"
            role="checkbox"
            aria-checked={showAll}
            onClick={handleShowAllClick}
            onKeyDown={handleShowAllKeyDown}
            className={cn(
              'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
              'transition-colors duration-200 ease-in-out',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              showAll ? 'bg-primary' : 'bg-muted'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0',
                'transition duration-200 ease-in-out',
                showAll ? 'translate-x-4' : 'translate-x-0'
              )}
            />
          </button>
        </div>
      )}
    </div>
  );
}
