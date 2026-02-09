/**
 * Sentry configuration constants and metrics helpers
 */

import * as Sentry from '@sentry/nextjs';

// Fallback DSN for development/local environments
export const SENTRY_DSN =
  'https://87269c25cb69df2160093daaaf4e93c0@o4509769403072512.ingest.de.sentry.io/4510708284784720';

// =============================================================================
// Podex Frontend Metrics Helpers
// =============================================================================
// Typed helpers for common metrics with standard naming convention:
// podex.web.<category>.<metric_name>

export const metrics = {
  // Session metrics
  sessionStarted: (templateId: string) =>
    Sentry.metrics.count('podex.web.session.started', 1, {
      attributes: { template_id: templateId },
    }),

  sessionTimeToActive: (durationMs: number, templateId: string) =>
    Sentry.metrics.distribution('podex.web.session.time_to_active', durationMs, {
      unit: 'millisecond',
      attributes: { template_id: templateId },
    }),

  // Agent metrics
  agentMessageSent: (model: string, role: string) =>
    Sentry.metrics.count('podex.web.agent.message_sent', 1, {
      attributes: { model, role },
    }),

  agentResponseReceived: (model: string, durationMs: number) =>
    Sentry.metrics.distribution('podex.web.agent.response_duration', durationMs, {
      unit: 'millisecond',
      attributes: { model },
    }),

  agentToolCallApproved: (toolName: string) =>
    Sentry.metrics.count('podex.web.agent.tool_call_approved', 1, {
      attributes: { tool_name: toolName },
    }),

  agentToolCallDenied: (toolName: string) =>
    Sentry.metrics.count('podex.web.agent.tool_call_denied', 1, {
      attributes: { tool_name: toolName },
    }),

  // Terminal metrics
  terminalLatency: (durationMs: number) =>
    Sentry.metrics.distribution('podex.web.terminal.perceived_latency', durationMs, {
      unit: 'millisecond',
    }),

  terminalReconnect: () => Sentry.metrics.count('podex.web.terminal.reconnect', 1),

  terminalSessionStarted: () => Sentry.metrics.count('podex.web.terminal.session_started', 1),

  // File operations
  fileOpened: (extension: string) =>
    Sentry.metrics.count('podex.web.file.opened', 1, {
      attributes: { extension },
    }),

  fileSaved: (extension: string, durationMs: number) => {
    Sentry.metrics.count('podex.web.file.saved', 1, { attributes: { extension } });
    Sentry.metrics.distribution('podex.web.file.save_duration', durationMs, {
      unit: 'millisecond',
      attributes: { extension },
    });
  },

  // Error tracking
  apiError: (endpoint: string, statusCode: number) =>
    Sentry.metrics.count('podex.web.api.error', 1, {
      attributes: { endpoint, status_code: String(statusCode) },
    }),

  // WebSocket metrics
  websocketConnected: () => Sentry.metrics.count('podex.web.websocket.connected', 1),

  websocketDisconnected: (reason: string) =>
    Sentry.metrics.count('podex.web.websocket.disconnected', 1, {
      attributes: { reason },
    }),

  websocketReconnect: () => Sentry.metrics.count('podex.web.websocket.reconnect', 1),

  // UI interaction metrics
  featureUsed: (featureName: string) =>
    Sentry.metrics.count('podex.web.feature.used', 1, {
      attributes: { feature: featureName },
    }),

  modalOpened: (modalName: string) =>
    Sentry.metrics.count('podex.web.modal.opened', 1, {
      attributes: { modal: modalName },
    }),

  // Performance metrics
  pageLoadTime: (pageName: string, durationMs: number) =>
    Sentry.metrics.distribution('podex.web.page.load_time', durationMs, {
      unit: 'millisecond',
      attributes: { page: pageName },
    }),

  hydrationTime: (durationMs: number) =>
    Sentry.metrics.distribution('podex.web.hydration_time', durationMs, {
      unit: 'millisecond',
    }),
};
