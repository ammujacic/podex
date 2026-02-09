import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBrowserContextStore, type BrowserContextData } from '../browserContext';
import {
  useDevToolsStore,
  type ConsoleEntry,
  type NetworkRequest,
  type BrowserError,
} from '../devtools';

// Mock navigator and window for browser APIs
vi.stubGlobal('navigator', {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
});

vi.stubGlobal('window', {
  location: {
    href: 'https://example.com/test',
  },
  innerWidth: 1920,
  innerHeight: 1080,
});

// Mock data helpers
const createMockConsoleEntry = (overrides?: Partial<ConsoleEntry>): ConsoleEntry => ({
  id: `console-${Date.now()}-${Math.random()}`,
  timestamp: Date.now(),
  level: 'log',
  args: [{ type: 'string', value: 'Test log message' }],
  url: 'https://example.com',
  ...overrides,
});

const createMockNetworkRequest = (overrides?: Partial<NetworkRequest>): NetworkRequest => ({
  id: `network-${Date.now()}-${Math.random()}`,
  url: 'https://api.example.com/data',
  method: 'GET',
  headers: {},
  body: null,
  timestamp: Date.now(),
  type: 'fetch',
  status: 200,
  statusText: 'OK',
  duration: 150,
  ...overrides,
});

const createMockBrowserError = (overrides?: Partial<BrowserError>): BrowserError => ({
  id: `error-${Date.now()}-${Math.random()}`,
  type: 'js_error',
  message: 'Test error',
  stack: 'Error: Test error\n    at test.js:10:5',
  timestamp: Date.now(),
  ...overrides,
});

describe('browserContextStore', () => {
  beforeEach(() => {
    // Reset both stores to initial state before each test
    act(() => {
      useBrowserContextStore.setState({
        agentCaptureEnabled: {},
        agentAutoInclude: {},
        pendingContext: {},
        htmlSnapshot: null,
      });

      useDevToolsStore.setState({
        consoleEntries: [],
        networkRequests: [],
        errors: [],
        currentUrl: 'https://example.com',
      } as any);
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty agent capture enabled map', () => {
      const { result } = renderHook(() => useBrowserContextStore());
      expect(result.current.agentCaptureEnabled).toEqual({});
    });

    it('has empty agent auto-include map', () => {
      const { result } = renderHook(() => useBrowserContextStore());
      expect(result.current.agentAutoInclude).toEqual({});
    });

    it('has empty pending context map', () => {
      const { result } = renderHook(() => useBrowserContextStore());
      expect(result.current.pendingContext).toEqual({});
    });

    it('has null HTML snapshot', () => {
      const { result } = renderHook(() => useBrowserContextStore());
      expect(result.current.htmlSnapshot).toBeNull();
    });
  });

  // ========================================================================
  // Capture Toggle Management
  // ========================================================================

  describe('Capture Toggle Management', () => {
    describe('toggleCapture', () => {
      it('enables capture for agent when toggled from false', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.toggleCapture('agent-1');
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(true);
      });

      it('disables capture for agent when toggled from true', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
          result.current.toggleCapture('agent-1');
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(false);
      });

      it('toggles multiple agents independently', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.toggleCapture('agent-1');
          result.current.toggleCapture('agent-2');
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(true);
        expect(result.current.agentCaptureEnabled['agent-2']).toBe(true);
      });
    });

    describe('setCaptureEnabled', () => {
      it('sets capture enabled to true', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(true);
      });

      it('sets capture enabled to false', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', false);
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(false);
      });

      it('does not affect other agents', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
          result.current.setCaptureEnabled('agent-2', false);
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(true);
        expect(result.current.agentCaptureEnabled['agent-2']).toBe(false);
      });
    });
  });

  // ========================================================================
  // Auto-Include Management
  // ========================================================================

  describe('Auto-Include Management', () => {
    describe('toggleAutoInclude', () => {
      it('enables auto-include for agent when toggled from false', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.toggleAutoInclude('agent-1');
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(true);
      });

      it('disables auto-include for agent when toggled from true', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setAutoInclude('agent-1', true);
          result.current.toggleAutoInclude('agent-1');
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(false);
      });

      it('toggles multiple agents independently', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.toggleAutoInclude('agent-1');
          result.current.toggleAutoInclude('agent-2');
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(true);
        expect(result.current.agentAutoInclude['agent-2']).toBe(true);
      });
    });

    describe('setAutoInclude', () => {
      it('sets auto-include to true', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setAutoInclude('agent-1', true);
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(true);
      });

      it('sets auto-include to false', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setAutoInclude('agent-1', false);
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(false);
      });

      it('does not affect other agents', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setAutoInclude('agent-1', true);
          result.current.setAutoInclude('agent-2', false);
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(true);
        expect(result.current.agentAutoInclude['agent-2']).toBe(false);
      });
    });
  });

  // ========================================================================
  // Context Capture
  // ========================================================================

  describe('Context Capture', () => {
    describe('captureContext', () => {
      it('captures current URL from devtools store', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          useDevToolsStore.setState({
            currentUrl: 'https://test.com/page',
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.url).toBe('https://test.com/page');
      });

      it('falls back to window.location.href when devtools URL is not set', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          useDevToolsStore.setState({
            currentUrl: '',
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.url).toBe('https://example.com/test');
      });

      it('captures console logs from devtools store', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const consoleEntry = createMockConsoleEntry({
          level: 'warn',
          args: [{ type: 'string', value: 'Warning message' }],
        });

        act(() => {
          useDevToolsStore.setState({
            consoleEntries: [consoleEntry],
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.consoleLogs).toHaveLength(1);
        expect(context!.consoleLogs[0].level).toBe('warn');
        expect(context!.consoleLogs[0].message).toBe('Warning message');
      });

      it('captures network requests from devtools store', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const networkRequest = createMockNetworkRequest({
          url: 'https://api.example.com/users',
          method: 'POST',
        });

        act(() => {
          useDevToolsStore.setState({
            networkRequests: [networkRequest],
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.networkRequests).toHaveLength(1);
        expect(context!.networkRequests[0].url).toBe('https://api.example.com/users');
        expect(context!.networkRequests[0].method).toBe('POST');
      });

      it('captures errors from devtools store', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const error = createMockBrowserError({
          type: 'unhandled_rejection',
          message: 'Promise rejected',
        });

        act(() => {
          useDevToolsStore.setState({
            errors: [error],
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.errors).toHaveLength(1);
        expect(context!.errors[0].type).toBe('unhandled_rejection');
        expect(context!.errors[0].message).toBe('Promise rejected');
      });

      it('limits console logs to max limit', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const entries = Array.from({ length: 100 }, (_, i) =>
          createMockConsoleEntry({ args: [{ type: 'string', value: `Log ${i}` }] })
        );

        act(() => {
          useDevToolsStore.setState({
            consoleEntries: entries,
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.consoleLogs.length).toBeLessThanOrEqual(50);
        // Should keep the most recent ones
        expect(context!.consoleLogs[context!.consoleLogs.length - 1].message).toBe('Log 99');
      });

      it('limits network requests to max limit', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const requests = Array.from({ length: 50 }, (_, i) =>
          createMockNetworkRequest({ url: `https://api.example.com/endpoint${i}` })
        );

        act(() => {
          useDevToolsStore.setState({
            networkRequests: requests,
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.networkRequests.length).toBeLessThanOrEqual(30);
        // Should keep the most recent ones
        expect(context!.networkRequests[context!.networkRequests.length - 1].url).toBe(
          'https://api.example.com/endpoint49'
        );
      });

      it('limits errors to max limit', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const errors = Array.from({ length: 30 }, (_, i) =>
          createMockBrowserError({ message: `Error ${i}` })
        );

        act(() => {
          useDevToolsStore.setState({
            errors: errors,
          } as any);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.errors.length).toBeLessThanOrEqual(20);
        // Should keep the most recent ones
        expect(context!.errors[context!.errors.length - 1].message).toBe('Error 29');
      });

      it('includes HTML snapshot when available', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const htmlContent = '<html><body>Test content</body></html>';

        act(() => {
          result.current.setHtmlSnapshot(htmlContent);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.htmlSnapshot).toBe(htmlContent);
      });

      it('truncates HTML snapshot when exceeding max size', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const largeHtml = '<html>' + 'x'.repeat(60000) + '</html>';

        act(() => {
          result.current.setHtmlSnapshot(largeHtml);
        });

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.htmlSnapshot!.length).toBeLessThanOrEqual(50000 + 20); // +20 for truncation marker
        expect(context!.htmlSnapshot).toContain('<!-- truncated -->');
      });

      it('captures user agent in metadata', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.metadata.userAgent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      });

      it('captures viewport size in metadata', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.metadata.viewportSize).toEqual({ width: 1920, height: 1080 });
      });

      it('includes timestamp in ISO format', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        let context: BrowserContextData;
        act(() => {
          context = result.current.captureContext('agent-1');
        });

        expect(context!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });
    });
  });

  // ========================================================================
  // Pending Context Management
  // ========================================================================

  describe('Pending Context Management', () => {
    const mockContext: BrowserContextData = {
      url: 'https://example.com',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      networkRequests: [],
      errors: [],
      metadata: {
        userAgent: 'Mozilla/5.0',
        viewportSize: { width: 1920, height: 1080 },
      },
    };

    describe('setPendingContext', () => {
      it('sets pending context for agent', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
        });

        expect(result.current.pendingContext['agent-1']).toEqual(mockContext);
      });

      it('can set pending context for multiple agents', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const mockContext2 = { ...mockContext, url: 'https://example.com/page2' };

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setPendingContext('agent-2', mockContext2);
        });

        expect(result.current.pendingContext['agent-1']?.url).toBe('https://example.com');
        expect(result.current.pendingContext['agent-2']?.url).toBe('https://example.com/page2');
      });

      it('can set pending context to null', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setPendingContext('agent-1', null);
        });

        expect(result.current.pendingContext['agent-1']).toBeNull();
      });

      it('does not affect other agents pending context', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setPendingContext('agent-2', mockContext);
          result.current.setPendingContext('agent-1', null);
        });

        expect(result.current.pendingContext['agent-1']).toBeNull();
        expect(result.current.pendingContext['agent-2']).toEqual(mockContext);
      });
    });

    describe('getPendingContext', () => {
      it('returns pending context for agent', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
        });

        const context = result.current.getPendingContext('agent-1');
        expect(context).toEqual(mockContext);
      });

      it('returns null when no pending context exists', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        const context = result.current.getPendingContext('agent-1');
        expect(context).toBeNull();
      });

      it('returns null after context is cleared', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.clearPendingContext('agent-1');
        });

        const context = result.current.getPendingContext('agent-1');
        expect(context).toBeNull();
      });
    });

    describe('clearPendingContext', () => {
      it('clears pending context for agent', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.clearPendingContext('agent-1');
        });

        expect(result.current.pendingContext['agent-1']).toBeNull();
      });

      it('does not affect other agents pending context', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setPendingContext('agent-2', mockContext);
          result.current.clearPendingContext('agent-1');
        });

        expect(result.current.pendingContext['agent-1']).toBeNull();
        expect(result.current.pendingContext['agent-2']).toEqual(mockContext);
      });

      it('handles clearing non-existent pending context gracefully', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        expect(() => {
          act(() => {
            result.current.clearPendingContext('non-existent-agent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // HTML Snapshot Management
  // ========================================================================

  describe('HTML Snapshot Management', () => {
    describe('setHtmlSnapshot', () => {
      it('sets HTML snapshot', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const html = '<html><body><h1>Test</h1></body></html>';

        act(() => {
          result.current.setHtmlSnapshot(html);
        });

        expect(result.current.htmlSnapshot).toBe(html);
      });

      it('updates HTML snapshot when called multiple times', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const html1 = '<html><body><h1>Test 1</h1></body></html>';
        const html2 = '<html><body><h1>Test 2</h1></body></html>';

        act(() => {
          result.current.setHtmlSnapshot(html1);
          result.current.setHtmlSnapshot(html2);
        });

        expect(result.current.htmlSnapshot).toBe(html2);
      });

      it('clears HTML snapshot when set to null', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const html = '<html><body><h1>Test</h1></body></html>';

        act(() => {
          result.current.setHtmlSnapshot(html);
          result.current.setHtmlSnapshot(null);
        });

        expect(result.current.htmlSnapshot).toBeNull();
      });

      it('accepts large HTML content', () => {
        const { result } = renderHook(() => useBrowserContextStore());
        const largeHtml = '<html>' + 'x'.repeat(100000) + '</html>';

        act(() => {
          result.current.setHtmlSnapshot(largeHtml);
        });

        expect(result.current.htmlSnapshot).toBe(largeHtml);
      });
    });
  });

  // ========================================================================
  // Agent Reset
  // ========================================================================

  describe('Agent Reset', () => {
    const mockContext: BrowserContextData = {
      url: 'https://example.com',
      timestamp: new Date().toISOString(),
      consoleLogs: [],
      networkRequests: [],
      errors: [],
      metadata: {},
    };

    describe('resetAgent', () => {
      it('resets capture enabled for agent', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
          result.current.resetAgent('agent-1');
        });

        expect(result.current.agentCaptureEnabled['agent-1']).toBe(false);
      });

      it('resets auto-include for agent', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setAutoInclude('agent-1', true);
          result.current.resetAgent('agent-1');
        });

        expect(result.current.agentAutoInclude['agent-1']).toBe(false);
      });

      it('clears pending context for agent', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.resetAgent('agent-1');
        });

        expect(result.current.pendingContext['agent-1']).toBeNull();
      });

      it('does not affect other agents', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
          result.current.setCaptureEnabled('agent-2', true);
          result.current.setAutoInclude('agent-1', true);
          result.current.setAutoInclude('agent-2', true);
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setPendingContext('agent-2', mockContext);
          result.current.resetAgent('agent-1');
        });

        expect(result.current.agentCaptureEnabled['agent-2']).toBe(true);
        expect(result.current.agentAutoInclude['agent-2']).toBe(true);
        expect(result.current.pendingContext['agent-2']).toEqual(mockContext);
      });

      it('handles resetting non-existent agent gracefully', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        expect(() => {
          act(() => {
            result.current.resetAgent('non-existent-agent');
          });
        }).not.toThrow();
      });
    });

    describe('reset', () => {
      it('clears all agent capture enabled settings', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
          result.current.setCaptureEnabled('agent-2', true);
          result.current.reset();
        });

        expect(result.current.agentCaptureEnabled).toEqual({});
      });

      it('clears all agent auto-include settings', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setAutoInclude('agent-1', true);
          result.current.setAutoInclude('agent-2', true);
          result.current.reset();
        });

        expect(result.current.agentAutoInclude).toEqual({});
      });

      it('clears all pending contexts', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setPendingContext('agent-2', mockContext);
          result.current.reset();
        });

        expect(result.current.pendingContext).toEqual({});
      });

      it('clears HTML snapshot', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setHtmlSnapshot('<html><body>Test</body></html>');
          result.current.reset();
        });

        expect(result.current.htmlSnapshot).toBeNull();
      });

      it('resets to initial state', () => {
        const { result } = renderHook(() => useBrowserContextStore());

        act(() => {
          result.current.setCaptureEnabled('agent-1', true);
          result.current.setAutoInclude('agent-1', true);
          result.current.setPendingContext('agent-1', mockContext);
          result.current.setHtmlSnapshot('<html>test</html>');
          result.current.reset();
        });

        expect(result.current.agentCaptureEnabled).toEqual({});
        expect(result.current.agentAutoInclude).toEqual({});
        expect(result.current.pendingContext).toEqual({});
        expect(result.current.htmlSnapshot).toBeNull();
      });
    });
  });

  // ========================================================================
  // Selector Hooks
  // ========================================================================

  describe('Selector Hooks', () => {
    describe('useIsCaptureEnabled', () => {
      it('returns false when capture not enabled', () => {
        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return store.agentCaptureEnabled['agent-1'] ?? false;
        });

        expect(result.current).toBe(false);
      });

      it('returns true when capture enabled', () => {
        act(() => {
          useBrowserContextStore.setState({
            agentCaptureEnabled: { 'agent-1': true },
          });
        });

        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return store.agentCaptureEnabled['agent-1'] ?? false;
        });

        expect(result.current).toBe(true);
      });
    });

    describe('useIsAutoInclude', () => {
      it('returns false when auto-include not enabled', () => {
        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return store.agentAutoInclude['agent-1'] ?? false;
        });

        expect(result.current).toBe(false);
      });

      it('returns true when auto-include enabled', () => {
        act(() => {
          useBrowserContextStore.setState({
            agentAutoInclude: { 'agent-1': true },
          });
        });

        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return store.agentAutoInclude['agent-1'] ?? false;
        });

        expect(result.current).toBe(true);
      });
    });

    describe('useHasPendingContext', () => {
      it('returns false when no pending context', () => {
        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return !!store.pendingContext['agent-1'];
        });

        expect(result.current).toBe(false);
      });

      it('returns true when pending context exists', () => {
        const mockContext: BrowserContextData = {
          url: 'https://example.com',
          timestamp: new Date().toISOString(),
          consoleLogs: [],
          networkRequests: [],
          errors: [],
          metadata: {},
        };

        act(() => {
          useBrowserContextStore.setState({
            pendingContext: { 'agent-1': mockContext },
          });
        });

        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return !!store.pendingContext['agent-1'];
        });

        expect(result.current).toBe(true);
      });

      it('returns false when pending context is null', () => {
        act(() => {
          useBrowserContextStore.setState({
            pendingContext: { 'agent-1': null },
          });
        });

        const { result } = renderHook(() => {
          const store = useBrowserContextStore();
          return !!store.pendingContext['agent-1'];
        });

        expect(result.current).toBe(false);
      });
    });
  });

  // ========================================================================
  // Utility Functions
  // ========================================================================

  describe('Utility Functions', () => {
    describe('estimateContextSize', () => {
      it('estimates size of browser context', async () => {
        const { estimateContextSize } = await import('../browserContext');
        const mockContext: BrowserContextData = {
          url: 'https://example.com',
          timestamp: new Date().toISOString(),
          consoleLogs: [],
          networkRequests: [],
          errors: [],
          metadata: {},
        };

        const size = estimateContextSize(mockContext);
        expect(size).toBeGreaterThan(0);
        expect(typeof size).toBe('number');
      });

      it('estimates larger size for context with data', async () => {
        const { estimateContextSize } = await import('../browserContext');
        const emptyContext: BrowserContextData = {
          url: 'https://example.com',
          timestamp: new Date().toISOString(),
          consoleLogs: [],
          networkRequests: [],
          errors: [],
          metadata: {},
        };

        const fullContext: BrowserContextData = {
          url: 'https://example.com',
          timestamp: new Date().toISOString(),
          consoleLogs: [{ level: 'log', message: 'Test log', timestamp: new Date().toISOString() }],
          networkRequests: [
            { url: 'https://api.example.com', method: 'GET', status: 200, type: 'fetch' },
          ],
          errors: [{ type: 'js_error', message: 'Error', timestamp: new Date().toISOString() }],
          metadata: { userAgent: 'Mozilla/5.0', viewportSize: { width: 1920, height: 1080 } },
        };

        const emptySize = estimateContextSize(emptyContext);
        const fullSize = estimateContextSize(fullContext);

        expect(fullSize).toBeGreaterThan(emptySize);
      });
    });

    describe('formatContextSize', () => {
      it('formats bytes correctly', async () => {
        const { formatContextSize } = await import('../browserContext');
        expect(formatContextSize(500)).toBe('500 B');
      });

      it('formats kilobytes correctly', async () => {
        const { formatContextSize } = await import('../browserContext');
        expect(formatContextSize(1536)).toBe('1.5 KB');
      });

      it('formats megabytes correctly', async () => {
        const { formatContextSize } = await import('../browserContext');
        expect(formatContextSize(1572864)).toBe('1.5 MB');
      });

      it('handles zero bytes', async () => {
        const { formatContextSize } = await import('../browserContext');
        expect(formatContextSize(0)).toBe('0 B');
      });
    });
  });
});
