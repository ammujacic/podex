/**
 * Tests for layout components.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Header } from '../Header';
import { StatusBar } from '../StatusBar';

describe('Layout Components', () => {
  describe('Header', () => {
    it('should render Podex branding', () => {
      const { lastFrame } = render(<Header />);

      expect(lastFrame()).toContain('PODEX');
    });

    it('should render session name', () => {
      const { lastFrame } = render(<Header sessionName="My Project" />);

      expect(lastFrame()).toContain('My Project');
    });

    it('should render branch name', () => {
      const { lastFrame } = render(<Header branch="main" />);

      expect(lastFrame()).toContain('main');
    });

    it('should show connected status', () => {
      const { lastFrame } = render(<Header isConnected />);

      expect(lastFrame()).toContain('Connected');
    });

    it('should show disconnected status', () => {
      const { lastFrame } = render(<Header isConnected={false} />);

      expect(lastFrame()).toContain('Disconnected');
    });

    it('should show local mode indicator', () => {
      const { lastFrame } = render(<Header isLocal />);

      expect(lastFrame()).toContain('Local');
    });

    it('should show cloud mode by default', () => {
      const { lastFrame } = render(<Header />);

      expect(lastFrame()).toContain('Cloud');
    });

    it('should render agent name', () => {
      const { lastFrame } = render(<Header agentName="Code Agent" />);

      expect(lastFrame()).toContain('Code Agent');
    });

    it('should render all elements together', () => {
      const { lastFrame } = render(
        <Header
          sessionName="Test Session"
          branch="feature/test"
          isConnected
          isLocal
          agentName="Test Agent"
        />
      );

      expect(lastFrame()).toContain('PODEX');
      expect(lastFrame()).toContain('Test Session');
      expect(lastFrame()).toContain('feature/test');
      expect(lastFrame()).toContain('Local');
      expect(lastFrame()).toContain('Connected');
      expect(lastFrame()).toContain('Test Agent');
    });
  });

  describe('StatusBar', () => {
    it('should render agent status', () => {
      const { lastFrame } = render(<StatusBar agentStatus="idle" />);

      expect(lastFrame()).toContain('Idle');
    });

    it('should render thinking status', () => {
      const { lastFrame } = render(<StatusBar agentStatus="thinking" />);

      expect(lastFrame()).toContain('Thinking');
    });

    it('should render executing status', () => {
      const { lastFrame } = render(<StatusBar agentStatus="executing" />);

      expect(lastFrame()).toContain('Executing');
    });

    it('should render error status', () => {
      const { lastFrame } = render(<StatusBar agentStatus="error" />);

      expect(lastFrame()).toContain('Error');
    });

    it('should render agent name with status', () => {
      const { lastFrame } = render(<StatusBar agentName="Code Agent" agentStatus="thinking" />);

      expect(lastFrame()).toContain('Code Agent');
    });

    it('should render custom message', () => {
      const { lastFrame } = render(<StatusBar message="Processing..." />);

      expect(lastFrame()).toContain('Processing...');
    });

    it('should render credits', () => {
      const { lastFrame } = render(<StatusBar credits={500} />);

      expect(lastFrame()).toContain('500');
    });

    it('should format large credit numbers', () => {
      const { lastFrame } = render(<StatusBar credits={10000} />);

      expect(lastFrame()).toContain('10,000');
    });

    it('should show keyboard shortcuts', () => {
      const { lastFrame } = render(<StatusBar />);

      expect(lastFrame()).toContain('Ctrl+C');
      expect(lastFrame()).toContain('exit');
    });

    it('should show Tab shortcut for agent switching', () => {
      const { lastFrame } = render(<StatusBar />);

      expect(lastFrame()).toContain('Tab');
      expect(lastFrame()).toContain('switch agent');
    });
  });
});
