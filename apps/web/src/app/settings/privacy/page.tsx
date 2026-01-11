'use client';

import { useState } from 'react';
import { Shield, Eye, Database, Download, Trash2, Save, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';

function ToggleSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative w-10 h-5 rounded-full transition-colors',
        enabled ? 'bg-accent-primary' : 'bg-elevated'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
          enabled ? 'left-5' : 'left-0.5'
        )}
      />
    </button>
  );
}

export default function PrivacyPage() {
  const [saving, setSaving] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [crashReportsEnabled, setCrashReportsEnabled] = useState(true);
  const [usageDataEnabled, setUsageDataEnabled] = useState(true);
  const [activityHistoryEnabled, setActivityHistoryEnabled] = useState(true);

  const handleSave = async () => {
    setSaving(true);
    // TODO: Implement save functionality
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setSaving(false);
  };

  const handleExportData = () => {
    // TODO: Implement data export
    alert('Data export feature coming soon');
  };

  const handleDeleteData = () => {
    // TODO: Implement data deletion
    if (confirm('Are you sure you want to delete all your data? This action cannot be undone.')) {
      alert('Data deletion feature coming soon');
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Privacy & Security</h1>
        <p className="text-text-muted mt-1">Control your privacy settings and data</p>
      </div>

      {/* Data Collection */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Data Collection
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Analytics</p>
              <p className="text-sm text-text-muted">
                Help us improve by sharing anonymous usage analytics
              </p>
            </div>
            <ToggleSwitch enabled={analyticsEnabled} onChange={setAnalyticsEnabled} />
          </div>
          <div className="border-t border-border-subtle pt-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Crash Reports</p>
              <p className="text-sm text-text-muted">
                Automatically send crash reports to help fix bugs
              </p>
            </div>
            <ToggleSwitch enabled={crashReportsEnabled} onChange={setCrashReportsEnabled} />
          </div>
          <div className="border-t border-border-subtle pt-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Usage Data</p>
              <p className="text-sm text-text-muted">
                Share feature usage data to help prioritize improvements
              </p>
            </div>
            <ToggleSwitch enabled={usageDataEnabled} onChange={setUsageDataEnabled} />
          </div>
        </div>
      </section>

      {/* Activity & History */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Database className="w-5 h-5" />
          Activity & History
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Activity History</p>
              <p className="text-sm text-text-muted">
                Keep a record of your actions and agent interactions
              </p>
            </div>
            <ToggleSwitch enabled={activityHistoryEnabled} onChange={setActivityHistoryEnabled} />
          </div>
          <div className="border-t border-border-subtle pt-4">
            <Button variant="outline" size="sm" onClick={() => alert('Coming soon')}>
              Clear Activity History
            </Button>
          </div>
        </div>
      </section>

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
                Download a copy of all your data in JSON format
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportData}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
          <div className="border-t border-border-subtle pt-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Delete All Data</p>
              <p className="text-sm text-text-muted">
                Permanently delete all your data from our servers
              </p>
            </div>
            <Button variant="danger" size="sm" onClick={handleDeleteData}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </section>

      {/* Legal Links */}
      <section className="mb-8">
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

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
