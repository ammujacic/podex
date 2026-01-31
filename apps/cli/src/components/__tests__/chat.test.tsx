/**
 * Tests for chat components.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Message } from '../chat/Message';
import { MessageList } from '../chat/MessageList';
import { StreamingMessage } from '../chat/StreamingMessage';
import type { Message as MessageType } from '@podex/shared';

describe('Chat Components', () => {
  describe('Message', () => {
    it('should render user message', () => {
      const message: MessageType = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello, world!',
        timestamp: new Date().toISOString(),
      };

      const { lastFrame } = render(<Message message={message} />);

      expect(lastFrame()).toContain('You');
      expect(lastFrame()).toContain('Hello, world!');
    });

    it('should render assistant message', () => {
      const message: MessageType = {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: new Date().toISOString(),
      };

      const { lastFrame } = render(<Message message={message} />);

      expect(lastFrame()).toContain('Assistant');
      expect(lastFrame()).toContain('Hi there!');
    });

    it('should render message with tool calls', () => {
      const message: MessageType = {
        id: 'msg-3',
        role: 'assistant',
        content: 'I will run a command.',
        toolCalls: [
          {
            id: 'tc-1',
            name: 'bash',
            status: 'completed',
            args: { command: 'ls -la' },
            result: { success: true, output: 'file1.txt\nfile2.txt' },
          },
        ],
      };

      const { lastFrame } = render(<Message message={message} />);

      expect(lastFrame()).toContain('Tool: bash');
      expect(lastFrame()).toContain('completed');
    });

    it('should render message with failed tool call', () => {
      const message: MessageType = {
        id: 'msg-4',
        role: 'assistant',
        content: 'Running command...',
        toolCalls: [
          {
            id: 'tc-2',
            name: 'bash',
            status: 'failed',
            args: { command: 'invalid' },
            result: { success: false, error: 'Command not found' },
          },
        ],
      };

      const { lastFrame } = render(<Message message={message} />);

      expect(lastFrame()).toContain('Command not found');
    });
  });

  describe('MessageList', () => {
    it('should render empty state', () => {
      const { lastFrame } = render(<MessageList messages={[]} />);

      expect(lastFrame()).toContain('No messages yet');
    });

    it('should render list of messages', () => {
      const messages: MessageType[] = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
      ];

      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain('Hello');
      expect(lastFrame()).toContain('Hi there!');
    });

    it('should limit messages with maxHeight', () => {
      const messages: MessageType[] = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const { lastFrame } = render(<MessageList messages={messages} maxHeight={3} />);

      // Should only show last 3 messages
      expect(lastFrame()).toContain('Message 7');
      expect(lastFrame()).toContain('Message 8');
      expect(lastFrame()).toContain('Message 9');
      expect(lastFrame()).not.toContain('Message 0');
    });
  });

  describe('StreamingMessage', () => {
    it('should render streaming content', () => {
      const { lastFrame } = render(<StreamingMessage content="Generating response..." />);

      expect(lastFrame()).toContain('streaming...');
      expect(lastFrame()).toContain('Generating response...');
    });

    it('should render thinking indicator', () => {
      const { lastFrame } = render(<StreamingMessage content="Processing..." isThinking={true} />);

      expect(lastFrame()).toContain('Processing...');
    });

    it('should render thinking content', () => {
      const { lastFrame } = render(
        <StreamingMessage content="Output here" thinkingContent="Analyzing the problem..." />
      );

      expect(lastFrame()).toContain('Thinking:');
      expect(lastFrame()).toContain('Analyzing the problem...');
    });
  });
});
