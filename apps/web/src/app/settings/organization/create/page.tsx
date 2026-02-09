'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  Check,
  Upload,
  Globe,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOrganizationStore, type CreditModel, type Organization } from '@/stores/organization';

type Step = 'details' | 'credit-model' | 'confirm';

type OrganizationResponse = Organization;

export default function CreateOrganizationPage() {
  useDocumentTitle('Create Organization');
  const router = useRouter();
  const { setContext: _setContext } = useOrganizationStore();

  const [step, setStep] = useState<Step>('details');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [website, setWebsite] = useState('');
  const [_logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [creditModel, setCreditModel] = useState<CreditModel>('pooled');

  const generateSlug = (orgName: string) => {
    return orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate slug if user hasn't manually edited it
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(value));
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Logo upload not yet implemented - would need user-level image upload endpoint
      const logoUrl = null;

      // Create organization via API
      const response = (await api.post('/api/organizations/', {
        name,
        slug: slug || null,
        website: website || null,
        logo_url: logoUrl,
        credit_model: creditModel,
      })) as OrganizationResponse;

      // Update store with new context
      _setContext({
        organization: response,
        role: 'owner',
        isBlocked: false,
        limits: {
          spendingLimitCents: null,
          currentSpendingCents: 0,
          remainingSpendingCents: null,
          allocatedCreditsCents: 0,
          usedCreditsCents: 0,
          remainingAllocatedCents: 0,
          allowedModels: null,
          allowedInstanceTypes: null,
          storageLimitGb: null,
          isAtLimit: false,
        },
      });

      // Redirect to organization page
      router.push('/settings/organization');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

  const creditModelOptions = [
    {
      value: 'pooled' as CreditModel,
      label: 'Pooled Credits',
      description:
        'All team members share credits from a central pool. Each member can have an individual spending cap to control usage.',
      features: [
        'Simple and flexible',
        'Members draw from shared pool',
        'Individual spending caps available',
        'Ideal for small to medium teams',
      ],
    },
    {
      value: 'allocated' as CreditModel,
      label: 'Allocated Credits',
      description:
        'Pre-assign specific credit amounts to each team member. Members can only use their allocated credits.',
      features: [
        'Full control over distribution',
        'Fixed budgets per member',
        'Members cannot exceed allocation',
        'Ideal for strict budget management',
      ],
    },
    {
      value: 'usage_based' as CreditModel,
      label: 'Usage Based',
      description:
        'Track usage throughout the billing period and bill at the end. Members have spending caps that block usage when reached.',
      features: [
        'Pay for what you use',
        'Usage tracking and reporting',
        'Spending caps prevent overages',
        'Ideal for variable usage patterns',
      ],
    },
  ];

  const canProceedFromDetails = name.trim().length >= 2 && slug.trim().length >= 2;

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings/organization"
          className="inline-flex items-center text-sm text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Link>
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
          <Building2 className="w-6 h-6" />
          Create Organization
        </h1>
        <p className="text-text-muted mt-1">
          Set up your organization for team collaboration and centralized billing
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-4 mb-8">
        {['details', 'credit-model', 'confirm'].map((s, index) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s
                  ? 'bg-accent-primary text-white'
                  : index < ['details', 'credit-model', 'confirm'].indexOf(step)
                    ? 'bg-accent-success text-white'
                    : 'bg-elevated text-text-muted'
              }`}
            >
              {index < ['details', 'credit-model', 'confirm'].indexOf(step) ? (
                <Check className="w-4 h-4" />
              ) : (
                index + 1
              )}
            </div>
            <span
              className={`text-sm ${step === s ? 'text-text-primary font-medium' : 'text-text-muted'}`}
            >
              {s === 'details' && 'Details'}
              {s === 'credit-model' && 'Credit Model'}
              {s === 'confirm' && 'Confirm'}
            </span>
            {index < 2 && <div className="w-8 h-px bg-border-default" />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {step === 'details' && (
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <h2 className="text-lg font-medium text-text-primary mb-4">Organization Details</h2>
          <div className="space-y-4">
            {/* Logo Upload */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Logo (optional)
              </label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <Image
                    src={logoPreview}
                    alt="Logo preview"
                    width={64}
                    height={64}
                    className="w-16 h-16 rounded-xl object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 bg-elevated rounded-xl flex items-center justify-center">
                    <Building2 className="w-8 h-8 text-text-muted" />
                  </div>
                )}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="hidden"
                  />
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-elevated hover:bg-border-subtle text-text-primary rounded-lg transition-colors">
                    <Upload className="w-4 h-4" />
                    Upload
                  </span>
                </label>
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Organization Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Inc."
                className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              />
            </div>

            {/* Slug */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                URL Slug *
              </label>
              <div className="flex items-center">
                <span className="px-3 py-2 bg-elevated border border-r-0 border-border-default rounded-l-lg text-text-muted text-sm">
                  podex.ai/org/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="acme-inc"
                  className="flex-1 px-3 py-2 bg-elevated border border-border-default rounded-r-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <p className="text-xs text-text-muted mt-1">
                Only lowercase letters, numbers, and hyphens
              </p>
            </div>

            {/* Website */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Website (optional)
              </label>
              <div className="flex items-center">
                <span className="px-3 py-2 bg-elevated border border-r-0 border-border-default rounded-l-lg text-text-muted">
                  <Globe className="w-4 h-4" />
                </span>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://acme.com"
                  className="flex-1 px-3 py-2 bg-elevated border border-border-default rounded-r-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <Button onClick={() => setStep('credit-model')} disabled={!canProceedFromDetails}>
              Continue
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {step === 'credit-model' && (
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <h2 className="text-lg font-medium text-text-primary mb-2">Choose Credit Model</h2>
          <p className="text-text-muted text-sm mb-6">
            Select how credits will be managed for your team. You can change this later.
          </p>

          <div className="space-y-4">
            {creditModelOptions.map((option) => (
              <label
                key={option.value}
                className={`block p-4 rounded-xl border cursor-pointer transition-colors ${
                  creditModel === option.value
                    ? 'border-accent-primary bg-accent-primary/5'
                    : 'border-border-default hover:border-border-subtle'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="creditModel"
                    value={option.value}
                    checked={creditModel === option.value}
                    onChange={(e) => setCreditModel(e.target.value as CreditModel)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">{option.label}</p>
                    <p className="text-sm text-text-muted mt-1">{option.description}</p>
                    <ul className="mt-3 space-y-1">
                      {option.features.map((feature, index) => (
                        <li
                          key={index}
                          className="flex items-center gap-2 text-sm text-text-secondary"
                        >
                          <Check className="w-4 h-4 text-accent-success" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={() => setStep('details')}>
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button onClick={() => setStep('confirm')}>
              Continue
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <h2 className="text-lg font-medium text-text-primary mb-4">Confirm & Create</h2>

          {error && (
            <div className="mb-4 p-4 bg-accent-error/10 border border-accent-error/30 rounded-lg text-accent-error text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4 mb-6">
            {/* Summary */}
            <div className="bg-elevated rounded-xl p-4">
              <div className="flex items-center gap-4 mb-4">
                {logoPreview ? (
                  <Image
                    src={logoPreview}
                    alt={name}
                    width={56}
                    height={56}
                    className="w-14 h-14 rounded-xl object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 bg-surface rounded-xl flex items-center justify-center">
                    <Building2 className="w-7 h-7 text-text-muted" />
                  </div>
                )}
                <div>
                  <p className="font-semibold text-text-primary text-lg">{name}</p>
                  <p className="text-sm text-text-muted">podex.ai/org/{slug}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-text-muted mb-1">Credit Model</p>
                  <p className="text-sm font-medium text-text-primary capitalize">
                    {creditModel.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-1">Your Role</p>
                  <p className="text-sm font-medium text-text-primary flex items-center gap-1">
                    <Shield className="w-4 h-4 text-yellow-500" />
                    Owner
                  </p>
                </div>
                {website && (
                  <div className="col-span-2">
                    <p className="text-xs text-text-muted mb-1">Website</p>
                    <p className="text-sm text-text-primary">{website}</p>
                  </div>
                )}
              </div>
            </div>

            {/* What happens next */}
            <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-xl p-4">
              <p className="font-medium text-text-primary mb-2">What happens next:</p>
              <ul className="space-y-2 text-sm text-text-secondary">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-accent-primary mt-0.5" />
                  <span>
                    Your personal billing will be paused while you&apos;re in the organization
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-accent-primary mt-0.5" />
                  <span>You can invite team members immediately</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-accent-primary mt-0.5" />
                  <span>Purchase credits to get started</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('credit-model')}>
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleCreate} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Building2 className="w-4 h-4 mr-2" />
                  Create Organization
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
