/**
 * Comprehensive tests for usePreviewDevTools hook
 * Tests DevTools integration, postMessage communication, and browser API mocking
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePreviewDevTools } from '../usePreviewDevTools';
import { useDevToolsStore } from '@/stores/devtools';
import type { DOMNode } from '@/stores/devtools';

// Mock the devtools store
vi.mock('@/stores/devtools', () => {
  const mockStore = {
    setIframeReady: vi.fn(),
    setCurrentUrl: vi.fn(),
    addConsoleEntry: vi.fn(),
    addNetworkRequest: vi.fn(),
    updateNetworkRequest: vi.fn(),
    setDOMSnapshot: vi.fn(),
    pushHistory: vi.fn(),
    addError: vi.fn(),
    setHtmlSnapshot: vi.fn(),
    addEvalResult: vi.fn(),
    setPendingEvalId: vi.fn(),
    resetForNewPreview: vi.fn(),
  };

  return {
    useDevToolsStore: {
      getState: vi.fn(() => mockStore),
      subscribe: vi.fn(() => () => {}),
    },
  };
});

describe('usePreviewDevTools', () => {
  const workspaceId = 'ws-123';
  let mockIframe: HTMLIFrameElement;
  let mockContentWindow: Window;
  let iframeRef: React.RefObject<HTMLIFrameElement>;
  let messageListeners: Array<(event: MessageEvent) => void> = [];
  let mockStore: ReturnType<typeof useDevToolsStore.getState>;

  beforeEach(() => {
    vi.clearAllMocks();
    messageListeners = [];

    // Create mock content window
    mockContentWindow = {
      postMessage: vi.fn(),
      location: {
        origin: window.location.origin,
      },
    } as any;

    // Create mock iframe
    mockIframe = {
      contentWindow: mockContentWindow,
    } as any;

    // Create ref
    iframeRef = { current: mockIframe };

    // Mock window.addEventListener
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'message') {
        messageListeners.push(handler as (event: MessageEvent) => void);
      }
    });

    vi.spyOn(window, 'removeEventListener').mockImplementation((event, handler) => {
      if (event === 'message') {
        const index = messageListeners.indexOf(handler as (event: MessageEvent) => void);
        if (index > -1) {
          messageListeners.splice(index, 1);
        }
      }
    });

    // Get mock store
    mockStore = useDevToolsStore.getState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to trigger message events
  const triggerMessage = (data: any, origin: string = window.location.origin) => {
    const event = new MessageEvent('message', {
      data,
      origin,
      source: mockContentWindow as any,
    });
    messageListeners.forEach((listener) => listener(event));
  };

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should setup message listener on mount', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      expect(window.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should reset DevTools state on mount', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      expect(mockStore.resetForNewPreview).toHaveBeenCalled();
    });

    it('should cleanup on unmount', () => {
      const { unmount } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      unmount();

      expect(window.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should not setup listener when disabled', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId, enabled: false }));

      expect(window.addEventListener).not.toHaveBeenCalled();
    });

    it('should handle subscribe cleanup', () => {
      const unsubscribe = vi.fn();
      (useDevToolsStore.subscribe as any).mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  // ========================================
  // Message Validation Tests
  // ========================================

  describe('Message Validation', () => {
    it('should ignore messages from different origins', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage(
        {
          type: 'devtools:console',
          source: 'podex-devtools',
          payload: { level: 'log', args: [{ type: 'string', value: 'test' }] },
          timestamp: Date.now(),
        },
        'https://evil.com'
      );

      expect(mockStore.addConsoleEntry).not.toHaveBeenCalled();
    });

    it('should ignore messages without type', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        source: 'podex-devtools',
        payload: {},
        timestamp: Date.now(),
      });

      expect(mockStore.addConsoleEntry).not.toHaveBeenCalled();
    });

    it('should ignore messages without devtools prefix', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'some_other_event',
        source: 'podex-devtools',
        payload: {},
        timestamp: Date.now(),
      });

      expect(mockStore.addConsoleEntry).not.toHaveBeenCalled();
    });

    it('should ignore messages from wrong source', () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:console',
        source: 'other-source',
        payload: { level: 'log', args: [{ type: 'string', value: 'test' }] },
        timestamp: Date.now(),
      });

      expect(mockStore.addConsoleEntry).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // DevTools Ready Event Tests
  // ========================================

  describe('DevTools Ready Events', () => {
    it('should handle devtools:ready event', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:ready',
        source: 'podex-devtools',
        payload: {
          url: 'http://localhost:3000',
          title: 'Test Page',
          userAgent: 'Mozilla/5.0',
          viewport: { width: 1920, height: 1080 },
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.setIframeReady).toHaveBeenCalledWith(true);
        expect(mockStore.pushHistory).toHaveBeenCalledWith('http://localhost:3000', 'Test Page');
      });
    });

    it('should handle devtools:dom:ready event', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:dom:ready',
        source: 'podex-devtools',
        payload: {
          url: 'http://localhost:3000/page',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.setCurrentUrl).toHaveBeenCalledWith('http://localhost:3000/page');
      });
    });
  });

  // ========================================
  // Console Event Tests
  // ========================================

  describe('Console Events', () => {
    it('should capture console.log', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'log',
          args: [{ type: 'string', value: 'Hello world' }],
          url: 'http://localhost:3000',
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalledWith({
          timestamp,
          level: 'log',
          args: [{ type: 'string', value: 'Hello world' }],
          url: 'http://localhost:3000',
        });
      });
    });

    it('should capture console.warn', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'warn',
          args: [{ type: 'string', value: 'Warning message' }],
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            level: 'warn',
            args: [{ type: 'string', value: 'Warning message' }],
          })
        );
      });
    });

    it('should capture console.error', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'error',
          args: [{ type: 'string', value: 'Error message' }],
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            level: 'error',
          })
        );
      });
    });

    it('should capture console.info', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'info',
          args: [{ type: 'string', value: 'Info message' }],
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalled();
      });
    });

    it('should capture console.debug', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'debug',
          args: [{ type: 'string', value: 'Debug message' }],
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalled();
      });
    });

    it('should handle multiple console arguments', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'log',
          args: [
            { type: 'string', value: 'User:' },
            { type: 'object', value: '{"name":"John","age":30}' },
          ],
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            args: expect.arrayContaining([
              { type: 'string', value: 'User:' },
              { type: 'object', value: '{"name":"John","age":30}' },
            ]),
          })
        );
      });
    });

    it('should ignore console events without required fields', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:console',
        source: 'podex-devtools',
        payload: {
          level: 'log',
          // Missing args
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Network Request Tests
  // ========================================

  describe('Network Request Events', () => {
    it('should capture network request', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:request',
        source: 'podex-devtools',
        payload: {
          id: 'req-001',
          url: 'https://api.example.com/users',
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: null,
          type: 'fetch',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addNetworkRequest).toHaveBeenCalledWith({
          id: 'req-001',
          url: 'https://api.example.com/users',
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: null,
          type: 'fetch',
        });
      });
    });

    it('should capture POST request with body', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const requestBody = JSON.stringify({ name: 'John', email: 'john@example.com' });

      triggerMessage({
        type: 'devtools:network:request',
        source: 'podex-devtools',
        payload: {
          id: 'req-002',
          url: 'https://api.example.com/users',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          type: 'fetch',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addNetworkRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
            body: requestBody,
          })
        );
      });
    });

    it('should capture XHR request', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:request',
        source: 'podex-devtools',
        payload: {
          id: 'req-003',
          url: 'https://api.example.com/data',
          method: 'GET',
          headers: {},
          body: null,
          type: 'xhr',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addNetworkRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'xhr',
          })
        );
      });
    });

    it('should ignore network request without required fields', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:request',
        source: 'podex-devtools',
        payload: {
          id: 'req-004',
          // Missing url
          method: 'GET',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addNetworkRequest).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Network Response Tests
  // ========================================

  describe('Network Response Events', () => {
    it('should update network request with response', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:response',
        source: 'podex-devtools',
        payload: {
          id: 'req-001',
          url: 'https://api.example.com/users',
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
          body: '[{"id":1,"name":"John"}]',
          duration: 145,
          size: 512,
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.updateNetworkRequest).toHaveBeenCalledWith('req-001', {
          status: 200,
          statusText: 'OK',
          responseHeaders: { 'Content-Type': 'application/json' },
          responseBody: '[{"id":1,"name":"John"}]',
          duration: 145,
          size: 512,
          error: undefined,
        });
      });
    });

    it('should handle network error', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:response',
        source: 'podex-devtools',
        payload: {
          id: 'req-002',
          error: 'Network timeout',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.updateNetworkRequest).toHaveBeenCalledWith(
          'req-002',
          expect.objectContaining({
            error: 'Network timeout',
          })
        );
      });
    });

    it('should handle 404 response', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:response',
        source: 'podex-devtools',
        payload: {
          id: 'req-003',
          status: 404,
          statusText: 'Not Found',
          headers: {},
          body: null,
          duration: 50,
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.updateNetworkRequest).toHaveBeenCalledWith(
          'req-003',
          expect.objectContaining({
            status: 404,
            statusText: 'Not Found',
          })
        );
      });
    });

    it('should ignore network response without ID', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:network:response',
        source: 'podex-devtools',
        payload: {
          // Missing id
          status: 200,
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.updateNetworkRequest).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // DOM Snapshot Tests
  // ========================================

  describe('DOM Snapshot Events', () => {
    it('should capture DOM snapshot', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const domSnapshot: DOMNode = {
        tagName: 'div',
        id: 'root',
        className: 'container',
        attributes: { 'data-test': 'value' },
        children: [
          {
            tagName: 'h1',
            text: 'Hello World',
          },
        ],
      };

      triggerMessage({
        type: 'devtools:dom:snapshot',
        source: 'podex-devtools',
        payload: domSnapshot,
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.setDOMSnapshot).toHaveBeenCalledWith(domSnapshot);
      });
    });

    it('should handle empty DOM snapshot', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:dom:snapshot',
        source: 'podex-devtools',
        payload: {},
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.setDOMSnapshot).toHaveBeenCalledWith({});
      });
    });
  });

  // ========================================
  // Navigation Event Tests
  // ========================================

  describe('Navigation Events', () => {
    it('should handle navigation event', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:navigate',
        source: 'podex-devtools',
        payload: {
          url: 'http://localhost:3000/about',
          type: 'pushState',
          title: 'About Page',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.pushHistory).toHaveBeenCalledWith(
          'http://localhost:3000/about',
          'About Page'
        );
      });
    });

    it('should ignore navigation without URL', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:navigate',
        source: 'podex-devtools',
        payload: {
          type: 'pushState',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.pushHistory).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Error Event Tests
  // ========================================

  describe('Error Events', () => {
    it('should capture JavaScript error', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:error',
        source: 'podex-devtools',
        payload: {
          type: 'js_error',
          message: 'Uncaught TypeError: Cannot read property of undefined',
          stack: 'Error: ...\n  at Component.render',
          filename: 'http://localhost:3000/app.js',
          lineno: 42,
          colno: 10,
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addError).toHaveBeenCalledWith({
          type: 'js_error',
          message: 'Uncaught TypeError: Cannot read property of undefined',
          stack: 'Error: ...\n  at Component.render',
          filename: 'http://localhost:3000/app.js',
          lineno: 42,
          colno: 10,
          timestamp,
        });

        // Should also add to console
        expect(mockStore.addConsoleEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            level: 'error',
          })
        );
      });
    });

    it('should capture unhandled rejection', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:error',
        source: 'podex-devtools',
        payload: {
          type: 'unhandled_rejection',
          message: 'Promise rejected without handler',
          stack: null,
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addError).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'unhandled_rejection',
            message: 'Promise rejected without handler',
          })
        );
      });
    });

    it('should ignore error without message', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:error',
        source: 'podex-devtools',
        payload: {
          type: 'js_error',
          // Missing message
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addError).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // HTML Snapshot Tests
  // ========================================

  describe('HTML Snapshot Events', () => {
    it('should capture HTML snapshot', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const html = '<html><body><h1>Test</h1></body></html>';
      const url = 'http://localhost:3000';

      triggerMessage({
        type: 'devtools:html',
        source: 'podex-devtools',
        payload: {
          html,
          url,
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.setHtmlSnapshot).toHaveBeenCalledWith(html, url);
      });
    });

    it('should ignore HTML snapshot without required fields', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:html',
        source: 'podex-devtools',
        payload: {
          html: '<html></html>',
          // Missing url
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.setHtmlSnapshot).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Eval Result Tests
  // ========================================

  describe('Eval Result Events', () => {
    it('should capture eval result', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:eval:result',
        source: 'podex-devtools',
        payload: {
          id: 'eval-001',
          code: 'document.title',
          result: 'Test Page',
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addEvalResult).toHaveBeenCalledWith({
          code: 'document.title',
          result: 'Test Page',
          error: undefined,
          timestamp,
        });
      });
    });

    it('should capture eval error', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const timestamp = Date.now();
      triggerMessage({
        type: 'devtools:eval:result',
        source: 'podex-devtools',
        payload: {
          id: 'eval-002',
          code: 'undefinedVariable',
          result: '',
          error: 'ReferenceError: undefinedVariable is not defined',
        },
        timestamp,
      });

      await waitFor(() => {
        expect(mockStore.addEvalResult).toHaveBeenCalledWith({
          code: 'undefinedVariable',
          result: '',
          error: 'ReferenceError: undefinedVariable is not defined',
          timestamp,
        });
      });
    });

    it('should ignore eval result without required fields', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      triggerMessage({
        type: 'devtools:eval:result',
        source: 'podex-devtools',
        payload: {
          id: 'eval-003',
          // Missing code
          result: 'test',
        },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(mockStore.addEvalResult).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Send Command Tests
  // ========================================

  describe('Send Command', () => {
    it('should send command to iframe', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.sendCommand('getDOMSnapshot');

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'getDOMSnapshot',
          payload: undefined,
        },
        '*'
      );
    });

    it('should send command with payload', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.sendCommand('eval', { id: 'eval-123', code: 'console.log("test")' });

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'eval',
          payload: { id: 'eval-123', code: 'console.log("test")' },
        },
        '*'
      );
    });

    it('should handle missing iframe', () => {
      iframeRef.current = null;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.sendCommand('getDOMSnapshot');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[DevTools] Cannot send command: iframe not available'
      );
      consoleWarnSpy.mockRestore();
    });

    it('should handle missing contentWindow', () => {
      mockIframe.contentWindow = null;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.sendCommand('getDOMSnapshot');

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle postMessage error', () => {
      (mockContentWindow.postMessage as any).mockImplementation(() => {
        throw new Error('PostMessage failed');
      });
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.sendCommand('getDOMSnapshot');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[DevTools] Failed to send command:',
        expect.any(Error)
      );
      consoleWarnSpy.mockRestore();
    });
  });

  // ========================================
  // Request DOM Snapshot Tests
  // ========================================

  describe('Request DOM Snapshot', () => {
    it('should send getDOMSnapshot command', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.requestDOMSnapshot();

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'getDOMSnapshot',
          payload: undefined,
        },
        '*'
      );
    });
  });

  // ========================================
  // Request HTML Tests
  // ========================================

  describe('Request HTML', () => {
    it('should send getHTML command', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.requestHTML();

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'getHTML',
          payload: undefined,
        },
        '*'
      );
    });
  });

  // ========================================
  // Navigate Tests
  // ========================================

  describe('Navigate', () => {
    it('should send navigate command', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.navigate('http://localhost:3000/about');

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'navigate',
          payload: { url: 'http://localhost:3000/about' },
        },
        '*'
      );
    });
  });

  // ========================================
  // Reload Tests
  // ========================================

  describe('Reload', () => {
    it('should send reload command', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      result.current.reload();

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'reload',
          payload: undefined,
        },
        '*'
      );
    });
  });

  // ========================================
  // Eval Code Tests
  // ========================================

  describe('Eval Code', () => {
    it('should send eval command and return ID', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const evalId = result.current.evalCode('document.title');

      expect(evalId).toMatch(/^eval-\d+-[a-z0-9]+$/);
      expect(mockStore.setPendingEvalId).toHaveBeenCalledWith(evalId);
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'devtools:command',
          command: 'eval',
          payload: {
            id: evalId,
            code: 'document.title',
          },
        },
        '*'
      );
    });

    it('should generate unique eval IDs', () => {
      const { result } = renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      const id1 = result.current.evalCode('test1');
      const id2 = result.current.evalCode('test2');

      expect(id1).not.toBe(id2);
    });
  });

  // ========================================
  // Integration Tests
  // ========================================

  describe('Integration Scenarios', () => {
    it('should handle full console logging flow', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      // Simulate multiple console logs
      const logs = ['First log', 'Second log', 'Third log'];

      logs.forEach((log, index) => {
        triggerMessage({
          type: 'devtools:console',
          source: 'podex-devtools',
          payload: {
            level: 'log',
            args: [{ type: 'string', value: log }],
          },
          timestamp: Date.now() + index,
        });
      });

      await waitFor(() => {
        expect(mockStore.addConsoleEntry).toHaveBeenCalledTimes(3);
      });
    });

    it('should handle network request/response flow', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      // Request
      triggerMessage({
        type: 'devtools:network:request',
        source: 'podex-devtools',
        payload: {
          id: 'req-flow',
          url: 'https://api.example.com/data',
          method: 'GET',
          headers: {},
          body: null,
          type: 'fetch',
        },
        timestamp: Date.now(),
      });

      // Response
      triggerMessage({
        type: 'devtools:network:response',
        source: 'podex-devtools',
        payload: {
          id: 'req-flow',
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '{"data":"test"}',
          duration: 100,
        },
        timestamp: Date.now() + 100,
      });

      await waitFor(() => {
        expect(mockStore.addNetworkRequest).toHaveBeenCalled();
        expect(mockStore.updateNetworkRequest).toHaveBeenCalled();
      });
    });

    it('should handle page lifecycle events', async () => {
      renderHook(() => usePreviewDevTools({ iframeRef, workspaceId }));

      // Ready
      triggerMessage({
        type: 'devtools:ready',
        source: 'podex-devtools',
        payload: {
          url: 'http://localhost:3000',
          title: 'Home',
        },
        timestamp: Date.now(),
      });

      // DOM ready
      triggerMessage({
        type: 'devtools:dom:ready',
        source: 'podex-devtools',
        payload: {
          url: 'http://localhost:3000',
        },
        timestamp: Date.now() + 50,
      });

      // Navigation
      triggerMessage({
        type: 'devtools:navigate',
        source: 'podex-devtools',
        payload: {
          url: 'http://localhost:3000/page2',
          title: 'Page 2',
        },
        timestamp: Date.now() + 100,
      });

      await waitFor(() => {
        expect(mockStore.setIframeReady).toHaveBeenCalled();
        expect(mockStore.setCurrentUrl).toHaveBeenCalled();
        expect(mockStore.pushHistory).toHaveBeenCalledTimes(2);
      });
    });
  });
});
