'use client';

import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check, Loader2, Terminal, AlertCircle } from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';

interface SSHKey {
  name: string;
  key_type: string;
  fingerprint: string;
  public_key: string;
  created_at: string;
}

interface SSHKeyListResponse {
  keys: SSHKey[];
  total: number;
}

export default function SSHKeysPage() {
  useDocumentTitle('SSH Keys');
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copiedFingerprint, setCopiedFingerprint] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setError(null);
      const response = await api.get<SSHKeyListResponse>('/api/ssh-keys');
      setKeys(response.keys);
    } catch (err) {
      console.error('Failed to fetch SSH keys:', err);
      setError('Failed to load SSH keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleAddKey = async () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) return;

    setAdding(true);
    setError(null);
    try {
      await api.post('/api/ssh-keys', {
        name: newKeyName.trim(),
        public_key: newKeyValue.trim(),
      });
      await fetchKeys();
      setShowAddForm(false);
      setNewKeyName('');
      setNewKeyValue('');
    } catch (err: unknown) {
      console.error('Failed to add SSH key:', err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'detail' in err
            ? String((err as { detail: unknown }).detail)
            : 'Failed to add SSH key';
      setError(errorMessage);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteKey = async (fingerprint: string) => {
    setDeleting(fingerprint);
    setError(null);
    try {
      await api.delete(`/api/ssh-keys/${encodeURIComponent(fingerprint)}`);
      await fetchKeys();
    } catch (err) {
      console.error('Failed to delete SSH key:', err);
      setError('Failed to delete SSH key');
    } finally {
      setDeleting(null);
    }
  };

  const copyFingerprint = async (fingerprint: string) => {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopiedFingerprint(fingerprint);
      setTimeout(() => setCopiedFingerprint(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">SSH Keys</h1>
        <p className="text-text-muted mt-1">
          Manage SSH keys for VS Code Remote-SSH access to your workspaces
        </p>
      </div>

      {/* Info Section */}
      <section className="mb-8">
        <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-xl p-5">
          <div className="flex gap-3">
            <Terminal className="w-5 h-5 text-accent-primary flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-text-primary mb-1">Connect via VS Code Remote-SSH</h3>
              <p className="text-sm text-text-secondary mb-3">
                Add your SSH public key to enable VS Code Remote-SSH connections to your workspaces.
                Once added, enable the SSH tunnel in your workspace settings.
              </p>
              <div className="bg-elevated rounded-lg p-3 font-mono text-xs text-text-secondary">
                <p className="mb-1"># Generate a new SSH key (if needed):</p>
                <p className="text-text-primary">
                  ssh-keygen -t ed25519 -C &quot;your@email.com&quot;
                </p>
                <p className="mt-2 mb-1"># Copy your public key:</p>
                <p className="text-text-primary">cat ~/.ssh/id_ed25519.pub</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-accent-error/10 border border-accent-error/20 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0" />
          <p className="text-sm text-accent-error">{error}</p>
        </div>
      )}

      {/* SSH Keys Section */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-text-primary flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Your SSH Keys
          </h2>
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Key
          </Button>
        </div>

        {/* Add Key Form */}
        {showAddForm && (
          <div className="bg-surface border border-border-default rounded-xl p-5 mb-4">
            <h3 className="font-medium text-text-primary mb-4">Add New SSH Key</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Key Name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
                  placeholder="e.g., MacBook Pro"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Public Key
                </label>
                <textarea
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-xs focus:outline-none focus:border-accent-primary resize-none"
                  placeholder="ssh-ed25519 AAAA... your@email.com"
                />
                <p className="text-xs text-text-muted mt-1">
                  Paste your public key (ssh-ed25519, ssh-rsa, or ecdsa)
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewKeyName('');
                    setNewKeyValue('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddKey}
                  disabled={adding || !newKeyName.trim() || !newKeyValue.trim()}
                >
                  {adding ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Key
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Keys List */}
        <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-text-muted mx-auto" />
              <p className="text-sm text-text-muted mt-2">Loading SSH keys...</p>
            </div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center">
              <KeyRound className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary">No SSH keys added yet</p>
              <p className="text-sm text-text-muted mt-1">
                Add a key to enable VS Code Remote-SSH access
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {keys.map((key) => (
                <li key={key.fingerprint} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-text-primary">{key.name}</h4>
                        <span className="px-2 py-0.5 text-xs bg-elevated rounded text-text-muted">
                          {key.key_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-text-muted font-mono truncate">
                          {key.fingerprint}
                        </code>
                        <button
                          onClick={() => copyFingerprint(key.fingerprint)}
                          className="p-1 hover:bg-elevated rounded transition-colors"
                          title="Copy fingerprint"
                        >
                          {copiedFingerprint === key.fingerprint ? (
                            <Check className="w-3.5 h-3.5 text-accent-success" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-text-muted" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-text-muted mt-1">
                        Added {formatDate(key.created_at)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteKey(key.fingerprint)}
                      disabled={deleting === key.fingerprint}
                      className="text-accent-error hover:text-accent-error hover:bg-accent-error/10"
                    >
                      {deleting === key.fingerprint ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* SSH Config Help */}
      <section>
        <h2 className="text-lg font-medium text-text-primary mb-4">Configure VS Code Remote-SSH</h2>
        <div className="bg-surface border border-border-default rounded-xl p-5">
          <p className="text-sm text-text-secondary mb-3">
            After enabling the SSH tunnel in your workspace, add this to your SSH config
            (~/.ssh/config):
          </p>
          <div className="bg-elevated rounded-lg p-4 font-mono text-xs">
            <pre className="text-text-secondary whitespace-pre-wrap">
              {`Host *.tunnel.podex.dev
    User podex
    ProxyCommand cloudflared access ssh --hostname %h
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null`}
            </pre>
          </div>
          <p className="text-xs text-text-muted mt-3">
            Requires{' '}
            <a
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary hover:underline"
            >
              cloudflared
            </a>{' '}
            to be installed on your local machine.
          </p>
        </div>
      </section>
    </div>
  );
}
