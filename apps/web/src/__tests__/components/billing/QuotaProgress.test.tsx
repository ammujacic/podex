/**
 * Tests for QuotaProgress component
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotaProgress } from '@/components/billing/QuotaProgress';

describe('QuotaProgress', () => {
  const defaultProps = {
    label: 'Tokens Used',
    current: 500000,
    limit: 1000000,
    unit: 'tokens',
  };

  it('renders the quota progress', () => {
    render(<QuotaProgress {...defaultProps} />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('shows the label', () => {
    render(<QuotaProgress {...defaultProps} />);
    expect(screen.getByText('Tokens Used')).toBeInTheDocument();
  });

  it('displays usage values', () => {
    render(<QuotaProgress {...defaultProps} />);
    // Should show formatted values (500K, 1M)
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('displays usage percentage', () => {
    render(<QuotaProgress {...defaultProps} />);
    // Should show 50% usage
    expect(screen.getByText(/50\.0% used/)).toBeInTheDocument();
  });

  it('shows warning state at 80% usage', () => {
    render(<QuotaProgress {...defaultProps} current={850000} />);
    // Should indicate warning state
    expect(screen.getByText('Approaching limit')).toBeInTheDocument();
  });

  it('shows critical state near 100% usage', () => {
    render(<QuotaProgress {...defaultProps} current={960000} />);
    // Should indicate critical state
    expect(screen.getByText('Almost at limit')).toBeInTheDocument();
  });

  it('shows exceeded state when over limit', () => {
    render(<QuotaProgress {...defaultProps} current={1100000} />);
    // Should indicate exceeded state
    expect(screen.getByText('Limit exceeded!')).toBeInTheDocument();
  });

  it('hides percentage when showPercentage is false', () => {
    render(<QuotaProgress {...defaultProps} showPercentage={false} />);
    expect(screen.queryByText(/% used/)).not.toBeInTheDocument();
  });

  it('respects custom warning threshold', () => {
    render(<QuotaProgress {...defaultProps} current={600000} warningThreshold={50} />);
    // 60% usage should trigger warning with 50% threshold
    expect(screen.getByText('Approaching limit')).toBeInTheDocument();
  });
});
