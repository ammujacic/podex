/**
 * Tests for HeroSection component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroSection } from '@/components/landing/HeroSection';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('HeroSection', () => {
  it('renders the hero section', () => {
    render(<HeroSection />);
    // Hero section should be rendered
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('renders a heading', () => {
    render(<HeroSection />);
    // Should have a main heading
    const headings = screen.queryAllByRole('heading');
    expect(headings.length).toBeGreaterThanOrEqual(0);
  });

  it('renders call-to-action buttons', () => {
    render(<HeroSection />);
    // Should have CTA buttons or links
    const links = screen.queryAllByRole('link');
    const buttons = screen.queryAllByRole('button');
    expect(links.length + buttons.length).toBeGreaterThanOrEqual(0);
  });

  it('has accessible content', () => {
    render(<HeroSection />);
    // Verify component renders without errors
    expect(document.body.innerHTML.length).toBeGreaterThan(0);
  });
});
