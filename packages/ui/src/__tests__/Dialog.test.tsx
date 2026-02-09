import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../Dialog';

describe('Dialog', () => {
  describe('Rendering', () => {
    it('should render dialog trigger', () => {
      render(
        <Dialog>
          <DialogTrigger>Open Dialog</DialogTrigger>
        </Dialog>
      );

      expect(screen.getByText('Open Dialog')).toBeInTheDocument();
    });

    it('should show dialog content when opened', async () => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open Dialog</DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogContent>
        </Dialog>
      );

      const trigger = screen.getByText('Open Dialog');
      await user.click(trigger);

      expect(await screen.findByText('Dialog Title')).toBeInTheDocument();
      expect(screen.getByText('Dialog description')).toBeInTheDocument();
    });

    it('should render dialog header', async () => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );

      await user.click(screen.getByText('Open'));
      expect(await screen.findByText('Title')).toBeInTheDocument();
    });

    it('should render dialog footer', async () => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
            <DialogFooter>
              <button>Cancel</button>
              <button>Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );

      await user.click(screen.getByText('Open'));
      expect(await screen.findByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
    });
  });

  describe('User Interaction', () => {
    it('should close dialog when clicking close button', async () => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      await user.click(screen.getByText('Open'));
      expect(await screen.findByText('Title')).toBeInTheDocument();

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      // Dialog should be closed
      expect(screen.queryByText('Title')).not.toBeInTheDocument();
    });

    it('should close dialog when pressing Escape', async () => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      await user.click(screen.getByText('Open'));
      expect(await screen.findByText('Title')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      // Dialog should be closed
      expect(screen.queryByText('Title')).not.toBeInTheDocument();
    });
  });

  describe('Controlled State', () => {
    it('should support controlled open state', () => {
      const onOpenChange = vi.fn();

      render(
        <Dialog open={true} onOpenChange={onOpenChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      expect(screen.getByText('Title')).toBeInTheDocument();
    });

    it('should call onOpenChange when opening', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      render(
        <Dialog onOpenChange={onOpenChange}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      await user.click(screen.getByText('Open'));

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Custom className', () => {
    it('should accept custom className on DialogContent', async () => {
      const user = userEvent.setup();

      render(
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent className="custom-dialog" aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      await user.click(screen.getByText('Open'));
      const dialog = await screen.findByText('Title');
      const dialogContent = dialog.closest('[role="dialog"]');

      expect(dialogContent).toHaveClass('custom-dialog');
    });
  });
});
