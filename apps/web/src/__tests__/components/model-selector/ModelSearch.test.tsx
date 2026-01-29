/**
 * Tests for ModelSearch component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelSearch } from '@/components/model-selector/ModelSearch';

describe('ModelSearch', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  };

  it('renders search input with placeholder', () => {
    render(<ModelSearch {...defaultProps} placeholder="Search models..." />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Search models...');
  });

  it('renders default placeholder when not provided', () => {
    render(<ModelSearch {...defaultProps} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).toHaveAttribute('placeholder', 'Search models...');
  });

  it('shows search icon', () => {
    const { container } = render(<ModelSearch {...defaultProps} />);

    // Search icon should be present (lucide-react renders SVG with class)
    const searchIcon = container.querySelector('svg.lucide-search');
    expect(searchIcon).toBeInTheDocument();
  });

  it('updates value when typing', () => {
    const { rerender } = render(<ModelSearch {...defaultProps} value="" />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).toHaveValue('');

    // Simulate parent updating value prop
    rerender(<ModelSearch {...defaultProps} value="claude" />);
    expect(input).toHaveValue('claude');
  });

  it('calls onChange when input changes', () => {
    const onChange = vi.fn();
    render(<ModelSearch {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    fireEvent.change(input, { target: { value: 'gpt' } });

    expect(onChange).toHaveBeenCalledWith('gpt');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows clear button when value is not empty', () => {
    render(<ModelSearch {...defaultProps} value="some search" />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    expect(clearButton).toBeInTheDocument();
  });

  it('hides clear button when value is empty', () => {
    render(<ModelSearch {...defaultProps} value="" />);

    const clearButton = screen.queryByRole('button', { name: 'Clear search' });
    expect(clearButton).not.toBeInTheDocument();
  });

  it('clears input and calls onChange with empty string when X is clicked', () => {
    const onChange = vi.fn();
    render(<ModelSearch {...defaultProps} value="test query" onChange={onChange} />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears input via keyboard Enter on clear button', () => {
    const onChange = vi.fn();
    render(<ModelSearch {...defaultProps} value="test query" onChange={onChange} />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.keyDown(clearButton, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('clears input via keyboard Space on clear button', () => {
    const onChange = vi.fn();
    render(<ModelSearch {...defaultProps} value="test query" onChange={onChange} />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.keyDown(clearButton, { key: ' ' });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('maintains focus after clearing', () => {
    const onChange = vi.fn();
    render(<ModelSearch {...defaultProps} value="test" onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    const clearButton = screen.getByRole('button', { name: 'Clear search' });

    // Focus the input first
    input.focus();
    expect(document.activeElement).toBe(input);

    // Click clear
    fireEvent.click(clearButton);

    // Focus should be back on input
    expect(document.activeElement).toBe(input);
  });

  it('applies custom className', () => {
    const { container } = render(
      <ModelSearch {...defaultProps} className="custom-search-class" />
    );

    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('custom-search-class');
  });

  it('autoFocus works when true', () => {
    render(<ModelSearch {...defaultProps} autoFocus={true} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).toHaveFocus();
  });

  it('does not autoFocus when false', () => {
    render(<ModelSearch {...defaultProps} autoFocus={false} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).not.toHaveFocus();
  });

  it('does not autoFocus by default', () => {
    render(<ModelSearch {...defaultProps} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).not.toHaveFocus();
  });

  it('has proper aria-label on input', () => {
    render(<ModelSearch {...defaultProps} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input).toHaveAttribute('aria-label', 'Search models');
  });

  it('has proper aria-label on clear button', () => {
    render(<ModelSearch {...defaultProps} value="test" />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    expect(clearButton).toHaveAttribute('aria-label', 'Clear search');
  });

  it('input has correct styling classes', () => {
    render(<ModelSearch {...defaultProps} />);

    const input = screen.getByRole('textbox', { name: 'Search models' });
    expect(input.className).toContain('rounded-md');
    expect(input.className).toContain('border');
  });

  it('clear button has hover and focus styles', () => {
    render(<ModelSearch {...defaultProps} value="test" />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    expect(clearButton.className).toContain('hover:text-foreground');
    expect(clearButton.className).toContain('focus:ring-2');
  });

  it('search icon is hidden from assistive technologies', () => {
    const { container } = render(<ModelSearch {...defaultProps} />);

    const searchIcon = container.querySelector('svg.lucide-search');
    expect(searchIcon).toHaveAttribute('aria-hidden', 'true');
  });

  it('X icon is hidden from assistive technologies', () => {
    const { container } = render(<ModelSearch {...defaultProps} value="test" />);

    const xIcon = container.querySelector('svg.lucide-x');
    expect(xIcon).toHaveAttribute('aria-hidden', 'true');
  });
});
