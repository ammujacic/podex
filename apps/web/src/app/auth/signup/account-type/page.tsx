'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  Building2,
  ArrowRight,
  Check,
  Loader2,
  Users,
  CreditCard,
  Shield,
  Zap,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useUser } from '@/stores/auth';

type AccountType = 'personal' | 'organization';

export default function AccountTypePage() {
  useDocumentTitle('Choose Account Type');
  const router = useRouter();
  const searchParams = useSearchParams();
  useUser(); // Ensure user auth state is loaded
  const returnTo = searchParams.get('returnTo');

  const [selectedType, setSelectedType] = useState<AccountType | null>(null);
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!selectedType) return;

    setLoading(true);
    try {
      if (selectedType === 'personal') {
        // For personal accounts, proceed directly to the app
        // Account type is already set to 'personal' by default, no API call needed
        router.push(returnTo || '/session/new');
      } else {
        // For organization accounts, go to org onboarding wizard
        router.push('/onboarding/organization/details');
      }
    } finally {
      setLoading(false);
    }
  };

  const accountOptions = [
    {
      type: 'personal' as AccountType,
      icon: User,
      title: 'Personal',
      description: 'For individual developers and freelancers',
      features: [
        'Personal workspace and projects',
        'Pay-as-you-go billing',
        'All AI models and features',
        'Upgrade anytime',
      ],
    },
    {
      type: 'organization' as AccountType,
      icon: Building2,
      title: 'Team / Organization',
      description: 'For teams and companies with centralized billing',
      features: [
        'Invite unlimited team members',
        'Centralized billing and credits',
        'Per-member usage limits and controls',
        'Admin dashboard and reporting',
      ],
      badge: 'Great for teams',
    },
  ];

  return (
    <div className="w-full max-w-2xl">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text-primary mb-2">How will you be using Podex?</h1>
        <p className="text-text-secondary">
          Choose the account type that fits your needs. You can always change this later.
        </p>
      </div>

      <div className="grid gap-4 mb-8">
        {accountOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = selectedType === option.type;

          return (
            <button
              key={option.type}
              onClick={() => setSelectedType(option.type)}
              className={`relative flex items-start gap-4 p-6 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-accent-primary bg-accent-primary/5 ring-2 ring-accent-primary/20'
                  : 'border-border-default bg-surface hover:border-border-subtle'
              }`}
            >
              {/* Badge */}
              {option.badge && (
                <span className="absolute top-4 right-4 px-2 py-1 bg-accent-secondary/10 text-accent-secondary text-xs font-medium rounded">
                  {option.badge}
                </span>
              )}

              {/* Radio indicator */}
              <div
                className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                  isSelected ? 'border-accent-primary bg-accent-primary' : 'border-border-default'
                }`}
              >
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Icon
                    className={`w-5 h-5 ${isSelected ? 'text-accent-primary' : 'text-text-muted'}`}
                  />
                  <h2 className="text-lg font-semibold text-text-primary">{option.title}</h2>
                </div>
                <p className="text-text-muted text-sm mb-4">{option.description}</p>
                <ul className="space-y-2">
                  {option.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm text-text-secondary">
                      <Check className="w-4 h-4 text-accent-success flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>

      {/* Organization Benefits Highlight */}
      {selectedType === 'organization' && (
        <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-xl p-5 mb-8">
          <h3 className="font-medium text-text-primary mb-3 flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent-primary" />
            Organization Benefits
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-accent-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">Team Management</p>
                <p className="text-xs text-text-muted">Invite and manage team members</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CreditCard className="w-4 h-4 text-accent-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">Centralized Billing</p>
                <p className="text-xs text-text-muted">One bill for the whole team</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-accent-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">Usage Controls</p>
                <p className="text-xs text-text-muted">Set limits per member</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Button
          onClick={handleContinue}
          disabled={!selectedType || loading}
          className="w-full"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Setting up...
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>

        <Link
          href={returnTo || '/session/new'}
          className="text-center text-sm text-text-muted hover:text-text-primary"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}
