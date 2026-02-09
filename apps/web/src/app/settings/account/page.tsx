'use client';

import { useState, useEffect } from 'react';
import { User, Mail, Key, Shield, Trash2, Save, Loader2, Smartphone, Check } from 'lucide-react';
import { Button } from '@podex/ui';
import { useUser, useAuthStore } from '@/stores/auth';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, getMFAStatus, type MFAStatusResponse } from '@/lib/api';
import { MFASetupModal } from '@/components/settings/MFASetupModal';
import { MFADisableModal } from '@/components/settings/MFADisableModal';
import { BackupCodesModal } from '@/components/settings/BackupCodesModal';
import { ChangePasswordModal } from '@/components/settings/ChangePasswordModal';
import { DeleteAccountModal } from '@/components/settings/DeleteAccountModal';
import { useRouter } from 'next/navigation';

export default function AccountPage() {
  useDocumentTitle('Account');
  const user = useUser();
  const { setUser } = useAuthStore();
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(user?.name || '');

  // MFA state
  const [mfaStatus, setMfaStatus] = useState<MFAStatusResponse | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [showMFASetup, setShowMFASetup] = useState(false);
  const [showMFADisable, setShowMFADisable] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchMFAStatus() {
      try {
        const status = await getMFAStatus();
        setMfaStatus(status);
      } catch (error) {
        console.error('Failed to fetch MFA status:', error);
      } finally {
        setMfaLoading(false);
      }
    }
    fetchMFAStatus();
  }, []);

  const handleMFASetupComplete = () => {
    setShowMFASetup(false);
    setMfaStatus({ enabled: true, backup_codes_remaining: 10 });
  };

  const handleMFADisableComplete = () => {
    setShowMFADisable(false);
    setMfaStatus({ enabled: false, backup_codes_remaining: 0 });
  };

  const handlePasswordChanged = () => {
    setShowChangePassword(false);
    // User will be logged out, redirect to login
    router.push('/auth/login?passwordChanged=true');
  };

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
    <div className="max-w-4xl mx-auto px-8 py-8">
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
            <Button variant="outline" size="sm" onClick={() => setShowChangePassword(true)}>
              <Key className="w-4 h-4 mr-2" />
              Change Password
            </Button>
          </div>
          <div className="border-t border-border-subtle pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-text-muted" />
                <div>
                  <p className="font-medium text-text-primary">Two-Factor Authentication</p>
                  <p className="text-sm text-text-muted">
                    {mfaLoading
                      ? 'Loading...'
                      : mfaStatus?.enabled
                        ? 'Your account is protected with 2FA'
                        : 'Add an extra layer of security'}
                  </p>
                </div>
              </div>
              {!mfaLoading &&
                (mfaStatus?.enabled ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-success/10 text-accent-success text-xs font-medium">
                      <Check className="w-3 h-3" />
                      Enabled
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setShowMFADisable(true)}>
                      Disable
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setShowMFASetup(true)}>
                    Enable 2FA
                  </Button>
                ))}
            </div>
            {mfaStatus?.enabled && (
              <div className="mt-3 pl-8 flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Backup Codes</p>
                  <p className="text-xs text-text-muted">
                    {mfaStatus.backup_codes_remaining} codes remaining
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowBackupCodes(true)}>
                  View Codes
                </Button>
              </div>
            )}
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
            <Button variant="danger" size="sm" onClick={() => setShowDeleteAccount(true)}>
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

      {/* MFA Modals */}
      <MFASetupModal
        isOpen={showMFASetup}
        onClose={() => setShowMFASetup(false)}
        onSuccess={handleMFASetupComplete}
      />
      <MFADisableModal
        isOpen={showMFADisable}
        onClose={() => setShowMFADisable(false)}
        onSuccess={handleMFADisableComplete}
        isOAuthUser={false}
      />
      <BackupCodesModal
        isOpen={showBackupCodes}
        onClose={() => setShowBackupCodes(false)}
        backupCodesRemaining={mfaStatus?.backup_codes_remaining ?? 0}
        onRegenerate={() =>
          setMfaStatus((prev) => (prev ? { ...prev, backup_codes_remaining: 10 } : null))
        }
      />
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        onComplete={handlePasswordChanged}
      />
      <DeleteAccountModal
        isOpen={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        mfaEnabled={mfaStatus?.enabled ?? false}
      />
    </div>
  );
}
