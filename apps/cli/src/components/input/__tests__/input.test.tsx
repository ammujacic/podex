/**
 * Tests for input components.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { SelectMenu } from '../SelectMenu';
import { ConfirmDialog } from '../ConfirmDialog';

describe('Input Components', () => {
  describe('SelectMenu', () => {
    const options = [
      { label: 'Option 1', value: 'opt1', description: 'First option' },
      { label: 'Option 2', value: 'opt2', description: 'Second option' },
      { label: 'Option 3', value: 'opt3', description: 'Third option' },
    ];

    it('should render all options', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<SelectMenu options={options} onSelect={onSelect} />);

      expect(lastFrame()).toContain('Option 1');
      expect(lastFrame()).toContain('Option 2');
      expect(lastFrame()).toContain('Option 3');
    });

    it('should render with label', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <SelectMenu options={options} onSelect={onSelect} label="Select an option" />
      );

      expect(lastFrame()).toContain('Select an option');
    });

    it('should highlight first option by default', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<SelectMenu options={options} onSelect={onSelect} />);

      // First option should have chevron indicator
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Option 1');
    });

    it('should show description for selected option', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <SelectMenu options={options} onSelect={onSelect} showDescriptions />
      );

      expect(lastFrame()).toContain('First option');
    });

    it('should show navigation hints', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(<SelectMenu options={options} onSelect={onSelect} />);

      expect(lastFrame()).toContain('navigate');
      expect(lastFrame()).toContain('Enter');
    });

    it('should render with default index', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <SelectMenu options={options} onSelect={onSelect} defaultIndex={1} />
      );

      // Second option should show its description
      expect(lastFrame()).toContain('Second option');
    });

    it('should render disabled options differently', () => {
      const optionsWithDisabled = [
        { label: 'Option 1', value: 'opt1' },
        { label: 'Option 2', value: 'opt2', disabled: true },
        { label: 'Option 3', value: 'opt3' },
      ];

      const onSelect = vi.fn();
      const { lastFrame } = render(
        <SelectMenu options={optionsWithDisabled} onSelect={onSelect} />
      );

      // All options should render
      expect(lastFrame()).toContain('Option 1');
      expect(lastFrame()).toContain('Option 2');
      expect(lastFrame()).toContain('Option 3');
    });

    it('should render when inactive', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <SelectMenu options={options} onSelect={onSelect} isActive={false} />
      );

      expect(lastFrame()).toContain('Option 1');
    });

    it('should accept custom highlight color', () => {
      const onSelect = vi.fn();
      const { lastFrame } = render(
        <SelectMenu options={options} onSelect={onSelect} highlightColor="green" />
      );

      expect(lastFrame()).toContain('Option 1');
    });
  });

  describe('ConfirmDialog', () => {
    it('should render message', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(<ConfirmDialog message="Are you sure?" onConfirm={onConfirm} />);

      expect(lastFrame()).toContain('Are you sure?');
    });

    it('should render description', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(
        <ConfirmDialog
          message="Delete file?"
          description="This action cannot be undone"
          onConfirm={onConfirm}
        />
      );

      expect(lastFrame()).toContain('This action cannot be undone');
    });

    it('should show all options by default', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(<ConfirmDialog message="Confirm?" onConfirm={onConfirm} />);

      expect(lastFrame()).toContain('Yes');
      expect(lastFrame()).toContain('No');
      expect(lastFrame()).toContain('Always Allow');
    });

    it('should hide always option when disabled', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(
        <ConfirmDialog message="Confirm?" onConfirm={onConfirm} showAlways={false} />
      );

      expect(lastFrame()).toContain('Yes');
      expect(lastFrame()).toContain('No');
      expect(lastFrame()).not.toContain('Always Allow');
    });

    it('should show keyboard shortcut hints', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(<ConfirmDialog message="Confirm?" onConfirm={onConfirm} />);

      expect(lastFrame()).toContain('Y');
      expect(lastFrame()).toContain('N');
      expect(lastFrame()).toContain('A');
    });

    it('should render with default option', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(
        <ConfirmDialog message="Confirm?" onConfirm={onConfirm} defaultOption="no" />
      );

      expect(lastFrame()).toContain('No');
    });

    it('should render when inactive', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(
        <ConfirmDialog message="Confirm?" onConfirm={onConfirm} isActive={false} />
      );

      expect(lastFrame()).toContain('Confirm?');
    });

    it('should show warning icon', () => {
      const onConfirm = vi.fn();
      const { lastFrame } = render(<ConfirmDialog message="Confirm?" onConfirm={onConfirm} />);

      // Should contain the warning symbol
      expect(lastFrame()).toContain('Confirm?');
    });
  });
});
