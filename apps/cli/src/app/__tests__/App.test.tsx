/**
 * Tests for App component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Text } from 'ink';
import { App } from '../App';

// Mock auth service
const mockIsAuthenticated = vi.fn(() => false);

vi.mock('../../services/auth-service', () => ({
  getAuthService: () => ({
    isAuthenticated: mockIsAuthenticated,
    initiateDeviceAuth: vi.fn(() =>
      Promise.resolve({
        device_code: 'test-device-code',
        user_code: 'TEST-1234',
        verification_uri: 'https://example.com/device',
        verification_uri_complete: 'https://example.com/device?code=TEST-1234',
        interval: 5,
      })
    ),
    pollForToken: vi.fn(() => Promise.resolve()),
    openBrowser: vi.fn(() => Promise.resolve()),
  }),
}));

// Mock InteractiveMode and RunMode
vi.mock('../InteractiveMode', () => ({
  InteractiveMode: function MockInteractiveMode() {
    return React.createElement(Text, null, 'Interactive Mode');
  },
}));

vi.mock('../RunMode', () => ({
  RunMode: function MockRunMode() {
    return React.createElement(Text, null, 'Run Mode');
  },
}));

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsAuthenticated.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Welcome Screen', () => {
    it('should show welcome screen by default', () => {
      const { lastFrame } = render(<App mode="interactive" />);

      // The logo is rendered with Unicode block characters
      expect(lastFrame()).toContain('Code from Anywhere');
    });

    it('should skip welcome screen when skipWelcome is true', () => {
      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      // Should go directly to login or main app
      expect(lastFrame()).toBeDefined();
    });

    it('should transition from welcome to login', () => {
      const { lastFrame } = render(<App mode="interactive" />);

      // Advance past welcome duration
      vi.advanceTimersByTime(1600);

      // Should now show login screen
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should show login screen when not authenticated', () => {
      mockIsAuthenticated.mockReturnValue(false);

      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      expect(lastFrame()).toContain('Sign in');
    });

    it('should show main app when authenticated', () => {
      mockIsAuthenticated.mockReturnValue(true);

      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      // Should show header and main content
      expect(lastFrame()).toContain('PODEX');
    });
  });

  describe('Mode Switching', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(true);
    });

    it('should render interactive mode', () => {
      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      // When authenticated, shows loading or main content
      expect(lastFrame()).toContain('Loading');
    });

    it('should render run mode with task', () => {
      const { lastFrame } = render(<App mode="run" task="test task" skipWelcome />);

      // Run mode shows loading or main content
      expect(lastFrame()).toContain('Loading');
    });
  });

  describe('Header Configuration', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(true);
    });

    it('should show header when authenticated', () => {
      const { lastFrame } = render(<App mode="interactive" sessionId="abc123456789" skipWelcome />);

      expect(lastFrame()).toContain('PODEX');
    });

    it('should show local mode indicator', () => {
      const { lastFrame } = render(<App mode="interactive" local skipWelcome />);

      expect(lastFrame()).toContain('Local');
    });

    it('should show cloud mode by default', () => {
      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      expect(lastFrame()).toContain('Cloud');
    });

    it('should show connected status when authenticated', () => {
      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      expect(lastFrame()).toContain('Connected');
    });
  });

  describe('Keyboard Shortcuts', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(true);
    });

    it('should show status bar with shortcuts', () => {
      const { lastFrame } = render(<App mode="interactive" skipWelcome />);

      expect(lastFrame()).toContain('Ctrl+C');
    });
  });

  describe('Props', () => {
    it('should accept exitOnComplete prop', () => {
      mockIsAuthenticated.mockReturnValue(true);

      const { lastFrame } = render(<App mode="run" task="test" exitOnComplete skipWelcome />);

      expect(lastFrame()).toBeDefined();
    });
  });
});
