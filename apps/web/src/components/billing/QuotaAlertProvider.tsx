'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { UsageAlertBanner, type QuotaStatus } from './UsageAlertBanner';
import { useOrgContext } from '@/stores/organization';

interface QuotaAlertContextType {
  userQuotas: QuotaStatus[];
  orgQuotas: QuotaStatus[];
  refreshQuotas: () => Promise<void>;
}

const QuotaAlertContext = createContext<QuotaAlertContextType>({
  userQuotas: [],
  orgQuotas: [],
  refreshQuotas: async () => {},
});

export const useQuotaAlert = () => useContext(QuotaAlertContext);

interface QuotaAlertProviderProps {
  children: ReactNode;
  showBanner?: boolean;
}

export function QuotaAlertProvider({ children, showBanner = true }: QuotaAlertProviderProps) {
  const [userQuotas, setUserQuotas] = useState<QuotaStatus[]>([]);
  const [orgQuotas, setOrgQuotas] = useState<QuotaStatus[]>([]);
  const orgContext = useOrgContext();
  const isOrgAdmin = orgContext?.role === 'owner' || orgContext?.role === 'admin';
  const orgId = orgContext?.organization?.id;

  const fetchQuotas = useCallback(async () => {
    try {
      // Fetch user quotas
      const userResponse = await fetch('/api/billing/quotas', {
        credentials: 'include',
      });
      if (userResponse.ok) {
        const data = await userResponse.json();
        const quotas: QuotaStatus[] = (data.quotas || []).map(
          (q: {
            quota_type: string;
            current_usage: number;
            limit_value: number;
            unit: string;
          }) => ({
            quotaType: q.quota_type,
            currentUsage: q.current_usage,
            limitValue: q.limit_value,
            unit: q.unit,
          })
        );
        setUserQuotas(quotas);
      }

      // Fetch org quotas if user is admin
      if (isOrgAdmin && orgId) {
        const orgResponse = await fetch(`/api/organizations/${orgId}/billing/summary`, {
          credentials: 'include',
        });
        if (orgResponse.ok) {
          const data = await orgResponse.json();
          // Convert org data to quota format (credit pool usage)
          const orgQuotaList: QuotaStatus[] = [];

          // If org has a credit pool, show usage
          if (data.credit_pool_cents !== undefined && data.credit_pool_initial_cents) {
            orgQuotaList.push({
              quotaType: 'credits',
              currentUsage: data.credit_pool_initial_cents - data.credit_pool_cents,
              limitValue: data.credit_pool_initial_cents,
              unit: 'cents',
            });
          }

          setOrgQuotas(orgQuotaList);
        }
      }
    } catch {
      // Silently fail - quotas are optional
    }
  }, [isOrgAdmin, orgId]);

  useEffect(() => {
    fetchQuotas();
    // Refresh every 5 minutes
    const interval = setInterval(fetchQuotas, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchQuotas]);

  return (
    <QuotaAlertContext.Provider value={{ userQuotas, orgQuotas, refreshQuotas: fetchQuotas }}>
      {showBanner && (
        <>
          {/* Show user quota alerts if not in org context */}
          {!orgContext && userQuotas.length > 0 && (
            <UsageAlertBanner quotas={userQuotas} isOrg={false} />
          )}
          {/* Show org quota alerts for admins */}
          {isOrgAdmin && orgQuotas.length > 0 && (
            <UsageAlertBanner quotas={orgQuotas} isOrg={true} />
          )}
        </>
      )}
      {children}
    </QuotaAlertContext.Provider>
  );
}
