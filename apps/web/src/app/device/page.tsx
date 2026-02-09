'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Terminal,
  Monitor,
  Smartphone,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { useUser } from '@/stores/auth';

interface AuthorizeDeviceResponse {
  success: boolean;
  message: string;
  device_name: string | null;
  device_type: string | null;
}

const deviceIcons: Record<string, React.ReactNode> = {
  cli: <Terminal className="w-12 h-12" />,
  vscode: <Monitor className="w-12 h-12" />,
  mobile: <Smartphone className="w-12 h-12" />,
  browser: <Monitor className="w-12 h-12" />,
};

function DeviceAuthContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useUser();

  const [code, setCode] = useState(searchParams.get('code') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<{
    name: string | null;
    type: string | null;
  } | null>(null);

  // If code is in URL and user is logged in, auto-submit
  useEffect(() => {
    const urlCode = searchParams.get('code');
    if (urlCode && user) {
      setCode(urlCode);
      // Auto-submit after a short delay for UX
    }
  }, [searchParams, user]);

  const handleSubmit = async (action: 'approve' | 'deny') => {
    if (!code) {
      setError('Please enter the device code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.post<AuthorizeDeviceResponse>('/api/v1/auth/device/authorize', {
        user_code: code.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        action,
      });

      if (action === 'approve') {
        setSuccess(true);
        setDeviceInfo({
          name: response.device_name,
          type: response.device_type,
        });
      } else {
        // Denied - redirect back to dashboard
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      const apiError = err as { message?: string; detail?: string };
      setError(apiError.detail || apiError.message || 'Failed to authorize device');
    } finally {
      setLoading(false);
    }
  };

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface border border-border-default rounded-2xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-accent-warning mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-text-primary mb-2">Sign In Required</h1>
          <p className="text-text-muted mb-6">Please sign in to authorize your device</p>
          <Button
            onClick={() =>
              router.push(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`)
            }
          >
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface border border-accent-success/30 rounded-2xl p-8 text-center">
          <CheckCircle className="w-16 h-16 text-accent-success mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Device Authorized!</h1>
          <p className="text-text-muted mb-6">
            {deviceInfo?.name || 'Your device'} has been successfully authorized. You can close this
            window and return to your device.
          </p>
          <Button variant="outline" onClick={() => router.push('/dashboard')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-surface border border-border-default rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-elevated rounded-2xl text-accent-primary mb-4">
            {deviceIcons.cli}
          </div>
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Authorize Device</h1>
          <p className="text-text-muted">Enter the code shown on your device to authorize it</p>
        </div>

        {error && (
          <div className="bg-accent-error/10 border border-accent-error/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <XCircle className="w-5 h-5 text-accent-error flex-shrink-0" />
            <p className="text-text-primary text-sm">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-text-secondary mb-2">Device Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9-]/g, '')
                  .slice(0, 9)
              )
            }
            placeholder="XXXX-XXXX"
            className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded-xl text-text-primary text-center text-2xl font-mono tracking-wider focus:outline-none focus:border-accent-primary"
            maxLength={9}
            autoFocus
          />
          <p className="text-xs text-text-muted mt-2 text-center">
            The code is displayed on your CLI or device
          </p>
        </div>

        <div className="space-y-3">
          <Button
            onClick={() => handleSubmit('approve')}
            disabled={loading || code.replace(/-/g, '').length !== 8}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Authorizing...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Authorize Device
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit('deny')}
            disabled={loading}
            className="w-full"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Deny
          </Button>
        </div>

        <div className="mt-8 pt-6 border-t border-border-subtle text-center">
          <p className="text-xs text-text-muted">
            Signed in as <span className="text-text-primary">{user.email}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DeviceAuthPage() {
  useDocumentTitle('Authorize Device');

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-void flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
        </div>
      }
    >
      <DeviceAuthContent />
    </Suspense>
  );
}
