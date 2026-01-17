'use client';

import { useState } from 'react';
import {
  Bell,
  Mail,
  MessageSquare,
  Volume2,
  Monitor,
  Save,
  Loader2,
  Smartphone,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';
import { PushNotificationSettings } from '@/components/settings/PushNotificationSettings';

interface NotificationSetting {
  id: string;
  label: string;
  description: string;
  email: boolean;
  push: boolean;
  inApp: boolean;
}

const defaultSettings: NotificationSetting[] = [
  {
    id: 'agent_complete',
    label: 'Agent Task Completed',
    description: 'When an agent finishes a task or requires attention',
    email: true,
    push: true,
    inApp: true,
  },
  {
    id: 'agent_error',
    label: 'Agent Errors',
    description: 'When an agent encounters an error or fails',
    email: true,
    push: true,
    inApp: true,
  },
  {
    id: 'billing',
    label: 'Billing & Usage',
    description: 'Payment confirmations, usage alerts, and invoices',
    email: true,
    push: false,
    inApp: true,
  },
  {
    id: 'security',
    label: 'Security Alerts',
    description: 'New login attempts and security-related notifications',
    email: true,
    push: true,
    inApp: true,
  },
  {
    id: 'updates',
    label: 'Product Updates',
    description: 'New features, improvements, and announcements',
    email: false,
    push: false,
    inApp: true,
  },
];

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

export default function NotificationsPage() {
  const [settings, setSettings] = useState<NotificationSetting[]>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [desktopEnabled, setDesktopEnabled] = useState(true);

  const updateSetting = (id: string, field: 'email' | 'push' | 'inApp', value: boolean) => {
    setSettings((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // TODO: Implement notification preferences API endpoint
      // await api.patch('/api/user/config/notifications', {
      //   settings,
      //   desktopEnabled,
      // });
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call
    } catch (error) {
      console.error('Failed to save notification settings:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Notification Preferences</h1>
        <p className="text-text-muted mt-1">Choose how and when you want to be notified</p>
      </div>

      {/* Push Notification Setup */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Push Notifications
        </h2>
        <PushNotificationSettings />
      </section>

      {/* Global Settings */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Volume2 className="w-5 h-5" />
          Global Settings
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Sound Notifications</p>
              <p className="text-sm text-text-muted">Play a sound for important notifications</p>
            </div>
            <ToggleSwitch enabled={soundEnabled} onChange={setSoundEnabled} />
          </div>
          <div className="border-t border-border-subtle pt-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Desktop Notifications</p>
              <p className="text-sm text-text-muted">
                Show browser notifications when tab is inactive
              </p>
            </div>
            <ToggleSwitch enabled={desktopEnabled} onChange={setDesktopEnabled} />
          </div>
        </div>
      </section>

      {/* Notification Types */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Notification Types
        </h2>
        <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-4 gap-4 px-5 py-3 bg-elevated border-b border-border-subtle text-xs font-medium text-text-muted uppercase tracking-wider">
            <div className="col-span-1">Notification</div>
            <div className="text-center flex items-center justify-center gap-1">
              <Mail className="w-3.5 h-3.5" /> Email
            </div>
            <div className="text-center flex items-center justify-center gap-1">
              <Monitor className="w-3.5 h-3.5" /> Push
            </div>
            <div className="text-center flex items-center justify-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" /> In-App
            </div>
          </div>

          {/* Settings rows */}
          {settings.map((setting, index) => (
            <div
              key={setting.id}
              className={cn(
                'grid grid-cols-4 gap-4 px-5 py-4',
                index !== settings.length - 1 && 'border-b border-border-subtle'
              )}
            >
              <div>
                <p className="font-medium text-text-primary">{setting.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{setting.description}</p>
              </div>
              <div className="flex items-center justify-center">
                <ToggleSwitch
                  enabled={setting.email}
                  onChange={(v) => updateSetting(setting.id, 'email', v)}
                />
              </div>
              <div className="flex items-center justify-center">
                <ToggleSwitch
                  enabled={setting.push}
                  onChange={(v) => updateSetting(setting.id, 'push', v)}
                />
              </div>
              <div className="flex items-center justify-center">
                <ToggleSwitch
                  enabled={setting.inApp}
                  onChange={(v) => updateSetting(setting.id, 'inApp', v)}
                />
              </div>
            </div>
          ))}
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
