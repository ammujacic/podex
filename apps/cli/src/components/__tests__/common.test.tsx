/**
 * Tests for common components.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Spinner } from '../common/Spinner';
import { ErrorBox } from '../common/ErrorBox';
import { SuccessBox } from '../common/SuccessBox';
import { Badge } from '../common/Badge';
import { ProgressBar } from '../common/ProgressBar';
import { Divider } from '../common/Divider';

describe('Common Components', () => {
  describe('Spinner', () => {
    it('should render without label', () => {
      const { lastFrame } = render(<Spinner />);

      // Spinner should render something (the spinner animation)
      expect(lastFrame()).toBeDefined();
    });

    it('should render with label', () => {
      const { lastFrame } = render(<Spinner label="Loading..." />);

      expect(lastFrame()).toContain('Loading...');
    });

    it('should accept custom color', () => {
      const { lastFrame } = render(<Spinner color="green" />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept different spinner types', () => {
      const { lastFrame } = render(<Spinner type="line" />);

      expect(lastFrame()).toBeDefined();
    });
  });

  describe('ErrorBox', () => {
    it('should render error message', () => {
      const { lastFrame } = render(<ErrorBox message="Something went wrong" />);

      expect(lastFrame()).toContain('Something went wrong');
      expect(lastFrame()).toContain('Error');
    });

    it('should render custom title', () => {
      const { lastFrame } = render(<ErrorBox message="Failed" title="Connection Error" />);

      expect(lastFrame()).toContain('Connection Error');
      expect(lastFrame()).toContain('Failed');
    });
  });

  describe('SuccessBox', () => {
    it('should render success message', () => {
      const { lastFrame } = render(<SuccessBox message="Operation completed" />);

      expect(lastFrame()).toContain('Operation completed');
      expect(lastFrame()).toContain('Success');
    });

    it('should render custom title', () => {
      const { lastFrame } = render(<SuccessBox message="Done" title="Task Complete" />);

      expect(lastFrame()).toContain('Task Complete');
      expect(lastFrame()).toContain('Done');
    });
  });

  describe('Badge', () => {
    it('should render children', () => {
      const { lastFrame } = render(<Badge>Test Badge</Badge>);

      expect(lastFrame()).toContain('Test Badge');
    });

    it('should render default variant', () => {
      const { lastFrame } = render(<Badge>Default</Badge>);

      expect(lastFrame()).toBeDefined();
    });

    it('should render success variant', () => {
      const { lastFrame } = render(<Badge variant="success">Success</Badge>);

      expect(lastFrame()).toContain('Success');
    });

    it('should render warning variant', () => {
      const { lastFrame } = render(<Badge variant="warning">Warning</Badge>);

      expect(lastFrame()).toContain('Warning');
    });

    it('should render error variant', () => {
      const { lastFrame } = render(<Badge variant="error">Error</Badge>);

      expect(lastFrame()).toContain('Error');
    });

    it('should render info variant', () => {
      const { lastFrame } = render(<Badge variant="info">Info</Badge>);

      expect(lastFrame()).toContain('Info');
    });

    it('should render primary variant', () => {
      const { lastFrame } = render(<Badge variant="primary">Primary</Badge>);

      expect(lastFrame()).toContain('Primary');
    });

    it('should show icon when requested', () => {
      const { lastFrame } = render(<Badge icon>With Icon</Badge>);

      expect(lastFrame()).toBeDefined();
    });
  });

  describe('ProgressBar', () => {
    it('should render at 0%', () => {
      const { lastFrame } = render(<ProgressBar value={0} />);

      expect(lastFrame()).toContain('0%');
    });

    it('should render at 50%', () => {
      const { lastFrame } = render(<ProgressBar value={50} />);

      expect(lastFrame()).toContain('50%');
    });

    it('should render at 100%', () => {
      const { lastFrame } = render(<ProgressBar value={100} />);

      expect(lastFrame()).toContain('100%');
    });

    it('should clamp values above 100', () => {
      const { lastFrame } = render(<ProgressBar value={150} />);

      expect(lastFrame()).toContain('100%');
    });

    it('should clamp values below 0', () => {
      const { lastFrame } = render(<ProgressBar value={-10} />);

      expect(lastFrame()).toContain('0%');
    });

    it('should hide percentage when requested', () => {
      const { lastFrame } = render(<ProgressBar value={50} showPercentage={false} />);

      expect(lastFrame()).not.toContain('50%');
    });

    it('should render with label', () => {
      const { lastFrame } = render(<ProgressBar value={50} label="Progress" />);

      expect(lastFrame()).toContain('Progress');
    });

    it('should respect custom width', () => {
      const { lastFrame } = render(<ProgressBar value={50} width={20} />);

      expect(lastFrame()).toBeDefined();
    });
  });

  describe('Divider', () => {
    it('should render simple divider', () => {
      const { lastFrame } = render(<Divider />);

      expect(lastFrame()).toBeDefined();
    });

    it('should render divider with title', () => {
      const { lastFrame } = render(<Divider title="Section" />);

      expect(lastFrame()).toContain('Section');
    });

    it('should respect custom width', () => {
      const { lastFrame } = render(<Divider width={20} />);

      expect(lastFrame()).toBeDefined();
    });

    it('should accept custom character', () => {
      const { lastFrame } = render(<Divider character="=" />);

      expect(lastFrame()).toContain('=');
    });
  });
});
