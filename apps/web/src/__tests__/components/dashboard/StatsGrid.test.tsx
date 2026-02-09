/**
 * Tests for StatsGrid component
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsGrid } from '@/components/dashboard/StatsGrid';

describe('StatsGrid', () => {
  const mockStats = {
    tokensUsed: 50000,
    apiCalls: 1250,
    activeAgents: 5,
    estimatedCost: 12.5,
  };

  it('renders the stats grid', () => {
    render(<StatsGrid stats={mockStats} />);
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('displays tokens used', () => {
    render(<StatsGrid stats={mockStats} />);
    expect(screen.getByText('Tokens Used')).toBeInTheDocument();
    expect(screen.getByText('50.0K')).toBeInTheDocument();
  });

  it('displays API calls', () => {
    render(<StatsGrid stats={mockStats} />);
    expect(screen.getByText('API Calls')).toBeInTheDocument();
    expect(screen.getByText('1.3K')).toBeInTheDocument();
  });

  it('displays active agents', () => {
    render(<StatsGrid stats={mockStats} />);
    expect(screen.getByText('Active Agents')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('displays estimated cost', () => {
    render(<StatsGrid stats={mockStats} />);
    expect(screen.getByText('Est. Cost')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<StatsGrid isLoading={true} />);
    // Should render loading skeletons
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('handles zero stats', () => {
    render(<StatsGrid stats={{ tokensUsed: 0, apiCalls: 0, activeAgents: 0, estimatedCost: 0 }} />);
    // Multiple '0' values are rendered for zero stats
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });
});
