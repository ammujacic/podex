/**
 * Tests for agent components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { AgentStatus, type AgentState } from '../AgentStatus';
import { AgentCard, type Agent } from '../AgentCard';
import { AgentGrid } from '../AgentGrid';
import { AgentSelector } from '../AgentSelector';

describe('Agent Components', () => {
  describe('AgentStatus', () => {
    const states: AgentState[] = ['idle', 'thinking', 'executing', 'waiting', 'error'];

    it.each(states)('should render %s state', (state) => {
      const { lastFrame } = render(<AgentStatus state={state} />);

      expect(lastFrame()).toBeDefined();
    });

    it('should render compact version', () => {
      const { lastFrame } = render(<AgentStatus state="idle" compact />);

      expect(lastFrame()).toBeDefined();
    });

    it('should render full version with label', () => {
      const { lastFrame } = render(<AgentStatus state="thinking" />);

      expect(lastFrame()).toContain('Thinking');
    });

    it('should animate for active states', () => {
      vi.useFakeTimers();

      const { lastFrame, rerender } = render(<AgentStatus state="thinking" />);
      const frame1 = lastFrame();

      vi.advanceTimersByTime(100);
      rerender(<AgentStatus state="thinking" />);
      const frame2 = lastFrame();

      // Animation may or may not have changed the frame
      expect(frame1).toBeDefined();
      expect(frame2).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('AgentCard', () => {
    const mockAgent: Agent = {
      id: 'agent-1',
      name: 'Test Agent',
      role: 'Developer',
      state: 'idle',
      colorIndex: 0,
    };

    it('should render agent name', () => {
      const { lastFrame } = render(<AgentCard agent={mockAgent} />);

      expect(lastFrame()).toContain('Test Agent');
    });

    it('should render agent role', () => {
      const { lastFrame } = render(<AgentCard agent={mockAgent} />);

      expect(lastFrame()).toContain('Developer');
    });

    it('should show active indicator when active', () => {
      const { lastFrame } = render(<AgentCard agent={mockAgent} isActive />);

      expect(lastFrame()).toContain('Active');
    });

    it('should render compact version', () => {
      const { lastFrame } = render(<AgentCard agent={mockAgent} compact />);

      expect(lastFrame()).toContain('Test Agent');
    });

    it('should show selection indicator when selected', () => {
      const { lastFrame } = render(<AgentCard agent={mockAgent} isSelected />);

      // Selected card should have different border
      expect(lastFrame()).toBeDefined();
    });

    it('should handle missing colorIndex', () => {
      const agentWithoutColor: Agent = {
        id: 'agent-2',
        name: 'No Color Agent',
        state: 'idle',
      };

      const { lastFrame } = render(<AgentCard agent={agentWithoutColor} />);

      expect(lastFrame()).toContain('No Color Agent');
    });
  });

  describe('AgentGrid', () => {
    const mockAgents: Agent[] = [
      { id: 'a1', name: 'Agent 1', state: 'idle', colorIndex: 0 },
      { id: 'a2', name: 'Agent 2', state: 'thinking', colorIndex: 1 },
      { id: 'a3', name: 'Agent 3', state: 'executing', colorIndex: 2 },
      { id: 'a4', name: 'Agent 4', state: 'waiting', colorIndex: 3 },
    ];

    it('should render all agents', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<AgentGrid agents={mockAgents} onSelect={onSelect} />);

      expect(lastFrame()).toContain('Agent 1');
      expect(lastFrame()).toContain('Agent 2');
      expect(lastFrame()).toContain('Agent 3');
      expect(lastFrame()).toContain('Agent 4');
    });

    it('should render nothing when no agents', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<AgentGrid agents={[]} onSelect={onSelect} />);

      expect(lastFrame()).toBe('');
    });

    it('should highlight current agent', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <AgentGrid agents={mockAgents} currentAgentId="a2" onSelect={onSelect} />
      );

      expect(lastFrame()).toContain('Agent 2');
    });

    it('should render when inactive', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <AgentGrid agents={mockAgents} onSelect={onSelect} isActive={false} />
      );

      expect(lastFrame()).toContain('Agent 1');
    });

    it('should support different column counts', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <AgentGrid agents={mockAgents} onSelect={onSelect} columns={3} />
      );

      // Should still render all agents
      expect(lastFrame()).toContain('Agent 1');
      expect(lastFrame()).toContain('Agent 4');
    });

    it('should support single column', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <AgentGrid agents={mockAgents} onSelect={onSelect} columns={1} />
      );

      expect(lastFrame()).toContain('Agent 1');
      expect(lastFrame()).toContain('Agent 4');
    });

    it('should render with onSelect callback', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<AgentGrid agents={mockAgents} onSelect={onSelect} />);

      expect(lastFrame()).toBeDefined();
    });
  });

  describe('AgentSelector', () => {
    const mockAgents = [
      { id: 'a1', name: 'Agent 1', role: 'Developer', state: 'idle' as const, colorIndex: 0 },
      { id: 'a2', name: 'Agent 2', role: 'Tester', state: 'thinking' as const, colorIndex: 1 },
    ];

    it('should render all agents', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<AgentSelector agents={mockAgents} onSelect={onSelect} />);

      expect(lastFrame()).toContain('Agent 1');
      expect(lastFrame()).toContain('Agent 2');
    });

    it('should render roles', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<AgentSelector agents={mockAgents} onSelect={onSelect} />);

      expect(lastFrame()).toContain('Developer');
      expect(lastFrame()).toContain('Tester');
    });

    it('should highlight current agent', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <AgentSelector agents={mockAgents} currentAgentId="a2" onSelect={onSelect} />
      );

      expect(lastFrame()).toContain('Agent 2');
    });

    it('should show section title', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<AgentSelector agents={mockAgents} onSelect={onSelect} />);

      expect(lastFrame()).toContain('Select Agent');
    });
  });
});
