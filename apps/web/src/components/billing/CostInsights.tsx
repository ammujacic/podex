'use client';

import { useEffect, useState } from 'react';
import {
  Lightbulb,
  TrendingDown,
  ArrowRight,
  Zap,
  DollarSign,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Check,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types matching the backend API
interface CostSummary {
  current_month_cost: number;
  last_month_cost: number;
  month_over_month_change: number;
  projected_monthly_cost: number;
  total_tokens_used: number;
  total_compute_minutes: number;
  potential_savings: number;
}

interface CostSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  estimated_savings: number;
  savings_percent: number;
  priority: string;
  actionable: boolean;
  action_label: string | null;
  affected_usage: string | null;
}

interface ModelComparison {
  current_model: string;
  current_cost: number;
  alternatives: {
    model: string;
    cost: number;
    savings: number;
    quality_impact: string;
  }[];
}

interface CostForecast {
  dates: string[];
  projected_costs: number[];
  current_trend_costs: number[];
  optimized_costs: number[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const priorityColors: Record<string, string> = {
  high: 'border-accent-error/30 bg-accent-error/5',
  medium: 'border-amber-500/30 bg-amber-500/5',
  low: 'border-accent-success/30 bg-accent-success/5',
};

const priorityBadgeColors: Record<string, string> = {
  high: 'bg-accent-error/20 text-accent-error',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-accent-success/20 text-accent-success',
};

const typeIcons: Record<string, React.ElementType> = {
  model_downgrade: Zap,
  context_reduction: BarChart3,
  caching: RefreshCw,
  batch_operations: DollarSign,
};

function SuggestionCard({
  suggestion,
  onApply,
}: {
  suggestion: CostSuggestion;
  onApply?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = typeIcons[suggestion.type] || Lightbulb;

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        priorityColors[suggestion.priority] || 'border-border-default bg-surface'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-overlay">
          <Icon className="w-4 h-4 text-accent-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-text-primary text-sm">{suggestion.title}</h4>
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium',
                priorityBadgeColors[suggestion.priority]
              )}
            >
              {suggestion.priority}
            </span>
          </div>

          <p className="text-xs text-text-muted line-clamp-2">{suggestion.description}</p>

          {expanded && suggestion.affected_usage && (
            <div className="mt-3 p-2 bg-overlay rounded text-xs text-text-secondary">
              <span className="text-text-muted">Affected usage:</span> {suggestion.affected_usage}
            </div>
          )}

          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-1 text-accent-success">
              <TrendingDown className="w-3.5 h-3.5" />
              <span className="text-sm font-medium">
                Save {formatCurrency(suggestion.estimated_savings)}/mo
              </span>
              <span className="text-xs text-text-muted">({suggestion.savings_percent}%)</span>
            </div>

            {suggestion.actionable && suggestion.action_label && onApply && (
              <button
                onClick={() => onApply(suggestion.id)}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/90 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {suggestion.action_label}
                <ArrowRight className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 text-text-muted hover:text-text-primary transition-colors"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelComparisonTable({ data }: { data: ModelComparison }) {
  return (
    <div className="bg-surface rounded-lg border border-border-default overflow-hidden">
      <div className="p-4 border-b border-border-subtle">
        <h3 className="font-medium text-text-primary">Model Cost Comparison</h3>
        <p className="text-xs text-text-muted mt-1">
          Current model: <span className="text-text-secondary">{data.current_model}</span> (
          {formatCurrency(data.current_cost)}/mo)
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-overlay text-text-muted text-xs">
            <th className="px-4 py-2 text-left font-medium">Alternative Model</th>
            <th className="px-4 py-2 text-right font-medium">Est. Cost</th>
            <th className="px-4 py-2 text-right font-medium">Savings</th>
            <th className="px-4 py-2 text-left font-medium">Quality Impact</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {data.alternatives.map((alt) => (
            <tr key={alt.model} className="hover:bg-overlay/50">
              <td className="px-4 py-3 text-text-primary font-mono text-xs">{alt.model}</td>
              <td className="px-4 py-3 text-right text-text-secondary">
                {formatCurrency(alt.cost)}
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-accent-success font-medium">
                  -{formatCurrency(alt.savings)}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-xs',
                    alt.quality_impact === 'none'
                      ? 'bg-accent-success/20 text-accent-success'
                      : alt.quality_impact === 'minimal'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-accent-error/20 text-accent-error'
                  )}
                >
                  {alt.quality_impact === 'none'
                    ? 'No impact'
                    : alt.quality_impact === 'minimal'
                      ? 'Minimal'
                      : 'Moderate'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniSparkline({ values, color = 'accent-primary' }: { values: number[]; color?: string }) {
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="w-20 h-8" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={`var(--color-${color})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CostInsights() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [suggestions, setSuggestions] = useState<CostSuggestion[]>([]);
  const [modelComparison, setModelComparison] = useState<ModelComparison | null>(null);
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    async function loadInsights() {
      try {
        setLoading(true);
        setError(null);

        const [summaryRes, suggestionsRes, comparisonRes, forecastRes] = await Promise.all([
          fetch('/api/v1/cost-insights/summary').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/v1/cost-insights/suggestions').then((r) => (r.ok ? r.json() : [])),
          fetch('/api/v1/cost-insights/model-comparison').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/v1/cost-insights/forecast').then((r) => (r.ok ? r.json() : null)),
        ]);

        setSummary(summaryRes);
        setSuggestions(suggestionsRes);
        setModelComparison(comparisonRes);
        setForecast(forecastRes);
      } catch (err) {
        setError('Failed to load cost insights');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadInsights();
  }, []);

  const handleApplySuggestion = async (_id: string) => {
    // In production, this would call an API to apply the optimization
    // TODO: Implement suggestion application - would require backend support for plan changes, quota adjustments, etc.
    // For now, just show a success message
    console.warn('Applying suggestion:', _id);
    // Could call something like:
    // await api.post('/api/cost-insights/apply-suggestion', { suggestion_id: _id });
  };

  if (loading) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-6 animate-pulse">
        <div className="h-6 bg-overlay rounded w-1/4 mb-4" />
        <div className="h-20 bg-overlay rounded mb-4" />
        <div className="space-y-3">
          <div className="h-16 bg-overlay rounded" />
          <div className="h-16 bg-overlay rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-6">
        <div className="flex items-center gap-2 text-accent-error">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const hasSuggestions = suggestions.length > 0;
  const totalPotentialSavings = suggestions.reduce((sum, s) => sum + s.estimated_savings, 0);

  return (
    <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-overlay/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent-primary/10">
            <Lightbulb className="w-5 h-5 text-accent-primary" />
          </div>
          <div className="text-left">
            <h2 className="font-semibold text-text-primary">Cost Optimization Insights</h2>
            {hasSuggestions ? (
              <p className="text-xs text-accent-success">
                {suggestions.length} suggestions · Save up to{' '}
                {formatCurrency(totalPotentialSavings)}/mo
              </p>
            ) : (
              <p className="text-xs text-text-muted">Your usage is already optimized!</p>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-text-muted" />
        ) : (
          <ChevronDown className="w-5 h-5 text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border-subtle">
          {/* Cost Summary */}
          {summary && (
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-border-subtle bg-overlay/30">
              <div>
                <div className="text-xs text-text-muted mb-1">This Month</div>
                <div className="text-lg font-semibold text-text-primary">
                  {formatCurrency(summary.current_month_cost)}
                </div>
                {summary.month_over_month_change !== 0 && (
                  <div
                    className={cn(
                      'text-xs',
                      summary.month_over_month_change > 0
                        ? 'text-accent-error'
                        : 'text-accent-success'
                    )}
                  >
                    {summary.month_over_month_change > 0 ? '+' : ''}
                    {summary.month_over_month_change.toFixed(1)}% vs last month
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-text-muted mb-1">Projected</div>
                <div className="text-lg font-semibold text-text-primary">
                  {formatCurrency(summary.projected_monthly_cost)}
                </div>
                <div className="text-xs text-text-muted">by end of month</div>
              </div>

              <div>
                <div className="text-xs text-text-muted mb-1">Potential Savings</div>
                <div className="text-lg font-semibold text-accent-success">
                  {formatCurrency(summary.potential_savings)}
                </div>
                <div className="text-xs text-text-muted">/month</div>
              </div>

              <div>
                <div className="text-xs text-text-muted mb-1">Trend</div>
                <div className="flex items-end gap-2">
                  {forecast && <MiniSparkline values={forecast.projected_costs} />}
                </div>
              </div>
            </div>
          )}

          {/* Suggestions */}
          {hasSuggestions ? (
            <div className="p-4 space-y-3">
              <h3 className="text-sm font-medium text-text-secondary mb-3">
                Optimization Suggestions
              </h3>
              {suggestions.slice(0, 3).map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  onApply={handleApplySuggestion}
                />
              ))}

              {suggestions.length > 3 && (
                <button className="w-full py-2 text-sm text-accent-primary hover:text-accent-primary/80 transition-colors">
                  View {suggestions.length - 3} more suggestions
                </button>
              )}
            </div>
          ) : (
            <div className="p-8 text-center">
              <Check className="w-12 h-12 text-accent-success mx-auto mb-3" />
              <p className="text-text-primary font-medium">All optimized!</p>
              <p className="text-sm text-text-muted mt-1">
                Your usage patterns are efficient. We'll notify you when we find new opportunities.
              </p>
            </div>
          )}

          {/* Model Comparison */}
          {modelComparison && modelComparison.alternatives.length > 0 && (
            <div className="p-4 border-t border-border-subtle">
              <ModelComparisonTable data={modelComparison} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
