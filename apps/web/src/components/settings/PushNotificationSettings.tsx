'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, Loader2, Smartphone, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePWAStore } from '@/stores/pwa';
import {
  isPushSupported,
  getNotificationPermission,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
  getCurrentSubscription,
} from '@/lib/push-notifications';

export function PushNotificationSettings() {
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  const { pushPermission, pushSubscription, setPushPermission, setPushSubscription } =
    usePWAStore();

  const isSupported = isPushSupported();
  const isEnabled = pushPermission === 'granted' && pushSubscription !== null;
  const isBlocked = pushPermission === 'denied';

  // Check current subscription status on mount
  useEffect(() => {
    async function checkSubscription() {
      setIsChecking(true);
      try {
        const permission = getNotificationPermission();
        setPushPermission(permission === 'unsupported' ? 'unsupported' : permission);

        if (permission === 'granted') {
          const subscription = await getCurrentSubscription();
          setPushSubscription(subscription);
        }
      } catch (error) {
        console.error('Failed to check push subscription:', error);
      } finally {
        setIsChecking(false);
      }
    }

    checkSubscription();
  }, [setPushPermission, setPushSubscription]);

  const handleEnable = async () => {
    setIsLoading(true);
    try {
      await subscribeToPushNotifications();
    } catch (error) {
      console.error('Failed to enable push notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable = async () => {
    setIsLoading(true);
    try {
      await unsubscribeFromPushNotifications();
    } catch (error) {
      console.error('Failed to disable push notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking notification status...</span>
        </div>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-text-muted/10">
            <BellOff className="h-5 w-5 text-text-muted" />
          </div>
          <div>
            <p className="font-medium text-text-secondary">Push Notifications Not Supported</p>
            <p className="text-sm text-text-muted">
              Your browser does not support push notifications. Try using Chrome, Edge, Firefox, or
              Safari.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
      {/* Main toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              isEnabled ? 'bg-accent-primary/10' : 'bg-text-muted/10'
            )}
          >
            {isEnabled ? (
              <Bell className="h-5 w-5 text-accent-primary" />
            ) : (
              <BellOff className="h-5 w-5 text-text-muted" />
            )}
          </div>
          <div>
            <p className="font-medium text-text-primary">Push Notifications</p>
            <p className="text-sm text-text-muted">
              Get notified about agent completions, approvals, and important updates
            </p>
          </div>
        </div>

        <button
          onClick={isEnabled ? handleDisable : handleEnable}
          disabled={isLoading || isBlocked}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            isEnabled
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'bg-accent-primary text-white hover:bg-accent-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isBlocked ? (
            'Blocked'
          ) : isEnabled ? (
            'Disable'
          ) : (
            'Enable'
          )}
        </button>
      </div>

      {/* Blocked warning */}
      {isBlocked && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-300">Notifications Blocked</p>
              <p className="text-xs text-yellow-400/80 mt-0.5">
                You previously blocked notifications. To enable them, click the lock icon in your
                browser&apos;s address bar and change the notification permission to
                &quot;Allow&quot;.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* PWA hint */}
      {!isEnabled && !isBlocked && (
        <div className="p-3 rounded-lg bg-elevated border border-border-subtle">
          <div className="flex items-start gap-2">
            <Smartphone className="h-4 w-4 text-text-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-text-secondary">
                <span className="font-medium">Tip:</span> For the best experience on mobile, install
                Podex to your home screen first. Push notifications work best with installed PWAs.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
