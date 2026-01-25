'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  ExternalLink,
  Smartphone,
  Tablet,
  Monitor,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  AlertCircle,
  Play,
  PanelBottom,
  PanelBottomClose,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';
import { getSocket } from '@/lib/collaboration';
import { useDevToolsStore } from '@/stores/devtools';
import { usePreviewDevTools } from '@/hooks/usePreviewDevTools';
import { DevToolsPanel } from './DevToolsPanel';

interface PreviewPanelProps {
  workspaceId: string;
  defaultUrl?: string;
  defaultPort?: number;
  onClose?: () => void;
}

type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'responsive';

const deviceSizes: Record<DeviceType, { width: string; height: string; label: string }> = {
  mobile: { width: '375px', height: '667px', label: 'Mobile (375x667)' },
  tablet: { width: '768px', height: '1024px', label: 'Tablet (768x1024)' },
  desktop: { width: '1280px', height: '800px', label: 'Desktop (1280x800)' },
  responsive: { width: '100%', height: '100%', label: 'Responsive' },
};

// Common dev server start commands by framework
const devServerCommands: Record<string, string> = {
  npm: 'npm run dev',
  pnpm: 'pnpm dev',
  yarn: 'yarn dev',
  vite: 'npx vite',
  next: 'npx next dev',
  default: 'npm run dev',
};

// Validate that a URL is a safe preview URL (either relative proxy path or the proxy endpoint)
function isValidPreviewUrl(url: string, workspaceId: string): boolean {
  // Allow relative paths starting with /api/preview/{workspaceId}/
  const relativePattern = new RegExp(`^/api/preview/${workspaceId}/proxy/\\d+/`);
  if (relativePattern.test(url)) {
    return true;
  }
  // Allow same-origin absolute URLs to the proxy endpoint
  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin === window.location.origin && relativePattern.test(parsed.pathname)) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function PreviewPanel({
  workspaceId,
  defaultUrl,
  defaultPort = 3000,
  onClose,
}: PreviewPanelProps) {
  // Use the proxy URL by default to avoid localhost access
  const defaultProxyUrl = `/api/preview/${workspaceId}/proxy/${defaultPort}/`;
  const [url, setUrl] = useState(
    defaultUrl && isValidPreviewUrl(defaultUrl, workspaceId) ? defaultUrl : defaultProxyUrl
  );
  const [inputUrl, setInputUrl] = useState(url);
  const [deviceType, setDeviceType] = useState<DeviceType>('responsive');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<'idle' | 'starting' | 'running' | 'error'>(
    'idle'
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // DevTools state
  const devToolsOpen = useDevToolsStore((s) => s.isOpen);
  const toggleDevTools = useDevToolsStore((s) => s.toggleDevTools);
  const panelHeight = useDevToolsStore((s) => s.panelHeight);
  const history = useDevToolsStore((s) => s.history);
  const historyIndex = useDevToolsStore((s) => s.historyIndex);
  const goBack = useDevToolsStore((s) => s.goBack);
  const goForward = useDevToolsStore((s) => s.goForward);
  const currentUrl = useDevToolsStore((s) => s.currentUrl);
  const consoleEntries = useDevToolsStore((s) => s.consoleEntries);
  const errors = useDevToolsStore((s) => s.errors);

  // DevTools hook for iframe communication
  const {
    requestDOMSnapshot,
    requestHTML,
    evalCode,
    reload: _reloadIframe,
  } = usePreviewDevTools({
    iframeRef,
    workspaceId,
    enabled: true,
  });

  // Calculate navigation state
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  // Error/warning count for DevTools badge
  const errorCount = errors.length;
  const warningCount = consoleEntries.filter((e) => e.level === 'warn').length;

  // Available ports for preview (would come from workspace config in production)
  const availablePorts = [
    { port: 3000, label: 'Dev Server', protocol: 'http' },
    { port: 8080, label: 'Backend', protocol: 'http' },
    { port: 5173, label: 'Vite', protocol: 'http' },
  ];

  // Handle iframe load
  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setServerStatus('running');
  }, []);

  // Handle iframe error
  const handleError = useCallback(() => {
    setIsLoading(false);
    setError('Failed to load preview. The development server may not be running.');
  }, []);

  // Navigate to URL - validate before navigating
  const navigateToUrl = useCallback(() => {
    if (!isValidPreviewUrl(inputUrl, workspaceId)) {
      setError('Invalid URL. Only workspace preview URLs are allowed.');
      return;
    }
    setUrl(inputUrl);
    setIsLoading(true);
    setError(null);
  }, [inputUrl, workspaceId]);

  // Refresh preview
  const refresh = useCallback(() => {
    if (iframeRef.current) {
      setIsLoading(true);
      setError(null);
      iframeRef.current.src = url;
    }
  }, [url]);

  // Open in new tab
  const openExternal = useCallback(() => {
    window.open(url, '_blank');
  }, [url]);

  // Handle keyboard shortcut for URL input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        navigateToUrl();
      }
    },
    [navigateToUrl]
  );

  // Handle back navigation
  const handleBack = useCallback(() => {
    const entry = goBack();
    if (entry) {
      setUrl(entry.url);
      setInputUrl(entry.url);
      setIsLoading(true);
      setError(null);
    }
  }, [goBack]);

  // Handle forward navigation
  const handleForward = useCallback(() => {
    const entry = goForward();
    if (entry) {
      setUrl(entry.url);
      setInputUrl(entry.url);
      setIsLoading(true);
      setError(null);
    }
  }, [goForward]);

  // Sync URL input with DevTools history when navigation happens inside iframe
  useEffect(() => {
    if (currentUrl && currentUrl !== inputUrl && isValidPreviewUrl(currentUrl, workspaceId)) {
      setInputUrl(currentUrl);
    }
  }, [currentUrl, inputUrl, workspaceId]);

  // Start dev server in the pod
  const startDevServer = useCallback(() => {
    if (isStartingServer) return;

    setIsStartingServer(true);
    setServerStatus('starting');
    setError(null);

    const socket = getSocket();

    // Extract port from current URL
    const portMatch = url.match(/\/proxy\/(\d+)\//);
    const port = portMatch?.[1] ? parseInt(portMatch[1], 10) : defaultPort;

    // Send command to start dev server
    socket.emit('workspace_command', {
      workspace_id: workspaceId,
      command: devServerCommands.default,
      port,
    });

    // Listen for server ready event
    const handleServerReady = (data: { workspace_id: string; port: number; status: string }) => {
      if (data.workspace_id === workspaceId && data.port === port) {
        setIsStartingServer(false);
        setServerStatus('running');
        // Refresh the preview after a short delay
        setTimeout(() => {
          refresh();
        }, 1000);
        socket.off('workspace_server_ready', handleServerReady);
        socket.off('workspace_server_error', handleServerError);
      }
    };

    const handleServerError = (data: { workspace_id: string; error: string }) => {
      if (data.workspace_id === workspaceId) {
        setIsStartingServer(false);
        setServerStatus('error');
        setError(`Failed to start server: ${data.error}`);
        socket.off('workspace_server_ready', handleServerReady);
        socket.off('workspace_server_error', handleServerError);
      }
    };

    socket.on('workspace_server_ready', handleServerReady);
    socket.on('workspace_server_error', handleServerError);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (isStartingServer) {
        setIsStartingServer(false);
        setServerStatus('idle');
        socket.off('workspace_server_ready', handleServerReady);
        socket.off('workspace_server_error', handleServerError);
        // Try refreshing anyway - server might be ready
        refresh();
      }
    }, 30000);
  }, [isStartingServer, url, defaultPort, workspaceId, refresh]);

  // Check if server is running periodically
  useEffect(() => {
    const checkServer = async () => {
      try {
        // In production, this would ping the actual workspace proxy
        await fetch(url, { method: 'HEAD', mode: 'no-cors' });
        // If we get here without error, try refreshing
        if (error && !isStartingServer) {
          refresh();
        }
      } catch {
        // Server not ready yet
      }
    };

    if (error && !isStartingServer) {
      const interval = setInterval(checkServer, 3000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [error, url, isStartingServer, refresh]);

  const deviceSize = deviceSizes[deviceType];

  return (
    <div className="flex flex-col h-full bg-surface border-l border-border-default">
      {/* Header with navigation */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-elevated">
        {/* Navigation buttons */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            disabled={!canGoBack}
            title="Go back"
            className="h-7 w-7"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleForward}
            disabled={!canGoForward}
            title="Go forward"
            className="h-7 w-7"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isLoading}
            title="Refresh"
            className="h-7 w-7"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* URL Input */}
        <div className="flex-1 flex items-center gap-2 bg-void rounded-md px-2 py-1 border border-border-default">
          <Globe className="w-4 h-4 text-text-muted shrink-0" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-text-primary outline-none min-w-0"
            placeholder="Enter URL..."
          />
        </div>

        {/* Action buttons */}
        <Button
          variant="ghost"
          size="icon"
          onClick={openExternal}
          title="Open in new tab"
          className="h-7 w-7"
        >
          <ExternalLink className="w-4 h-4" />
        </Button>

        {/* DevTools toggle */}
        <Button
          variant={devToolsOpen ? 'secondary' : 'ghost'}
          size="icon"
          onClick={toggleDevTools}
          title={devToolsOpen ? 'Close DevTools' : 'Open DevTools'}
          className={cn('h-7 w-7 relative', devToolsOpen && 'bg-accent-primary/10')}
        >
          {devToolsOpen ? (
            <PanelBottomClose className="w-4 h-4" />
          ) : (
            <PanelBottom className="w-4 h-4" />
          )}
          {/* Error badge */}
          {!devToolsOpen && errorCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent-error text-[10px] font-medium text-white flex items-center justify-center">
              {errorCount > 9 ? '9+' : errorCount}
            </span>
          )}
        </Button>

        {/* Device selector */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeviceMenu(!showDeviceMenu)}
            className="gap-1 h-7"
          >
            {deviceType === 'mobile' && <Smartphone className="w-4 h-4" />}
            {deviceType === 'tablet' && <Tablet className="w-4 h-4" />}
            {deviceType === 'desktop' && <Monitor className="w-4 h-4" />}
            {deviceType === 'responsive' && <Monitor className="w-4 h-4" />}
            <ChevronDown className="w-3 h-3" />
          </Button>

          {showDeviceMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-elevated border border-border-default rounded-md shadow-lg z-10">
              {(Object.keys(deviceSizes) as DeviceType[]).map((device) => (
                <button
                  key={device}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2 ${
                    deviceType === device ? 'text-accent-primary' : 'text-text-secondary'
                  }`}
                  onClick={() => {
                    setDeviceType(device);
                    setShowDeviceMenu(false);
                  }}
                >
                  {device === 'mobile' && <Smartphone className="w-4 h-4" />}
                  {device === 'tablet' && <Tablet className="w-4 h-4" />}
                  {device === 'desktop' && <Monitor className="w-4 h-4" />}
                  {device === 'responsive' && <Monitor className="w-4 h-4" />}
                  {deviceSizes[device].label}
                </button>
              ))}
            </div>
          )}
        </div>

        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close preview"
            className="h-7 w-7"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Port selector bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border-subtle text-xs shrink-0">
        <span className="text-text-muted">Ports:</span>
        {availablePorts.map((p) => (
          <button
            key={p.port}
            className={`px-2 py-0.5 rounded ${
              url.includes(`/proxy/${p.port}/`)
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-secondary hover:bg-overlay'
            }`}
            onClick={() => {
              // Use the workspace proxy URL instead of localhost to avoid SSRF
              const newUrl = `/api/preview/${workspaceId}/proxy/${p.port}/`;
              setInputUrl(newUrl);
              setUrl(newUrl);
              setIsLoading(true);
              setError(null);
            }}
          >
            {p.port} ({p.label})
          </button>
        ))}
        {serverStatus === 'running' && (
          <span className="ml-auto flex items-center gap-1 text-accent-success">
            <span className="w-2 h-2 rounded-full bg-accent-success animate-pulse" />
            Server running
          </span>
        )}
        {serverStatus === 'starting' && (
          <span className="ml-auto flex items-center gap-1 text-accent-warning">
            <Loader2 className="w-3 h-3 animate-spin" />
            Starting server...
          </span>
        )}
      </div>

      {/* Main content area with DevTools */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Preview content */}
        <div
          className="flex items-center justify-center bg-void overflow-auto p-4 relative"
          style={{
            height: devToolsOpen ? `calc(100% - ${panelHeight}px)` : '100%',
          }}
        >
          {/* Loading state */}
          {isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-void/80 z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
                <span className="text-text-secondary text-sm">Loading preview...</span>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center gap-4 text-center max-w-md">
              <div className="w-16 h-16 rounded-full bg-accent-error/10 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-accent-error" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-text-primary mb-2">Preview Unavailable</h3>
                <p className="text-text-secondary text-sm">{error}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={refresh}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Retry
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={startDevServer}
                  disabled={isStartingServer}
                >
                  {isStartingServer ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-1" />
                      Start Server
                    </>
                  )}
                </Button>
              </div>
              {isStartingServer && (
                <p className="text-xs text-text-muted">
                  Running{' '}
                  <code className="bg-overlay px-1 rounded">{devServerCommands.default}</code>
                  ...
                </p>
              )}
            </div>
          )}

          {/* Iframe container */}
          <div
            className={cn(
              'bg-white rounded-lg overflow-hidden shadow-lg transition-all duration-300',
              error && 'hidden'
            )}
            style={{
              width: deviceSize.width,
              height: deviceSize.height,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            <iframe
              ref={iframeRef}
              src={url}
              className="w-full h-full border-0"
              onLoad={handleLoad}
              onError={handleError}
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
              title="Preview"
            />
          </div>
        </div>

        {/* DevTools Panel */}
        {devToolsOpen && (
          <DevToolsPanel
            onRequestDOMSnapshot={requestDOMSnapshot}
            onRequestHTML={requestHTML}
            onEvalCode={evalCode}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border-subtle text-xs text-text-muted shrink-0">
        <span>{deviceSize.label}</span>
        <div className="flex items-center gap-3">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-accent-error">
              <AlertCircle className="w-3 h-3" />
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-accent-warning">
              {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
            </span>
          )}
          <span className="truncate max-w-[300px]">{currentUrl || url}</span>
        </div>
      </div>
    </div>
  );
}
