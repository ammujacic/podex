/**
 * Basic tests for UI primitives (card, input, label, progress, switch, collapsible).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../card';
import { Input } from '../input';
import { Label } from '../label';
import { Progress } from '../progress';
import { Switch } from '../switch';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../collapsible';

describe('Card', () => {
  it('should render Card with children', () => {
    render(<Card data-testid="card">Card content</Card>);
    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('should render CardHeader, CardTitle, CardDescription, CardContent, CardFooter', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('should render input with placeholder', () => {
    render(<Input placeholder="Enter text" data-testid="input" />);
    const input = screen.getByTestId('input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Enter text');
  });

  it('should support type attribute', () => {
    render(<Input type="password" data-testid="input" />);
    expect(screen.getByTestId('input')).toHaveAttribute('type', 'password');
  });
});

describe('Label', () => {
  it('should render label with text', () => {
    render(<Label>Field label</Label>);
    expect(screen.getByText('Field label')).toBeInTheDocument();
  });

  it('should associate with input via htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" data-testid="email-input" />
      </>
    );
    const label = screen.getByText('Email');
    expect(label).toHaveAttribute('for', 'email');
    expect(screen.getByTestId('email-input')).toHaveAttribute('id', 'email');
  });
});

describe('Progress', () => {
  it('should render with default value 0', () => {
    render(<Progress data-testid="progress" />);
    const progress = screen.getByTestId('progress');
    expect(progress).toBeInTheDocument();
    const fill = progress.querySelector('div:last-child');
    expect(fill).toHaveStyle({ width: '0%' });
  });

  it('should render with value and max', () => {
    render(<Progress data-testid="progress" value={50} max={100} />);
    const fill = screen.getByTestId('progress').querySelector('div:last-child');
    expect(fill).toHaveStyle({ width: '50%' });
  });

  it('should clamp percentage to 0-100', () => {
    render(<Progress data-testid="progress" value={150} max={100} />);
    const fill = screen.getByTestId('progress').querySelector('div:last-child');
    expect(fill).toHaveStyle({ width: '100%' });
  });
});

describe('Switch', () => {
  it('should render unchecked by default', () => {
    render(<Switch data-testid="switch" />);
    expect(screen.getByTestId('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('should render checked when checked prop is true', () => {
    render(<Switch data-testid="switch" checked />);
    expect(screen.getByTestId('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('should call onCheckedChange when clicked', () => {
    const onCheckedChange = vi.fn();
    render(<Switch data-testid="switch" onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByTestId('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('should not call onCheckedChange when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch data-testid="switch" disabled onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByTestId('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('Collapsible', () => {
  it('should hide content when closed', () => {
    render(
      <Collapsible open={false}>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Content</CollapsibleContent>
      </Collapsible>
    );
    expect(screen.getByText('Toggle')).toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('should show content when open', () => {
    render(
      <Collapsible open>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Content</CollapsibleContent>
      </Collapsible>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should call onOpenChange when trigger clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible open={false} onOpenChange={onOpenChange}>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Content</CollapsibleContent>
      </Collapsible>
    );
    fireEvent.click(screen.getByText('Toggle'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('should show content when forceMount even if closed', () => {
    render(
      <Collapsible open={false}>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent forceMount>Content</CollapsibleContent>
      </Collapsible>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
