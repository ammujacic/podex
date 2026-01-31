/**
 * Tests for theme system.
 */

import { describe, it, expect } from 'vitest';
import { colors, terminalColors } from '../colors';
import { spacing, borders, icons, animation } from '../tokens';
import { theme } from '../ThemeProvider';

describe('Theme System', () => {
  describe('colors', () => {
    it('should have primary colors', () => {
      expect(colors.primary.purple).toBe('#8B5CF6');
      expect(colors.primary.purpleLight).toBe('#A78BFA');
      expect(colors.primary.purpleDark).toBe('#7C3AED');
    });

    it('should have secondary colors', () => {
      expect(colors.secondary.cyan).toBe('#06B6D4');
      expect(colors.secondary.cyanLight).toBe('#22D3EE');
      expect(colors.secondary.cyanDark).toBe('#0891B2');
    });

    it('should have feedback colors', () => {
      expect(colors.feedback.success).toBe('#22c55e');
      expect(colors.feedback.warning).toBe('#f59e0b');
      expect(colors.feedback.error).toBe('#ef4444');
      expect(colors.feedback.info).toBe('#3b82f6');
    });

    it('should have neutral colors', () => {
      expect(colors.neutral.background).toBe('#07070a');
      expect(colors.neutral.text).toBe('#f0f0f5');
    });

    it('should have agent colors array', () => {
      expect(colors.agents).toHaveLength(8);
      expect(colors.agents[0]).toBe('#8B5CF6');
    });
  });

  describe('terminalColors', () => {
    it('should have terminal-safe color names', () => {
      expect(terminalColors.primary).toBe('magenta');
      expect(terminalColors.secondary).toBe('cyan');
      expect(terminalColors.success).toBe('green');
      expect(terminalColors.error).toBe('red');
    });
  });

  describe('tokens', () => {
    describe('spacing', () => {
      it('should have spacing values', () => {
        expect(spacing.none).toBe(0);
        expect(spacing.xs).toBe(1);
        expect(spacing.md).toBe(2);
        expect(spacing.xl).toBe(4);
      });
    });

    describe('borders', () => {
      it('should have border styles', () => {
        expect(borders.single).toBe('single');
        expect(borders.double).toBe('double');
        expect(borders.round).toBe('round');
      });
    });

    describe('icons', () => {
      it('should have status icons', () => {
        expect(icons.success).toBeDefined();
        expect(icons.error).toBeDefined();
        expect(icons.warning).toBeDefined();
      });

      it('should have navigation icons', () => {
        expect(icons.arrowRight).toBeDefined();
        expect(icons.arrowLeft).toBeDefined();
        expect(icons.chevronRight).toBeDefined();
      });
    });

    describe('animation', () => {
      it('should have timing values', () => {
        expect(animation.fast).toBe(100);
        expect(animation.normal).toBe(200);
        expect(animation.slow).toBe(500);
      });

      it('should have spinner frames', () => {
        expect(animation.spinnerFrames).toHaveLength(10);
      });
    });
  });

  describe('theme object', () => {
    it('should export theme object', () => {
      expect(theme).toBeDefined();
      expect(theme.colors).toBeDefined();
      expect(theme.spacing).toBeDefined();
      expect(theme.borders).toBeDefined();
      expect(theme.icons).toBeDefined();
      expect(theme.animation).toBeDefined();
    });

    it('should have all color properties', () => {
      expect(theme.colors.primary).toBeDefined();
      expect(theme.colors.secondary).toBeDefined();
      expect(theme.colors.feedback).toBeDefined();
      expect(theme.colors.neutral).toBeDefined();
    });

    it('should have terminal colors', () => {
      expect(theme.terminalColors).toBeDefined();
      expect(theme.terminalColors.primary).toBe('magenta');
    });
  });
});
