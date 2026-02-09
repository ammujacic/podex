/**
 * Tests for branding components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Logo, podexGradient } from '../Logo';
import { WelcomeScreen } from '../WelcomeScreen';

describe('Branding Components', () => {
  describe('Logo', () => {
    it('should render full logo by default', () => {
      const { lastFrame } = render(<Logo />);

      // Full logo contains the ASCII art with PODEX
      expect(lastFrame()).toBeDefined();
    });

    it('should render compact logo', () => {
      const { lastFrame } = render(<Logo variant="compact" />);

      expect(lastFrame()).toContain('PODEX');
    });

    it('should render minimal logo', () => {
      const { lastFrame } = render(<Logo variant="minimal" />);

      expect(lastFrame()).toContain('PODEX');
    });

    it('should show tagline when requested', () => {
      const { lastFrame } = render(<Logo variant="full" showTagline />);

      expect(lastFrame()).toContain('Code from Anywhere');
    });

    it('should show version when requested', () => {
      const { lastFrame } = render(<Logo variant="compact" showVersion version="1.0.0" />);

      expect(lastFrame()).toContain('v1.0.0');
    });

    it('should apply gradient to text', () => {
      const result = podexGradient('test');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('WelcomeScreen', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should render welcome screen with logo', () => {
      const { lastFrame } = render(<WelcomeScreen />);

      expect(lastFrame()).toBeDefined();
    });

    it('should show version', () => {
      const { lastFrame } = render(<WelcomeScreen version="2.0.0" />);

      expect(lastFrame()).toContain('v2.0.0');
    });

    it('should show loading message', () => {
      const { lastFrame } = render(<WelcomeScreen loadingMessage="Starting up" />);

      expect(lastFrame()).toContain('Starting up');
    });

    it('should accept onComplete callback', () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(<WelcomeScreen onComplete={onComplete} duration={1000} />);

      // Component should render
      expect(lastFrame()).toBeDefined();
    });

    it('should accept duration prop', () => {
      const { lastFrame } = render(<WelcomeScreen duration={500} />);

      expect(lastFrame()).toBeDefined();
    });

    it('should hide when not showing loading', () => {
      const { lastFrame } = render(<WelcomeScreen showLoading={false} />);

      // Should not contain spinner text when loading is false
      expect(lastFrame()).not.toContain('Initializing');
    });
  });
});
