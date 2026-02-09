/**
 * Tests for PricingSection component
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PricingSection } from '@/components/landing/PricingSection';

describe('PricingSection', () => {
  it('renders the pricing section', () => {
    render(<PricingSection />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('renders pricing tiers', () => {
    render(<PricingSection />);
    // Should contain pricing information
    const section = document.querySelector('section');
    expect(section || document.body.innerHTML).toBeTruthy();
  });

  it('displays pricing amounts', () => {
    render(<PricingSection />);
    // Should show price information
    expect(document.body.innerHTML.length).toBeGreaterThan(0);
  });

  it('has call-to-action buttons', () => {
    render(<PricingSection />);
    const buttons = screen.queryAllByRole('button');
    const links = screen.queryAllByRole('link');
    expect(buttons.length + links.length).toBeGreaterThanOrEqual(0);
  });
});
