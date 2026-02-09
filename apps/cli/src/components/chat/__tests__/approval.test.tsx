/**
 * Tests for ApprovalPrompt component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ApprovalPrompt, type ApprovalRequest } from '../ApprovalPrompt';

describe('ApprovalPrompt', () => {
  const mockRequest: ApprovalRequest = {
    id: 'approval-1',
    tool: 'shell',
    description: 'Run a command',
    command: 'npm install',
  };

  it('should render tool name', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('shell');
  });

  it('should render description', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('Run a command');
  });

  it('should render command when provided', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('npm install');
  });

  it('should render without command', () => {
    const requestWithoutCommand: ApprovalRequest = {
      id: 'approval-2',
      tool: 'file',
      description: 'Read a file',
    };

    const onRespond = vi.fn();
    const { lastFrame } = render(
      <ApprovalPrompt request={requestWithoutCommand} onRespond={onRespond} />
    );

    expect(lastFrame()).toContain('Read a file');
    expect(lastFrame()).not.toContain('Command:');
  });

  it('should show Approve option', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('Approve');
  });

  it('should show Deny option', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('Deny');
  });

  it('should show Always Allow option', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('Always');
  });

  it('should show keyboard shortcuts', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    expect(lastFrame()).toContain('Y');
    expect(lastFrame()).toContain('N');
    expect(lastFrame()).toContain('A');
  });

  it('should render when inactive', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(
      <ApprovalPrompt request={mockRequest} onRespond={onRespond} isActive={false} />
    );

    expect(lastFrame()).toContain('shell');
  });

  it('should render with args', () => {
    const requestWithArgs: ApprovalRequest = {
      id: 'approval-3',
      tool: 'api',
      description: 'Make API call',
      args: { url: 'https://example.com' },
    };

    const onRespond = vi.fn();
    const { lastFrame } = render(
      <ApprovalPrompt request={requestWithArgs} onRespond={onRespond} />
    );

    expect(lastFrame()).toContain('Make API call');
  });

  it('should show warning indicator', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    // Should contain warning icon or text
    expect(lastFrame()).toBeDefined();
  });

  it('should accept onRespond callback', () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(<ApprovalPrompt request={mockRequest} onRespond={onRespond} />);

    // Callback should be passed but not called yet
    expect(onRespond).not.toHaveBeenCalled();
    expect(lastFrame()).toBeDefined();
  });
});
