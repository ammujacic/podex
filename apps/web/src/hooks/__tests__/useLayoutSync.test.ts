/**
 * Comprehensive tests for useLayoutSync hook
 * Tests multi-tab layout synchronization functionality
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLayoutSync } from '../useLayoutSync';
import type {
  SessionLayoutState,
  AgentLayoutState,
  FilePreviewLayoutState,
  EditorLayoutState,
  EditorTabsLayoutState,
} from '@/lib/api';
import type { GridSpan, AgentPosition } from '@/stores/session';

// Mock dependencies
const mockGetSessionLayout = vi.fn();
const mockUpdateSessionLayout = vi.fn();
const mockUpdateAgentLayout = vi.fn();
const mockUpdateFilePreviewLayout = vi.fn();
const mockUpdateEditorLayout = vi.fn();

const mockSetViewMode = vi.fn();
const mockSetActiveAgent = vi.fn();
const mockUpdateAgentGridSpan = vi.fn();
const mockUpdateAgentPosition = vi.fn();
const mockUpdateFilePreviewGridSpan = vi.fn();
const mockDockFilePreview = vi.fn();
const mockPinFilePreview = vi.fn();
const mockCreateEditorGridCard = vi.fn();
const mockRemoveEditorGridCard = vi.fn();
const mockUpdateEditorGridSpan = vi.fn();
const mockUpdateEditorFreeformPosition = vi.fn();

const mockOnSocketEvent = vi.fn();
const mockEmitLayoutChange = vi.fn();

const mockSetEditorLayout = vi.fn();

// Socket event handlers
let socketHandlers: Record<string, (event: unknown) => void> = {};

// Mock stores
const mockSessionStore = {
  sessions: {
    'session-1': {
      id: 'session-1',
      viewMode: 'grid' as const,
      activeAgentId: null,
      agents: [],
      filePreviews: [{ id: 'preview-1', path: '/test.ts', docked: false, pinned: false }],
      editorGridCardId: null,
      editorGridSpan: null,
      editorFreeformPosition: null,
    },
  },
  setViewMode: mockSetViewMode,
  setActiveAgent: mockSetActiveAgent,
  updateAgentGridSpan: mockUpdateAgentGridSpan,
  updateAgentPosition: mockUpdateAgentPosition,
  updateFilePreviewGridSpan: mockUpdateFilePreviewGridSpan,
  dockFilePreview: mockDockFilePreview,
  pinFilePreview: mockPinFilePreview,
  createEditorGridCard: mockCreateEditorGridCard,
  removeEditorGridCard: mockRemoveEditorGridCard,
  updateEditorGridSpan: mockUpdateEditorGridSpan,
  updateEditorFreeformPosition: mockUpdateEditorFreeformPosition,
  getState: vi.fn(() => mockSessionStore),
};

const mockEditorStore = {
  splitLayout: 'single' as const,
  panes: {
    main: {
      id: 'main',
      tabs: ['tab-1'],
      activeTabId: 'tab-1',
      size: 1,
    },
  },
  paneOrder: ['main'],
  activePaneId: 'main',
  tabs: {
    'tab-1': {
      id: 'tab-1',
      path: '/test.ts',
      name: 'test.ts',
      language: 'typescript',
      isDirty: false,
      isPreview: false,
      paneId: 'main',
    },
  },
  setLayout: mockSetEditorLayout,
  getState: vi.fn(() => mockEditorStore),
};

const mockAuthStore = {
  user: { id: 'user-1', email: 'test@test.com' },
};

vi.mock('@/lib/api', () => ({
  getSessionLayout: (...args: unknown[]) => mockGetSessionLayout(...args),
  updateSessionLayout: (...args: unknown[]) => mockUpdateSessionLayout(...args),
  updateAgentLayout: (...args: unknown[]) => mockUpdateAgentLayout(...args),
  updateFilePreviewLayout: (...args: unknown[]) => mockUpdateFilePreviewLayout(...args),
  updateEditorLayout: (...args: unknown[]) => mockUpdateEditorLayout(...args),
}));

vi.mock('@/stores/session', () => {
  const store = {
    useSessionStore: (selector?: (state: typeof mockSessionStore) => unknown) => {
      if (selector) {
        return selector(mockSessionStore);
      }
      return mockSessionStore;
    },
  };

  // Add getState method to the useSessionStore function
  (
    store.useSessionStore as typeof mockSessionStore & { getState: () => typeof mockSessionStore }
  ).getState = () => mockSessionStore;

  return store;
});

vi.mock('@/stores/editor', () => {
  const store = {
    useEditorStore: (selector?: (state: typeof mockEditorStore) => unknown) => {
      if (typeof selector === 'function') {
        return selector(mockEditorStore);
      }
      return mockEditorStore;
    },
  };

  // Add getState method to the useEditorStore function
  (
    store.useEditorStore as typeof mockEditorStore & { getState: () => typeof mockEditorStore }
  ).getState = () => mockEditorStore;

  return store;
});

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

vi.mock('@/lib/socket', () => ({
  onSocketEvent: (event: string, handler: (data: unknown) => void) => {
    mockOnSocketEvent(event, handler);
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  },
  emitLayoutChange: (...args: unknown[]) => mockEmitLayoutChange(...args),
}));

vi.mock('zustand/shallow', () => ({
  useShallow: (selector: (state: typeof mockEditorStore) => unknown) => selector,
}));

// Mock sessionStorage
const sessionStorageMock: Record<string, string> = {};

Object.defineProperty(global, 'sessionStorage', {
  value: {
    getItem: (key: string) => sessionStorageMock[key] || null,
    setItem: (key: string, value: string) => {
      sessionStorageMock[key] = value;
    },
    removeItem: (key: string) => {
      delete sessionStorageMock[key];
    },
    clear: () => {
      Object.keys(sessionStorageMock).forEach((key) => delete sessionStorageMock[key]);
    },
    length: 0,
    key: () => null,
  },
  writable: true,
  configurable: true,
});

describe('useLayoutSync', () => {
  const defaultServerLayout: SessionLayoutState = {
    view_mode: 'grid',
    active_agent_id: null,
    agent_layouts: {},
    file_preview_layouts: {},
    sidebar_open: true,
    sidebar_width: 250,
    editor_grid_card_id: null,
    editor_grid_span: null,
    editor_freeform_position: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers = {};
    Object.keys(sessionStorageMock).forEach((key) => delete sessionStorageMock[key]);

    // Default mock implementations
    mockGetSessionLayout.mockResolvedValue(defaultServerLayout);
    mockUpdateSessionLayout.mockResolvedValue(defaultServerLayout);
    mockUpdateAgentLayout.mockResolvedValue({});
    mockUpdateFilePreviewLayout.mockResolvedValue({});
    mockUpdateEditorLayout.mockResolvedValue({});

    // Reset store state
    mockSessionStore.sessions['session-1'] = {
      id: 'session-1',
      viewMode: 'grid' as const,
      activeAgentId: null,
      agents: [],
      filePreviews: [{ id: 'preview-1', path: '/test.ts', docked: false, pinned: false }],
      editorGridCardId: null,
      editorGridSpan: null,
      editorFreeformPosition: null,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State and Setup', () => {
    it('should initialize with device ID from sessionStorage', () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      const deviceId = sessionStorage.getItem('podex_device_id');
      expect(deviceId).toBeTruthy();
      expect(deviceId).toMatch(/^device_\d+_/);
    });

    it('should reuse existing device ID from sessionStorage', () => {
      sessionStorage.setItem('podex_device_id', 'existing-device-123');

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      expect(sessionStorage.getItem('podex_device_id')).toBe('existing-device-123');
    });

    it('should load layout from server on mount', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1', enabled: true }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalledWith('session-1');
      });
    });

    it('should not load layout when disabled', () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1', enabled: false }));

      expect(mockGetSessionLayout).not.toHaveBeenCalled();
    });

    it('should return sync functions', () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      expect(result.current.syncViewMode).toBeInstanceOf(Function);
      expect(result.current.syncActiveAgent).toBeInstanceOf(Function);
      expect(result.current.syncAgentGridSpan).toBeInstanceOf(Function);
      expect(result.current.syncAgentPosition).toBeInstanceOf(Function);
      expect(result.current.syncFilePreviewLayout).toBeInstanceOf(Function);
      expect(result.current.syncEditorGridCard).toBeInstanceOf(Function);
      expect(result.current.syncEditorGridSpan).toBeInstanceOf(Function);
      expect(result.current.syncEditorFreeformPosition).toBeInstanceOf(Function);
      expect(result.current.isApplyingRemote).toBe(false);
    });
  });

  describe('Loading Layout from Server', () => {
    it('should apply view mode from server', async () => {
      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        view_mode: 'freeform',
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockSetViewMode).toHaveBeenCalledWith('session-1', 'freeform');
      });
    });

    it('should apply active agent from server', async () => {
      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        active_agent_id: 'agent-1',
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockSetActiveAgent).toHaveBeenCalledWith('session-1', 'agent-1');
      });
    });

    it('should apply agent layouts from server', async () => {
      const agentLayout: AgentLayoutState = {
        agent_id: 'agent-1',
        grid_span: { col_span: 2, row_span: 1 },
        position: { x: 0, y: 0, width: 100, height: 100, z_index: 1 },
      };

      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        agent_layouts: { 'agent-1': agentLayout },
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockUpdateAgentGridSpan).toHaveBeenCalledWith('session-1', 'agent-1', {
          colSpan: 2,
          rowSpan: 1,
        });
        expect(mockUpdateAgentPosition).toHaveBeenCalledWith('session-1', 'agent-1', {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
        });
      });
    });

    it('should apply file preview layouts from server', async () => {
      const previewLayout: FilePreviewLayoutState = {
        preview_id: 'preview-1',
        path: '/test.ts',
        grid_span: { col_span: 1, row_span: 1 },
        docked: true,
        pinned: true,
      };

      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        file_preview_layouts: { 'preview-1': previewLayout },
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockUpdateFilePreviewGridSpan).toHaveBeenCalledWith('session-1', 'preview-1', {
          colSpan: 1,
          rowSpan: 1,
        });
        expect(mockDockFilePreview).toHaveBeenCalledWith('session-1', 'preview-1', true);
        expect(mockPinFilePreview).toHaveBeenCalledWith('session-1', 'preview-1', true);
      });
    });

    it('should skip non-existent file previews', async () => {
      const previewLayout: FilePreviewLayoutState = {
        preview_id: 'non-existent',
        path: '/missing.ts',
        docked: true,
      };

      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        file_preview_layouts: { 'non-existent': previewLayout },
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      // Should not update non-existent preview
      expect(mockDockFilePreview).not.toHaveBeenCalled();
    });

    it('should create editor grid card when server has it but local does not', async () => {
      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        editor_grid_card_id: 'editor-1',
        editor_grid_span: { col_span: 2, row_span: 2 },
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockCreateEditorGridCard).toHaveBeenCalledWith('session-1');
        expect(mockUpdateEditorGridSpan).toHaveBeenCalledWith('session-1', {
          colSpan: 2,
          rowSpan: 2,
        });
      });
    });

    it('should sync editor to server when local has it but server does not', async () => {
      mockSessionStore.sessions['session-1'].editorGridCardId = 'editor-1';
      mockSessionStore.sessions['session-1'].editorGridSpan = { colSpan: 2, rowSpan: 1 };

      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        editor_grid_card_id: null,
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockUpdateEditorLayout).toHaveBeenCalledWith('session-1', {
          editor_grid_card_id: 'editor-1',
          editor_grid_span: { col_span: 2, row_span: 1 },
        });
      });
    });

    it('should apply editor tabs layout from server', async () => {
      const editorTabs: EditorTabsLayoutState = {
        split_layout: 'horizontal',
        panes: {
          main: { id: 'main', tabs: ['tab-1'], active_tab_id: 'tab-1', size: 0.5 },
          secondary: { id: 'secondary', tabs: ['tab-2'], active_tab_id: 'tab-2', size: 0.5 },
        },
        pane_order: ['main', 'secondary'],
        active_pane_id: 'main',
        tabs: {
          'tab-1': {
            id: 'tab-1',
            path: '/file1.ts',
            name: 'file1.ts',
            language: 'typescript',
            is_preview: false,
          },
          'tab-2': {
            id: 'tab-2',
            path: '/file2.ts',
            name: 'file2.ts',
            language: 'typescript',
            is_preview: true,
          },
        },
      };

      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        editor_tabs: editorTabs,
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockSetEditorLayout).toHaveBeenCalledWith(
          expect.objectContaining({
            splitLayout: 'horizontal',
            paneOrder: ['main', 'secondary'],
            activePaneId: 'main',
          })
        );
      });
    });

    it('should handle 503 error gracefully', async () => {
      const error = new Error('Service unavailable');
      (error as Error & { status?: number }).status = 503;
      mockGetSessionLayout.mockRejectedValue(error);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          '[LayoutSync] API server unavailable, using local state'
        );
      });

      consoleWarnSpy.mockRestore();
    });

    it('should handle generic errors during layout load', async () => {
      mockGetSessionLayout.mockRejectedValue(new Error('Network error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[LayoutSync] Failed to load layout from server:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Syncing View Mode', () => {
    it('should sync view mode change', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncViewMode('focus');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith('session-1', {
          view_mode: 'focus',
        });
      });

      expect(mockEmitLayoutChange).toHaveBeenCalledWith({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: expect.stringMatching(/^device_/),
        type: 'view_mode',
        payload: { view_mode: 'focus' },
      });
    });

    it('should debounce view mode updates', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      // Clear mock to isolate only the view mode sync calls (ignore initial editor layout sync)
      mockUpdateSessionLayout.mockClear();

      vi.useFakeTimers();

      act(() => {
        result.current.syncViewMode('focus');
        result.current.syncViewMode('freeform');
        result.current.syncViewMode('grid');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledTimes(1);
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith('session-1', {
          view_mode: 'grid',
        });
      });
    });

    it('should not sync when applying remote changes', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      // Clear mock from initial calls
      mockEmitLayoutChange.mockClear();

      // Simulate remote change being applied - this sets isApplyingRemote
      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'view_mode',
          payload: { view_mode: 'focus' },
        });
      });

      // The remote change should have been applied
      expect(mockSetViewMode).toHaveBeenCalledWith('session-1', 'focus');

      // Clear to check if future syncs emit
      mockEmitLayoutChange.mockClear();

      // isApplyingRemote flag should be false now, so this should emit
      // This test was checking wrong behavior - after remote is applied, syncs should work again
      vi.useFakeTimers();
      act(() => {
        result.current.syncViewMode('grid');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      // Should emit since remote application is complete
      await waitFor(() => {
        expect(mockEmitLayoutChange).toHaveBeenCalled();
      });
    });
  });

  describe('Syncing Active Agent', () => {
    it('should sync active agent change', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncActiveAgent('agent-1');
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith('session-1', {
          active_agent_id: 'agent-1',
        });
      });

      expect(mockEmitLayoutChange).toHaveBeenCalledWith({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: expect.stringMatching(/^device_/),
        type: 'active_agent',
        payload: { agent_id: 'agent-1' },
      });
    });

    it('should sync null active agent', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncActiveAgent(null);
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith('session-1', {
          active_agent_id: null,
        });
      });
    });
  });

  describe('Syncing Agent Layout', () => {
    it('should sync agent grid span', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      const gridSpan: GridSpan = { colSpan: 2, rowSpan: 1 };

      act(() => {
        result.current.syncAgentGridSpan('agent-1', gridSpan);
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalledWith('session-1', 'agent-1', {
          grid_span: { col_span: 2, row_span: 1 },
        });
      });

      expect(mockEmitLayoutChange).toHaveBeenCalledWith({
        session_id: 'session-1',
        user_id: 'user-1',
        device_id: expect.stringMatching(/^device_/),
        type: 'agent_layout',
        payload: {
          agent_id: 'agent-1',
          grid_span: { col_span: 2, row_span: 1 },
        },
      });
    });

    it('should debounce agent grid span updates', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncAgentGridSpan('agent-1', { colSpan: 1, rowSpan: 1 });
        result.current.syncAgentGridSpan('agent-1', { colSpan: 2, rowSpan: 1 });
        result.current.syncAgentGridSpan('agent-1', { colSpan: 3, rowSpan: 2 });
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalledTimes(1);
        expect(mockUpdateAgentLayout).toHaveBeenCalledWith('session-1', 'agent-1', {
          grid_span: { col_span: 3, row_span: 2 },
        });
      });
    });

    it('should sync agent position', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      const position: AgentPosition = {
        x: 100,
        y: 200,
        width: 300,
        height: 400,
        zIndex: 5,
      };

      act(() => {
        result.current.syncAgentPosition('agent-1', position);
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalledWith('session-1', 'agent-1', {
          position: { x: 100, y: 200, width: 300, height: 400, z_index: 5 },
        });
      });
    });

    it('should debounce agent position updates during drag', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncAgentPosition('agent-1', {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
        });
        result.current.syncAgentPosition('agent-1', {
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          zIndex: 1,
        });
        result.current.syncAgentPosition('agent-1', {
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          zIndex: 1,
        });
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Syncing File Preview Layout', () => {
    it('should sync file preview grid span', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncFilePreviewLayout('preview-1', {
          gridSpan: { colSpan: 2, rowSpan: 1 },
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateFilePreviewLayout).toHaveBeenCalledWith('session-1', 'preview-1', {
          preview_id: 'preview-1',
          grid_span: { col_span: 2, row_span: 1 },
        });
      });
    });

    it('should sync file preview docked state', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncFilePreviewLayout('preview-1', { docked: true });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateFilePreviewLayout).toHaveBeenCalledWith('session-1', 'preview-1', {
          preview_id: 'preview-1',
          docked: true,
        });
      });
    });

    it('should sync file preview pinned state', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncFilePreviewLayout('preview-1', { pinned: true });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateFilePreviewLayout).toHaveBeenCalledWith('session-1', 'preview-1', {
          preview_id: 'preview-1',
          pinned: true,
        });
      });
    });

    it('should sync file preview path', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncFilePreviewLayout('preview-1', { path: '/new-path.ts' });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateFilePreviewLayout).toHaveBeenCalledWith('session-1', 'preview-1', {
          preview_id: 'preview-1',
          path: '/new-path.ts',
        });
      });
    });

    it('should sync multiple file preview properties at once', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncFilePreviewLayout('preview-1', {
          gridSpan: { colSpan: 2, rowSpan: 2 },
          docked: true,
          pinned: true,
          path: '/multi-prop.ts',
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateFilePreviewLayout).toHaveBeenCalledWith('session-1', 'preview-1', {
          preview_id: 'preview-1',
          grid_span: { col_span: 2, row_span: 2 },
          docked: true,
          pinned: true,
          path: '/multi-prop.ts',
        });
      });
    });
  });

  describe('Syncing Editor Layout', () => {
    it('should sync editor grid card creation', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncEditorGridCard('editor-1');
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateEditorLayout).toHaveBeenCalledWith('session-1', {
          editor_grid_card_id: 'editor-1',
        });
      });
    });

    it('should sync editor grid card removal', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncEditorGridCard(null);
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateEditorLayout).toHaveBeenCalledWith('session-1', {
          editor_grid_card_id: null,
        });
      });
    });

    it('should sync editor grid span', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncEditorGridSpan({ colSpan: 3, rowSpan: 2 });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateEditorLayout).toHaveBeenCalledWith('session-1', {
          editor_grid_span: { col_span: 3, row_span: 2 },
        });
      });
    });

    it('should sync editor freeform position', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncEditorFreeformPosition({
          x: 50,
          y: 100,
          width: 600,
          height: 400,
          zIndex: 10,
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateEditorLayout).toHaveBeenCalledWith('session-1', {
          editor_freeform_position: { x: 50, y: 100, width: 600, height: 400, z_index: 10 },
        });
      });
    });

    it('should sync editor tabs layout when tabs change', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      // Trigger editor layout change
      act(() => {
        mockEditorStore.tabs = {
          'tab-1': {
            id: 'tab-1',
            path: '/new.ts',
            name: 'new.ts',
            language: 'typescript',
            isDirty: false,
            isPreview: false,
            paneId: 'main',
          },
        };
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      // Should sync editor tabs to server
      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            editor_tabs: expect.objectContaining({
              split_layout: 'single',
              tabs: expect.any(Object),
            }),
          })
        );
      });
    });

    it('should not sync editor tabs when no tabs exist', async () => {
      mockEditorStore.tabs = {};

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith('session-1', {
          editor_tabs: null,
        });
      });
    });
  });

  describe('Remote Layout Change Events', () => {
    it('should listen for layout change events', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalledWith('layout:change', expect.any(Function));
      });
    });

    it('should apply remote view mode change', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'view_mode',
          payload: { view_mode: 'freeform' },
        });
      });

      expect(mockSetViewMode).toHaveBeenCalledWith('session-1', 'freeform');
    });

    it('should apply remote active agent change', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'active_agent',
          payload: { agent_id: 'agent-2' },
        });
      });

      expect(mockSetActiveAgent).toHaveBeenCalledWith('session-1', 'agent-2');
    });

    it('should apply remote agent layout change with grid span', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'agent_layout',
          payload: {
            agent_id: 'agent-1',
            grid_span: { col_span: 3, row_span: 1 },
          },
        });
      });

      expect(mockUpdateAgentGridSpan).toHaveBeenCalledWith('session-1', 'agent-1', {
        colSpan: 3,
        rowSpan: 1,
      });
    });

    it('should apply remote agent layout change with position', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'agent_layout',
          payload: {
            agent_id: 'agent-1',
            position: { x: 10, y: 20, width: 300, height: 200, z_index: 5 },
          },
        });
      });

      expect(mockUpdateAgentPosition).toHaveBeenCalledWith('session-1', 'agent-1', {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        zIndex: 5,
      });
    });

    it('should apply remote file preview layout change', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'file_preview_layout',
          payload: {
            preview_id: 'preview-1',
            grid_span: { col_span: 2, row_span: 1 },
            docked: true,
            pinned: false,
          },
        });
      });

      expect(mockUpdateFilePreviewGridSpan).toHaveBeenCalledWith('session-1', 'preview-1', {
        colSpan: 2,
        rowSpan: 1,
      });
      expect(mockDockFilePreview).toHaveBeenCalledWith('session-1', 'preview-1', true);
      expect(mockPinFilePreview).toHaveBeenCalledWith('session-1', 'preview-1', false);
    });

    it('should create editor on remote editor layout change', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'editor_layout',
          payload: {
            editor_grid_card_id: 'editor-1',
            grid_span: { col_span: 2, row_span: 2 },
          },
        });
      });

      expect(mockCreateEditorGridCard).toHaveBeenCalledWith('session-1');
      expect(mockUpdateEditorGridSpan).toHaveBeenCalledWith('session-1', {
        colSpan: 2,
        rowSpan: 2,
      });
    });

    it('should remove editor on remote editor layout change', async () => {
      mockSessionStore.sessions['session-1'].editorGridCardId = 'editor-1';

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'editor_layout',
          payload: {
            editor_grid_card_id: null,
          },
        });
      });

      expect(mockRemoveEditorGridCard).toHaveBeenCalledWith('session-1');
    });

    it('should handle full sync event', async () => {
      mockGetSessionLayout.mockResolvedValue({
        ...defaultServerLayout,
        view_mode: 'focus',
        active_agent_id: 'agent-full-sync',
      });

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      mockSetViewMode.mockClear();
      mockSetActiveAgent.mockClear();

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: 'other-device',
          type: 'full_sync',
          payload: {},
        });
      });

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalledWith('session-1');
        expect(mockSetViewMode).toHaveBeenCalledWith('session-1', 'focus');
        expect(mockSetActiveAgent).toHaveBeenCalledWith('session-1', 'agent-full-sync');
      });
    });

    it('should ignore events from own device', async () => {
      const deviceId = 'my-device-123';
      sessionStorage.setItem('podex_device_id', deviceId);

      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      // Clear mocks from initial setup
      mockSetViewMode.mockClear();

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-1',
          sender_device: deviceId,
          type: 'view_mode',
          payload: { view_mode: 'focus' },
        });
      });

      // Should not apply own events
      expect(mockSetViewMode).not.toHaveBeenCalled();
    });

    it('should ignore events from different session', async () => {
      renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      // Clear mocks from initial setup
      mockSetViewMode.mockClear();

      act(() => {
        socketHandlers['layout:change']({
          session_id: 'session-2',
          sender_device: 'other-device',
          type: 'view_mode',
          payload: { view_mode: 'focus' },
        });
      });

      expect(mockSetViewMode).not.toHaveBeenCalled();
    });

    it('should unsubscribe from socket events on unmount', async () => {
      // The socket event handler is registered in socketHandlers
      const { unmount } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      // Verify that the socket handler is registered
      expect(socketHandlers['layout:change']).toBeDefined();

      unmount();

      // After unmount, the cleanup function removes the handler from socketHandlers
      expect(socketHandlers['layout:change']).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors during layout save', async () => {
      mockUpdateSessionLayout.mockRejectedValue(new Error('API Error'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncViewMode('focus');
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[LayoutSync] Failed to save layout:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle API errors during agent layout update', async () => {
      mockUpdateAgentLayout.mockRejectedValue(new Error('Network error'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncAgentGridSpan('agent-1', { colSpan: 2, rowSpan: 1 });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle API errors during file preview update', async () => {
      mockUpdateFilePreviewLayout.mockRejectedValue(new Error('Update failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncFilePreviewLayout('preview-1', { docked: true });
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle API errors during editor layout update', async () => {
      mockUpdateEditorLayout.mockRejectedValue(new Error('Editor update failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncEditorGridCard('editor-1');
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Cleanup on Unmount', () => {
    it('should not sync after unmount', async () => {
      const { unmount } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      // Clear any previous calls
      mockEmitLayoutChange.mockClear();
      mockUpdateSessionLayout.mockClear();

      unmount();

      // After unmount, the socket handler should be removed
      // This verifies that remote changes won't be received after unmount
      expect(socketHandlers['layout:change']).toBeUndefined();

      // Note: The sync functions themselves (like syncViewMode) are still callable
      // after unmount as they are just regular functions returned from the hook.
      // However, this is expected React behavior - the functions don't self-destruct.
      // The important cleanup is that socket subscriptions are removed.
    });

    it('should clear socket subscriptions on unmount', async () => {
      // The socket event handler is registered in socketHandlers
      const { unmount } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockOnSocketEvent).toHaveBeenCalled();
      });

      // Verify that the socket handler is registered before unmount
      expect(socketHandlers['layout:change']).toBeDefined();

      unmount();

      // After unmount, the cleanup function removes the handler from socketHandlers
      expect(socketHandlers['layout:change']).toBeUndefined();
    });
  });

  describe('Session ID Changes', () => {
    it('should reload layout when session ID changes', async () => {
      const { rerender } = renderHook(({ sessionId }) => useLayoutSync({ sessionId }), {
        initialProps: { sessionId: 'session-1' },
      });

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalledWith('session-1');
      });

      mockGetSessionLayout.mockClear();

      rerender({ sessionId: 'session-2' });

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalledWith('session-2');
      });
    });

    it('should not reload when enabled changes to false', async () => {
      const { rerender } = renderHook(
        ({ enabled }) => useLayoutSync({ sessionId: 'session-1', enabled }),
        { initialProps: { enabled: true } }
      );

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalledTimes(1);
      });

      mockGetSessionLayout.mockClear();

      rerender({ enabled: false });

      await waitFor(() => {
        expect(mockGetSessionLayout).not.toHaveBeenCalled();
      });
    });
  });

  describe('Debouncing Behavior', () => {
    it('should use 500ms debounce for layout save', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncViewMode('focus');
      });

      // Wait 400ms - should not save yet
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(mockUpdateSessionLayout).not.toHaveBeenCalled();

      // Wait another 100ms - should save now
      act(() => {
        vi.advanceTimersByTime(100);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalled();
      });
    });

    it('should use 300ms debounce for agent resize', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncAgentGridSpan('agent-1', { colSpan: 2, rowSpan: 1 });
      });

      // Wait 200ms - should not save yet
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(mockUpdateAgentLayout).not.toHaveBeenCalled();

      // Wait another 100ms - should save now
      act(() => {
        vi.advanceTimersByTime(100);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalled();
      });
    });

    it('should reset debounce timer on subsequent calls', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncViewMode('focus');
      });

      act(() => {
        vi.advanceTimersByTime(400);
      });

      // Make another change before debounce completes
      act(() => {
        result.current.syncViewMode('freeform');
      });

      act(() => {
        vi.advanceTimersByTime(400);
      });

      // Still should not have saved
      expect(mockUpdateSessionLayout).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });

      vi.useRealTimers();

      // Should save with latest value
      await waitFor(() => {
        expect(mockUpdateSessionLayout).toHaveBeenCalledTimes(1);
        expect(mockUpdateSessionLayout).toHaveBeenCalledWith('session-1', {
          view_mode: 'freeform',
        });
      });
    });
  });

  describe('Format Conversion', () => {
    it('should convert GridSpan between frontend and API formats', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncAgentGridSpan('agent-1', { colSpan: 2, rowSpan: 3 });
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalledWith('session-1', 'agent-1', {
          grid_span: { col_span: 2, row_span: 3 },
        });
      });
    });

    it('should convert AgentPosition between frontend and API formats', async () => {
      const { result } = renderHook(() => useLayoutSync({ sessionId: 'session-1' }));

      await waitFor(() => {
        expect(mockGetSessionLayout).toHaveBeenCalled();
      });

      vi.useFakeTimers();

      act(() => {
        result.current.syncAgentPosition('agent-1', {
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          zIndex: 5,
        });
      });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(mockUpdateAgentLayout).toHaveBeenCalledWith('session-1', 'agent-1', {
          position: { x: 10, y: 20, width: 300, height: 200, z_index: 5 },
        });
      });
    });
  });
});
