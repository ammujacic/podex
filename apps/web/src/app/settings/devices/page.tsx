'use client';

import { useEffect, useState } from 'react';
import {
  Smartphone,
  Monitor,
  Terminal,
  Globe,
  Trash2,
  LogOut,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

interface DeviceSession {
  id: string;
  device_type: string;
  device_name: string | null;
  os_name: string | null;
  browser_name: string | null;
  ip_address: string | null;
  city: string | null;
  country: string | null;
  last_active_at: string;
  created_at: string;
  is_current: boolean;
}

interface SessionListResponse {
  sessions: DeviceSession[];
  total: number;
}

const deviceIcons: Record<string, React.ReactNode> = {
  browser: <Globe className="w-5 h-5" />,
  cli: <Terminal className="w-5 h-5" />,
  vscode: <Monitor className="w-5 h-5" />,
  mobile: <Smartphone className="w-5 h-5" />,
  tablet: <Smartphone className="w-5 h-5" />,
  api: <Terminal className="w-5 h-5" />,
};

export default function DevicesPage() {
  useDocumentTitle('Devices & Sessions');
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SessionListResponse>('/api/v1/auth/sessions');
      setSessions(data.sessions);
    } catch (err) {
      setError('Failed to load sessions. Please try again.');
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await api.delete(`/api/v1/auth/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error('Failed to revoke session:', err);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAll = async () => {
    if (!confirm('Are you sure you want to log out of all other devices?')) return;

    setRevokingAll(true);
    try {
      await api.delete('/api/v1/auth/sessions?keep_current=true');
      // Reload to show only current session
      await loadSessions();
    } catch (err) {
      console.error('Failed to revoke all sessions:', err);
    } finally {
      setRevokingAll(false);
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    return deviceIcons[deviceType] || <Monitor className="w-5 h-5" />;
  };

  const formatLocation = (session: DeviceSession) => {
    if (session.city && session.country) {
      return `${session.city}, ${session.country}`;
    }
    if (session.country) return session.country;
    if (session.ip_address) return session.ip_address;
    return 'Unknown location';
  };

  const getDeviceDescription = (session: DeviceSession) => {
    if (session.device_name) return session.device_name;
    if (session.browser_name && session.os_name) {
      return `${session.browser_name} on ${session.os_name}`;
    }
    if (session.os_name) return session.os_name;
    return session.device_type.charAt(0).toUpperCase() + session.device_type.slice(1);
  };

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Devices & Sessions</h1>
        <p className="text-text-muted mt-1">Manage your active sessions across all devices</p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {sessions.length > 1 && (
          <Button variant="danger" size="sm" onClick={handleRevokeAll} disabled={revokingAll}>
            {revokingAll ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4 mr-2" />
            )}
            Log out other devices
          </Button>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-accent-error/10 border border-accent-error/30 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-accent-error" />
          <p className="text-text-primary">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && sessions.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      )}

      {/* Sessions List */}
      {!loading && sessions.length === 0 && !error && (
        <div className="text-center py-12 text-text-muted">No active sessions found</div>
      )}

      <div className="space-y-3">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`bg-surface border rounded-xl p-4 ${
              session.is_current ? 'border-accent-primary/50' : 'border-border-default'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    session.is_current
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'bg-elevated text-text-muted'
                  }`}
                >
                  {getDeviceIcon(session.device_type)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-text-primary">{getDeviceDescription(session)}</p>
                    {session.is_current && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-accent-primary/10 text-accent-primary rounded-full">
                        <CheckCircle className="w-3 h-3" />
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mt-0.5">{formatLocation(session)}</p>
                  <p className="text-xs text-text-muted mt-1">
                    Last active{' '}
                    {formatDistanceToNow(new Date(session.last_active_at), {
                      addSuffix: true,
                    })}
                    {' · '}
                    Signed in{' '}
                    {formatDistanceToNow(new Date(session.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
              {!session.is_current && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevokeSession(session.id)}
                  disabled={revokingId === session.id}
                  className="text-text-muted hover:text-accent-error"
                >
                  {revokingId === session.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Info Section */}
      <div className="mt-8 p-4 bg-elevated rounded-xl border border-border-subtle">
        <h3 className="text-sm font-medium text-text-primary mb-2">About Device Sessions</h3>
        <ul className="text-sm text-text-muted space-y-1">
          <li>• Each login creates a new session</li>
          <li>• Sessions expire automatically after 30 days of inactivity</li>
          <li>• Revoking a session logs out that device immediately</li>
          <li>• Changing your password logs out all devices</li>
        </ul>
      </div>
    </div>
  );
}
