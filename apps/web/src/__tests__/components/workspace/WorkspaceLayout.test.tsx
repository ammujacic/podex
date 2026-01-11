/**
 * Tests for WorkspaceLayout component
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';

// Mock UI store
vi.mock('@/stores/ui', () => ({
  useUIStore: () => ({
    sidebarLayout: {
      left: { collapsed: false, width: 280, panels: [], splitRatio: 0.5 },
      right: { collapsed: false, width: 320, panels: [], splitRatio: 0.5 },
    },
    terminalVisible: true,
    terminalHeight: 200,
  }),
}));

// Mock keybindings hook
vi.mock('@/hooks/useKeybindings', () => ({
  useKeybindings: () => {},
}));

// Mock child components
vi.mock('@/components/workspace/WorkspaceHeader', () => ({
  WorkspaceHeader: ({ sessionId }: { sessionId: string }) => (
    <header data-testid="workspace-header">Header {sessionId}</header>
  ),
}));

vi.mock('@/components/workspace/SidebarContainer', () => ({
  SidebarContainer: ({ side }: { side: string }) => (
    <aside data-testid={`workspace-sidebar-${side}`}>Sidebar {side}</aside>
  ),
}));

vi.mock('@/components/workspace/TerminalPanel', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel">Terminal</div>,
}));

vi.mock('@/components/workspace/FilePreviewLayer', () => ({
  FilePreviewLayer: () => <div data-testid="file-preview-layer">File Preview</div>,
}));

vi.mock('@/components/workspace/ModalLayer', () => ({
  ModalLayer: () => <div data-testid="modal-layer">Modal</div>,
}));

vi.mock('@/components/workspace/LayoutSyncProvider', () => ({
  LayoutSyncProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/workspace/CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette">Command Palette</div>,
}));

vi.mock('@/components/workspace/QuickOpen', () => ({
  QuickOpen: () => <div data-testid="quick-open">Quick Open</div>,
}));

vi.mock('@/components/workspace/NotificationCenter', () => ({
  NotificationCenter: () => <div data-testid="notification-center">Notifications</div>,
}));

describe('WorkspaceLayout', () => {
  it('renders the workspace layout', () => {
    render(
      <WorkspaceLayout sessionId="session-123">
        <div>Main content</div>
      </WorkspaceLayout>
    );
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('contains header', () => {
    render(
      <WorkspaceLayout sessionId="session-123">
        <div>Content</div>
      </WorkspaceLayout>
    );
    expect(screen.getByTestId('workspace-header')).toBeInTheDocument();
  });

  it('contains both sidebars', () => {
    render(
      <WorkspaceLayout sessionId="session-123">
        <div>Content</div>
      </WorkspaceLayout>
    );
    expect(screen.getByTestId('workspace-sidebar-left')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-sidebar-right')).toBeInTheDocument();
  });

  it('contains terminal panel', () => {
    render(
      <WorkspaceLayout sessionId="session-123">
        <div>Content</div>
      </WorkspaceLayout>
    );
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('renders children in main content area', () => {
    render(
      <WorkspaceLayout sessionId="session-123">
        <div>Main content</div>
      </WorkspaceLayout>
    );
    expect(screen.getByText('Main content')).toBeInTheDocument();
  });

  it('passes sessionId to header', () => {
    render(
      <WorkspaceLayout sessionId="test-session">
        <div>Content</div>
      </WorkspaceLayout>
    );
    expect(screen.getByText(/test-session/)).toBeInTheDocument();
  });
});
