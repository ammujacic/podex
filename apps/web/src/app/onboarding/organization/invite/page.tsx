'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Check, Mail, Plus, X, Users, Loader2 } from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOrganizationStore } from '@/stores/organization';
import { api } from '@/lib/api';

interface InviteEntry {
  email: string;
  role: 'admin' | 'member';
}

export default function OnboardingInvitePage() {
  useDocumentTitle('Create Organization - Invite Team');
  const router = useRouter();
  const { setContext: _setContext } = useOrganizationStore();

  const [invites, setInvites] = useState<InviteEntry[]>([{ email: '', role: 'member' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we have org data from previous steps
  useEffect(() => {
    const data = sessionStorage.getItem('org-onboarding');
    if (!data) {
      router.replace('/onboarding/organization/details');
    }
  }, [router]);

  const addInvite = () => {
    setInvites([...invites, { email: '', role: 'member' }]);
  };

  const removeInvite = (index: number) => {
    setInvites(invites.filter((_, i) => i !== index));
  };

  const updateInvite = (index: number, field: keyof InviteEntry, value: string) => {
    setInvites(invites.map((invite, i) => (i === index ? { ...invite, [field]: value } : invite)));
  };

  const handleBack = () => {
    router.push('/onboarding/organization/credit-model');
  };

  const handleCreateOrganization = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = JSON.parse(sessionStorage.getItem('org-onboarding') || '{}');
      const validInvites = invites.filter((inv) => inv.email.trim());

      // Create organization via API
      const response = (await api.post('/api/organizations/', {
        name: data.name,
        slug: data.slug,
        website: data.website || null,
        logo_url: null, // TODO: Handle logo upload
        credit_model: data.creditModel,
      })) as { id: string; name: string; slug: string; creditModel: string };

      // Send invitations if any
      if (validInvites.length > 0) {
        await Promise.all(
          validInvites.map((invite: InviteEntry) =>
            api.post(`/api/organizations/${response.id}/invitations`, {
              email: invite.email,
              role: invite.role || 'member',
              message: null, // No message field in InviteEntry
            })
          )
        );
      }

      // Clear session storage
      sessionStorage.removeItem('org-onboarding');

      // Update store with new context
      // setContext({
      //   organization: response.organization,
      //   role: 'owner',
      //   isBlocked: false,
      //   limits: response.limits,
      // });

      // Redirect to organization dashboard
      router.push('/settings/organization');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    setInvites([]);
    handleCreateOrganization();
  };

  const validInviteCount = invites.filter((inv) => {
    const email = inv.email.trim();
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }).length;

  // Progress steps
  const steps = [
    { id: 'details', label: 'Details', active: false, completed: true },
    { id: 'credit-model', label: 'Credit Model', active: false, completed: true },
    { id: 'invite', label: 'Invite Team', active: true, completed: false },
    { id: 'complete', label: 'Complete', active: false, completed: false },
  ];

  return (
    <div>
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step.active
                  ? 'bg-accent-primary text-white'
                  : step.completed
                    ? 'bg-accent-success text-white'
                    : 'bg-elevated text-text-muted'
              }`}
            >
              {step.completed ? <Check className="w-4 h-4" /> : index + 1}
            </div>
            <span
              className={`text-sm hidden sm:block ${
                step.active ? 'text-text-primary font-medium' : 'text-text-muted'
              }`}
            >
              {step.label}
            </span>
            {index < steps.length - 1 && <div className="w-8 h-px bg-border-default mx-2" />}
          </div>
        ))}
      </div>

      {/* Form */}
      <div className="bg-surface border border-border-default rounded-xl p-6">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-text-primary mb-2">Invite your team</h1>
          <p className="text-text-muted">
            Add team members to collaborate with. You can always invite more people later.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-accent-error/10 border border-accent-error/30 rounded-lg text-accent-error text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3 mb-6">
          {invites.map((invite, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
                <input
                  type="email"
                  value={invite.email}
                  onChange={(e) => updateInvite(index, 'email', e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full pl-10 pr-4 py-3 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <select
                value={invite.role}
                onChange={(e) => updateInvite(index, 'role', e.target.value)}
                className="px-4 py-3 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              {invites.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeInvite(index)}
                  className="p-3 hover:bg-elevated rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-text-muted" />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addInvite}
          className="w-full py-3 border border-dashed border-border-default rounded-lg text-text-muted hover:text-text-primary hover:border-border-subtle transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add another
        </button>

        {/* Info box */}
        <div className="mt-6 p-4 bg-elevated rounded-lg">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-text-muted mt-0.5" />
            <div>
              <p className="text-sm text-text-secondary">
                Team members will receive an email invitation to join your organization. Only
                business email addresses are supported.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-between">
          <Button variant="outline" onClick={handleBack} disabled={loading}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleSkip} disabled={loading}>
              Skip for now
            </Button>
            <Button onClick={handleCreateOrganization} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  {validInviteCount > 0
                    ? `Create & Send ${validInviteCount} Invite${validInviteCount > 1 ? 's' : ''}`
                    : 'Create Organization'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
