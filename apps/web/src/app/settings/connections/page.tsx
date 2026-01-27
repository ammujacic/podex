'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Link2,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Unlink,
  ExternalLink,
  Clock,
  Info,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  getOAuthProviders,
  getOAuthConnections,
  startOAuthFlow,
  completeOAuthFlow,
  disconnectOAuth,
  refreshOAuthToken,
  openOAuthPopup,
  type OAuthProvider,
  type OAuthConnection,
} from '@/lib/api/oauth';
import { cn } from '@/lib/utils';

// Provider icons as inline SVGs
const ProviderIcons: Record<string, React.FC<{ className?: string }>> = {
  anthropic: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.954 7.62L12.68 21.54h-3.32l2.16-5.7-4.68-8.22h3.52l2.88 5.28 2.76-5.28h3.36l-1.4 2.58zm-9.94 0l-5.28 13.92H.35L5.63 7.62h2.38z" />
    </svg>
  ),
  google: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  ),
  github: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ),
};

// Provider display names and descriptions
const PROVIDER_INFO: Record<
  string,
  { name: string; description: string; color: string; benefit: string }
> = {
  anthropic: {
    name: 'Anthropic (Claude)',
    description: 'Use your Claude Pro or Max subscription',
    color: 'text-orange-500',
    benefit: 'Access extended thinking and higher rate limits from your Claude subscription',
  },
  google: {
    name: 'Google (Gemini)',
    description: 'Use your Google AI subscription',
    color: 'text-blue-500',
    benefit: 'Use Gemini models with your Google account',
  },
  github: {
    name: 'GitHub (Copilot)',
    description: 'Use your GitHub Copilot subscription',
    color: 'text-gray-300',
    benefit: 'Access Copilot models through your GitHub subscription',
  },
};

export default function ConnectionsPage() {
  useDocumentTitle('Connected Accounts');

  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [providersData, connectionsData] = await Promise.all([
        getOAuthProviders(),
        getOAuthConnections(),
      ]);
      setProviders(providersData);
      setConnections(connectionsData);
    } catch (err) {
      console.error('Failed to fetch OAuth data:', err);
      setError('Failed to load connected accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getConnection = (providerId: string) => {
    return connections.find((c) => c.provider === providerId);
  };

  const handleConnect = async (providerId: string) => {
    setConnecting(providerId);
    setError(null);

    try {
      // Start OAuth flow
      const { auth_url } = await startOAuthFlow(providerId);

      // Open popup
      const result = await openOAuthPopup(auth_url);

      // Complete OAuth flow
      await completeOAuthFlow(providerId, {
        code: result.code,
        state: result.state,
      });

      // Refresh connections
      await fetchData();
    } catch (err) {
      console.error('OAuth flow failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect account');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (providerId: string) => {
    setDisconnecting(providerId);
    setError(null);

    try {
      await disconnectOAuth(providerId);
      await fetchData();
    } catch (err) {
      console.error('Failed to disconnect:', err);
      setError('Failed to disconnect account');
    } finally {
      setDisconnecting(null);
    }
  };

  const handleRefresh = async (providerId: string) => {
    setRefreshing(providerId);
    setError(null);

    try {
      await refreshOAuthToken(providerId);
      await fetchData();
    } catch (err) {
      console.error('Failed to refresh token:', err);
      setError('Failed to refresh connection');
    } finally {
      setRefreshing(null);
    }
  };

  const formatExpiration = (expiresAt: number | null) => {
    if (!expiresAt) return null;
    const date = new Date(expiresAt * 1000);
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) return 'Expired';
    if (diff < 60 * 60 * 1000) return 'Expires soon';
    if (diff < 24 * 60 * 60 * 1000)
      return `Expires in ${Math.round(diff / (60 * 60 * 1000))} hours`;
    return `Expires in ${Math.round(diff / (24 * 60 * 60 * 1000))} days`;
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Connected Accounts</h1>
        <p className="text-text-muted mt-1">
          Connect your personal AI subscriptions to use them with Podex agents
        </p>
      </div>

      {/* Info Box */}
      <div className="mb-8 p-4 bg-accent-primary/5 border border-accent-primary/20 rounded-xl">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-accent-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-text-primary font-medium">Use Your Own Subscriptions</p>
            <p className="text-text-muted mt-1">
              Connect your Claude Pro, Gemini, or GitHub Copilot subscriptions to use their
              capabilities directly in Podex. Your tokens are securely stored and only used for your
              agents.
            </p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-sm text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Providers List */}
      <section>
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          Available Providers
        </h2>

        <div className="space-y-4">
          {providers.map((provider) => {
            const connection = getConnection(provider.id);
            const info = PROVIDER_INFO[provider.id] || {
              name: provider.name,
              description: 'Connect this provider',
              color: 'text-text-primary',
              benefit: '',
            };
            const Icon = ProviderIcons[provider.id];
            const isConnected = connection?.status === 'connected';
            const hasError = connection?.status === 'error';
            const isExpired = connection?.status === 'expired';
            const expiration = formatExpiration(connection?.expires_at ?? null);

            return (
              <div
                key={provider.id}
                className={cn(
                  'bg-surface border rounded-xl p-5 transition-colors',
                  isConnected
                    ? 'border-green-500/30'
                    : hasError || isExpired
                      ? 'border-red-500/30'
                      : 'border-border-default'
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Provider Icon */}
                  <div
                    className={cn(
                      'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                      isConnected ? 'bg-green-500/10' : 'bg-elevated'
                    )}
                  >
                    {Icon && <Icon className={cn('w-6 h-6', info.color)} />}
                  </div>

                  {/* Provider Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text-primary">{info.name}</h3>
                      {isConnected && (
                        <span className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          Connected
                        </span>
                      )}
                      {hasError && (
                        <span className="flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">
                          <AlertCircle className="w-3 h-3" />
                          Error
                        </span>
                      )}
                      {isExpired && (
                        <span className="flex items-center gap-1 text-xs text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" />
                          Expired
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-muted mt-1">{info.description}</p>

                    {/* Connected account info */}
                    {connection && (
                      <div className="mt-2 text-sm">
                        {connection.email && (
                          <p className="text-text-secondary">
                            {connection.name
                              ? `${connection.name} (${connection.email})`
                              : connection.email}
                          </p>
                        )}
                        {expiration && (
                          <p
                            className={cn(
                              'text-xs mt-1',
                              expiration === 'Expired' || expiration === 'Expires soon'
                                ? 'text-orange-500'
                                : 'text-text-muted'
                            )}
                          >
                            <Clock className="w-3 h-3 inline mr-1" />
                            {expiration}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Benefit text for unconnected */}
                    {!connection && info.benefit && (
                      <p className="text-xs text-text-muted mt-2">{info.benefit}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isConnected && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRefresh(provider.id)}
                          disabled={refreshing === provider.id}
                        >
                          {refreshing === provider.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnect(provider.id)}
                          disabled={disconnecting === provider.id}
                          className="text-red-400 hover:text-red-300 hover:border-red-500/50"
                        >
                          {disconnecting === provider.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Unlink className="w-4 h-4" />
                          )}
                        </Button>
                      </>
                    )}

                    {(hasError || isExpired) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(provider.id)}
                        disabled={connecting === provider.id}
                      >
                        {connecting === provider.id ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Reconnect
                      </Button>
                    )}

                    {!connection && (
                      <Button
                        variant={provider.configured ? 'primary' : 'outline'}
                        size="sm"
                        onClick={() => handleConnect(provider.id)}
                        disabled={!provider.configured || connecting === provider.id}
                      >
                        {connecting === provider.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Connecting...
                          </>
                        ) : provider.configured ? (
                          <>
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Connect
                          </>
                        ) : (
                          'Not Available'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How It Works */}
      <section className="mt-8">
        <h2 className="text-lg font-medium text-text-primary mb-4">How It Works</h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent-primary/10 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
              1
            </div>
            <div>
              <p className="font-medium text-text-primary">Connect your account</p>
              <p className="text-sm text-text-muted">
                Click Connect and authorize Podex to use your subscription
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent-primary/10 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
              2
            </div>
            <div>
              <p className="font-medium text-text-primary">Select in agent settings</p>
              <p className="text-sm text-text-muted">
                When creating or editing an agent, choose to use your connected subscription
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent-primary/10 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
              3
            </div>
            <div>
              <p className="font-medium text-text-primary">Enjoy enhanced capabilities</p>
              <p className="text-sm text-text-muted">
                Access your subscription's rate limits and features directly in Podex
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
