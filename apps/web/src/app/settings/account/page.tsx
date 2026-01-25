'use client';

import { useState } from 'react';
import { User, Mail, Key, Shield, Trash2, Save, Loader2 } from 'lucide-react';
import { Button } from '@podex/ui';
import { useUser, useAuthStore } from '@/stores/auth';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';

export default function AccountPage() {
  useDocumentTitle('Account');
  const user = useUser();
  const { setUser } = useAuthStore();
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(user?.name || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.patch('/api/auth/me', { name: displayName });
      if (user && updated) {
        setUser({ ...user, name: displayName });
      }
    } catch (error) {
      console.error('Failed to save account settings:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Account Settings</h1>
        <p className="text-text-muted mt-1">Manage your account details and preferences</p>
      </div>

      {/* Profile Section */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <User className="w-5 h-5" />
          Profile
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-accent-primary"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Email Address
            </label>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-text-muted" />
              <span className="text-text-primary">{user?.email || 'Not set'}</span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Email cannot be changed. Contact support if needed.
            </p>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Security
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Password</p>
              <p className="text-sm text-text-muted">Change your account password</p>
            </div>
            <Button variant="outline" size="sm">
              <Key className="w-4 h-4 mr-2" />
              Change Password
            </Button>
          </div>
          <div className="border-t border-border-subtle pt-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Two-Factor Authentication</p>
              <p className="text-sm text-text-muted">Add an extra layer of security</p>
            </div>
            <Button variant="outline" size="sm">
              Enable 2FA
            </Button>
          </div>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-accent-error mb-4 flex items-center gap-2">
          <Trash2 className="w-5 h-5" />
          Danger Zone
        </h2>
        <div className="bg-surface border border-accent-error/30 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-text-primary">Delete Account</p>
              <p className="text-sm text-text-muted">
                Permanently delete your account and all data
              </p>
            </div>
            <Button variant="danger" size="sm">
              Delete Account
            </Button>
          </div>
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
