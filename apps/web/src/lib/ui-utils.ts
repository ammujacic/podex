/**
 * Shared UI utilities for consistent styling across components.
 * Consolidates duplicated status colors, attention badge logic, and model display names.
 */

import type { Agent } from '@/stores/session';
import { parseModelIdToDisplayName } from '@/lib/model-utils';

// ============================================================================
// Status Colors
// ============================================================================

export type WorkspaceStatus = 'running' | 'pending' | 'standby' | 'stopped' | 'error' | string;
export type AgentStatus = 'idle' | 'active' | 'error' | 'paused' | string;
export type AttentionType = 'error' | 'needs_approval' | 'completed' | 'waiting_input';

/**
 * Get CSS class for workspace status indicator
 */
export function getWorkspaceStatusColor(status: WorkspaceStatus): string {
  switch (status) {
    case 'running':
      return 'bg-status-success';
    case 'pending':
      return 'bg-status-warning animate-pulse';
    case 'standby':
      return 'bg-status-warning';
    case 'stopped':
    case 'error':
      return 'bg-status-error';
    default:
      return 'bg-text-tertiary';
  }
}

/**
 * Get human-readable text for workspace status
 */
export function getWorkspaceStatusText(status: WorkspaceStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'pending':
      return 'Starting...';
    case 'standby':
      return 'Standby';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

/**
 * Get CSS classes for attention type styling (background and text)
 */
export function getAttentionTypeStyles(type: AttentionType): {
  bg: string;
  text: string;
  ring: string;
} {
  switch (type) {
    case 'error':
      return {
        bg: 'bg-red-500/20',
        text: 'text-red-400',
        ring: 'ring-red-500/50',
      };
    case 'needs_approval':
      return {
        bg: 'bg-yellow-500/20',
        text: 'text-yellow-400',
        ring: 'ring-yellow-500/50',
      };
    case 'completed':
      return {
        bg: 'bg-green-500/20',
        text: 'text-green-400',
        ring: 'ring-green-500/30',
      };
    case 'waiting_input':
      return {
        bg: 'bg-blue-500/20',
        text: 'text-blue-400',
        ring: 'ring-blue-500/30',
      };
    default:
      return {
        bg: 'bg-surface-hover',
        text: 'text-text-secondary',
        ring: '',
      };
  }
}

/**
 * Get attention type label for display
 */
export function getAttentionTypeLabel(type: AttentionType): string {
  switch (type) {
    case 'needs_approval':
      return 'Approval';
    case 'error':
      return 'Error';
    case 'completed':
      return 'Done';
    case 'waiting_input':
      return 'Input';
    default:
      return '';
  }
}

// ============================================================================
// Agent Colors
// ============================================================================

const AGENT_COLORS = [
  '#8B5CF6', // Purple
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#06B6D4', // Cyan
] as const;

/**
 * Get color for an agent (uses agent's color if set, otherwise generates based on name)
 */
export function getAgentColor(agent: Agent | { name: string; color?: string }): string {
  if (agent.color) return agent.color;
  const index = agent.name.charCodeAt(0) % AGENT_COLORS.length;
  return AGENT_COLORS[index] ?? AGENT_COLORS[0];
}

// ============================================================================
// Model Display Names
// ============================================================================

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-opus-4-20250514': 'Opus 4',
  'claude-3-5-sonnet-latest': 'Sonnet 3.5',
  'claude-3-5-haiku-latest': 'Haiku 3.5',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  o1: 'o1',
  'o1-mini': 'o1 Mini',
  'o3-mini': 'o3 Mini',
  'gemini-2.0-flash': 'Gemini 2.0',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
};

/**
 * Get human-readable display name for a model ID
 */
export function getModelDisplayName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] || parseModelIdToDisplayName(modelId);
}

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Format a date/timestamp for display (HH:MM format)
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Get relative time string (e.g., "2m ago", "1h ago")
 */
export function getRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

// ============================================================================
// Viewport Utilities
// ============================================================================

/**
 * Calculate position with viewport boundary detection
 * Ensures element stays within viewport bounds
 */
export function calculateBoundedPosition(
  x: number,
  y: number,
  elementWidth: number,
  elementHeight: number,
  padding = 10
): { x: number; y: number } {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;

  return {
    x: Math.max(padding, Math.min(x, viewportWidth - elementWidth - padding)),
    y: Math.max(padding, Math.min(y, viewportHeight - elementHeight - padding)),
  };
}
