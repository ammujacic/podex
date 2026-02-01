'use client';

import { useState } from 'react';
import { Shield, Download, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function PrivacyPage() {
  const [exporting, setExporting] = useState(false);
  const [exportRequested, setExportRequested] = useState(false);

  const handleRequestExport = async () => {
    setExporting(true);
    try {
      await api.post('/api/user/data-export', {
        request_type: 'export_data',
        data_categories: ['profile', 'sessions', 'messages', 'billing', 'settings'],
      });
      setExportRequested(true);
    } catch (error) {
      console.error('Failed to request data export:', error);
      alert('Failed to request data export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Privacy & Data</h1>
        <p className="text-text-muted mt-1">Manage your data and privacy settings</p>
      </div>

      {/* Data Management */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Data Management
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Export Your Data</p>
              <p className="text-sm text-text-muted">
                Request a copy of all your data. You&apos;ll be notified when it&apos;s ready.
              </p>
            </div>
            {exportRequested ? (
              <div className="flex items-center gap-2 text-accent-success text-sm">
                <AlertCircle className="w-4 h-4" />
                Export requested
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRequestExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {exporting ? 'Requesting...' : 'Request Export'}
              </Button>
            )}
          </div>
          <div className="border-t border-border-subtle pt-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Delete Account</p>
              <p className="text-sm text-text-muted">
                Permanently delete your account and all associated data
              </p>
            </div>
            <Link href="/settings/account">
              <Button variant="outline" size="sm">
                Go to Account Settings
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Privacy Info */}
      <section className="mb-8">
        <div className="bg-elevated border border-border-subtle rounded-xl p-5">
          <h3 className="font-medium text-text-primary mb-2">How We Handle Your Data</h3>
          <ul className="text-sm text-text-secondary space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-accent-primary mt-1">•</span>
              Your code and project data are stored securely and only accessible to you
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent-primary mt-1">•</span>
              We use industry-standard encryption for data in transit and at rest
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent-primary mt-1">•</span>
              AI interactions may be used to improve our services (see Privacy Policy for details)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent-primary mt-1">•</span>
              You can request deletion of your data at any time
            </li>
          </ul>
        </div>
      </section>

      {/* Legal Links */}
      <section>
        <div className="flex gap-4 text-sm">
          <a
            href="/privacy-policy"
            className="text-accent-primary hover:underline flex items-center gap-1"
          >
            Privacy Policy <ExternalLink className="w-3 h-3" />
          </a>
          <a href="/terms" className="text-accent-primary hover:underline flex items-center gap-1">
            Terms of Service <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </section>
    </div>
  );
}
