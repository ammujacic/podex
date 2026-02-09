'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function OnboardingOrganizationPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the first step
    router.replace('/onboarding/organization/details');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
    </div>
  );
}
