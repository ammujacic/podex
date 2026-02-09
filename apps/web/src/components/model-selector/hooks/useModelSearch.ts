'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { LLMModel, ModelCategory } from '../types';

const DEBOUNCE_MS = 300;

export interface UseModelSearchOptions {
  /** List of models to search/filter */
  models: LLMModel[];
  /** List of favorited model IDs */
  favorites: string[];
  /** Whether to show all models or just featured ones */
  showAllModels: boolean;
}

export interface UseModelSearchReturn {
  /** Current search query */
  searchQuery: string;
  /** Set the search query (will be debounced) */
  setSearchQuery: (query: string) => void;
  /** Currently active category filters */
  activeCategories: ModelCategory[];
  /** Toggle a category filter on/off */
  toggleCategory: (category: ModelCategory) => void;
  /** Clear all category filters */
  clearCategories: () => void;
  /** Set all active categories at once */
  setActiveCategories: (categories: ModelCategory[]) => void;
  /** Filtered and sorted models based on search/filters */
  filteredModels: LLMModel[];
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Clear all filters (search and categories) */
  clearAllFilters: () => void;
}

/**
 * Check if a model matches the search query
 */
function matchesSearch(model: LLMModel, query: string): boolean {
  if (!query.trim()) {
    return true;
  }
  const lowerQuery = query.toLowerCase().trim();
  return (
    model.display_name.toLowerCase().includes(lowerQuery) ||
    model.model_id.toLowerCase().includes(lowerQuery) ||
    model.provider.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Check if a model matches any of the active categories
 * Uses OR logic - model matches if it has ANY of the active categories
 */
function matchesCategories(model: LLMModel, activeCategories: ModelCategory[]): boolean {
  if (activeCategories.length === 0) {
    return true;
  }
  const modelCategories = model.categories ?? [];
  return activeCategories.some((category) => modelCategories.includes(category));
}

/**
 * Check if a model should be shown based on featured/showAll status
 */
function matchesFeaturedFilter(model: LLMModel, showAllModels: boolean): boolean {
  if (showAllModels) {
    return true;
  }
  return model.is_featured === true;
}

/**
 * Sort models: favorites first, then featured, then by display_order
 */
function sortModels(models: LLMModel[], favorites: string[]): LLMModel[] {
  return [...models].sort((a, b) => {
    // Favorites first
    const aFavorite = favorites.includes(a.model_id);
    const bFavorite = favorites.includes(b.model_id);
    if (aFavorite && !bFavorite) return -1;
    if (!aFavorite && bFavorite) return 1;

    // Featured second
    const aFeatured = a.is_featured ?? false;
    const bFeatured = b.is_featured ?? false;
    if (aFeatured && !bFeatured) return -1;
    if (!aFeatured && bFeatured) return 1;

    // Then by display_order (lower = higher priority)
    const aOrder = a.display_order ?? 999;
    const bOrder = b.display_order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // Finally alphabetically by display name
    return a.display_name.localeCompare(b.display_name);
  });
}

/**
 * Hook for searching and filtering models with debounced search.
 *
 * Features:
 * - 300ms debounce on search input
 * - Category filtering with OR logic
 * - Combined filter: matchesSearch AND (matchesCategory OR noFiltersActive) AND (isFeatured OR showAllModels)
 * - Sorted: favorites first, then featured, then by display_order
 *
 * @example
 * ```tsx
 * function ModelList({ models }) {
 *   const { favorites } = useModelFavorites();
 *   const {
 *     searchQuery,
 *     setSearchQuery,
 *     activeCategories,
 *     toggleCategory,
 *     filteredModels
 *   } = useModelSearch({ models, favorites, showAllModels: false });
 *
 *   return (
 *     <>
 *       <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
 *       {filteredModels.map(model => <ModelCard key={model.model_id} model={model} />)}
 *     </>
 *   );
 * }
 * ```
 */
export function useModelSearch({
  models,
  favorites,
  showAllModels,
}: UseModelSearchOptions): UseModelSearchReturn {
  const [searchQuery, setSearchQueryImmediate] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<ModelCategory[]>([]);

  // Debounce the search query
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryImmediate(query);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const toggleCategory = useCallback((category: ModelCategory) => {
    setActiveCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  }, []);

  const clearCategories = useCallback(() => {
    setActiveCategories([]);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSearchQueryImmediate('');
    setDebouncedQuery('');
    setActiveCategories([]);
  }, []);

  const hasActiveFilters = useMemo(() => {
    return debouncedQuery.trim().length > 0 || activeCategories.length > 0;
  }, [debouncedQuery, activeCategories]);

  const filteredModels = useMemo(() => {
    const filtered = models.filter((model) => {
      // Must match search query
      if (!matchesSearch(model, debouncedQuery)) {
        return false;
      }

      // Must match category filter (or no filters active)
      if (!matchesCategories(model, activeCategories)) {
        return false;
      }

      // Must be featured or showAllModels is enabled
      if (!matchesFeaturedFilter(model, showAllModels)) {
        return false;
      }

      return true;
    });

    return sortModels(filtered, favorites);
  }, [models, debouncedQuery, activeCategories, showAllModels, favorites]);

  return {
    searchQuery,
    setSearchQuery,
    activeCategories,
    toggleCategory,
    clearCategories,
    setActiveCategories,
    filteredModels,
    hasActiveFilters,
    clearAllFilters,
  };
}
