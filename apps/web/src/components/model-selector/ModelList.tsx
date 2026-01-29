'use client';

import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { ModelCard } from './ModelCard';
import { Skeleton } from '@/components/ui/Skeleton';
import type { LLMModel } from './types';

export interface ModelListProps {
  /** Already filtered/sorted models to display */
  models: LLMModel[];
  /** Currently selected model ID */
  selectedModelId?: string;
  /** Callback when a model is selected */
  onSelectModel: (modelId: string) => void;
  /** List of favorited model IDs */
  favorites: string[];
  /** Callback to toggle a model's favorite status (optional, ModelCard uses its own hook) */
  onToggleFavorite?: (modelId: string) => void;
  /** Whether to show favorite toggle buttons on cards */
  showFavoriteToggle?: boolean;
  /** Message to display when no models match */
  emptyMessage?: string;
  /** Whether models are being loaded */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Skeleton card for loading state
 */
function ModelCardSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 bg-card">
      {/* Top row: name and toggle */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-6 w-6 ml-auto rounded" />
      </div>
      {/* Model ID */}
      <Skeleton className="h-4 w-36" />
      {/* Bottom row: context and pricing */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

/**
 * ModelList displays a virtualized list of models with an optional favorites section.
 *
 * Features:
 * - Virtualized scrolling using @tanstack/react-virtual for 200+ model performance
 * - Pinned favorites section at the top (non-virtualized for visibility)
 * - Loading skeletons while fetching
 * - Empty state when no models match
 * - Accessible with proper ARIA roles
 */
export function ModelList({
  models,
  selectedModelId,
  onSelectModel,
  favorites,
  // onToggleFavorite is optional - ModelCard uses useModelFavorites hook internally
  onToggleFavorite: _onToggleFavorite,
  showFavoriteToggle = true,
  emptyMessage = 'No models found',
  isLoading = false,
  className,
}: ModelListProps) {
  // Suppress unused variable warning - prop is for API consistency but ModelCard handles favorites internally
  void _onToggleFavorite;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter models that are favorited and exist in the current list
  const favoritedModels = useMemo(() => {
    const favoriteSet = new Set(favorites);
    return models.filter((model) => favoriteSet.has(model.model_id));
  }, [models, favorites]);

  // Virtual list configuration
  const virtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 80, // Estimated row height in pixels
    overscan: 5, // Number of items to render above/below viewport
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-2 p-2', className)} aria-busy="true">
        <ModelCardSkeleton />
        <ModelCardSkeleton />
        <ModelCardSkeleton />
        <ModelCardSkeleton />
        <ModelCardSkeleton />
      </div>
    );
  }

  // Empty state
  if (models.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center h-full min-h-[200px] text-muted-foreground',
          className
        )}
        role="status"
      >
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Favorites section (pinned, not virtualized) */}
      {favoritedModels.length > 0 && (
        <div className="flex-shrink-0 border-b border-border pb-2 mb-2">
          <h3 className="text-sm font-medium text-muted-foreground px-2 mb-2">Favorites</h3>
          <div className="flex flex-col gap-2 px-2" role="group" aria-label="Favorite models">
            {favoritedModels.map((model) => (
              <ModelCard
                key={`fav-${model.model_id}`}
                model={model}
                onSelect={onSelectModel}
                isSelected={selectedModelId === model.model_id}
                showFavoriteToggle={showFavoriteToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Virtualized main list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto px-2"
        role="listbox"
        aria-label="Model list"
      >
        <div
          style={{
            height: `${totalSize}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualItem) => {
            const model = models[virtualItem.index];
            if (!model) return null;
            return (
              <div
                key={virtualItem.key}
                role="option"
                aria-selected={selectedModelId === model.model_id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="pb-2">
                  <ModelCard
                    model={model}
                    onSelect={onSelectModel}
                    isSelected={selectedModelId === model.model_id}
                    showFavoriteToggle={showFavoriteToggle}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
