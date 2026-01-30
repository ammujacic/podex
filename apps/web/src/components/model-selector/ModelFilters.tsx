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
  showAllToggle: _showAllToggle = false,
  showAll: _showAll = false,
  onToggleShowAll: _onToggleShowAll,
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

  return (
    <div
      role="group"
      aria-label="Filter by category"
      className={cn('flex items-center gap-1 overflow-x-auto scrollbar-hide', className)}
    >
      {/* Category filters - underline style */}
      <div className="flex items-center gap-1 flex-shrink-0">
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
                'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium',
                'border-b-2 transition-all duration-150 ease-in-out',
                'focus:outline-none',
                'flex-shrink-0 whitespace-nowrap cursor-pointer',
                isActive
                  ? 'border-accent-primary text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border-default'
              )}
            >
              <span className="text-xs" aria-hidden="true">
                {category.icon}
              </span>
              <span>{category.label}</span>
            </button>
          );
        })}
      </div>

      {/* Show all toggle - removed, keeping interface simple */}
    </div>
  );
}
