import '@testing-library/jest-dom';
import { vi, beforeAll, afterAll } from 'vitest';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Register happy-dom globally
GlobalRegistrator.register();

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Mock framer-motion with a Proxy to handle any motion.* component
vi.mock('framer-motion', async () => {
  const React = await import('react');

  // Framer Motion specific props that should be filtered out
  const framerProps = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileInView',
    'whileDrag',
    'drag',
    'dragConstraints',
    'layout',
    'layoutId',
    'motion',
    'style',
    'transformTemplate',
    'custom',
  ]);

  // Create a factory for motion components
  const createMotionComponent = (element: string) => {
    const Component = React.forwardRef((props: Record<string, unknown>, ref) => {
      // Filter out Framer Motion specific props
      const domProps = Object.keys(props).reduce(
        (acc, key) => {
          if (!framerProps.has(key)) {
            acc[key] = props[key];
          }
          return acc;
        },
        {} as Record<string, unknown>
      );

      return React.createElement(element, { ...domProps, ref });
    });
    Component.displayName = `motion.${element}`;
    return Component;
  };

  // Use a Proxy to dynamically create any motion.* component
  const motionProxy = new Proxy(
    {},
    {
      get: (_target, prop: string) => createMotionComponent(prop),
    }
  );

  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useInView: () => true,
  };
});

// Suppress console errors in tests
const originalWarn = console.warn;
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning:') || args[0].includes('Not implemented'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };

  // Suppress act() warnings in tests - these are not actual test failures
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('was not wrapped in act(...)')) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Mock CSS imports
vi.mock('*.css', () => ({}));
vi.mock('*.scss', () => ({}));
vi.mock('*.sass', () => ({}));
vi.mock('*.less', () => ({}));
