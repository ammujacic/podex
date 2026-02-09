/**
 * Tests for lib/sentry (SENTRY_DSN and metrics helpers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCount = vi.fn();
const mockDistribution = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  metrics: {
    count: mockCount,
    distribution: mockDistribution,
  },
}));

describe('lib/sentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports SENTRY_DSN', async () => {
    const mod = await import('../sentry');
    expect(mod.SENTRY_DSN).toBeDefined();
    expect(typeof mod.SENTRY_DSN).toBe('string');
    expect(mod.SENTRY_DSN).toContain('sentry.io');
  });

  it('exports metrics object', async () => {
    const { metrics } = await import('../sentry');
    expect(metrics).toBeDefined();
    expect(typeof metrics.sessionStarted).toBe('function');
    expect(typeof metrics.agentMessageSent).toBe('function');
  });

  it('metrics.sessionStarted calls Sentry.metrics.count', async () => {
    const { metrics } = await import('../sentry');
    metrics.sessionStarted('template-1');
    expect(mockCount).toHaveBeenCalledWith('podex.web.session.started', 1, {
      attributes: { template_id: 'template-1' },
    });
  });

  it('metrics.sessionTimeToActive calls Sentry.metrics.distribution', async () => {
    const { metrics } = await import('../sentry');
    metrics.sessionTimeToActive(1500, 'template-1');
    expect(mockDistribution).toHaveBeenCalledWith(
      'podex.web.session.time_to_active',
      1500,
      expect.objectContaining({
        unit: 'millisecond',
        attributes: { template_id: 'template-1' },
      })
    );
  });

  it('metrics.agentMessageSent calls Sentry.metrics.count', async () => {
    const { metrics } = await import('../sentry');
    metrics.agentMessageSent('claude-3-5-sonnet', 'user');
    expect(mockCount).toHaveBeenCalledWith('podex.web.agent.message_sent', 1, {
      attributes: { model: 'claude-3-5-sonnet', role: 'user' },
    });
  });

  it('metrics.fileSaved calls count and distribution', async () => {
    const { metrics } = await import('../sentry');
    metrics.fileSaved('ts', 100);
    expect(mockCount).toHaveBeenCalledWith('podex.web.file.saved', 1, {
      attributes: { extension: 'ts' },
    });
    expect(mockDistribution).toHaveBeenCalledWith(
      'podex.web.file.save_duration',
      100,
      expect.objectContaining({
        unit: 'millisecond',
        attributes: { extension: 'ts' },
      })
    );
  });

  it('metrics.apiError calls Sentry.metrics.count', async () => {
    const { metrics } = await import('../sentry');
    metrics.apiError('/api/foo', 500);
    expect(mockCount).toHaveBeenCalledWith('podex.web.api.error', 1, {
      attributes: { endpoint: '/api/foo', status_code: '500' },
    });
  });

  it('metrics.websocketConnected calls Sentry.metrics.count', async () => {
    const { metrics } = await import('../sentry');
    metrics.websocketConnected();
    expect(mockCount).toHaveBeenCalledWith('podex.web.websocket.connected', 1);
  });

  it('metrics.featureUsed calls Sentry.metrics.count', async () => {
    const { metrics } = await import('../sentry');
    metrics.featureUsed('test-feature');
    expect(mockCount).toHaveBeenCalledWith('podex.web.feature.used', 1, {
      attributes: { feature: 'test-feature' },
    });
  });

  it('metrics.modalOpened calls Sentry.metrics.count', async () => {
    const { metrics } = await import('../sentry');
    metrics.modalOpened('settings');
    expect(mockCount).toHaveBeenCalledWith('podex.web.modal.opened', 1, {
      attributes: { modal: 'settings' },
    });
  });

  it('metrics.pageLoadTime calls Sentry.metrics.distribution', async () => {
    const { metrics } = await import('../sentry');
    metrics.pageLoadTime('dashboard', 800);
    expect(mockDistribution).toHaveBeenCalledWith(
      'podex.web.page.load_time',
      800,
      expect.objectContaining({
        unit: 'millisecond',
        attributes: { page: 'dashboard' },
      })
    );
  });

  it('metrics.hydrationTime calls Sentry.metrics.distribution', async () => {
    const { metrics } = await import('../sentry');
    metrics.hydrationTime(200);
    expect(mockDistribution).toHaveBeenCalledWith(
      'podex.web.hydration_time',
      200,
      expect.objectContaining({ unit: 'millisecond' })
    );
  });
});
