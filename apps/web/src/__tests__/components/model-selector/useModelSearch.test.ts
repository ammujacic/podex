/**
 * Tests for useModelSearch hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useModelSearch } from '@/components/model-selector/hooks/useModelSearch';
import type { LLMModel, ModelCategory } from '@/components/model-selector/types';

// Mock model data for testing
const createMockModel = (overrides: Partial<LLMModel> = {}): LLMModel => ({
  model_id: 'test-model',
  display_name: 'Test Model',
  provider: 'test-provider',
  family: 'test-family',
  description: 'A test model',
  cost_tier: 'medium',
  capabilities: {
    vision: false,
    thinking: false,
    tool_use: true,
    streaming: true,
    json_mode: true,
  },
  context_window: 32000,
  max_output_tokens: 4096,
  is_default: false,
  input_cost_per_million: 1.0,
  output_cost_per_million: 2.0,
  good_for: ['general'],
  user_input_cost_per_million: 1.2,
  user_output_cost_per_million: 2.4,
  llm_margin_percent: 20,
  is_featured: true,
  display_order: 0,
  categories: [],
  ...overrides,
});

const mockModels: LLMModel[] = [
  createMockModel({
    model_id: 'claude-3-sonnet',
    display_name: 'Claude 3 Sonnet',
    provider: 'anthropic',
    categories: ['reasoning', 'code'] as ModelCategory[],
    is_featured: true,
    display_order: 1,
  }),
  createMockModel({
    model_id: 'gpt-4o',
    display_name: 'GPT-4o',
    provider: 'openai',
    categories: ['reasoning', 'vision'] as ModelCategory[],
    is_featured: true,
    display_order: 2,
  }),
  createMockModel({
    model_id: 'llama-3-8b',
    display_name: 'Llama 3 8B',
    provider: 'meta',
    categories: ['fast', 'budget'] as ModelCategory[],
    is_featured: true,
    display_order: 3,
  }),
  createMockModel({
    model_id: 'gemini-1.5-flash',
    display_name: 'Gemini 1.5 Flash',
    provider: 'google',
    categories: ['fast', 'large_context'] as ModelCategory[],
    is_featured: false,
    display_order: 10,
  }),
  createMockModel({
    model_id: 'codellama-70b',
    display_name: 'CodeLlama 70B',
    provider: 'meta',
    categories: ['code'] as ModelCategory[],
    is_featured: false,
    display_order: 15,
  }),
];

describe('useModelSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should initialize with empty search query and no active categories', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: false })
      );

      expect(result.current.searchQuery).toBe('');
      expect(result.current.activeCategories).toEqual([]);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('should show only featured models when showAllModels is false', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: false })
      );

      // Only featured models should be shown
      expect(result.current.filteredModels.length).toBe(3);
      expect(result.current.filteredModels.every((m) => m.is_featured)).toBe(true);
    });

    it('should show all models when showAllModels is true', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      expect(result.current.filteredModels.length).toBe(5);
    });
  });

  describe('search functionality', () => {
    it('should filter models by display name (case-insensitive)', async () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setSearchQuery('claude');
      });

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.filteredModels.length).toBe(1);
      expect(result.current.filteredModels[0].model_id).toBe('claude-3-sonnet');
    });

    it('should filter models by model_id', async () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setSearchQuery('gpt-4o');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.filteredModels.length).toBe(1);
      expect(result.current.filteredModels[0].model_id).toBe('gpt-4o');
    });

    it('should filter models by provider', async () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setSearchQuery('meta');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.filteredModels.length).toBe(2);
      expect(result.current.filteredModels.every((m) => m.provider === 'meta')).toBe(true);
    });

    it('should debounce search input', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setSearchQuery('claude');
      });

      // Before debounce
      expect(result.current.searchQuery).toBe('claude'); // Immediate update
      expect(result.current.filteredModels.length).toBe(5); // Not filtered yet

      // After debounce
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.filteredModels.length).toBe(1);
    });

    it('should return empty array when no models match search', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setSearchQuery('nonexistent');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.filteredModels.length).toBe(0);
    });
  });

  describe('category filtering', () => {
    it('should filter by single category', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.toggleCategory('code');
      });

      expect(result.current.activeCategories).toContain('code');
      expect(result.current.filteredModels.every((m) => m.categories?.includes('code'))).toBe(true);
    });

    it('should use OR logic for multiple categories', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.toggleCategory('vision');
        result.current.toggleCategory('budget');
      });

      // Should include models with vision OR budget
      expect(result.current.filteredModels.length).toBe(2);
      expect(result.current.filteredModels.some((m) => m.model_id === 'gpt-4o')).toBe(true); // vision
      expect(result.current.filteredModels.some((m) => m.model_id === 'llama-3-8b')).toBe(true); // budget
    });

    it('should toggle category off when clicked again', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.toggleCategory('code');
      });
      expect(result.current.activeCategories).toContain('code');

      act(() => {
        result.current.toggleCategory('code');
      });
      expect(result.current.activeCategories).not.toContain('code');
    });

    it('should clear all categories', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.toggleCategory('code');
        result.current.toggleCategory('vision');
      });
      expect(result.current.activeCategories.length).toBe(2);

      act(() => {
        result.current.clearCategories();
      });
      expect(result.current.activeCategories).toEqual([]);
    });

    it('should set active categories directly', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setActiveCategories(['fast', 'reasoning']);
      });

      expect(result.current.activeCategories).toEqual(['fast', 'reasoning']);
    });
  });

  describe('combined filtering', () => {
    it('should apply both search and category filters', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.toggleCategory('code');
        result.current.setSearchQuery('meta');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Should only match CodeLlama (meta provider + code category)
      expect(result.current.filteredModels.length).toBe(1);
      expect(result.current.filteredModels[0].model_id).toBe('codellama-70b');
    });

    it('should correctly report hasActiveFilters', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      expect(result.current.hasActiveFilters).toBe(false);

      act(() => {
        result.current.setSearchQuery('test');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.hasActiveFilters).toBe(true);

      act(() => {
        result.current.clearAllFilters();
      });

      expect(result.current.hasActiveFilters).toBe(false);
    });
  });

  describe('sorting', () => {
    it('should sort favorites first', () => {
      const { result } = renderHook(() =>
        useModelSearch({
          models: mockModels,
          favorites: ['llama-3-8b'],
          showAllModels: true,
        })
      );

      expect(result.current.filteredModels[0].model_id).toBe('llama-3-8b');
    });

    it('should sort featured models before non-featured', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      const featuredModels = result.current.filteredModels.filter((m) => m.is_featured);
      const nonFeaturedModels = result.current.filteredModels.filter((m) => !m.is_featured);

      // All featured models should come before non-featured
      const lastFeaturedIndex = result.current.filteredModels.findLastIndex((m) => m.is_featured);
      const firstNonFeaturedIndex = result.current.filteredModels.findIndex((m) => !m.is_featured);

      if (featuredModels.length > 0 && nonFeaturedModels.length > 0) {
        expect(lastFeaturedIndex).toBeLessThan(firstNonFeaturedIndex);
      }
    });

    it('should sort by display_order within same tier', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: false })
      );

      // Among featured models, should be sorted by display_order
      expect(result.current.filteredModels[0].model_id).toBe('claude-3-sonnet'); // display_order: 1
      expect(result.current.filteredModels[1].model_id).toBe('gpt-4o'); // display_order: 2
      expect(result.current.filteredModels[2].model_id).toBe('llama-3-8b'); // display_order: 3
    });
  });

  describe('clearAllFilters', () => {
    it('should clear both search and categories', () => {
      const { result } = renderHook(() =>
        useModelSearch({ models: mockModels, favorites: [], showAllModels: true })
      );

      act(() => {
        result.current.setSearchQuery('test');
        result.current.toggleCategory('code');
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.searchQuery).toBe('test');
      expect(result.current.activeCategories.length).toBe(1);

      act(() => {
        result.current.clearAllFilters();
      });

      expect(result.current.searchQuery).toBe('');
      expect(result.current.activeCategories).toEqual([]);
    });
  });
});
