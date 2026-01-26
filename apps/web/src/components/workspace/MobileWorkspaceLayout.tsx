'use client';

import { useState, useCallback, useMemo, Component, type ReactNode } from 'react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { MobileWorkspaceHeader } from './MobileWorkspaceHeader';
import { MobileSessionOverview } from './MobileSessionOverview';
import { MobileAgentView } from './MobileAgentView';
import { MobileWidgetSheet, type WidgetId } from './MobileWidgetSheet';
import { MobileFileViewerSheet } from './MobileFileViewerSheet';
import {
  Bug,
  FolderTree,
  GitBranch,
  Github,
  Search,
  AlertCircle,
  Bot,
  Puzzle,
  BarChart3,
  Terminal,
  RefreshCw,
  Globe,
} from 'lucide-react';

// Error boundary for agent view to prevent crashes from taking down the whole layout
interface AgentViewErrorBoundaryProps {
  children: ReactNode;
  agentName?: string;
  onReset?: () => void;
}

interface AgentViewErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class AgentViewErrorBoundary extends Component<
  AgentViewErrorBoundaryProps,
  AgentViewErrorBoundaryState
> {
  constructor(props: AgentViewErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): AgentViewErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AgentView error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <AlertCircle className="h-12 w-12 text-status-error mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            {this.props.agentName
              ? `${this.props.agentName} encountered an error`
              : 'Something went wrong'}
          </h3>
          <p className="text-sm text-text-secondary mb-4 max-w-xs">
            {this.state.error?.message ||
              'An unexpected error occurred while rendering this agent.'}
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-accent-primary text-text-inverse rounded-lg hover:bg-accent-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Lazy imports for widget content
import { FilesPanel } from './FilesPanel';
import { GitPanel } from './GitPanel';
import { GitHubWidget } from './GitHubWidget';
import { SearchPanel } from './SearchPanel';
import { DiagnosticsSidebarPanel } from './DiagnosticsSidebarPanel';
import { AgentsPanel } from './AgentsPanel';
import { MCPPanel } from './MCPPanel';
import { UsageSidebarPanel } from './UsageSidebarPanel';
import { TerminalPanel } from './TerminalPanel';
import { SentryPanel } from './SentryPanel';
import { PreviewPanel } from './PreviewPanel';

interface MobileWorkspaceLayoutProps {
  sessionId: string;
}

type MobileView = 'overview' | 'agent';

export function MobileWorkspaceLayout({ sessionId }: MobileWorkspaceLayoutProps) {
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const agents = useMemo(() => session?.agents ?? [], [session?.agents]);
  const localPodId = session?.localPodId;
  const mountPath = session?.mount_path;

  // View state - start with overview
  const [currentView, setCurrentView] = useState<MobileView>('overview');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  // Mobile widget state from UI store
  const mobileActiveWidget = useUIStore((state) => state.mobileActiveWidget);
  const closeMobileWidget = useUIStore((state) => state.closeMobileWidget);

  // Navigate to agent view
  const handleAgentSelect = useCallback((agentId: string) => {
    setActiveAgentId(agentId);
    setCurrentView('agent');
  }, []);

  // Navigate back to overview
  const handleBackToOverview = useCallback(() => {
    setCurrentView('overview');
  }, []);

  // Swipe handlers for agent navigation within agent view
  const handleSwipeLeft = useCallback(() => {
    if (!activeAgentId) return;
    const currentIndex = agents.findIndex((a) => a.id === activeAgentId);
    if (currentIndex < agents.length - 1) {
      setActiveAgentId(agents[currentIndex + 1]?.id ?? null);
    }
  }, [agents, activeAgentId]);

  const handleSwipeRight = useCallback(() => {
    if (!activeAgentId) return;
    const currentIndex = agents.findIndex((a) => a.id === activeAgentId);
    if (currentIndex > 0) {
      setActiveAgentId(agents[currentIndex - 1]?.id ?? null);
    }
  }, [agents, activeAgentId]);

  // Add agent handler - opens the create agent modal directly
  const handleAddAgent = useCallback(() => {
    const openModal = useUIStore.getState().openModal;
    openModal('create-agent');
  }, []);

  // Widget configuration - all widgets open full by default, users can drag to resize
  const widgetConfig: Record<
    WidgetId,
    { title: string; icon: React.ReactNode; height: 'half' | 'full'; component: React.ReactNode }
  > = {
    files: {
      title: 'Files',
      icon: <FolderTree className="h-5 w-5" />,
      height: 'full',
      component: (
        <FilesPanel sessionId={sessionId} localPodId={localPodId} workingDir={mountPath} />
      ),
    },
    git: {
      title: 'Git',
      icon: <GitBranch className="h-5 w-5" />,
      height: 'full',
      component: <GitPanel sessionId={sessionId} localPodId={localPodId} mountPath={mountPath} />,
    },
    github: {
      title: 'GitHub',
      icon: <Github className="h-5 w-5" />,
      height: 'full',
      component: <GitHubWidget sessionId={sessionId} />,
    },
    search: {
      title: 'Search',
      icon: <Search className="h-5 w-5" />,
      height: 'full',
      component: <SearchPanel sessionId={sessionId} />,
    },
    problems: {
      title: 'Problems',
      icon: <AlertCircle className="h-5 w-5" />,
      height: 'full',
      component: <DiagnosticsSidebarPanel sessionId={sessionId} />,
    },
    agents: {
      title: 'Agents',
      icon: <Bot className="h-5 w-5" />,
      height: 'full',
      component: <AgentsPanel sessionId={sessionId} />,
    },
    mcp: {
      title: 'MCP Integrations',
      icon: <Puzzle className="h-5 w-5" />,
      height: 'full',
      component: <MCPPanel sessionId={sessionId} />,
    },
    extensions: {
      title: 'Extensions',
      icon: <Puzzle className="h-5 w-5" />,
      height: 'full',
      component: <div className="p-4 text-text-secondary">Extensions coming soon</div>,
    },
    usage: {
      title: 'Usage',
      icon: <BarChart3 className="h-5 w-5" />,
      height: 'full',
      component: <UsageSidebarPanel sessionId={sessionId} />,
    },
    terminal: {
      title: 'Terminal',
      icon: <Terminal className="h-5 w-5" />,
      height: 'full',
      component: (
        <div className="h-full">
          <TerminalPanel sessionId={sessionId} />
        </div>
      ),
    },
    sentry: {
      title: 'Sentry',
      icon: <Bug className="h-5 w-5" />,
      height: 'full',
      component: <SentryPanel sessionId={sessionId} />,
    },
    preview: {
      title: 'Preview',
      icon: <Globe className="h-5 w-5" />,
      height: 'full',
      component: session?.workspaceId ? (
        <PreviewPanel workspaceId={session.workspaceId} onClose={closeMobileWidget} />
      ) : (
        <div className="p-4 text-text-secondary">
          Workspace not available. Please wait for the workspace to initialize.
        </div>
      ),
    },
  };

  const activeWidget = mobileActiveWidget as WidgetId | null;
  const widgetInfo = activeWidget ? widgetConfig[activeWidget] : null;

  // Get current agent name for header
  const currentAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) : null;

  return (
    <div className="flex flex-col h-dvh bg-void md:hidden">
      {/* Header */}
      <MobileWorkspaceHeader
        sessionId={sessionId}
        showBackButton={currentView === 'agent'}
        onBack={handleBackToOverview}
        subtitle={currentView === 'agent' && currentAgent ? currentAgent.name : undefined}
        agentRole={currentView === 'agent' && currentAgent ? currentAgent.role : undefined}
      />

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {currentView === 'overview' ? (
          <MobileSessionOverview
            sessionId={sessionId}
            onAgentSelect={handleAgentSelect}
            onAddAgent={handleAddAgent}
          />
        ) : activeAgentId ? (
          <AgentViewErrorBoundary
            key={activeAgentId}
            agentName={currentAgent?.name}
            onReset={() => setActiveAgentId(activeAgentId)}
          >
            <MobileAgentView
              sessionId={sessionId}
              agentId={activeAgentId}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
            />
          </AgentViewErrorBoundary>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-secondary">No agent selected</p>
          </div>
        )}
      </div>

      {/* Widget bottom sheets */}
      {widgetInfo && (
        <MobileWidgetSheet
          isOpen={!!activeWidget}
          onClose={closeMobileWidget}
          title={widgetInfo.title}
          icon={widgetInfo.icon}
          height={widgetInfo.height}
        >
          {widgetInfo.component}
        </MobileWidgetSheet>
      )}

      {/* Mobile file viewer */}
      <MobileFileViewerSheet />
    </div>
  );
}
