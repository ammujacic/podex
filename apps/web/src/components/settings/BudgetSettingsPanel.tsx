'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { useCostStore, type Budget, type BudgetStatus, formatCost } from '@/stores/cost';
import {
  Shield,
  Plus,
  Trash2,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
  Loader2,
  X,
} from 'lucide-react';

interface BudgetSettingsPanelProps {
  className?: string;
  onCreateBudget?: (budget: Partial<Budget>) => Promise<void>;
  onDeleteBudget?: (budgetId: string) => Promise<void>;
}

export function BudgetSettingsPanel({
  className,
  onCreateBudget,
  onDeleteBudget,
}: BudgetSettingsPanelProps) {
  const { budgets, budgetStatuses, removeBudget } = useCostStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (budgetId: string) => {
    setDeletingId(budgetId);
    try {
      await onDeleteBudget?.(budgetId);
      removeBudget(budgetId);
    } catch (err) {
      console.error('Failed to delete budget:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async (budgetData: Partial<Budget>) => {
    try {
      await onCreateBudget?.(budgetData);
      setShowCreateDialog(false);
    } catch (err) {
      console.error('Failed to create budget:', err);
      throw err;
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-accent-primary" />
          <h2 className="text-lg font-semibold">Budget Limits</h2>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90"
        >
          <Plus className="w-4 h-4" />
          New Budget
        </button>
      </div>

      {/* Description */}
      <p className="text-sm text-text-muted">
        Set spending limits to control your usage. You&apos;ll receive alerts when approaching your
        budget limits.
      </p>

      {/* Budget List */}
      {budgets.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border-subtle">
          <Shield className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-50" />
          <p className="text-text-muted">No budgets configured</p>
          <p className="text-sm text-text-muted mt-1">
            Create a budget to track and limit your spending
          </p>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="mt-4 px-4 py-2 text-sm rounded bg-surface-secondary hover:bg-surface-hover"
          >
            Create Your First Budget
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {budgets.map((budget) => {
            const status = budgetStatuses.find((s) => s.budget.id === budget.id);
            return (
              <BudgetCard
                key={budget.id}
                budget={budget}
                status={status}
                onDelete={() => handleDelete(budget.id)}
                isDeleting={deletingId === budget.id}
              />
            );
          })}
        </div>
      )}

      {/* Budget Tips */}
      <div className="p-4 rounded-lg bg-surface-secondary border border-border-subtle">
        <h3 className="font-medium mb-2 flex items-center gap-2">
          <Settings className="w-4 h-4 text-accent-primary" />
          Budget Tips
        </h3>
        <ul className="text-sm text-text-secondary space-y-1.5">
          <li>• Set a monthly budget to track overall spending</li>
          <li>• Use session budgets for experimental or risky tasks</li>
          <li>• Enable hard limits to automatically stop usage when exceeded</li>
          <li>• Warning threshold alerts you before reaching the limit</li>
        </ul>
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <CreateBudgetDialog onClose={() => setShowCreateDialog(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

interface BudgetCardProps {
  budget: Budget;
  status?: BudgetStatus;
  onDelete: () => void;
  isDeleting: boolean;
}

function BudgetCard({ budget, status, onDelete, isDeleting }: BudgetCardProps) {
  const percentageUsed = status?.percentageUsed || 0;
  const isNearLimit = percentageUsed >= budget.warningThreshold * 100;
  const isOverLimit = percentageUsed >= 100;

  const periodLabels: Record<string, string> = {
    session: 'Per Session',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
  };

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        isOverLimit
          ? 'border-red-500/50'
          : isNearLimit
            ? 'border-yellow-500/50'
            : 'border-border-subtle'
      )}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">
                {budget.sessionId ? 'Session Budget' : `${periodLabels[budget.period]} Budget`}
              </h3>
              {budget.hardLimit && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/20 text-red-500">
                  Hard Limit
                </span>
              )}
            </div>
            {budget.sessionId && (
              <p className="text-xs text-text-muted mt-0.5">
                Session: {budget.sessionId.slice(0, 8)}...
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-500 disabled:opacity-50"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Budget Amount */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-bold font-mono">{formatCost(budget.amount)}</span>
          <span className="text-sm text-text-muted">limit</span>
        </div>

        {/* Progress */}
        {status && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">{formatCost(status.spent)} spent</span>
              <span
                className={cn(
                  'font-mono',
                  isOverLimit
                    ? 'text-red-500'
                    : isNearLimit
                      ? 'text-yellow-500'
                      : 'text-text-primary'
                )}
              >
                {percentageUsed.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-surface-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  isOverLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : 'bg-accent-primary'
                )}
                style={{ width: `${Math.min(percentageUsed, 100)}%` }}
              />
            </div>
            <p className="text-xs text-text-muted">{formatCost(status.remaining)} remaining</p>
          </div>
        )}

        {/* Settings */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border-subtle text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Warn at {budget.warningThreshold * 100}%
          </span>
          {budget.expiresAt && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Expires {new Date(budget.expiresAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface CreateBudgetDialogProps {
  onClose: () => void;
  onCreate: (budget: Partial<Budget>) => Promise<void>;
}

function CreateBudgetDialog({ onClose, onCreate }: CreateBudgetDialogProps) {
  const [amount, setAmount] = useState('10.00');
  const [period, setPeriod] = useState<Budget['period']>('monthly');
  const [warningThreshold, setWarningThreshold] = useState(80);
  const [hardLimit, setHardLimit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount');
      setIsSubmitting(false);
      return;
    }

    try {
      await onCreate({
        amount: parsedAmount,
        period,
        warningThreshold: warningThreshold / 100,
        hardLimit,
      });
    } catch {
      setError('Failed to create budget');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-surface-primary shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="font-semibold">Create Budget</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-sm font-medium mb-1">Budget Amount</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                className="w-full pl-9 pr-4 py-2 rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
                placeholder="10.00"
              />
            </div>
          </div>

          {/* Period */}
          <div>
            <label className="block text-sm font-medium mb-1">Budget Period</label>
            <div className="grid grid-cols-4 gap-2">
              {(['daily', 'weekly', 'monthly', 'session'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    'py-2 text-sm rounded border transition-colors',
                    period === p
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-border-subtle hover:bg-surface-hover'
                  )}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Warning Threshold */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Warning Threshold: {warningThreshold}%
            </label>
            <input
              type="range"
              min="50"
              max="95"
              step="5"
              value={warningThreshold}
              onChange={(e) => setWarningThreshold(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-text-muted mt-1">
              You&apos;ll be notified when spending reaches {warningThreshold}% of the budget
            </p>
          </div>

          {/* Hard Limit */}
          <div className="flex items-start gap-3 p-3 rounded bg-surface-secondary">
            <input
              type="checkbox"
              id="hardLimit"
              checked={hardLimit}
              onChange={(e) => setHardLimit(e.target.checked)}
              className="mt-0.5 rounded border-border-subtle"
            />
            <label htmlFor="hardLimit" className="flex-1 cursor-pointer">
              <span className="text-sm font-medium">Enable Hard Limit</span>
              <p className="text-xs text-text-muted mt-0.5">
                When enabled, usage will be blocked when the budget is exceeded
              </p>
            </label>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Create Budget
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BudgetSettingsPanel;
