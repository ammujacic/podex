/**
 * Tests for PlanCard component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanCard } from '@/components/billing/PlanCard';

describe('PlanCard', () => {
  const defaultProps = {
    name: 'Pro',
    description: 'For professional developers',
    price: 29,
    priceYearly: 290,
    billingCycle: 'monthly' as const,
    features: [
      { name: 'Unlimited projects', included: true },
      { name: 'Git integration', included: true },
      { name: 'Agent memory', included: true, value: '100GB' },
      { name: 'Priority support', included: false },
    ],
    isPopular: true,
    isEnterprise: false,
  };

  it('renders the plan card', () => {
    render(<PlanCard {...defaultProps} />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('displays plan name', () => {
    render(<PlanCard {...defaultProps} />);
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('displays pricing', () => {
    render(<PlanCard {...defaultProps} />);
    // Should show price information
    expect(screen.getByText('$29')).toBeInTheDocument();
  });

  it('shows popular badge when applicable', () => {
    render(<PlanCard {...defaultProps} />);
    expect(screen.getByText('Most Popular')).toBeInTheDocument();
  });

  it('does not show popular badge when not popular', () => {
    render(<PlanCard {...defaultProps} isPopular={false} />);
    expect(screen.queryByText('Most Popular')).not.toBeInTheDocument();
  });

  it('shows current plan badge', () => {
    render(<PlanCard {...defaultProps} isPopular={false} isCurrent={true} />);
    // "Current Plan" appears in both badge and button text
    const currentPlanElements = screen.getAllByText('Current Plan');
    expect(currentPlanElements.length).toBeGreaterThanOrEqual(1);
  });

  it('handles click action', () => {
    const onSelect = vi.fn();
    render(<PlanCard {...defaultProps} onSelect={onSelect} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalled();
  });

  it('disables button when isCurrent', () => {
    render(<PlanCard {...defaultProps} isCurrent={true} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('shows Custom price for enterprise', () => {
    render(<PlanCard {...defaultProps} isEnterprise={true} />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('displays features list', () => {
    render(<PlanCard {...defaultProps} />);
    expect(screen.getByText('Unlimited projects')).toBeInTheDocument();
    expect(screen.getByText('Git integration')).toBeInTheDocument();
  });
});
