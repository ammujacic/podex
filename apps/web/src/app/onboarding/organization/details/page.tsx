'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Building2, ArrowRight, Upload, Globe, Check } from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function OnboardingOrganizationDetailsPage() {
  useDocumentTitle('Create Organization - Details');
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [website, setWebsite] = useState('');
  const [_logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const generateSlug = (orgName: string) => {
    return orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleNameChange = (value: string) => {
    setName(value);
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

  const handleContinue = () => {
    // Store data in session storage for the wizard
    sessionStorage.setItem(
      'org-onboarding',
      JSON.stringify({
        name,
        slug,
        website,
        logoPreview,
      })
    );
    router.push('/onboarding/organization/credit-model');
  };

  const isValid = name.trim().length >= 2 && slug.trim().length >= 2;

  // Progress steps
  const steps = [
    { id: 'details', label: 'Details', active: true, completed: false },
    { id: 'credit-model', label: 'Credit Model', active: false, completed: false },
    { id: 'invite', label: 'Invite Team', active: false, completed: false },
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
          <h1 className="text-xl font-semibold text-text-primary mb-2">
            Let&apos;s set up your organization
          </h1>
          <p className="text-text-muted">Enter your organization details to get started</p>
        </div>

        <div className="space-y-5">
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
                <span className="inline-flex items-center gap-2 px-4 py-2 bg-elevated hover:bg-border-subtle text-text-primary rounded-lg transition-colors text-sm">
                  <Upload className="w-4 h-4" />
                  Upload Logo
                </span>
              </label>
            </div>
          </div>

          {/* Organization Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Organization Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Inc."
              className="w-full px-4 py-3 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              autoFocus
            />
          </div>

          {/* URL Slug */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">URL Slug *</label>
            <div className="flex items-center">
              <span className="px-4 py-3 bg-elevated border border-r-0 border-border-default rounded-l-lg text-text-muted text-sm">
                podex.ai/org/
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme-inc"
                className="flex-1 px-4 py-3 bg-elevated border border-border-default rounded-r-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
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
              <span className="px-4 py-3 bg-elevated border border-r-0 border-border-default rounded-l-lg text-text-muted">
                <Globe className="w-4 h-4" />
              </span>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://acme.com"
                className="flex-1 px-4 py-3 bg-elevated border border-border-default rounded-r-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Button onClick={handleContinue} disabled={!isValid}>
            Continue
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
