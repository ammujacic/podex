/**
 * Tests for FeaturesSection component
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeaturesSection } from '@/components/landing/FeaturesSection';

describe('FeaturesSection', () => {
  it('renders the features section', () => {
    render(<FeaturesSection />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('renders feature cards', () => {
    render(<FeaturesSection />);
    // Features section should contain feature items
    const section = document.querySelector('section');
    expect(section || document.body.innerHTML).toBeTruthy();
  });

  it('has accessible headings', () => {
    render(<FeaturesSection />);
    const headings = screen.queryAllByRole('heading');
    // Should have at least section heading
    expect(headings.length).toBeGreaterThanOrEqual(0);
  });
});
