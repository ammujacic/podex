/**
 * Tests for useModelFavorites hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useModelFavorites,
  __resetFavoritesCache,
} from '@/components/model-selector/hooks/useModelFavorites';

const STORAGE_KEY = 'podex-model-favorites';

describe('useModelFavorites', () => {
  // Mock localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    };
  })();

  beforeEach(() => {
    // Reset the internal cache before each test
    __resetFavoritesCache();
    // Clear and mock localStorage
    localStorageMock.clear();
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('should initialize with empty favorites when localStorage is empty', () => {
    const { result } = renderHook(() => useModelFavorites());

    expect(result.current.favorites).toEqual([]);
  });

  it('should toggle favorite on when model is not favorited', () => {
    const { result } = renderHook(() => useModelFavorites());

    act(() => {
      result.current.toggleFavorite('model-1');
    });

    expect(result.current.favorites).toContain('model-1');
    expect(result.current.isFavorite('model-1')).toBe(true);
  });

  it('should toggle favorite off when model is already favorited', () => {
    const { result } = renderHook(() => useModelFavorites());

    // Add model
    act(() => {
      result.current.toggleFavorite('model-1');
    });
    expect(result.current.favorites).toContain('model-1');

    // Remove model
    act(() => {
      result.current.toggleFavorite('model-1');
    });
    expect(result.current.favorites).not.toContain('model-1');
    expect(result.current.isFavorite('model-1')).toBe(false);
  });

  it('should persist favorites to localStorage', () => {
    const { result } = renderHook(() => useModelFavorites());

    act(() => {
      result.current.toggleFavorite('model-1');
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(['model-1']));
  });

  it('should add favorite using addFavorite', () => {
    const { result } = renderHook(() => useModelFavorites());

    act(() => {
      result.current.addFavorite('model-1');
    });

    expect(result.current.favorites).toContain('model-1');
    expect(result.current.isFavorite('model-1')).toBe(true);
  });

  it('should not duplicate when adding already favorited model', () => {
    const { result } = renderHook(() => useModelFavorites());

    act(() => {
      result.current.addFavorite('model-1');
    });
    act(() => {
      result.current.addFavorite('model-1');
    });

    expect(result.current.favorites.filter((id) => id === 'model-1').length).toBe(1);
  });

  it('should remove favorite using removeFavorite', () => {
    const { result } = renderHook(() => useModelFavorites());

    // Add first
    act(() => {
      result.current.addFavorite('model-1');
    });
    expect(result.current.isFavorite('model-1')).toBe(true);

    // Remove
    act(() => {
      result.current.removeFavorite('model-1');
    });
    expect(result.current.isFavorite('model-1')).toBe(false);
  });

  it('should clear all favorites', () => {
    const { result } = renderHook(() => useModelFavorites());

    // Add multiple
    act(() => {
      result.current.addFavorite('model-1');
      result.current.addFavorite('model-2');
      result.current.addFavorite('model-3');
    });
    expect(result.current.favorites.length).toBe(3);

    // Clear all
    act(() => {
      result.current.clearFavorites();
    });
    expect(result.current.favorites).toEqual([]);
  });

  it('should handle multiple models correctly', () => {
    const { result } = renderHook(() => useModelFavorites());

    act(() => {
      result.current.toggleFavorite('model-1');
      result.current.toggleFavorite('model-2');
      result.current.toggleFavorite('model-3');
    });

    expect(result.current.favorites).toEqual(['model-1', 'model-2', 'model-3']);
    expect(result.current.isFavorite('model-1')).toBe(true);
    expect(result.current.isFavorite('model-2')).toBe(true);
    expect(result.current.isFavorite('model-3')).toBe(true);
    expect(result.current.isFavorite('model-4')).toBe(false);
  });

  it('should return stable function references', () => {
    const { result, rerender } = renderHook(() => useModelFavorites());

    const initialToggle = result.current.toggleFavorite;
    const initialAddFavorite = result.current.addFavorite;
    const initialRemoveFavorite = result.current.removeFavorite;
    const initialClearFavorites = result.current.clearFavorites;

    rerender();

    expect(result.current.toggleFavorite).toBe(initialToggle);
    expect(result.current.addFavorite).toBe(initialAddFavorite);
    expect(result.current.removeFavorite).toBe(initialRemoveFavorite);
    expect(result.current.clearFavorites).toBe(initialClearFavorites);
  });

  it('should share state between multiple hook instances', () => {
    const { result: result1 } = renderHook(() => useModelFavorites());
    const { result: result2 } = renderHook(() => useModelFavorites());

    act(() => {
      result1.current.toggleFavorite('shared-model');
    });

    // Both instances should see the same favorites
    expect(result1.current.favorites).toContain('shared-model');
    expect(result2.current.favorites).toContain('shared-model');
  });
});
