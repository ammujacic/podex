'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useCostStore, type BudgetAlert, formatCost } from '@/stores/cost';
import {
  X,
  AlertTriangle,
  AlertOctagon,
  TrendingUp,
  Bell,
  CheckCircle,
  DollarSign,
  Shield,
} from 'lucide-react';

interface BudgetAlertDialogProps {
  alert: BudgetAlert;
  onClose: () => void;
  onAcknowledge?: (alertId: string) => void;
  className?: string;
}

export function BudgetAlertDialog({
  alert,
  onClose,
  onAcknowledge,
  className,
}: BudgetAlertDialogProps) {
  const acknowledgeAlert = useCostStore((state) => state.acknowledgeAlert);

  const handleAcknowledge = () => {
    acknowledgeAlert(alert.id);
    onAcknowledge?.(alert.id);
    onClose();
  };

  const getIcon = () => {
    switch (alert.alertType) {
      case 'budget_exceeded':
        return <AlertOctagon className="w-6 h-6" />;
      case 'threshold_warning':
        return <AlertTriangle className="w-6 h-6" />;
      case 'unusual_spike':
        return <TrendingUp className="w-6 h-6" />;
      default:
        return <Bell className="w-6 h-6" />;
    }
  };

  const getSeverityStyles = () => {
    switch (alert.severity) {
      case 'critical':
        return {
          bg: 'bg-red-500/10',
          border: 'border-red-500',
          icon: 'text-red-500',
          button: 'bg-red-500 hover:bg-red-600',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-500/10',
          border: 'border-yellow-500',
          icon: 'text-yellow-500',
          button: 'bg-yellow-500 hover:bg-yellow-600',
        };
      default:
        return {
          bg: 'bg-blue-500/10',
          border: 'border-blue-500',
          icon: 'text-blue-500',
          button: 'bg-blue-500 hover:bg-blue-600',
        };
    }
  };

  const styles = getSeverityStyles();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className={cn(
          'w-full max-w-md rounded-lg bg-surface-primary shadow-xl border',
          styles.border,
          className
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-start justify-between p-4 border-b border-border-subtle',
            styles.bg
          )}
        >
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-lg', styles.bg, styles.icon)}>{getIcon()}</div>
            <div>
              <h2 className="font-semibold text-lg">
                {alert.alertType === 'budget_exceeded'
                  ? 'Budget Exceeded'
                  : alert.alertType === 'threshold_warning'
                    ? 'Budget Warning'
                    : alert.alertType === 'unusual_spike'
                      ? 'Unusual Spending'
                      : 'Budget Alert'}
              </h2>
              <p className="text-xs text-text-muted">
                {new Date(alert.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-text-secondary">{alert.message}</p>

          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted">Usage Progress</span>
              <span className="text-sm font-mono">
                {formatCost(alert.currentSpent)} / {formatCost(alert.budgetAmount)}
              </span>
            </div>
            <div className="h-3 bg-surface-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  alert.severity === 'critical'
                    ? 'bg-red-500'
                    : alert.severity === 'warning'
                      ? 'bg-yellow-500'
                      : 'bg-blue-500'
                )}
                style={{ width: `${Math.min(alert.percentageUsed, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-text-muted">
              <span>0%</span>
              <span className="font-medium">{alert.percentageUsed.toFixed(1)}%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Info Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-surface-secondary">
              <div className="flex items-center gap-2 text-text-muted mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs">Current Spent</span>
              </div>
              <p className="text-lg font-mono font-medium">{formatCost(alert.currentSpent)}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-secondary">
              <div className="flex items-center gap-2 text-text-muted mb-1">
                <Shield className="w-4 h-4" />
                <span className="text-xs">Budget Limit</span>
              </div>
              <p className="text-lg font-mono font-medium">{formatCost(alert.budgetAmount)}</p>
            </div>
          </div>

          {/* Recommendations */}
          {alert.alertType === 'budget_exceeded' && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <h4 className="text-sm font-medium text-red-500 mb-2">Recommended Actions</h4>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Increase your budget limit if needed</li>
                <li>• Review which agents are consuming the most</li>
                <li>• Consider using more cost-effective models</li>
              </ul>
            </div>
          )}

          {alert.alertType === 'unusual_spike' && (
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <h4 className="text-sm font-medium text-yellow-500 mb-2">What&apos;s happening?</h4>
              <p className="text-sm text-text-secondary">
                Your spending in the last hour is significantly higher than your average. This could
                be due to complex tasks or multiple agents running in parallel.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded hover:bg-surface-hover transition-colors"
          >
            Close
          </button>
          {!alert.acknowledged && (
            <button
              onClick={handleAcknowledge}
              className={cn(
                'px-4 py-2 text-sm rounded text-white flex items-center gap-2 transition-colors',
                styles.button
              )}
            >
              <CheckCircle className="w-4 h-4" />
              Acknowledge
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Alert Bell with badge for header
interface AlertBellProps {
  className?: string;
  onClick?: () => void;
}

export function AlertBell({ className, onClick }: AlertBellProps) {
  const { alerts, unreadAlertCount } = useCostStore();

  const latestCritical = alerts.find((a) => !a.acknowledged && a.severity === 'critical');

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative p-2 rounded-lg hover:bg-surface-hover transition-colors',
        latestCritical && 'animate-pulse',
        className
      )}
      title={unreadAlertCount > 0 ? `${unreadAlertCount} unread alerts` : 'No alerts'}
    >
      <Bell
        className={cn(
          'w-5 h-5',
          latestCritical
            ? 'text-red-500'
            : unreadAlertCount > 0
              ? 'text-yellow-500'
              : 'text-text-muted'
        )}
      />
      {unreadAlertCount > 0 && (
        <span
          className={cn(
            'absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-white text-xs font-bold',
            latestCritical ? 'bg-red-500' : 'bg-yellow-500'
          )}
        >
          {unreadAlertCount > 9 ? '9+' : unreadAlertCount}
        </span>
      )}
    </button>
  );
}

// Alert List for sidebar or dropdown
interface AlertListProps {
  className?: string;
  onAlertClick?: (alert: BudgetAlert) => void;
  limit?: number;
}

export function AlertList({ className, onAlertClick, limit = 5 }: AlertListProps) {
  const { alerts } = useCostStore();

  const displayAlerts = alerts.slice(0, limit);

  if (displayAlerts.length === 0) {
    return (
      <div className={cn('p-4 text-center text-text-muted', className)}>
        <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No alerts</p>
      </div>
    );
  }

  return (
    <div className={cn('divide-y divide-border-subtle', className)}>
      {displayAlerts.map((alert) => (
        <button
          key={alert.id}
          onClick={() => onAlertClick?.(alert)}
          className={cn(
            'w-full p-3 text-left hover:bg-surface-hover transition-colors flex items-start gap-3',
            !alert.acknowledged && 'bg-surface-secondary/50'
          )}
        >
          <div
            className={cn(
              'p-1.5 rounded',
              alert.severity === 'critical'
                ? 'bg-red-500/20 text-red-500'
                : alert.severity === 'warning'
                  ? 'bg-yellow-500/20 text-yellow-500'
                  : 'bg-blue-500/20 text-blue-500'
            )}
          >
            {alert.alertType === 'budget_exceeded' ? (
              <AlertOctagon className="w-4 h-4" />
            ) : alert.alertType === 'unusual_spike' ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-sm truncate', !alert.acknowledged && 'font-medium')}>
              {alert.message}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{formatRelativeTime(alert.createdAt)}</p>
          </div>
          {!alert.acknowledged && (
            <div className="w-2 h-2 rounded-full bg-accent-primary flex-shrink-0 mt-2" />
          )}
        </button>
      ))}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export default BudgetAlertDialog;
