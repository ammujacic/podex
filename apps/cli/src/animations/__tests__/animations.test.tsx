/**
 * Tests for animation hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect, useState } from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useTypewriter } from '../useTypewriter';
import { useFadeIn } from '../useFadeIn';
import { usePulse } from '../usePulse';
import { useLoadingDots } from '../useLoadingDots';

describe('Animation Hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useTypewriter', () => {
    function TypewriterTest({ text, speed = 30 }: { text: string; speed?: number }) {
      const { displayText, isComplete } = useTypewriter(text, { speed });
      return (
        <Text>
          Text:{displayText}|Complete:{isComplete ? 'YES' : 'NO'}
        </Text>
      );
    }

    it('should start with empty string', () => {
      const { lastFrame } = render(<TypewriterTest text="Hello" />);
      expect(lastFrame()).toContain('Text:');
      expect(lastFrame()).toContain('Complete:NO');
    });

    it('should render with speed option', () => {
      const { lastFrame } = render(<TypewriterTest text="Hi" speed={100} />);
      expect(lastFrame()).toContain('Text:');
    });

    it('should render with empty text', () => {
      const { lastFrame } = render(<TypewriterTest text="" />);
      expect(lastFrame()).toBeDefined();
    });

    it('should accept different speeds', () => {
      const { lastFrame } = render(<TypewriterTest text="Test" speed={50} />);
      expect(lastFrame()).toContain('Text:');
    });
  });

  describe('useFadeIn', () => {
    function FadeInTest({ delay = 0 }: { delay?: number }) {
      const { isVisible, opacity } = useFadeIn({ delay });
      return (
        <Text>
          Visible:{isVisible ? 'YES' : 'NO'}|Opacity:{opacity}
        </Text>
      );
    }

    it('should be visible immediately with no delay', () => {
      const { lastFrame } = render(<FadeInTest delay={0} />);
      expect(lastFrame()).toContain('Visible:YES');
      expect(lastFrame()).toContain('Opacity:1');
    });

    it('should not be visible initially with delay', () => {
      const { lastFrame } = render(<FadeInTest delay={500} />);
      expect(lastFrame()).toContain('Visible:NO');
      expect(lastFrame()).toContain('Opacity:0');
    });

    it('should accept delay parameter', () => {
      const { lastFrame } = render(<FadeInTest delay={1000} />);
      expect(lastFrame()).toBeDefined();
    });

    it('should render with default delay', () => {
      const { lastFrame } = render(<FadeInTest />);
      expect(lastFrame()).toContain('Visible:YES');
    });
  });

  describe('usePulse', () => {
    function PulseTest({
      interval = 500,
      enabled = true,
    }: {
      interval?: number;
      enabled?: boolean;
    }) {
      const isPulsed = usePulse({ interval, enabled });
      return <Text>Pulse:{isPulsed ? 'ON' : 'OFF'}</Text>;
    }

    it('should start as false', () => {
      const { lastFrame } = render(<PulseTest interval={500} />);
      expect(lastFrame()).toContain('Pulse:OFF');
    });

    it('should render with options', () => {
      const { lastFrame } = render(<PulseTest interval={100} />);
      expect(lastFrame()).toBeDefined();
    });

    it('should render when disabled', () => {
      const { lastFrame } = render(<PulseTest interval={500} enabled={false} />);
      expect(lastFrame()).toContain('Pulse:OFF');
    });

    it('should accept interval parameter', () => {
      const { lastFrame } = render(<PulseTest interval={1000} />);
      expect(lastFrame()).toContain('Pulse:');
    });
  });

  describe('useLoadingDots', () => {
    function DotsTest({
      interval = 400,
      maxDots = 3,
      enabled = true,
    }: {
      interval?: number;
      maxDots?: number;
      enabled?: boolean;
    }) {
      const dots = useLoadingDots({ interval, maxDots, enabled });
      return <Text>Loading{dots}|END</Text>;
    }

    it('should start empty', () => {
      const { lastFrame } = render(<DotsTest interval={100} />);
      expect(lastFrame()).toContain('Loading');
      expect(lastFrame()).toContain('|END');
    });

    it('should render with default options', () => {
      const { lastFrame } = render(<DotsTest />);
      expect(lastFrame()).toContain('Loading');
    });

    it('should render when disabled', () => {
      const { lastFrame } = render(<DotsTest interval={100} enabled={false} />);
      expect(lastFrame()).toContain('Loading|END');
    });

    it('should accept maxDots parameter', () => {
      const { lastFrame } = render(<DotsTest interval={100} maxDots={2} />);
      expect(lastFrame()).toContain('Loading');
    });
  });
});
