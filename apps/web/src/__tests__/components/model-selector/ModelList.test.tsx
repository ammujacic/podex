/**
 * Tests for ModelList component
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelList } from '@/components/model-selector/ModelList';
import type { LLMModel } from '@/components/model-selector/types';
import { __resetFavoritesCache } from '@/components/model-selector/hooks/useModelFavorites';

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
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock ResizeObserver for virtualization
// Note: Callback must be deferred to prevent infinite loops with TanStack Virtual
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  private observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe = vi.fn((target: Element) => {
    // Prevent multiple observations of the same element causing loops
    if (this.observedElements.has(target)) {
      return;
    }
    this.observedElements.add(target);

    // Use queueMicrotask to defer callback and prevent synchronous infinite loops
    queueMicrotask(() => {
      this.callback(
        [
          {
            target,
            contentRect: {
              width: 400,
              height: 600,
              top: 0,
              left: 0,
              bottom: 600,
              right: 400,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [{ blockSize: 600, inlineSize: 400 }],
            contentBoxSize: [{ blockSize: 600, inlineSize: 400 }],
            devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 400 }],
          } as ResizeObserverEntry,
        ],
        this
      );
    });
  });
  unobserve = vi.fn((target: Element) => {
    this.observedElements.delete(target);
  });
  disconnect = vi.fn(() => {
    this.observedElements.clear();
  });
}

Object.defineProperty(window, 'ResizeObserver', {
  value: ResizeObserverMock,
  writable: true,
});

// Mock scrollTo for virtualization
Element.prototype.scrollTo = vi.fn();

// Mock getBoundingClientRect for virtualization
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    // Return dimensions for scroll containers
    if (this.getAttribute('role') === 'listbox' || this.classList?.contains('overflow-auto')) {
      return {
        width: 400,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

// Create test models
function createMockModel(overrides: Partial<LLMModel> = {}): LLMModel {
  const defaults: LLMModel = {
    model_id: 'test/model-1',
    display_name: 'Test Model 1',
    provider: 'test',
    family: 'test-family',
    description: 'A test model',
    cost_tier: 'low',
    capabilities: {
      chat: true,
      function_calling: true,
      vision: false,
      streaming: true,
      system_prompt: true,
      json_mode: true,
    },
    context_window: 100000,
    max_output_tokens: 4096,
    is_default: false,
    input_cost_per_million: 1,
    output_cost_per_million: 5,
    good_for: ['general'],
    user_input_cost_per_million: 1,
    user_output_cost_per_million: 5,
    llm_margin_percent: 0,
    is_featured: false,
    categories: ['fast'],
  };
  return { ...defaults, ...overrides };
}

const mockModels: LLMModel[] = [
  createMockModel({
    model_id: 'anthropic/claude-3.5-sonnet',
    display_name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
  }),
  createMockModel({
    model_id: 'openai/gpt-4o',
    display_name: 'GPT-4o',
    provider: 'openai',
  }),
  createMockModel({
    model_id: 'google/gemini-pro',
    display_name: 'Gemini Pro',
    provider: 'google',
  }),
];

describe('ModelList', () => {
  const defaultProps = {
    models: mockModels,
    onSelectModel: vi.fn(),
    favorites: [],
    onToggleFavorite: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    __resetFavoritesCache();
  });

  it('renders with role="listbox"', () => {
    render(<ModelList {...defaultProps} />);

    expect(screen.getByRole('listbox', { name: 'Model list' })).toBeInTheDocument();
  });

  it('shows favorites section when favorites exist', () => {
    render(<ModelList {...defaultProps} favorites={['anthropic/claude-3.5-sonnet']} />);

    // Check for favorites header
    expect(screen.getByText('Favorites')).toBeInTheDocument();

    // Check for favorite models group
    expect(screen.getByRole('group', { name: 'Favorite models' })).toBeInTheDocument();
  });

  it('does not show favorites section when no favorites', () => {
    render(<ModelList {...defaultProps} favorites={[]} />);

    expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Favorite models' })).not.toBeInTheDocument();
  });

  it('only shows favorites that exist in models list', () => {
    render(
      <ModelList
        {...defaultProps}
        favorites={['anthropic/claude-3.5-sonnet', 'nonexistent/model']}
      />
    );

    // Should show favorites section since one model exists
    expect(screen.getByText('Favorites')).toBeInTheDocument();

    // The favorite model should be rendered in the favorites section
    const favoritesSection = screen.getByRole('group', { name: 'Favorite models' });
    expect(favoritesSection).toBeInTheDocument();
  });

  it('handles empty models array with default empty message', () => {
    render(<ModelList {...defaultProps} models={[]} />);

    expect(screen.getByText('No models found')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('handles empty models array with custom empty message', () => {
    render(<ModelList {...defaultProps} models={[]} emptyMessage="No matching models" />);

    expect(screen.getByText('No matching models')).toBeInTheDocument();
  });

  it('handles loading state with skeletons', () => {
    render(<ModelList {...defaultProps} isLoading={true} />);

    // Check for loading indicator
    const loadingContainer = document.querySelector('[aria-busy="true"]');
    expect(loadingContainer).toBeInTheDocument();

    // Should not show models while loading
    expect(screen.queryByText('Claude 3.5 Sonnet')).not.toBeInTheDocument();
  });

  it('calls onSelectModel when a favorite model is clicked', () => {
    const onSelectModel = vi.fn();
    render(
      <ModelList
        {...defaultProps}
        onSelectModel={onSelectModel}
        favorites={['anthropic/claude-3.5-sonnet']}
      />
    );

    // Click on the first model card (in favorites section)
    const claudeCards = screen.getAllByRole('button', { name: /select claude 3\.5 sonnet/i });
    expect(claudeCards.length).toBeGreaterThan(0);
    fireEvent.click(claudeCards[0]);

    expect(onSelectModel).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
  });

  it('passes correct isSelected prop to ModelCard in favorites', () => {
    render(
      <ModelList {...defaultProps} selectedModelId="openai/gpt-4o" favorites={['openai/gpt-4o']} />
    );

    // Check that the selected model has aria-pressed="true" (may appear multiple times)
    const gptCards = screen.getAllByRole('button', { name: /select gpt-4o/i });
    expect(gptCards.length).toBeGreaterThan(0);
    // The first one should be in favorites section
    expect(gptCards[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('respects showFavoriteToggle prop in favorites section', () => {
    render(
      <ModelList
        {...defaultProps}
        favorites={['anthropic/claude-3.5-sonnet']}
        showFavoriteToggle={false}
      />
    );

    // Favorite buttons should not be visible even in favorites section
    expect(screen.queryByLabelText('Add to favorites')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove from favorites')).not.toBeInTheDocument();
  });

  it('shows favorite toggle by default in favorites section', () => {
    render(<ModelList {...defaultProps} favorites={['anthropic/claude-3.5-sonnet']} />);

    // At least the favorite model's toggle should be visible
    const favoriteButtons = screen.queryAllByLabelText(/favorites/i);
    expect(favoriteButtons.length).toBeGreaterThan(0);
  });

  it('applies custom className', () => {
    const { container } = render(<ModelList {...defaultProps} className="custom-class" />);

    // The root element should have the custom class
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders without crashing with large model list', () => {
    // Create a large list of models
    const largeModelList = Array.from({ length: 200 }, (_, i) =>
      createMockModel({
        model_id: `provider/model-${i}`,
        display_name: `Model ${i}`,
      })
    );

    // Should render without throwing
    expect(() => {
      render(<ModelList {...defaultProps} models={largeModelList} />);
    }).not.toThrow();

    // The listbox should be present
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
  });

  it('renders virtualization container with correct structure', () => {
    render(<ModelList {...defaultProps} />);

    // Check that the virtualization container exists
    const listbox = screen.getByRole('listbox', { name: 'Model list' });
    expect(listbox).toBeInTheDocument();

    // The listbox should have a child div for virtual content
    const virtualContainer = listbox.querySelector('div[style*="height"]');
    expect(virtualContainer).toBeInTheDocument();
  });

  it('handles multiple favorites in favorites section', () => {
    render(
      <ModelList {...defaultProps} favorites={['anthropic/claude-3.5-sonnet', 'openai/gpt-4o']} />
    );

    // Both should appear in favorites section
    const favoritesSection = screen.getByRole('group', { name: 'Favorite models' });
    const favCards = favoritesSection.querySelectorAll('[role="button"]');
    expect(favCards.length).toBe(2);
  });

  it('renders favorite models in favorites section', () => {
    render(<ModelList {...defaultProps} favorites={['anthropic/claude-3.5-sonnet']} />);

    // Model should appear in favorites section
    const favoritesSection = screen.getByRole('group', { name: 'Favorite models' });
    expect(favoritesSection.querySelector('[role="button"]')).toBeInTheDocument();

    // The favorite model's name should be visible (may appear multiple times with virtualization)
    const claudeTexts = screen.getAllByText('Claude 3.5 Sonnet');
    expect(claudeTexts.length).toBeGreaterThan(0);
  });

  it('does not render empty favorites section when favorites do not match models', () => {
    render(
      <ModelList {...defaultProps} favorites={['nonexistent/model-1', 'nonexistent/model-2']} />
    );

    // Should not show favorites section since no favorites match models
    expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Favorite models' })).not.toBeInTheDocument();
  });

  it('renders loading skeleton cards', () => {
    render(<ModelList {...defaultProps} isLoading={true} />);

    // Check for skeleton elements by their structure
    const loadingContainer = document.querySelector('[aria-busy="true"]');
    expect(loadingContainer).toBeInTheDocument();

    // Should have multiple skeleton cards
    const skeletons = loadingContainer?.querySelectorAll('.rounded-lg.border');
    expect(skeletons?.length).toBeGreaterThan(0);
  });
});
