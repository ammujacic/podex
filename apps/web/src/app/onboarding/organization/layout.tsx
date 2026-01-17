'use client';

import { Building2 } from 'lucide-react';
import Link from 'next/link';

export default function OnboardingOrganizationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-void flex flex-col">
      {/* Header */}
      <header className="border-b border-border-subtle">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent-primary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">P</span>
            </div>
            <span className="text-xl font-semibold text-text-primary">Podex</span>
          </Link>
          <div className="flex items-center gap-2 text-text-muted">
            <Building2 className="w-5 h-5" />
            <span className="text-sm">Organization Setup</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
