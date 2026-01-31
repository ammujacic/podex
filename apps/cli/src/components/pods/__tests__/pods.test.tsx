/**
 * Tests for pods components.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { PodSelectionScreen } from '../PodSelectionScreen';

// Mock the API client
const mockGet = vi.fn();
vi.mock('../../../services/api-client', () => ({
  getApiClient: () => ({
    get: mockGet,
  }),
}));

describe('PodSelectionScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // Never resolves
    const onSelect = vi.fn();

    const { lastFrame } = render(<PodSelectionScreen onSelect={onSelect} />);

    expect(lastFrame()).toContain('Loading');
  });

  it('should call API on mount', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const onSelect = vi.fn();

    render(<PodSelectionScreen onSelect={onSelect} />);

    expect(mockGet).toHaveBeenCalledWith('/api/v1/local-pods');
  });

  it('should accept onSelect callback', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const onSelect = vi.fn();

    const { lastFrame } = render(<PodSelectionScreen onSelect={onSelect} />);

    expect(lastFrame()).toBeDefined();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should show spinner text', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const onSelect = vi.fn();

    const { lastFrame } = render(<PodSelectionScreen onSelect={onSelect} />);

    expect(lastFrame()).toContain('Loading available pods');
  });

  it('should render correctly', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const onSelect = vi.fn();

    const { lastFrame } = render(<PodSelectionScreen onSelect={onSelect} />);

    expect(lastFrame()).toBeDefined();
    expect(lastFrame()?.length).toBeGreaterThan(0);
  });
});
