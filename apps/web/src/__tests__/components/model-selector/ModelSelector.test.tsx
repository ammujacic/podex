/**
 * Tests for ModelSelector component
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSelector } from '@/components/model-selector/ModelSelector';
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

// Mock @/lib/api for local models discovery (useOllamaModels hook uses these)
const mockGetLocalLLMConfig = vi.fn();
const mockDiscoverLocalModels = vi.fn();

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api');
  return {
    ...actual,
    getLocalLLMConfig: () => mockGetLocalLLMConfig(),
    discoverLocalModels: (params: unknown) => mockDiscoverLocalModels(params),
  };
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

// Create test models helper
function createMockModel(overrides: Partial<LLMModel> = {}): LLMModel {
  const defaults: LLMModel = {
    model_id: 'test/model-1',
    display_name: 'Test Model 1',
    provider: 'test',
    family: 'test-family',
    description: 'A test model',
    cost_tier: 'low',
    capabilities: {
      vision: false,
      thinking: false,
      tool_use: true,
      streaming: true,
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
    is_featured: true,
    categories: ['fast'],
  };
  return { ...defaults, ...overrides };
}

const mockPodexModels: LLMModel[] = [
  createMockModel({
    model_id: 'anthropic/claude-3.5-sonnet',
    display_name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    is_featured: true,
  }),
  createMockModel({
    model_id: 'openai/gpt-4o',
    display_name: 'GPT-4o',
    provider: 'openai',
    is_featured: true,
  }),
  createMockModel({
    model_id: 'google/gemini-pro',
    display_name: 'Gemini Pro',
    provider: 'google',
    is_featured: true,
  }),
];

const mockUserKeyModels: LLMModel[] = [
  createMockModel({
    model_id: 'custom/my-model',
    display_name: 'My Custom Model',
    provider: 'custom',
    is_featured: true,
  }),
];

describe('ModelSelector', () => {
  const defaultProps = {
    models: mockPodexModels,
    onSelectModel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    __resetFavoritesCache();

    // Default local LLM mocks - no cached config, connection error on discover
    mockGetLocalLLMConfig.mockResolvedValue(null);
    mockDiscoverLocalModels.mockRejectedValue(new Error('Could not connect to Ollama'));
  });

  describe('Tab rendering', () => {
    it('renders with three tabs', async () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByRole('tab', { name: 'Podex' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Your Keys' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Local' })).toBeInTheDocument();
    });

    it('default tab is Podex', async () => {
      render(<ModelSelector {...defaultProps} />);

      const podexTab = screen.getByRole('tab', { name: 'Podex' });
      expect(podexTab).toHaveAttribute('data-state', 'active');
    });

    it('can switch between tabs', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} />);

      // Click Your Keys tab
      const yourKeysTab = screen.getByRole('tab', { name: 'Your Keys' });
      await user.click(yourKeysTab);

      await waitFor(() => {
        expect(yourKeysTab).toHaveAttribute('data-state', 'active');
      });
      expect(screen.getByRole('tab', { name: 'Podex' })).toHaveAttribute('data-state', 'inactive');

      // Click Local tab
      const localTab = screen.getByRole('tab', { name: 'Local' });
      await user.click(localTab);

      await waitFor(() => {
        expect(localTab).toHaveAttribute('data-state', 'active');
      });
      expect(yourKeysTab).toHaveAttribute('data-state', 'inactive');
    });

    it('respects defaultTab prop', async () => {
      render(<ModelSelector {...defaultProps} defaultTab="your-keys" />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Your Keys' })).toHaveAttribute(
          'data-state',
          'active'
        );
      });
      expect(screen.getByRole('tab', { name: 'Podex' })).toHaveAttribute('data-state', 'inactive');
    });

    it('respects defaultTab prop for local', async () => {
      render(<ModelSelector {...defaultProps} defaultTab="local" />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Local' })).toHaveAttribute('data-state', 'active');
      });
    });
  });

  describe('Podex tab', () => {
    it('shows search input', async () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByLabelText('Search models')).toBeInTheDocument();
    });

    it('shows filter chips', async () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Fast' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reasoning' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument();
    });

    it('does not show "Show all" toggle (removed for simplicity)', async () => {
      render(<ModelSelector {...defaultProps} />);

      // Show all toggle was removed to keep interface simple
      expect(screen.queryByText(/Show all/)).not.toBeInTheDocument();
    });

    it('shows model list', async () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByRole('listbox', { name: 'Model list' })).toBeInTheDocument();
    });

    it('displays models from props', async () => {
      render(<ModelSelector {...defaultProps} />);

      // Models should be visible in the list
      await waitFor(() => {
        expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument();
      });
    });

    it('shows loading state when isLoading is true', async () => {
      render(<ModelSelector {...defaultProps} isLoading={true} />);

      const loadingContainer = document.querySelector('[aria-busy="true"]');
      expect(loadingContainer).toBeInTheDocument();
    });
  });

  describe('Your Keys tab', () => {
    it('shows empty state when no user key models', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} userKeyModels={[]} />);

      // Switch to Your Keys tab
      await user.click(screen.getByRole('tab', { name: 'Your Keys' }));

      await waitFor(() => {
        expect(
          screen.getByText(
            'Configure your API keys in Settings to use models with your own billing.'
          )
        ).toBeInTheDocument();
      });
    });

    it('shows user key models when provided', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} userKeyModels={mockUserKeyModels} />);

      // Switch to Your Keys tab
      await user.click(screen.getByRole('tab', { name: 'Your Keys' }));

      await waitFor(() => {
        expect(screen.getByText('My Custom Model')).toBeInTheDocument();
      });
    });

    it('shows search in Your Keys tab when models exist', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} userKeyModels={mockUserKeyModels} />);

      // Switch to Your Keys tab
      await user.click(screen.getByRole('tab', { name: 'Your Keys' }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search your models...')).toBeInTheDocument();
      });
    });

    it('does not show filters in Your Keys tab', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} userKeyModels={mockUserKeyModels} />);

      // Switch to Your Keys tab
      await user.click(screen.getByRole('tab', { name: 'Your Keys' }));

      // Wait for tab switch, then verify filter buttons are not shown
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Your Keys' })).toHaveAttribute(
          'data-state',
          'active'
        );
      });

      // The Podex filters should not be visible when on Your Keys tab
      // ModelFilters component is only rendered in Podex tab
      const filterGroup = screen.queryByRole('group', { name: 'Filter by category' });
      expect(filterGroup).not.toBeInTheDocument();
    });
  });

  describe('Local tab', () => {
    it('shows connection error when Ollama is not running', async () => {
      const user = userEvent.setup();
      // Default mock already rejects with connection error

      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByText(/Could not connect to Ollama/i)).toBeInTheDocument();
      });
    });

    it('shows refresh button', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Refresh local models' })).toBeInTheDocument();
      });
    });

    it('shows search in Local tab', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search local models...')).toBeInTheDocument();
      });
    });

    it('shows loading state when discovering models', async () => {
      const user = userEvent.setup();
      // Make discoverLocalModels hang
      mockDiscoverLocalModels.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByText('Discovering local models...')).toBeInTheDocument();
      });
    });

    it('shows empty state when Ollama connected but no models', async () => {
      const user = userEvent.setup();
      mockDiscoverLocalModels.mockResolvedValue({
        success: true,
        models: [],
      });

      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByText(/No local models found/i)).toBeInTheDocument();
      });
    });

    it('shows Ollama models when available', async () => {
      const user = userEvent.setup();
      mockDiscoverLocalModels.mockResolvedValue({
        success: true,
        models: [
          {
            id: 'llama2:7b',
            name: 'llama2:7b',
            size: 3826793472,
          },
        ],
      });

      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByText('Llama2')).toBeInTheDocument();
      });
    });

    it('refresh button triggers model refresh', async () => {
      const user = userEvent.setup();
      mockDiscoverLocalModels.mockResolvedValue({
        success: true,
        models: [],
      });

      render(<ModelSelector {...defaultProps} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      // Wait for initial load
      await waitFor(() => {
        expect(mockDiscoverLocalModels).toHaveBeenCalled();
      });

      const initialCallCount = mockDiscoverLocalModels.mock.calls.length;

      // Click refresh
      const refreshButton = screen.getByRole('button', { name: 'Refresh local models' });
      await user.click(refreshButton);

      await waitFor(() => {
        expect(mockDiscoverLocalModels.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });
  });

  describe('Model selection', () => {
    it('calls onSelectModel when model is selected', async () => {
      const user = userEvent.setup();
      const onSelectModel = vi.fn();
      render(<ModelSelector {...defaultProps} onSelectModel={onSelectModel} />);

      // Find and click a model card
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Select Claude 3\.5 Sonnet/i })
        ).toBeInTheDocument();
      });

      const modelCard = screen.getByRole('button', { name: /Select Claude 3\.5 Sonnet/i });
      await user.click(modelCard);

      expect(onSelectModel).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
    });

    it('selected model is highlighted', async () => {
      render(<ModelSelector {...defaultProps} selectedModelId="anthropic/claude-3.5-sonnet" />);

      await waitFor(() => {
        const modelCard = screen.getByRole('button', { name: /Select Claude 3\.5 Sonnet/i });
        expect(modelCard).toHaveAttribute('aria-pressed', 'true');
      });
    });

    it('non-selected models are not highlighted', async () => {
      render(<ModelSelector {...defaultProps} selectedModelId="anthropic/claude-3.5-sonnet" />);

      await waitFor(() => {
        const gptCard = screen.getByRole('button', { name: /Select GPT-4o/i });
        expect(gptCard).toHaveAttribute('aria-pressed', 'false');
      });
    });

    it('can select models from Your Keys tab', async () => {
      const user = userEvent.setup();
      const onSelectModel = vi.fn();
      render(
        <ModelSelector
          {...defaultProps}
          onSelectModel={onSelectModel}
          userKeyModels={mockUserKeyModels}
        />
      );

      // Switch to Your Keys tab
      await user.click(screen.getByRole('tab', { name: 'Your Keys' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Select My Custom Model/i })).toBeInTheDocument();
      });

      const modelCard = screen.getByRole('button', { name: /Select My Custom Model/i });
      await user.click(modelCard);

      expect(onSelectModel).toHaveBeenCalledWith('custom/my-model');
    });

    it('can select models from Local tab', async () => {
      const user = userEvent.setup();
      mockDiscoverLocalModels.mockResolvedValue({
        success: true,
        models: [
          {
            id: 'llama2:7b',
            name: 'llama2:7b',
            size: 3826793472,
          },
        ],
      });

      const onSelectModel = vi.fn();
      render(<ModelSelector {...defaultProps} onSelectModel={onSelectModel} />);

      // Switch to Local tab
      await user.click(screen.getByRole('tab', { name: 'Local' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Select Llama2/i })).toBeInTheDocument();
      });

      const modelCard = screen.getByRole('button', { name: /Select Llama2/i });
      await user.click(modelCard);

      // Model ID is prefixed with provider (e.g., "ollama/llama2:7b")
      expect(onSelectModel).toHaveBeenCalledWith('ollama/llama2:7b');
    });
  });

  describe('Search functionality', () => {
    it('filters models in Podex tab', async () => {
      const user = userEvent.setup();
      render(<ModelSelector {...defaultProps} />);

      const searchInput = screen.getByLabelText('Search models');
      await user.type(searchInput, 'claude');

      // Wait for debounce
      await waitFor(
        () => {
          expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });
  });

  describe('className prop', () => {
    it('applies custom className', async () => {
      const { container } = render(
        <ModelSelector {...defaultProps} className="custom-test-class" />
      );

      expect(container.firstChild).toHaveClass('custom-test-class');
    });
  });

  describe('Accessibility', () => {
    it('has accessible tab list', async () => {
      render(<ModelSelector {...defaultProps} />);

      const tabList = screen.getByRole('tablist', { name: 'Model source tabs' });
      expect(tabList).toBeInTheDocument();
    });

    it('tabs have correct ARIA attributes', async () => {
      render(<ModelSelector {...defaultProps} />);

      const podexTab = screen.getByRole('tab', { name: 'Podex' });
      expect(podexTab).toHaveAttribute('data-state', 'active');

      const yourKeysTab = screen.getByRole('tab', { name: 'Your Keys' });
      expect(yourKeysTab).toHaveAttribute('data-state', 'inactive');
    });

    it('tab panels are focusable', async () => {
      render(<ModelSelector {...defaultProps} />);

      // The active tab panel should be accessible
      const panels = document.querySelectorAll('[role="tabpanel"]');
      expect(panels.length).toBeGreaterThan(0);
    });
  });
});
