'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Key,
  Link2,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Unlink,
  ExternalLink,
  Clock,
  Info,
  Eye,
  EyeOff,
  Trash2,
  X,
  Check,
  ClipboardPaste,
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
  type OAuthProvider,
  type OAuthConnection,
} from '@/lib/api/oauth';
import { getLLMApiKeys, setLLMApiKey, removeLLMApiKey } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ============== Provider Icons ==============

const ProviderIcons: Record<string, React.FC<{ className?: string }>> = {
  anthropic: ({ className }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9.218 2h2.402L16 12.987h-2.402zM4.379 2h2.512l4.38 10.987H8.82l-.895-2.308h-4.58l-.896 2.307H0L4.38 2.001zm2.755 6.64L5.635 4.777 4.137 8.64z"
      />
    </svg>
  ),
  openai: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
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

// OAuth Provider display info
const OAUTH_PROVIDER_INFO: Record<
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

// API Key providers
const API_KEY_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Use Claude models with your own API key',
    color: 'text-orange-500',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Use GPT models with your own API key',
    color: 'text-green-500',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
];

// ============== OAuth Code Entry Modal ==============

interface OAuthCodeModalProps {
  providerName: string;
  authUrl: string;
  onComplete: (code: string) => Promise<void>;
  onClose: () => void;
}

function OAuthCodeEntryModal({ providerName, authUrl, onComplete, onClose }: OAuthCodeModalProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await onComplete(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSubmitting(false);
    }
  };

  // Extract code from pasted URL or handle code#state format (Anthropic)
  const handleCodeChange = (value: string) => {
    // Handle URL format with code= parameter
    if (value.includes('code=')) {
      try {
        const url = new URL(value);
        const codeParam = url.searchParams.get('code');
        if (codeParam) {
          setCode(codeParam);
          return;
        }
      } catch {
        const match = value.match(/[?&]code=([^&\s]+)/);
        if (match) {
          const matchedCode = match[1] ?? '';
          if (matchedCode) {
            setCode(matchedCode);
            return;
          }
        }
      }
    }
    // For Anthropic's code#state format, we pass the whole thing
    // (backend will parse it) - just store as-is
    setCode(value);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-border-subtle max-w-lg w-full">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Connect {providerName}</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
                1
              </div>
              <p className="text-sm font-medium text-text-primary">Open the authorization page</p>
            </div>
            <div className="flex gap-2">
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 text-sm font-medium whitespace-nowrap"
              >
                <ExternalLink className="h-4 w-4" />
                Open {providerName}
              </a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(authUrl);
                    toast.success('Authorization link copied to clipboard');
                  } catch {
                    toast.error('Failed to copy link');
                  }
                }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-overlay text-sm font-medium whitespace-nowrap"
              >
                <ClipboardPaste className="h-4 w-4" />
                Copy link
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
                2
              </div>
              <p className="text-sm font-medium text-text-primary">Authorize access</p>
            </div>
            <p className="text-xs text-text-muted ml-8">
              Click &quot;Authorize&quot; on the {providerName} page
            </p>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
                3
              </div>
              <p className="text-sm font-medium text-text-primary">Copy the authorization code</p>
            </div>
            <p className="text-xs text-text-muted ml-8">
              After authorizing, you&apos;ll see a code displayed on the page. Copy the entire code.
            </p>
          </div>

          {/* Step 4 */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
                  4
                </div>
                <p className="text-sm font-medium text-text-primary">Paste the code here</p>
              </div>
              <div className="ml-8 flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="Paste authorization code..."
                  className="flex-1 px-3 py-2.5 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      handleCodeChange(text);
                    } catch {
                      // Clipboard access denied
                    }
                  }}
                  className="px-3 py-2.5 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-overlay transition-colors"
                  title="Paste from clipboard"
                >
                  <ClipboardPaste className="h-4 w-4" />
                </button>
              </div>
            </div>

            {error && (
              <div className="ml-8 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-text-secondary hover:bg-elevated"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!code.trim() || submitting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Connect Account
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============== API Key Card Component ==============

interface ApiKeyCardProps {
  provider: (typeof API_KEY_PROVIDERS)[0];
  isConfigured: boolean;
  onSave: (apiKey: string) => Promise<void>;
  onRemove: () => Promise<void>;
}

function ApiKeyCard({ provider, isConfigured, onSave, onRemove }: ApiKeyCardProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const Icon = ProviderIcons[provider.id];

  const handleSave = async () => {
    if (!apiKey.trim()) return;

    setSaving(true);
    try {
      await onSave(apiKey.trim());
      setApiKey('');
      toast.success(`${provider.name} API key saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemove();
      toast.success(`${provider.name} API key removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove API key');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className={cn(
        'bg-surface border rounded-xl p-4 transition-colors',
        isConfigured ? 'border-green-500/30' : 'border-border-default'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
            isConfigured ? 'bg-green-500/10' : 'bg-elevated'
          )}
        >
          {Icon && <Icon className={cn('w-5 h-5', provider.color)} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-text-primary text-sm">{provider.name}</h3>
            {isConfigured && (
              <span className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full">
                <CheckCircle className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">{provider.description}</p>

          {isConfigured ? (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 px-2.5 py-1.5 rounded-lg bg-elevated border border-border-subtle text-text-muted text-xs font-mono">
                ••••••••••••
              </div>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors text-xs"
              >
                {removing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider.placeholder}
                    className="w-full px-2.5 py-1.5 pr-8 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
                <button
                  onClick={handleSave}
                  disabled={!apiKey.trim() || saving}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 text-xs font-medium"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </button>
              </div>
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent-primary hover:underline"
              >
                Get API key <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== Main Component ==============

export default function ConnectionsPage() {
  useDocumentTitle('AI Subscriptions (API)');

  // OAuth state
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [connections, setConnections] = useState<OAuthConnection[]>([]);

  // API key state
  const [configuredApiKeys, setConfiguredApiKeys] = useState<string[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // OAuth modal state
  const [oauthModal, setOauthModal] = useState<{
    provider: string;
    authUrl: string;
    state: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [providersData, connectionsData, apiKeysData] = await Promise.all([
        getOAuthProviders(),
        getOAuthConnections(),
        getLLMApiKeys(),
      ]);
      setProviders(providersData);
      setConnections(connectionsData);
      setConfiguredApiKeys(apiKeysData.providers);
    } catch (err) {
      console.error('Failed to fetch data:', err);
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

  // OAuth handlers
  const handleConnect = async (providerId: string) => {
    setConnecting(providerId);
    setError(null);

    try {
      const { auth_url, state } = await startOAuthFlow(providerId);
      setOauthModal({
        provider: providerId,
        authUrl: auth_url,
        state: state ?? '',
      });
    } catch (err) {
      console.error('OAuth flow failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
    } finally {
      setConnecting(null);
    }
  };

  const handleOAuthComplete = async (code: string) => {
    if (!oauthModal) return;

    await completeOAuthFlow(oauthModal.provider, {
      code,
      state: oauthModal.state,
    });
    setOauthModal(null);
    await fetchData();
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

  // API key handlers
  const handleSaveApiKey = async (providerId: string, apiKey: string) => {
    await setLLMApiKey(providerId, apiKey);
    await fetchData();
  };

  const handleRemoveApiKey = async (providerId: string) => {
    await removeLLMApiKey(providerId);
    await fetchData();
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
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">AI Subscriptions (API)</h1>
        <p className="text-text-muted mt-1">Connect your AI subscriptions and API keys</p>
      </div>

      {/* Info Box */}
      <div className="mb-8 p-4 bg-accent-primary/5 border border-accent-primary/20 rounded-xl">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-accent-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-text-primary font-medium">Use Your Own Accounts</p>
            <p className="text-text-muted mt-1">
              Connect via OAuth to use your existing subscriptions, or add API keys for direct
              access.
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

      {/* OAuth Providers Section */}
      <section className="mb-10">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          Personal Subscriptions (OAuth)
        </h2>

        <div className="space-y-4">
          {providers.map((provider) => {
            const connection = getConnection(provider.id);
            const info = OAUTH_PROVIDER_INFO[provider.id] || {
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
                  <div
                    className={cn(
                      'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                      isConnected ? 'bg-green-500/10' : 'bg-elevated'
                    )}
                  >
                    {Icon && <Icon className={cn('w-6 h-6', info.color)} />}
                  </div>

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

                    {!connection && info.benefit && (
                      <p className="text-xs text-text-muted mt-2">{info.benefit}</p>
                    )}
                  </div>

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

      {/* API Keys Section */}
      <section className="mb-10">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Key className="w-5 h-5" />
          API Keys
        </h2>
        <p className="text-sm text-text-muted mb-4">
          Add your own API keys to use Anthropic or OpenAI models directly
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {API_KEY_PROVIDERS.map((provider) => (
            <ApiKeyCard
              key={provider.id}
              provider={provider}
              isConfigured={configuredApiKeys.includes(provider.id)}
              onSave={(apiKey) => handleSaveApiKey(provider.id, apiKey)}
              onRemove={() => handleRemoveApiKey(provider.id)}
            />
          ))}
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
              <p className="font-medium text-text-primary">Connect via OAuth or add API key</p>
              <p className="text-sm text-text-muted">
                OAuth uses your existing subscription; API keys give direct access
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
                When creating or editing an agent, choose which provider to use
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-accent-primary/10 text-accent-primary text-sm font-medium flex items-center justify-center flex-shrink-0">
              3
            </div>
            <div>
              <p className="font-medium text-text-primary">Use your own quota</p>
              <p className="text-sm text-text-muted">
                Requests use your connected account instead of Podex credits
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* OAuth Code Entry Modal */}
      {oauthModal && (
        <OAuthCodeEntryModal
          providerName={OAUTH_PROVIDER_INFO[oauthModal.provider]?.name || oauthModal.provider}
          authUrl={oauthModal.authUrl}
          onComplete={handleOAuthComplete}
          onClose={() => setOauthModal(null)}
        />
      )}
    </div>
  );
}
