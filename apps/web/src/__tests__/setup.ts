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

  // Create a factory for motion components
  const createMotionComponent = (element: string) => {
    const Component = React.forwardRef((props: object, ref) =>
      React.createElement(element, { ...props, ref })
    );
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
});

afterAll(() => {
  console.error = originalError;
});
