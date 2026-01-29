'use client';

import { useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useModelFavorites } from './hooks/useModelFavorites';
import { MODEL_CATEGORIES, type LLMModel, type ModelCategory } from './types';

export interface ModelCardProps {
  /** The model to display */
  model: LLMModel;
  /** Callback when the model card is selected */
  onSelect: (modelId: string) => void;
  /** Whether this model is currently selected */
  isSelected?: boolean;
  /** Whether to show the favorite toggle button */
  showFavoriteToggle?: boolean;
}

/**
 * Format context window size for display
 * e.g., 200000 -> "200K context"
 */
function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1000000) {
    return `${(contextWindow / 1000000).toFixed(contextWindow % 1000000 === 0 ? 0 : 1)}M context`;
  }
  if (contextWindow >= 1000) {
    return `${Math.round(contextWindow / 1000)}K context`;
  }
  return `${contextWindow} context`;
}

/**
 * Format pricing for display
 * e.g., input=3, output=15 -> "$3 / $15 per 1M"
 */
function formatPricing(inputCost: number | null, outputCost: number | null): string {
  if (inputCost === null && outputCost === null) {
    return 'Free';
  }

  const formatCost = (cost: number | null): string => {
    if (cost === null) return '$0';
    if (cost >= 1) return `$${cost.toFixed(cost % 1 === 0 ? 0 : 2)}`;
    if (cost >= 0.01) return `$${cost.toFixed(2)}`;
    return `$${cost.toFixed(3)}`;
  };

  return `${formatCost(inputCost)} / ${formatCost(outputCost)} per 1M`;
}

/**
 * Get category info by ID
 */
function getCategoryInfo(categoryId: ModelCategory) {
  return MODEL_CATEGORIES.find((cat) => cat.id === categoryId);
}

/**
 * ModelCard displays an individual model in the model selector.
 *
 * Features:
 * - Displays model name, ID, context window, and pricing
 * - Shows featured indicator (star) for featured models
 * - Shows "Recommended" badge for default models
 * - Category badges with icons
 * - Favorite toggle functionality
 * - Keyboard navigation support
 */
export function ModelCard({
  model,
  onSelect,
  isSelected = false,
  showFavoriteToggle = true,
}: ModelCardProps) {
  const { isFavorite, toggleFavorite } = useModelFavorites();
  const modelIsFavorite = isFavorite(model.model_id);

  const handleSelect = useCallback(() => {
    onSelect(model.model_id);
  }, [model.model_id, onSelect]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSelect();
      }
    },
    [handleSelect]
  );

  const handleFavoriteClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      toggleFavorite(model.model_id);
    },
    [model.model_id, toggleFavorite]
  );

  const handleFavoriteKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(model.model_id);
      }
    },
    [model.model_id, toggleFavorite]
  );

  const categoryBadges = useMemo(() => {
    if (!model.categories?.length) return null;
    return model.categories.map((categoryId) => {
      const info = getCategoryInfo(categoryId);
      if (!info) return null;
      return (
        <span key={categoryId} className="text-sm" title={info.description} aria-label={info.label}>
          {info.icon}
        </span>
      );
    });
  }, [model.categories]);

  const pricing = formatPricing(model.input_cost_per_million, model.output_cost_per_million);

  const contextWindow = formatContextWindow(model.context_window);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      aria-pressed={isSelected}
      aria-label={`Select ${model.display_name}`}
      className={cn(
        'relative flex flex-col gap-1 rounded-lg border p-3 cursor-pointer transition-all',
        'bg-card text-card-foreground',
        'hover:bg-accent hover:border-accent-foreground/20',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        isSelected && 'border-primary bg-primary/5 ring-1 ring-primary'
      )}
    >
      {/* Top row: Featured star, name, favorite toggle, category badges */}
      <div className="flex items-center gap-2">
        {/* Featured indicator */}
        {model.is_featured && (
          <span className="text-yellow-500" title="Featured model" aria-label="Featured">
            &#11088;
          </span>
        )}

        {/* Model display name */}
        <span className="font-medium text-foreground flex-1 truncate">{model.display_name}</span>

        {/* Favorite toggle */}
        {showFavoriteToggle && (
          <button
            type="button"
            onClick={handleFavoriteClick}
            onKeyDown={handleFavoriteKeyDown}
            aria-label={modelIsFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={modelIsFavorite}
            className={cn(
              'p-1 rounded hover:bg-muted transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-ring'
            )}
          >
            <span className={cn(modelIsFavorite ? 'text-red-500' : 'text-muted-foreground')}>
              {modelIsFavorite ? '\u2764\uFE0F' : '\u2661'}
            </span>
          </button>
        )}

        {/* Category badges */}
        {categoryBadges && (
          <div className="flex items-center gap-1" aria-label="Model categories">
            {categoryBadges}
          </div>
        )}
      </div>

      {/* Model ID / slug */}
      <div className="text-sm text-muted-foreground truncate">{model.model_id}</div>

      {/* Bottom row: Context window, pricing, recommended badge */}
      <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
        <span>{contextWindow}</span>
        <span className="text-muted-foreground/50">&bull;</span>
        <span>{pricing}</span>

        {/* Recommended badge for default models */}
        {model.is_default && (
          <Badge
            variant="secondary"
            className="ml-auto text-xs bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
          >
            Recommended
          </Badge>
        )}
      </div>
    </div>
  );
}
