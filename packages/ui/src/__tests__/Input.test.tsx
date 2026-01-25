import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../Input';

describe('Input', () => {
  describe('Rendering', () => {
    it('should render input element', () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('should render with text type by default', () => {
      render(<Input type="text" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveAttribute('type', 'text');
    });

    it('should render with specific type', () => {
      render(<Input type="email" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveAttribute('type', 'email');
    });

    it('should render different input types', () => {
      const { rerender } = render(<Input type="password" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'password');

      rerender(<Input type="number" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'number');

      rerender(<Input type="tel" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'tel');
    });
  });

  describe('Props', () => {
    it('should accept placeholder', () => {
      render(<Input placeholder="Enter your name" />);
      expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument();
    });

    it('should accept value', () => {
      render(<Input value="test value" onChange={() => {}} />);
      expect(screen.getByDisplayValue('test value')).toBeInTheDocument();
    });

    it('should accept defaultValue', () => {
      render(<Input defaultValue="default text" />);
      expect(screen.getByDisplayValue('default text')).toBeInTheDocument();
    });

    it('should be disabled when disabled prop is true', () => {
      render(<Input disabled data-testid="input" />);
      expect(screen.getByTestId('input')).toBeDisabled();
    });

    it('should accept custom className', () => {
      render(<Input className="custom-class" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveClass('custom-class');
    });

    it('should merge custom className with default classes', () => {
      render(<Input className="custom-class" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveClass('custom-class');
      expect(input).toHaveClass('flex'); // Default class
    });
  });

  describe('User Interaction', () => {
    it('should call onChange when user types', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();

      render(<Input onChange={onChange} />);
      const input = screen.getByRole('textbox');

      await user.type(input, 'test');

      expect(onChange).toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledTimes(4); // Once per character
    });

    it('should not call onChange when disabled', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();

      render(<Input disabled onChange={onChange} />);
      const input = screen.getByRole('textbox');

      await user.type(input, 'test');

      expect(onChange).not.toHaveBeenCalled();
    });

    it('should update value when typing', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn((e) => e.target.value);

      render(<Input onChange={onChange} data-testid="input" />);
      const input = screen.getByTestId('input') as HTMLInputElement;

      await user.type(input, 'hello');

      expect(input.value).toBe('hello');
    });

    it('should handle focus events', async () => {
      const onFocus = vi.fn();
      const user = userEvent.setup();

      render(<Input onFocus={onFocus} />);
      const input = screen.getByRole('textbox');

      await user.click(input);

      expect(onFocus).toHaveBeenCalledTimes(1);
    });

    it('should handle blur events', async () => {
      const onBlur = vi.fn();
      const user = userEvent.setup();

      render(<Input onBlur={onBlur} />);
      const input = screen.getByRole('textbox');

      await user.click(input);
      await user.tab(); // Move focus away

      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ref', () => {
    it('should forward ref to input element', () => {
      const ref = { current: null as HTMLInputElement | null };
      render(<Input ref={ref} />);

      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('should allow calling methods on ref', () => {
      const ref = { current: null as HTMLInputElement | null };
      render(<Input ref={ref} />);

      expect(ref.current?.focus).toBeDefined();
      expect(ref.current?.blur).toBeDefined();
    });
  });

  describe('Attributes', () => {
    it('should accept required attribute', () => {
      render(<Input required data-testid="input" />);
      expect(screen.getByTestId('input')).toBeRequired();
    });

    it('should accept readonly attribute', () => {
      render(<Input readOnly data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('readonly');
    });

    it('should accept name attribute', () => {
      render(<Input name="email" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('name', 'email');
    });

    it('should accept maxLength attribute', () => {
      render(<Input maxLength={10} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('maxLength', '10');
    });

    it('should accept aria attributes', () => {
      render(<Input aria-label="Email input" aria-describedby="email-help" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveAttribute('aria-label', 'Email input');
      expect(input).toHaveAttribute('aria-describedby', 'email-help');
    });
  });
});
