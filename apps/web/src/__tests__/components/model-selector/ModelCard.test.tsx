/**
 * Tests for ModelCard component
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelCard } from '@/components/model-selector/ModelCard';
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

describe('ModelCard', () => {
  const mockModel: LLMModel = {
    model_id: 'anthropic/claude-3.5-sonnet',
    display_name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    family: 'claude-3.5',
    description: 'A powerful AI model',
    cost_tier: 'medium',
    capabilities: {
      chat: true,
      function_calling: true,
      vision: true,
      streaming: true,
      system_prompt: true,
      json_mode: true,
    },
    context_window: 200000,
    max_output_tokens: 8192,
    is_default: false,
    input_cost_per_million: 3,
    output_cost_per_million: 15,
    good_for: ['general', 'coding'],
    user_input_cost_per_million: 3,
    user_output_cost_per_million: 15,
    llm_margin_percent: 0,
    is_featured: false,
    categories: ['fast', 'code', 'reasoning'],
  };

  const defaultProps = {
    model: mockModel,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    __resetFavoritesCache();
  });

  it('renders the model card', () => {
    render(<ModelCard {...defaultProps} />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('displays model name', () => {
    render(<ModelCard {...defaultProps} />);
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument();
  });

  it('displays model ID', () => {
    render(<ModelCard {...defaultProps} />);
    expect(screen.getByText('anthropic/claude-3.5-sonnet')).toBeInTheDocument();
  });

  it('shows featured star when is_featured is true', () => {
    const featuredModel = { ...mockModel, is_featured: true };
    render(<ModelCard {...defaultProps} model={featuredModel} />);
    expect(screen.getByLabelText('Featured')).toBeInTheDocument();
  });

  it('does not show featured star when is_featured is false', () => {
    render(<ModelCard {...defaultProps} />);
    expect(screen.queryByLabelText('Featured')).not.toBeInTheDocument();
  });

  it('shows Recommended badge when is_default is true', () => {
    const defaultModel = { ...mockModel, is_default: true };
    render(<ModelCard {...defaultProps} model={defaultModel} />);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('does not show Recommended badge when is_default is false', () => {
    render(<ModelCard {...defaultProps} />);
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
  });

  it('displays category badges', () => {
    render(<ModelCard {...defaultProps} />);
    // The categories are displayed as icons with aria-labels
    expect(screen.getByLabelText('Fast')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Reasoning')).toBeInTheDocument();
  });

  it('displays context window formatted', () => {
    render(<ModelCard {...defaultProps} />);
    expect(screen.getByText('200K context')).toBeInTheDocument();
  });

  it('displays pricing formatted', () => {
    render(<ModelCard {...defaultProps} />);
    expect(screen.getByText('$3 / $15 per 1M')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<ModelCard {...defaultProps} onSelect={onSelect} />);

    const card = screen.getByRole('button', { name: /select claude 3\.5 sonnet/i });
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
  });

  it('toggles favorite when heart clicked', () => {
    render(<ModelCard {...defaultProps} />);

    const favoriteButton = screen.getByLabelText('Add to favorites');
    fireEvent.click(favoriteButton);

    // After clicking, should now show "Remove from favorites"
    expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();
  });

  it('shows filled heart when model is favorited', () => {
    // First render and toggle favorite
    const { unmount } = render(<ModelCard {...defaultProps} />);

    const favoriteButton = screen.getByLabelText('Add to favorites');
    fireEvent.click(favoriteButton);

    // Now it should show remove from favorites
    expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();

    // Unmount and re-render to verify persistence
    unmount();

    render(<ModelCard {...defaultProps} />);

    // Should still show as favorited
    expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();
  });

  it('handles keyboard navigation - Enter to select', () => {
    const onSelect = vi.fn();
    render(<ModelCard {...defaultProps} onSelect={onSelect} />);

    const card = screen.getByRole('button', { name: /select claude 3\.5 sonnet/i });
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
  });

  it('handles keyboard navigation - Space to select', () => {
    const onSelect = vi.fn();
    render(<ModelCard {...defaultProps} onSelect={onSelect} />);

    const card = screen.getByRole('button', { name: /select claude 3\.5 sonnet/i });
    fireEvent.keyDown(card, { key: ' ' });

    expect(onSelect).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
  });

  it('handles keyboard navigation - Enter on favorite button', () => {
    render(<ModelCard {...defaultProps} />);

    const favoriteButton = screen.getByLabelText('Add to favorites');
    fireEvent.keyDown(favoriteButton, { key: 'Enter' });

    expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();
  });

  it('handles keyboard navigation - Space on favorite button', () => {
    render(<ModelCard {...defaultProps} />);

    const favoriteButton = screen.getByLabelText('Add to favorites');
    fireEvent.keyDown(favoriteButton, { key: ' ' });

    expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();
  });

  it('applies correct styling when selected', () => {
    render(<ModelCard {...defaultProps} isSelected={true} />);

    const card = screen.getByRole('button', { name: /select claude 3\.5 sonnet/i });
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card.className).toContain('border-primary');
  });

  it('applies correct styling when not selected', () => {
    render(<ModelCard {...defaultProps} isSelected={false} />);

    const card = screen.getByRole('button', { name: /select claude 3\.5 sonnet/i });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(card.className).not.toContain('border-primary');
  });

  it('hides favorite toggle when showFavoriteToggle is false', () => {
    render(<ModelCard {...defaultProps} showFavoriteToggle={false} />);

    expect(screen.queryByLabelText('Add to favorites')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove from favorites')).not.toBeInTheDocument();
  });

  it('shows favorite toggle by default', () => {
    render(<ModelCard {...defaultProps} />);

    expect(screen.getByLabelText('Add to favorites')).toBeInTheDocument();
  });

  it('formats context window for million tokens', () => {
    const largeContextModel = { ...mockModel, context_window: 1000000 };
    render(<ModelCard {...defaultProps} model={largeContextModel} />);
    expect(screen.getByText('1M context')).toBeInTheDocument();
  });

  it('formats context window for small values', () => {
    const smallContextModel = { ...mockModel, context_window: 500 };
    render(<ModelCard {...defaultProps} model={smallContextModel} />);
    expect(screen.getByText('500 context')).toBeInTheDocument();
  });

  it('displays Free for null pricing', () => {
    const freeModel = {
      ...mockModel,
      input_cost_per_million: null,
      output_cost_per_million: null,
    };
    render(<ModelCard {...defaultProps} model={freeModel} />);
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('does not call onSelect when favorite button is clicked', () => {
    const onSelect = vi.fn();
    render(<ModelCard {...defaultProps} onSelect={onSelect} />);

    const favoriteButton = screen.getByLabelText('Add to favorites');
    fireEvent.click(favoriteButton);

    // onSelect should not be called when clicking the favorite button
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('handles model without categories', () => {
    const modelWithoutCategories = { ...mockModel, categories: undefined };
    render(<ModelCard {...defaultProps} model={modelWithoutCategories} />);

    // Should render without errors
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument();
    // Should not have category badges container
    expect(screen.queryByLabelText('Model categories')).not.toBeInTheDocument();
  });

  it('handles model with empty categories array', () => {
    const modelWithEmptyCategories = { ...mockModel, categories: [] };
    render(<ModelCard {...defaultProps} model={modelWithEmptyCategories} />);

    // Should render without errors
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument();
  });
});
