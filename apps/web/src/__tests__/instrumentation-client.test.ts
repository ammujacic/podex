/**
 * Tests for client-side instrumentation (Sentry init).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInit = vi.fn();
const mockReplayIntegration = vi.fn(() => ({}));
const mockCaptureRouterTransitionStart = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: mockInit,
  replayIntegration: mockReplayIntegration,
  captureRouterTransitionStart: mockCaptureRouterTransitionStart,
}));

vi.mock('@/lib/sentry', () => ({
  SENTRY_DSN: 'https://test-dsn@sentry.io/1',
}));

describe('instrumentation-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should initialize Sentry with replay integration', async () => {
    await import('@/instrumentation-client');

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: expect.any(String),
        integrations: expect.any(Array),
        tracesSampleRate: 1,
        enableLogs: true,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        sendDefaultPii: true,
      })
    );
    expect(mockReplayIntegration).toHaveBeenCalled();
  });

  it('should use NEXT_PUBLIC_SENTRY_DSN when set', async () => {
    const original = process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://env-dsn@sentry.io/2';
    vi.resetModules();

    await import('@/instrumentation-client');

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://env-dsn@sentry.io/2',
      })
    );

    process.env.NEXT_PUBLIC_SENTRY_DSN = original;
  });

  it('should export onRouterTransitionStart', async () => {
    const mod = await import('@/instrumentation-client');
    expect(mod.onRouterTransitionStart).toBeDefined();
    expect(mod.onRouterTransitionStart).toBe(mockCaptureRouterTransitionStart);
  });
});
