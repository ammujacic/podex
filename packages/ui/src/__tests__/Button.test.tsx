import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, IconButton, ButtonGroup } from '../Button';

describe('Button', () => {
  describe('Rendering', () => {
    it('should render with children', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
    });

    it('should render with default variant (primary)', () => {
      render(<Button>Primary</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-accent-primary');
    });

    it('should render with secondary variant', () => {
      render(<Button variant="secondary">Secondary</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-elevated');
    });

    it('should render with ghost variant', () => {
      render(<Button variant="ghost">Ghost</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-transparent');
    });

    it('should render with danger variant', () => {
      render(<Button variant="danger">Delete</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-accent-error');
    });

    it('should render with success variant', () => {
      render(<Button variant="success">Success</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-accent-success');
    });

    it('should render with link variant', () => {
      render(<Button variant="link">Link</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('text-accent-primary');
    });

    it('should render with outline variant', () => {
      render(<Button variant="outline">Outline</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('border-accent-primary');
    });
  });

  describe('Sizes', () => {
    it('should render with xs size', () => {
      render(<Button size="xs">Extra Small</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-7');
    });

    it('should render with sm size', () => {
      render(<Button size="sm">Small</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-9');
    });

    it('should render with md size (default)', () => {
      render(<Button size="md">Medium</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-10');
    });

    it('should render with lg size', () => {
      render(<Button size="lg">Large</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-12');
    });

    it('should render with xl size', () => {
      render(<Button size="xl">Extra Large</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-14');
    });

    it('should render with icon size', () => {
      render(<Button size="icon">+</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-10', 'w-10');
    });
  });

  describe('States', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('should show loading spinner when loading', () => {
      render(<Button loading>Loading</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveClass('text-transparent');
    });

    it('should be disabled when loading', () => {
      render(<Button loading>Loading</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('should render full width', () => {
      render(<Button fullWidth>Full Width</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('w-full');
    });
  });

  describe('Icons', () => {
    it('should render with left icon', () => {
      render(<Button leftIcon={<span data-testid="left-icon">←</span>}>With Left Icon</Button>);
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    });

    it('should render with right icon', () => {
      render(<Button rightIcon={<span data-testid="right-icon">→</span>}>With Right Icon</Button>);
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('should not show icons when loading', () => {
      render(
        <Button
          loading
          leftIcon={<span data-testid="left-icon">←</span>}
          rightIcon={<span data-testid="right-icon">→</span>}
        >
          Loading
        </Button>
      );
      expect(screen.queryByTestId('left-icon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('right-icon')).not.toBeInTheDocument();
    });
  });

  describe('Events', () => {
    it('should call onClick when clicked', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();

      render(<Button onClick={onClick}>Click me</Button>);
      await user.click(screen.getByRole('button'));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when disabled', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();

      render(
        <Button onClick={onClick} disabled>
          Click me
        </Button>
      );
      await user.click(screen.getByRole('button'));

      expect(onClick).not.toHaveBeenCalled();
    });

    it('should not call onClick when loading', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();

      render(
        <Button onClick={onClick} loading>
          Click me
        </Button>
      );
      await user.click(screen.getByRole('button'));

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('Custom className', () => {
    it('should merge custom className', () => {
      render(<Button className="custom-class">Button</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
      expect(button).toHaveClass('bg-accent-primary'); // Should still have default classes
    });
  });
});

describe('IconButton', () => {
  it('should render with icon', () => {
    render(<IconButton icon={<span data-testid="icon">×</span>} label="Close" />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('should have aria-label', () => {
    render(<IconButton icon={<span>×</span>} label="Close" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toBeInTheDocument();
  });

  it('should use icon size by default', () => {
    render(<IconButton icon={<span>×</span>} label="Close" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('h-10', 'w-10');
  });

  it('should use ghost variant by default', () => {
    render(<IconButton icon={<span>×</span>} label="Close" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-transparent');
  });

  it('should accept custom size and variant', () => {
    render(<IconButton icon={<span>×</span>} label="Close" size="icon-lg" variant="danger" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('h-12', 'w-12');
    expect(button).toHaveClass('bg-accent-error');
  });
});

describe('ButtonGroup', () => {
  it('should render children', () => {
    render(
      <ButtonGroup>
        <Button>First</Button>
        <Button>Second</Button>
      </ButtonGroup>
    );
    expect(screen.getByRole('button', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument();
  });

  it('should have role="group"', () => {
    render(
      <ButtonGroup>
        <Button>First</Button>
      </ButtonGroup>
    );
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    render(
      <ButtonGroup className="custom-group">
        <Button>First</Button>
      </ButtonGroup>
    );
    expect(screen.getByRole('group')).toHaveClass('custom-group');
  });

  it('should render with gap by default', () => {
    render(
      <ButtonGroup>
        <Button>First</Button>
      </ButtonGroup>
    );
    expect(screen.getByRole('group')).toHaveClass('gap-2');
  });

  it('should render attached buttons when attached prop is true', () => {
    render(
      <ButtonGroup attached>
        <Button>First</Button>
        <Button>Second</Button>
      </ButtonGroup>
    );
    const group = screen.getByRole('group');
    expect(group).not.toHaveClass('gap-2');
  });
});
