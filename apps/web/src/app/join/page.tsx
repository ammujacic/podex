'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Link as LinkIcon, Loader2, ArrowRight, Building2 } from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function JoinPage() {
  useDocumentTitle('Join Organization');
  const router = useRouter();

  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setLoading(true);
    setError(null);

    // Extract code from URL if user pasted full URL
    let code = inviteCode.trim();
    if (code.includes('/join/')) {
      const match = code.match(/\/join\/([a-zA-Z0-9]+)/);
      if (match?.[1]) {
        code = match[1];
      }
    }

    // Navigate to the join page for this code
    router.push(`/join/${code}`);
  };

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-accent-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-accent-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">Join an Organization</h1>
          <p className="text-text-muted mt-2">
            Enter your invite code or paste the full invite link
          </p>
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-6">
          {error && (
            <div className="mb-4 p-4 bg-accent-error/10 border border-accent-error/30 rounded-lg text-accent-error text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Invite Code or Link
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter code or paste invite link"
                  className="w-full pl-10 pr-4 py-3 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  autoFocus
                />
              </div>
              <p className="text-xs text-text-muted mt-2">
                Example: ABC123 or https://podex.ai/join/ABC123
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={!inviteCode.trim() || loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Checking...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-text-muted mt-6">
          Don&apos;t have an invite?{' '}
          <Link href="/settings/organization" className="text-accent-primary hover:underline">
            Create your own organization
          </Link>
        </p>
      </div>
    </div>
  );
}
