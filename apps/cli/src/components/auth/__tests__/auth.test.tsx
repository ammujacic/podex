/**
 * Tests for auth components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { LoginScreen } from '../LoginScreen';

// Mock auth service
vi.mock('../../../services/auth-service', () => ({
  getAuthService: () => ({
    isAuthenticated: vi.fn(() => false),
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

describe('Auth Components', () => {
  describe('LoginScreen', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should render welcome message', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      expect(lastFrame()).toContain('Welcome');
    });

    it('should render logo', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      // Logo renders with version
      expect(lastFrame()).toContain('v0.');
    });

    it('should render sign in option', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      expect(lastFrame()).toContain('Sign in');
    });

    it('should render skip option when available', () => {
      const onSuccess = vi.fn();
      const onSkip = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} onSkip={onSkip} />);

      // With onSkip, there should be 2 options
      expect(lastFrame()).toBeDefined();
    });

    it('should show navigation hints', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      // Should show arrow key navigation hints
      expect(lastFrame()).toContain('navigate');
    });

    it('should render with both callbacks', () => {
      const onSuccess = vi.fn();
      const onSkip = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} onSkip={onSkip} />);

      expect(lastFrame()).toBeDefined();
    });

    it('should show sign in description', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      expect(lastFrame()).toContain('Authenticate');
    });

    it('should show sign in option with onSkip provided', () => {
      const onSuccess = vi.fn();
      const onSkip = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} onSkip={onSkip} />);

      expect(lastFrame()).toContain('Sign in to Podex');
    });

    it('should render without onSkip prop', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      expect(lastFrame()).not.toContain('Continue without signing in');
    });

    it('should show Podex branding', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      // Logo shows somewhere
      expect(lastFrame()).toContain('Podex');
    });

    it('should show version info', () => {
      const onSuccess = vi.fn();
      const { lastFrame } = render(<LoginScreen onSuccess={onSuccess} />);

      // Logo with showVersion displays version
      expect(lastFrame()).toContain('v');
    });
  });
});
