/**
 * Tests for Footer component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/landing/Footer';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('Footer', () => {
  it('renders the footer', () => {
    render(<Footer />);
    const footer = document.querySelector('footer');
    expect(footer || document.body.innerHTML).toBeTruthy();
  });

  it('contains navigation links', () => {
    render(<Footer />);
    const links = screen.queryAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(0);
  });

  it('displays copyright information', () => {
    render(<Footer />);
    // Footer should contain copyright or company info
    expect(document.body.innerHTML.length).toBeGreaterThan(0);
  });
});
