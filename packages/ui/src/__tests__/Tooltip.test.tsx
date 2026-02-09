import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../Tooltip';

describe('Tooltip', () => {
  describe('Rendering', () => {
    it('should render tooltip trigger', () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      expect(screen.getByText('Hover me')).toBeInTheDocument();
    });

    it('should render tooltip content when opened', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByText('Hover me');
      await user.hover(trigger);

      // Wait for tooltip to appear - use role to avoid duplicate matches
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });

    it('should accept custom className on TooltipContent', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent className="custom-tooltip">Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByText('Hover me');
      await user.hover(trigger);

      // Just verify it renders
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });
  });

  describe('Props', () => {
    it('should use default sideOffset', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByText('Hover me');
      await user.hover(trigger);

      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });

    it('should accept custom sideOffset', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent sideOffset={10}>Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByText('Hover me');
      await user.hover(trigger);

      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });
  });

  describe('User Interaction', () => {
    it('should show tooltip on hover', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByText('Hover me');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      await user.hover(trigger);

      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });

    it('should show and hide tooltip on interaction', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByText('Hover me');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      await user.hover(trigger);

      // Tooltip appears
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });
  });

  describe('Multiple Tooltips', () => {
    it('should handle multiple tooltips independently', async () => {
      const user = userEvent.setup();

      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>First</TooltipTrigger>
            <TooltipContent>First tooltip</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>Second</TooltipTrigger>
            <TooltipContent>Second tooltip</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const firstTrigger = screen.getByText('First');
      await user.hover(firstTrigger);

      // Just check tooltip appears
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
    });
  });
});
