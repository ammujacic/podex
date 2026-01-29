/**
 * Tests for ModelFilters component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelFilters } from '@/components/model-selector/ModelFilters';
import { MODEL_CATEGORIES } from '@/components/model-selector/types';
import type { ModelCategory } from '@/components/model-selector/types';

describe('ModelFilters', () => {
  const defaultProps = {
    activeCategories: [] as ModelCategory[],
    onToggleCategory: vi.fn(),
  };

  it('renders all category chips', () => {
    render(<ModelFilters {...defaultProps} />);

    // Check that all categories are rendered
    MODEL_CATEGORIES.forEach((category) => {
      expect(screen.getByRole('button', { name: category.label })).toBeInTheDocument();
    });
  });

  it('shows correct icons for each category', () => {
    render(<ModelFilters {...defaultProps} />);

    // Each category button should contain its icon
    MODEL_CATEGORIES.forEach((category) => {
      const button = screen.getByRole('button', { name: category.label });
      expect(button.textContent).toContain(category.icon);
    });
  });

  it('active categories have aria-pressed="true"', () => {
    const activeCategories: ModelCategory[] = ['fast', 'code'];
    render(<ModelFilters {...defaultProps} activeCategories={activeCategories} />);

    // Active categories should have aria-pressed="true"
    const fastButton = screen.getByRole('button', { name: 'Fast' });
    const codeButton = screen.getByRole('button', { name: 'Code' });
    expect(fastButton).toHaveAttribute('aria-pressed', 'true');
    expect(codeButton).toHaveAttribute('aria-pressed', 'true');

    // Inactive categories should have aria-pressed="false"
    const reasoningButton = screen.getByRole('button', { name: 'Reasoning' });
    const visionButton = screen.getByRole('button', { name: 'Vision' });
    expect(reasoningButton).toHaveAttribute('aria-pressed', 'false');
    expect(visionButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a chip calls onToggleCategory with correct category', () => {
    const onToggleCategory = vi.fn();
    render(<ModelFilters {...defaultProps} onToggleCategory={onToggleCategory} />);

    const fastButton = screen.getByRole('button', { name: 'Fast' });
    fireEvent.click(fastButton);

    expect(onToggleCategory).toHaveBeenCalledWith('fast');
    expect(onToggleCategory).toHaveBeenCalledTimes(1);
  });

  it('keyboard Enter on chip calls onToggleCategory', () => {
    const onToggleCategory = vi.fn();
    render(<ModelFilters {...defaultProps} onToggleCategory={onToggleCategory} />);

    const reasoningButton = screen.getByRole('button', { name: 'Reasoning' });
    fireEvent.keyDown(reasoningButton, { key: 'Enter' });

    expect(onToggleCategory).toHaveBeenCalledWith('reasoning');
  });

  it('keyboard Space on chip calls onToggleCategory', () => {
    const onToggleCategory = vi.fn();
    render(<ModelFilters {...defaultProps} onToggleCategory={onToggleCategory} />);

    const codeButton = screen.getByRole('button', { name: 'Code' });
    fireEvent.keyDown(codeButton, { key: ' ' });

    expect(onToggleCategory).toHaveBeenCalledWith('code');
  });

  it('shows "Show all" toggle when showAllToggle is true', () => {
    render(<ModelFilters {...defaultProps} showAllToggle={true} onToggleShowAll={vi.fn()} />);

    expect(screen.getByText('Show all (200+)')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides "Show all" toggle when showAllToggle is false', () => {
    render(<ModelFilters {...defaultProps} showAllToggle={false} />);

    expect(screen.queryByText('Show all (200+)')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('"Show all" toggle reflects showAll state - checked', () => {
    render(
      <ModelFilters
        {...defaultProps}
        showAllToggle={true}
        showAll={true}
        onToggleShowAll={vi.fn()}
      />
    );

    const toggle = screen.getByRole('checkbox');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('"Show all" toggle reflects showAll state - unchecked', () => {
    render(
      <ModelFilters
        {...defaultProps}
        showAllToggle={true}
        showAll={false}
        onToggleShowAll={vi.fn()}
      />
    );

    const toggle = screen.getByRole('checkbox');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking "Show all" calls onToggleShowAll', () => {
    const onToggleShowAll = vi.fn();
    render(
      <ModelFilters
        {...defaultProps}
        showAllToggle={true}
        showAll={false}
        onToggleShowAll={onToggleShowAll}
      />
    );

    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);

    expect(onToggleShowAll).toHaveBeenCalledTimes(1);
  });

  it('keyboard Enter on "Show all" calls onToggleShowAll', () => {
    const onToggleShowAll = vi.fn();
    render(
      <ModelFilters
        {...defaultProps}
        showAllToggle={true}
        showAll={false}
        onToggleShowAll={onToggleShowAll}
      />
    );

    const toggle = screen.getByRole('checkbox');
    fireEvent.keyDown(toggle, { key: 'Enter' });

    expect(onToggleShowAll).toHaveBeenCalledTimes(1);
  });

  it('keyboard Space on "Show all" calls onToggleShowAll', () => {
    const onToggleShowAll = vi.fn();
    render(
      <ModelFilters
        {...defaultProps}
        showAllToggle={true}
        showAll={false}
        onToggleShowAll={onToggleShowAll}
      />
    );

    const toggle = screen.getByRole('checkbox');
    fireEvent.keyDown(toggle, { key: ' ' });

    expect(onToggleShowAll).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    render(<ModelFilters {...defaultProps} className="custom-class-name" />);

    const container = screen.getByRole('group', { name: 'Filter by category' });
    expect(container).toHaveClass('custom-class-name');
  });

  it('has correct container role and aria-label', () => {
    render(<ModelFilters {...defaultProps} />);

    const container = screen.getByRole('group', { name: 'Filter by category' });
    expect(container).toBeInTheDocument();
  });

  it('active chips have different styling from inactive chips', () => {
    const activeCategories: ModelCategory[] = ['fast'];
    render(<ModelFilters {...defaultProps} activeCategories={activeCategories} />);

    const activeButton = screen.getByRole('button', { name: 'Fast' });
    const inactiveButton = screen.getByRole('button', { name: 'Reasoning' });

    // Active chip should have primary background
    expect(activeButton.className).toContain('bg-primary');
    expect(activeButton.className).toContain('text-primary-foreground');

    // Inactive chip should have background styling
    expect(inactiveButton.className).toContain('bg-background');
    expect(inactiveButton.className).not.toContain('bg-primary');
  });

  it('chips have focus ring for accessibility', () => {
    render(<ModelFilters {...defaultProps} />);

    const button = screen.getByRole('button', { name: 'Fast' });
    expect(button.className).toContain('focus:ring-2');
  });

  it('chips show description as title tooltip', () => {
    render(<ModelFilters {...defaultProps} />);

    MODEL_CATEGORIES.forEach((category) => {
      const button = screen.getByRole('button', { name: category.label });
      expect(button).toHaveAttribute('title', category.description);
    });
  });

  it('toggles multiple categories independently', () => {
    const onToggleCategory = vi.fn();
    render(<ModelFilters {...defaultProps} onToggleCategory={onToggleCategory} />);

    const fastButton = screen.getByRole('button', { name: 'Fast' });
    const codeButton = screen.getByRole('button', { name: 'Code' });
    const visionButton = screen.getByRole('button', { name: 'Vision' });

    fireEvent.click(fastButton);
    fireEvent.click(codeButton);
    fireEvent.click(visionButton);

    expect(onToggleCategory).toHaveBeenCalledTimes(3);
    expect(onToggleCategory).toHaveBeenNthCalledWith(1, 'fast');
    expect(onToggleCategory).toHaveBeenNthCalledWith(2, 'code');
    expect(onToggleCategory).toHaveBeenNthCalledWith(3, 'vision');
  });
});
