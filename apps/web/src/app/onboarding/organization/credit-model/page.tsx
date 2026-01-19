'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, Check, Users, Wallet, TrendingUp } from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { CreditModel } from '@/stores/organization';

export default function OnboardingCreditModelPage() {
  useDocumentTitle('Create Organization - Credit Model');
  const router = useRouter();

  const [creditModel, setCreditModel] = useState<CreditModel>('pooled');

  // Check if we have org data from previous step
  useEffect(() => {
    const data = sessionStorage.getItem('org-onboarding');
    if (!data) {
      router.replace('/onboarding/organization/details');
    }
  }, [router]);

  const handleContinue = () => {
    const existing = JSON.parse(sessionStorage.getItem('org-onboarding') || '{}');
    sessionStorage.setItem('org-onboarding', JSON.stringify({ ...existing, creditModel }));
    router.push('/onboarding/organization/invite');
  };

  const handleBack = () => {
    router.push('/onboarding/organization/details');
  };

  const creditModelOptions = [
    {
      value: 'pooled' as CreditModel,
      icon: Users,
      label: 'Pooled Credits',
      description:
        'All team members share credits from a central pool. Set individual spending caps to control usage.',
      pros: ['Simple to manage', 'Flexible allocation', 'Great for small teams'],
      recommended: true,
    },
    {
      value: 'allocated' as CreditModel,
      icon: Wallet,
      label: 'Allocated Credits',
      description:
        'Pre-assign specific credit amounts to each member. Members can only use their allocated credits.',
      pros: ['Fixed budgets', 'Full control', 'Predictable spending'],
      recommended: false,
    },
    {
      value: 'usage_based' as CreditModel,
      icon: TrendingUp,
      label: 'Usage Based',
      description:
        'Track usage and bill at the end of each period. Set caps to prevent unexpected charges.',
      pros: ['Pay only for usage', 'No upfront purchase', 'Flexible scaling'],
      recommended: false,
    },
  ];

  // Progress steps
  const steps = [
    { id: 'details', label: 'Details', active: false, completed: true },
    { id: 'credit-model', label: 'Credit Model', active: true, completed: false },
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
          <h1 className="text-xl font-semibold text-text-primary mb-2">Choose your credit model</h1>
          <p className="text-text-muted">
            Select how credits will be managed for your team. You can change this later.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {creditModelOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = creditModel === option.value;

            return (
              <label
                key={option.value}
                className={`relative flex items-start gap-4 p-5 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'border-accent-primary bg-accent-primary/5'
                    : 'border-border-default hover:border-border-subtle'
                }`}
              >
                {/* Radio */}
                <input
                  type="radio"
                  name="creditModel"
                  value={option.value}
                  checked={isSelected}
                  onChange={(e) => setCreditModel(e.target.value as CreditModel)}
                  className="mt-1"
                />

                {/* Content */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon
                      className={`w-5 h-5 ${isSelected ? 'text-accent-primary' : 'text-text-muted'}`}
                    />
                    <h3 className="font-medium text-text-primary">{option.label}</h3>
                    {option.recommended && (
                      <span className="px-2 py-0.5 bg-accent-primary/10 text-accent-primary text-xs font-medium rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mb-3">{option.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {option.pros.map((pro, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 text-xs text-text-secondary"
                      >
                        <Check className="w-3 h-3 text-accent-success" />
                        {pro}
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleContinue}>
            Continue
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
