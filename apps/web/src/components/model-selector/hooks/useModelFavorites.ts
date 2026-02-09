'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'podex-model-favorites';

/**
 * Get favorites from localStorage safely (SSR-safe)
 */
function getFavoritesFromStorage(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    }
  } catch (error) {
    console.error('Failed to parse favorites from localStorage:', error);
  }
  return [];
}

/**
 * Save favorites to localStorage
 */
function saveFavoritesToStorage(favorites: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error('Failed to save favorites to localStorage:', error);
  }
}

// Shared state for favorites - enables cross-tab sync
let favoritesCache = getFavoritesFromStorage();
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): string[] {
  return favoritesCache;
}

function getServerSnapshot(): string[] {
  return [];
}

function notifyListeners(): void {
  listeners.forEach((callback) => callback());
}

function updateFavorites(newFavorites: string[]): void {
  favoritesCache = newFavorites;
  saveFavoritesToStorage(newFavorites);
  notifyListeners();
}

// Initialize storage event listener for cross-tab sync
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      favoritesCache = getFavoritesFromStorage();
      notifyListeners();
    }
  });
}

/**
 * Reset the internal favorites cache. Only for testing purposes.
 * @internal
 */
export function __resetFavoritesCache(): void {
  favoritesCache = [];
  listeners.clear();
}

export interface UseModelFavoritesReturn {
  /** List of favorited model IDs */
  favorites: string[];
  /** Toggle a model's favorite status */
  toggleFavorite: (modelId: string) => void;
  /** Check if a model is favorited */
  isFavorite: (modelId: string) => boolean;
  /** Add a model to favorites */
  addFavorite: (modelId: string) => void;
  /** Remove a model from favorites */
  removeFavorite: (modelId: string) => void;
  /** Clear all favorites */
  clearFavorites: () => void;
}

/**
 * Hook for managing model favorites with localStorage persistence.
 *
 * Features:
 * - SSR-safe (checks for window before accessing localStorage)
 * - Cross-tab synchronization via storage event listener
 * - Type-safe with proper error handling
 *
 * @example
 * ```tsx
 * function ModelCard({ model }) {
 *   const { isFavorite, toggleFavorite } = useModelFavorites();
 *
 *   return (
 *     <button onClick={() => toggleFavorite(model.id)}>
 *       {isFavorite(model.id) ? '❤️' : '🤍'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useModelFavorites(): UseModelFavoritesReturn {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleFavorite = useCallback((modelId: string) => {
    const currentFavorites = getSnapshot();
    const newFavorites = currentFavorites.includes(modelId)
      ? currentFavorites.filter((id) => id !== modelId)
      : [...currentFavorites, modelId];
    updateFavorites(newFavorites);
  }, []);

  const isFavorite = useCallback(
    (modelId: string) => {
      return favorites.includes(modelId);
    },
    [favorites]
  );

  const addFavorite = useCallback((modelId: string) => {
    const currentFavorites = getSnapshot();
    if (!currentFavorites.includes(modelId)) {
      updateFavorites([...currentFavorites, modelId]);
    }
  }, []);

  const removeFavorite = useCallback((modelId: string) => {
    const currentFavorites = getSnapshot();
    if (currentFavorites.includes(modelId)) {
      updateFavorites(currentFavorites.filter((id) => id !== modelId));
    }
  }, []);

  const clearFavorites = useCallback(() => {
    updateFavorites([]);
  }, []);

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    addFavorite,
    removeFavorite,
    clearFavorites,
  };
}
