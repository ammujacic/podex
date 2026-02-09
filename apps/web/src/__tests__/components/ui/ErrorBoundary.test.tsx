/**
 * Tests for ErrorBoundary component
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// Component that throws an error
const ThrowingComponent = () => {
  throw new Error('Test error');
};

// Component that doesn't throw
const SafeComponent = () => <div>Safe content</div>;

describe('ErrorBoundary', () => {
  // Suppress console.error for expected errors
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <SafeComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeTruthy();
  });

  it('renders fallback when error occurs', () => {
    render(
      <ErrorBoundary fallback={<div>Error occurred</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Error occurred')).toBeTruthy();
  });

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError} fallback={<div>Error</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalled();
  });
});
