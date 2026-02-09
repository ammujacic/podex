/**
 * Tests for ui-utils.ts utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getWorkspaceStatusColor,
  getWorkspaceStatusText,
  getAttentionTypeStyles,
  getAttentionTypeLabel,
  getAgentColor,
  getModelDisplayName,
  formatTime,
  getRelativeTime,
  calculateBoundedPosition,
} from '../ui-utils';

describe('getWorkspaceStatusColor', () => {
  it('returns success color for running status', () => {
    expect(getWorkspaceStatusColor('running')).toBe('bg-status-success');
  });

  it('returns warning color with pulse for pending status', () => {
    expect(getWorkspaceStatusColor('pending')).toBe('bg-status-warning animate-pulse');
  });

  it('returns error color for stopped status', () => {
    expect(getWorkspaceStatusColor('stopped')).toBe('bg-status-error');
  });

  it('returns error color for error status', () => {
    expect(getWorkspaceStatusColor('error')).toBe('bg-status-error');
  });

  it('returns tertiary color for unknown status', () => {
    expect(getWorkspaceStatusColor('unknown')).toBe('bg-text-tertiary');
    expect(getWorkspaceStatusColor('some-other-status')).toBe('bg-text-tertiary');
  });
});

describe('getWorkspaceStatusText', () => {
  it('returns "Running" for running status', () => {
    expect(getWorkspaceStatusText('running')).toBe('Running');
  });

  it('returns "Starting..." for pending status', () => {
    expect(getWorkspaceStatusText('pending')).toBe('Starting...');
  });

  it('returns "Stopped" for stopped status', () => {
    expect(getWorkspaceStatusText('stopped')).toBe('Stopped');
  });

  it('returns "Error" for error status', () => {
    expect(getWorkspaceStatusText('error')).toBe('Error');
  });

  it('returns "Unknown" for unknown status', () => {
    expect(getWorkspaceStatusText('unknown')).toBe('Unknown');
    expect(getWorkspaceStatusText('something-else')).toBe('Unknown');
  });
});

describe('getAttentionTypeStyles', () => {
  it('returns red styles for error type', () => {
    const styles = getAttentionTypeStyles('error');
    expect(styles.bg).toBe('bg-red-500/20');
    expect(styles.text).toBe('text-red-400');
    expect(styles.ring).toBe('ring-red-500/50');
  });

  it('returns yellow styles for needs_approval type', () => {
    const styles = getAttentionTypeStyles('needs_approval');
    expect(styles.bg).toBe('bg-yellow-500/20');
    expect(styles.text).toBe('text-yellow-400');
    expect(styles.ring).toBe('ring-yellow-500/50');
  });

  it('returns green styles for completed type', () => {
    const styles = getAttentionTypeStyles('completed');
    expect(styles.bg).toBe('bg-green-500/20');
    expect(styles.text).toBe('text-green-400');
    expect(styles.ring).toBe('ring-green-500/30');
  });

  it('returns blue styles for waiting_input type', () => {
    const styles = getAttentionTypeStyles('waiting_input');
    expect(styles.bg).toBe('bg-blue-500/20');
    expect(styles.text).toBe('text-blue-400');
    expect(styles.ring).toBe('ring-blue-500/30');
  });

  it('returns default styles for unknown type', () => {
    const styles = getAttentionTypeStyles('unknown' as never);
    expect(styles.bg).toBe('bg-surface-hover');
    expect(styles.text).toBe('text-text-secondary');
    expect(styles.ring).toBe('');
  });
});

describe('getAttentionTypeLabel', () => {
  it('returns "Approval" for needs_approval type', () => {
    expect(getAttentionTypeLabel('needs_approval')).toBe('Approval');
  });

  it('returns "Error" for error type', () => {
    expect(getAttentionTypeLabel('error')).toBe('Error');
  });

  it('returns "Done" for completed type', () => {
    expect(getAttentionTypeLabel('completed')).toBe('Done');
  });

  it('returns "Input" for waiting_input type', () => {
    expect(getAttentionTypeLabel('waiting_input')).toBe('Input');
  });

  it('returns empty string for unknown type', () => {
    expect(getAttentionTypeLabel('unknown' as never)).toBe('');
  });
});

describe('getAgentColor', () => {
  it('returns agent color if set', () => {
    const agent = { name: 'Test Agent', color: '#FF0000' };
    expect(getAgentColor(agent)).toBe('#FF0000');
  });

  it('generates color based on name if not set', () => {
    const agent = { name: 'Test Agent' };
    const color = getAgentColor(agent);
    // Color should be one of the predefined colors
    expect(color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('returns consistent color for same name', () => {
    const agent1 = { name: 'Agent A' };
    const agent2 = { name: 'Agent A' };
    expect(getAgentColor(agent1)).toBe(getAgentColor(agent2));
  });

  it('returns different colors for different names', () => {
    const agentA = { name: 'Agent A' };
    const agentB = { name: 'Agent B' };
    // Different first characters should potentially give different colors
    // (though collisions are possible due to modulo)
    const colorA = getAgentColor(agentA);
    const colorB = getAgentColor(agentB);
    expect(colorA).toBeDefined();
    expect(colorB).toBeDefined();
  });
});

describe('getModelDisplayName', () => {
  it('returns the raw model ID (no frontend inference)', () => {
    expect(getModelDisplayName('claude-opus-4.5')).toBe('claude-opus-4.5');
    expect(getModelDisplayName('gpt-4o')).toBe('gpt-4o');
    expect(getModelDisplayName('unknown-model-name')).toBe('unknown-model-name');
  });
});

describe('formatTime', () => {
  it('formats a Date object to HH:MM format', () => {
    const date = new Date('2024-01-15T14:30:00');
    const result = formatTime(date);
    // Format depends on locale, but should contain hour and minute
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats a string date to HH:MM format', () => {
    const result = formatTime('2024-01-15T14:30:00');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('handles ISO date strings', () => {
    const result = formatTime('2024-01-15T14:30:00.000Z');
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getRelativeTime', () => {
  let now: Date;

  beforeEach(() => {
    now = new Date();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for times less than a minute ago', () => {
    const date = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
    expect(getRelativeTime(date)).toBe('just now');
  });

  it('returns minutes ago for times less than an hour ago', () => {
    const date = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago
    expect(getRelativeTime(date)).toBe('5m ago');
  });

  it('returns hours ago for times less than a day ago', () => {
    const date = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago
    expect(getRelativeTime(date)).toBe('3h ago');
  });

  it('returns days ago for times more than a day ago', () => {
    const date = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    expect(getRelativeTime(date)).toBe('2d ago');
  });

  it('handles string dates', () => {
    const dateStr = new Date(now.getTime() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    expect(getRelativeTime(dateStr)).toBe('10m ago');
  });
});

describe('calculateBoundedPosition', () => {
  beforeEach(() => {
    // Mock window dimensions
    vi.stubGlobal('window', {
      innerWidth: 1024,
      innerHeight: 768,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns position as-is when within bounds', () => {
    const result = calculateBoundedPosition(100, 100, 200, 150);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
  });

  it('clamps position to left edge with padding', () => {
    const result = calculateBoundedPosition(-50, 100, 200, 150);
    expect(result.x).toBe(10); // Default padding
    expect(result.y).toBe(100);
  });

  it('clamps position to top edge with padding', () => {
    const result = calculateBoundedPosition(100, -50, 200, 150);
    expect(result.x).toBe(100);
    expect(result.y).toBe(10); // Default padding
  });

  it('clamps position to right edge', () => {
    const result = calculateBoundedPosition(900, 100, 200, 150);
    // 1024 - 200 - 10 = 814 (viewport width - element width - padding)
    expect(result.x).toBe(814);
  });

  it('clamps position to bottom edge', () => {
    const result = calculateBoundedPosition(100, 700, 200, 150);
    // 768 - 150 - 10 = 608 (viewport height - element height - padding)
    expect(result.y).toBe(608);
  });

  it('respects custom padding', () => {
    const result = calculateBoundedPosition(-50, -50, 200, 150, 20);
    expect(result.x).toBe(20);
    expect(result.y).toBe(20);
  });

  it('handles position exactly at edge', () => {
    const result = calculateBoundedPosition(10, 10, 200, 150);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
  });

  it('handles large elements that fill viewport', () => {
    const result = calculateBoundedPosition(0, 0, 1000, 700, 10);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
  });
});
