'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Book,
  ChevronDown,
  Code,
  FileCode,
  Folder,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  TestTube,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getSessionHealth,
  getSessionHealthRecommendations,
  analyzeSessionHealth,
  applyHealthFix,
} from '@/lib/api';
import { HealthCheckConfig } from './HealthCheckConfig';

// Types matching the backend API
interface MetricScore {
  score: number;
  grade: string;
  details?: Record<string, unknown>;
}

interface HealthScoreResponse {
  id: string;
  session_id: string;
  overall_score: number;
  grade: string;
  code_quality: MetricScore;
  test_coverage: MetricScore;
  security: MetricScore;
  documentation: MetricScore;
  dependencies: MetricScore;
  analyzed_files_count: number;
  analysis_duration_seconds: number;
  analysis_status: string;
  analyzed_at: string | null;
  previous_score: number | null;
  score_change: number | null;
}

interface Recommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: string;
  effort: string;
  impact: string;
  auto_fixable: boolean;
}

interface RecommendationsResponse {
  total_count: number;
  by_priority: Record<string, number>;
  by_type: Record<string, number>;
  recommendations: Recommendation[];
}

interface ProjectHealthProps {
  sessionId: string;
  compact?: boolean;
}

const gradeColors: Record<string, string> = {
  A: 'text-accent-success border-accent-success/30 bg-accent-success/10',
  B: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  C: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  D: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  F: 'text-accent-error border-accent-error/30 bg-accent-error/10',
  'N/A': 'text-text-muted border-border-subtle bg-overlay',
};

const priorityColors: Record<string, string> = {
  high: 'text-accent-error',
  medium: 'text-amber-400',
  low: 'text-accent-success',
};

const typeIcons: Record<string, React.ElementType> = {
  code_quality: Code,
  test_coverage: TestTube,
  security: Shield,
  documentation: Book,
  dependencies: Package,
};

function ScoreRing({
  score,
  grade,
  size = 'md',
}: {
  score: number;
  grade: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { outer: 48, stroke: 4, font: 'text-sm' },
    md: { outer: 80, stroke: 6, font: 'text-xl' },
    lg: { outer: 120, stroke: 8, font: 'text-3xl' },
  };

  const { outer, stroke, font } = sizes[size];
  const radius = (outer - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = () => {
    if (score >= 90) return 'stroke-accent-success';
    if (score >= 80) return 'stroke-emerald-400';
    if (score >= 70) return 'stroke-amber-400';
    if (score >= 60) return 'stroke-orange-400';
    return 'stroke-accent-error';
  };

  return (
    <div className="relative" style={{ width: outer, height: outer }}>
      <svg className="transform -rotate-90" width={outer} height={outer}>
        <circle
          cx={outer / 2}
          cy={outer / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border-subtle"
        />
        <circle
          cx={outer / 2}
          cy={outer / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(getColor(), 'transition-all duration-500')}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn(font, 'font-bold', gradeColors[grade]?.split(' ')[0])}>
          {grade !== 'N/A' ? grade : '-'}
        </span>
      </div>
    </div>
  );
}

function MetricBar({
  label,
  score,
  icon: Icon,
  details,
  category,
  onConfigure,
}: {
  label: string;
  score: number;
  icon: React.ElementType;
  details?: Record<string, unknown>;
  category: string;
  onConfigure?: (category: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const getColor = () => {
    if (score >= 80) return 'bg-accent-success';
    if (score >= 60) return 'bg-amber-400';
    return 'bg-accent-error';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <button
          onClick={() => details && setShowDetails(!showDetails)}
          className="flex-1 flex items-center gap-2 text-sm text-left group"
          disabled={!details}
        >
          <Icon className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-text-secondary">{label}</span>
          {details && (
            <ChevronDown
              className={cn(
                'w-3 h-3 text-text-muted transition-transform opacity-0 group-hover:opacity-100',
                showDetails && 'rotate-180 opacity-100'
              )}
            />
          )}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{score}</span>
          {onConfigure && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConfigure(category);
              }}
              className="p-1 text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors opacity-0 group-hover:opacity-100"
              title="Configure checks"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 bg-overlay rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', getColor())}
          style={{ width: `${score}%` }}
        />
      </div>

      {showDetails && details && (
        <div className="mt-2 p-2 bg-overlay/50 rounded text-xs space-y-1">
          {Object.entries(details).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="text-text-muted">{key.split('_').join(' ')}</span>
              <span className="text-text-secondary">
                {typeof value === 'number' ? value.toLocaleString() : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationItem({
  recommendation,
  onAutoFix,
}: {
  recommendation: Recommendation;
  onAutoFix?: (id: string) => void;
}) {
  const Icon = typeIcons[recommendation.type] || AlertTriangle;

  return (
    <div className="p-3 bg-overlay/50 rounded-lg">
      <div className="flex items-start gap-2">
        <Icon className={cn('w-4 h-4 mt-0.5', priorityColors[recommendation.priority])} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-text-primary truncate">
              {recommendation.title}
            </span>
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                recommendation.priority === 'high' && 'bg-accent-error/20 text-accent-error',
                recommendation.priority === 'medium' && 'bg-amber-500/20 text-amber-400',
                recommendation.priority === 'low' && 'bg-accent-success/20 text-accent-success'
              )}
            >
              {recommendation.priority}
            </span>
          </div>
          <p className="text-xs text-text-muted line-clamp-2">{recommendation.description}</p>

          {recommendation.auto_fixable && onAutoFix && (
            <button
              onClick={() => onAutoFix(recommendation.id)}
              className="mt-2 flex items-center gap-1 px-2 py-1 text-xs font-medium text-accent-primary hover:text-accent-primary/80 bg-accent-primary/10 hover:bg-accent-primary/20 rounded transition-colors"
            >
              <Zap className="w-3 h-3" />
              Auto-fix
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectHealth({
  sessionId,
  compact: _compact = false,
}: ProjectHealthProps) {
  const [health, setHealth] = useState<HealthScoreResponse | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configCategory, setConfigCategory] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState<string>('');

  const fetchHealth = async () => {
    try {
      const [healthRes, recsRes] = await Promise.all([
        getSessionHealth(sessionId),
        getSessionHealthRecommendations(sessionId),
      ]);

      setHealth(healthRes);
      setRecommendations(recsRes);
      setError(null);
    } catch (err) {
      setError('Failed to load health score');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Poll for analysis completion
  useEffect(() => {
    if (!analyzing) return;

    const interval = setInterval(async () => {
      try {
        const data = await getSessionHealth(sessionId);
        if (data && (data.analysis_status === 'completed' || data.analysis_status === 'failed')) {
          setAnalyzing(false);
          fetchHealth();
        }
      } catch (err) {
        console.error('Failed to poll health status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzing, sessionId]);

  const handleAnalyze = async () => {
    try {
      setAnalyzing(true);
      setError(null);

      await analyzeSessionHealth(sessionId, workingDirectory || undefined);
    } catch (err) {
      setError('Failed to start analysis');
      setAnalyzing(false);
      console.error(err);
    }
  };

  const handleAutoFix = async (recommendationId: string) => {
    try {
      await applyHealthFix(sessionId, recommendationId);

      // Refresh after fix
      setTimeout(fetchHealth, 1000);
    } catch (err) {
      console.error('Auto-fix failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-4 animate-pulse">
        <div className="h-6 bg-overlay rounded w-1/2 mb-4" />
        <div className="h-20 bg-overlay rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-sm text-accent-error">{error}</div>
        <button
          onClick={fetchHealth}
          className="mt-2 text-xs text-accent-primary hover:text-accent-primary/80"
        >
          Retry
        </button>
      </div>
    );
  }

  const hasScore = health && health.analysis_status !== 'not_run';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {!hasScore ? (
        // No analysis run yet
        <div className="p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-overlay flex items-center justify-center mx-auto mb-3">
            <FileCode className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary mb-1">No health analysis yet</p>
          <p className="text-xs text-text-muted mb-4">
            Analyze your project to get insights on code quality, security, and more
          </p>

          {/* Folder selector */}
          <div className="mb-4 max-w-xs mx-auto">
            <div className="relative">
              <Folder className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="/ (project root)"
                className="w-full pl-9 pr-8 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
              />
              {workingDirectory && (
                <button
                  onClick={() => setWorkingDirectory('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] text-text-muted">
              Optional: Specify a subfolder to analyze
            </p>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Analysis
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Score Overview */}
          <div className="p-4 flex items-center gap-4">
            <ScoreRing score={health.overall_score} grade={health.grade} size="md" />

            <div className="flex-1">
              <div className="text-2xl font-bold text-text-primary">
                {health.overall_score}
                <span className="text-sm font-normal text-text-muted">/100</span>
              </div>

              {health.score_change !== null && (
                <div
                  className={cn(
                    'flex items-center gap-1 text-sm',
                    health.score_change > 0 ? 'text-accent-success' : 'text-accent-error'
                  )}
                >
                  {health.score_change > 0 ? (
                    <ArrowUp className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowDown className="w-3.5 h-3.5" />
                  )}
                  <span>{Math.abs(health.score_change)} pts</span>
                </div>
              )}

              <div className="text-xs text-text-muted mt-1">
                {health.analyzed_files_count} files analyzed
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Folder input for re-analyze */}
              <div className="relative">
                <input
                  type="text"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="/"
                  title="Working directory (leave empty for project root)"
                  className="w-20 px-2 py-1.5 bg-overlay border border-border-subtle rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
                />
              </div>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="p-2 text-text-muted hover:text-text-primary hover:bg-overlay rounded-lg transition-colors disabled:opacity-50"
                title={workingDirectory ? `Re-analyze in ${workingDirectory}` : 'Re-analyze'}
              >
                {analyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Metric Bars */}
          <div className="px-4 pb-4 space-y-3 group">
            <MetricBar
              label="Code Quality"
              score={health.code_quality.score}
              icon={Code}
              details={health.code_quality.details as Record<string, unknown>}
              category="code_quality"
              onConfigure={setConfigCategory}
            />
            <MetricBar
              label="Test Coverage"
              score={health.test_coverage.score}
              icon={TestTube}
              details={health.test_coverage.details as Record<string, unknown>}
              category="test_coverage"
              onConfigure={setConfigCategory}
            />
            <MetricBar
              label="Security"
              score={health.security.score}
              icon={Shield}
              details={health.security.details as Record<string, unknown>}
              category="security"
              onConfigure={setConfigCategory}
            />
            <MetricBar
              label="Documentation"
              score={health.documentation.score}
              icon={Book}
              details={health.documentation.details as Record<string, unknown>}
              category="documentation"
              onConfigure={setConfigCategory}
            />
            <MetricBar
              label="Dependencies"
              score={health.dependencies.score}
              icon={Package}
              details={health.dependencies.details as Record<string, unknown>}
              category="dependencies"
              onConfigure={setConfigCategory}
            />
          </div>

          {/* Recommendations */}
          {recommendations && recommendations.total_count > 0 && (
            <div className="border-t border-border-subtle">
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-text-primary">
                    {recommendations.total_count} Recommendations
                  </span>
                </div>
                {recommendations.by_priority.high && (
                  <span className="text-xs text-accent-error">
                    {recommendations.by_priority.high} critical
                  </span>
                )}
              </div>

              <div className="px-3 pb-3 space-y-2">
                {recommendations.recommendations.slice(0, 3).map((rec) => (
                  <RecommendationItem
                    key={rec.id}
                    recommendation={rec}
                    onAutoFix={rec.auto_fixable ? handleAutoFix : undefined}
                  />
                ))}

                {recommendations.total_count > 3 && (
                  <button className="w-full py-2 text-xs text-accent-primary hover:text-accent-primary/80 transition-colors">
                    View all {recommendations.total_count} recommendations
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Analysis Info */}
          <div className="px-4 pb-3 text-xs text-text-muted">
            Last analyzed:{' '}
            {health.analyzed_at ? new Date(health.analyzed_at).toLocaleString() : 'Unknown'} (
            {health.analysis_duration_seconds.toFixed(1)}s)
          </div>
        </div>
      )}

      {/* Health Check Config Modal */}
      <HealthCheckConfig
        sessionId={sessionId}
        open={configCategory !== null}
        onOpenChange={(open) => !open && setConfigCategory(null)}
        category={configCategory || undefined}
        onSave={() => {
          // Optionally re-analyze after config changes
        }}
      />
    </div>
  );
}
