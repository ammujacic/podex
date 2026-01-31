/**
 * Tests for ChatInput component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ChatInput, SimpleChatInput } from '../ChatInput';

describe('ChatInput', () => {
  describe('ChatInput component', () => {
    it('should render with default placeholder', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<ChatInput onSubmit={onSubmit} />);

      expect(lastFrame()).toContain('Type a message...');
    });

    it('should render with custom placeholder', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(
        <ChatInput onSubmit={onSubmit} placeholder="Enter command..." />
      );

      expect(lastFrame()).toContain('Enter command...');
    });

    it('should render in disabled state', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<ChatInput onSubmit={onSubmit} disabled />);

      expect(lastFrame()).toContain('Type a message...');
    });

    it('should show prompt character', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<ChatInput onSubmit={onSubmit} />);

      expect(lastFrame()).toContain('>');
    });

    it('should accept onHistoryUp callback', () => {
      const onSubmit = vi.fn();
      const onHistoryUp = vi.fn(() => 'previous command');
      const { lastFrame } = render(<ChatInput onSubmit={onSubmit} onHistoryUp={onHistoryUp} />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept onHistoryDown callback', () => {
      const onSubmit = vi.fn();
      const onHistoryDown = vi.fn(() => 'next command');
      const { lastFrame } = render(<ChatInput onSubmit={onSubmit} onHistoryDown={onHistoryDown} />);

      expect(lastFrame()).toBeDefined();
    });

    it('should render empty input', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<ChatInput onSubmit={onSubmit} />);

      expect(lastFrame()).toBeDefined();
    });
  });

  describe('SimpleChatInput component', () => {
    it('should render with default placeholder', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<SimpleChatInput onSubmit={onSubmit} />);

      expect(lastFrame()).toContain('Type a message...');
    });

    it('should render with custom placeholder', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(
        <SimpleChatInput onSubmit={onSubmit} placeholder="Ask a question..." />
      );

      expect(lastFrame()).toContain('Ask a question...');
    });

    it('should render in disabled state', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<SimpleChatInput onSubmit={onSubmit} disabled />);

      expect(lastFrame()).toBeDefined();
    });

    it('should show prompt character', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<SimpleChatInput onSubmit={onSubmit} />);

      expect(lastFrame()).toContain('>');
    });

    it('should render without history callbacks', () => {
      const onSubmit = vi.fn();
      const { lastFrame } = render(<SimpleChatInput onSubmit={onSubmit} />);

      expect(lastFrame()).toBeDefined();
    });
  });
});
