'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Book,
  ChevronDown,
  Code,
  Edit2,
  Loader2,
  Package,
  Play,
  Plus,
  Shield,
  TestTube,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getHealthChecks,
  createHealthCheck,
  updateHealthCheck,
  deleteHealthCheck,
  testHealthCheck,
  type HealthCheck,
  type CreateHealthCheckRequest,
  type UpdateHealthCheckRequest,
} from '@/lib/api';

interface HealthCheckConfigProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: string;
  onSave?: () => void;
}

const categoryIcons: Record<string, React.ElementType> = {
  code_quality: Code,
  test_coverage: TestTube,
  security: Shield,
  documentation: Book,
  dependencies: Package,
};

const categoryLabels: Record<string, string> = {
  code_quality: 'Code Quality',
  test_coverage: 'Test Coverage',
  security: 'Security',
  documentation: 'Documentation',
  dependencies: 'Dependencies',
};

const parseModeDescriptions: Record<string, string> = {
  exit_code: 'Score based on command exit code (0 = success)',
  json: 'Parse JSON output and extract score from a path',
  regex: 'Count regex matches and calculate score',
  line_count: 'Score based on output line count',
};

interface CheckFormData {
  name: string;
  description: string;
  command: string;
  working_directory: string;
  timeout: number;
  parse_mode: string;
  parse_config: Record<string, unknown>;
  weight: number;
  enabled: boolean;
  fix_command: string;
}

const defaultFormData: CheckFormData = {
  name: '',
  description: '',
  command: '',
  working_directory: '',
  timeout: 60,
  parse_mode: 'exit_code',
  parse_config: { success_codes: [0], score_on_success: 100, score_on_failure: 0 },
  weight: 1.0,
  enabled: true,
  fix_command: '',
};

function CheckItem({
  check,
  onEdit,
  onDelete,
  onTest,
  onToggle,
}: {
  check: HealthCheck;
  onEdit: (check: HealthCheck) => void;
  onDelete: (check: HealthCheck) => void;
  onTest: (check: HealthCheck) => void;
  onToggle: (check: HealthCheck, enabled: boolean) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-3 bg-overlay/30">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex-1 flex items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              'w-4 h-4 text-text-muted transition-transform',
              showDetails && 'rotate-180'
            )}
          />
          <span className="text-sm font-medium text-text-primary">{check.name}</span>
          {check.is_builtin && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent-primary/20 text-accent-primary rounded">
              Built-in
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onTest(check)}
            className="p-1.5 text-text-muted hover:text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
            title="Test check"
          >
            <Play className="w-3.5 h-3.5" />
          </button>

          {!check.is_builtin && (
            <>
              <button
                onClick={() => onEdit(check)}
                className="p-1.5 text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors"
                title="Edit check"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onDelete(check)}
                className="p-1.5 text-text-muted hover:text-accent-error hover:bg-accent-error/10 rounded transition-colors"
                title="Delete check"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={check.enabled}
              onChange={(e) => onToggle(check, e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-overlay rounded-full peer peer-checked:bg-accent-primary peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
          </label>
        </div>
      </div>

      {showDetails && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs">
          {check.description && <p className="text-text-muted">{check.description}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-text-muted">Command:</span>
              <code className="ml-1 text-text-secondary font-mono text-[11px]">
                {check.command}
              </code>
            </div>
            <div>
              <span className="text-text-muted">Parse mode:</span>
              <span className="ml-1 text-text-secondary">{check.parse_mode}</span>
            </div>
            <div>
              <span className="text-text-muted">Timeout:</span>
              <span className="ml-1 text-text-secondary">{check.timeout}s</span>
            </div>
            <div>
              <span className="text-text-muted">Weight:</span>
              <span className="ml-1 text-text-secondary">{check.weight}</span>
            </div>
          </div>
          {check.fix_command && (
            <div>
              <span className="text-text-muted">Fix command:</span>
              <code className="ml-1 text-accent-success font-mono text-[11px]">
                {check.fix_command}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  initialData?: CheckFormData;
  onSubmit: (data: CheckFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState<CheckFormData>(initialData || defaultFormData);
  const [parseConfigJson, setParseConfigJson] = useState(
    JSON.stringify(formData.parse_config, null, 2)
  );
  const [parseConfigError, setParseConfigError] = useState<string | null>(null);

  const handleParseConfigChange = (value: string) => {
    setParseConfigJson(value);
    try {
      const parsed = JSON.parse(value);
      setFormData((prev) => ({ ...prev, parse_config: parsed }));
      setParseConfigError(null);
    } catch {
      setParseConfigError('Invalid JSON');
    }
  };

  const handleParseModeChange = (mode: string) => {
    let defaultConfig: Record<string, unknown> = {};
    switch (mode) {
      case 'exit_code':
        defaultConfig = { success_codes: [0], score_on_success: 100, score_on_failure: 0 };
        break;
      case 'json':
        defaultConfig = { score_path: 'score', max_value: 100 };
        break;
      case 'regex':
        defaultConfig = {
          pattern: 'error',
          score_formula: '100 - (matches * 5)',
          max_score: 100,
          min_score: 0,
        };
        break;
      case 'line_count':
        defaultConfig = { target: 0, penalty_per_line: 5, base_score: 100 };
        break;
    }
    setFormData((prev) => ({ ...prev, parse_mode: mode, parse_config: defaultConfig }));
    setParseConfigJson(JSON.stringify(defaultConfig, null, 2));
    setParseConfigError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parseConfigError) return;
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Name</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-primary"
          placeholder="My Custom Check"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-primary resize-none"
          rows={2}
          placeholder="Optional description of what this check does"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Command</label>
        <input
          type="text"
          value={formData.command}
          onChange={(e) => setFormData((prev) => ({ ...prev, command: e.target.value }))}
          className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary font-mono focus:outline-none focus:border-accent-primary"
          placeholder="npm run lint --format=json"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            Working Directory
          </label>
          <input
            type="text"
            value={formData.working_directory}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, working_directory: e.target.value }))
            }
            className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-primary"
            placeholder="/ (project root)"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            Timeout (seconds)
          </label>
          <input
            type="number"
            value={formData.timeout}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, timeout: parseInt(e.target.value) || 60 }))
            }
            className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-primary"
            min={5}
            max={300}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Parse Mode</label>
        <select
          value={formData.parse_mode}
          onChange={(e) => handleParseModeChange(e.target.value)}
          className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-primary"
        >
          <option value="exit_code">Exit Code</option>
          <option value="json">JSON Path</option>
          <option value="regex">Regex Count</option>
          <option value="line_count">Line Count</option>
        </select>
        <p className="mt-1 text-xs text-text-muted">{parseModeDescriptions[formData.parse_mode]}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">
          Parse Configuration (JSON)
        </label>
        <textarea
          value={parseConfigJson}
          onChange={(e) => handleParseConfigChange(e.target.value)}
          className={cn(
            'w-full px-3 py-2 bg-overlay border rounded-lg text-sm text-text-primary font-mono focus:outline-none resize-none',
            parseConfigError
              ? 'border-accent-error focus:border-accent-error'
              : 'border-border-subtle focus:border-accent-primary'
          )}
          rows={4}
        />
        {parseConfigError && <p className="mt-1 text-xs text-accent-error">{parseConfigError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">Weight</label>
          <input
            type="number"
            value={formData.weight}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, weight: parseFloat(e.target.value) || 1.0 }))
            }
            className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-primary"
            min={0.1}
            max={5}
            step={0.1}
          />
          <p className="mt-1 text-xs text-text-muted">
            Higher weight = more impact on category score
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            Fix Command (optional)
          </label>
          <input
            type="text"
            value={formData.fix_command}
            onChange={(e) => setFormData((prev) => ({ ...prev, fix_command: e.target.value }))}
            className="w-full px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-sm text-text-primary font-mono focus:outline-none focus:border-accent-primary"
            placeholder="npm run lint --fix"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="check-enabled"
          checked={formData.enabled}
          onChange={(e) => setFormData((prev) => ({ ...prev, enabled: e.target.checked }))}
          className="rounded border-border-subtle bg-overlay"
        />
        <label htmlFor="check-enabled" className="text-sm text-text-secondary">
          Enabled
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !!parseConfigError}
          className="px-4 py-2 text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/90 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Saving...
            </>
          ) : (
            'Save Check'
          )}
        </button>
      </div>
    </form>
  );
}

export function HealthCheckConfig({
  sessionId,
  open,
  onOpenChange,
  category: initialCategory,
  onSave,
}: HealthCheckConfigProps) {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory || 'code_quality');
  const [showForm, setShowForm] = useState(false);
  const [editingCheck, setEditingCheck] = useState<HealthCheck | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<{
    checkId: string;
    loading: boolean;
    result?: { success: boolean; score: number; error?: string };
  } | null>(null);

  const categories = ['code_quality', 'test_coverage', 'security', 'documentation', 'dependencies'];

  const fetchChecks = useCallback(async () => {
    try {
      setLoading(true);
      const response = await getHealthChecks(selectedCategory, sessionId);
      setChecks(response.checks);
      setError(null);
    } catch (err) {
      setError('Failed to load health checks');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, sessionId]);

  useEffect(() => {
    if (open) {
      fetchChecks();
    }
  }, [open, fetchChecks]);

  const handleCreateCheck = async (data: CheckFormData) => {
    try {
      setIsSubmitting(true);
      const request: CreateHealthCheckRequest = {
        category: selectedCategory,
        name: data.name,
        description: data.description || undefined,
        command: data.command,
        working_directory: data.working_directory || undefined,
        timeout: data.timeout,
        parse_mode: data.parse_mode,
        parse_config: data.parse_config,
        weight: data.weight,
        enabled: data.enabled,
        fix_command: data.fix_command || undefined,
        session_id: sessionId,
      };
      await createHealthCheck(request);
      setShowForm(false);
      await fetchChecks();
      onSave?.();
    } catch (err) {
      setError('Failed to create check');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateCheck = async (data: CheckFormData) => {
    if (!editingCheck) return;
    try {
      setIsSubmitting(true);
      const request: UpdateHealthCheckRequest = {
        name: data.name,
        description: data.description || undefined,
        command: data.command,
        working_directory: data.working_directory || undefined,
        timeout: data.timeout,
        parse_mode: data.parse_mode,
        parse_config: data.parse_config,
        weight: data.weight,
        enabled: data.enabled,
        fix_command: data.fix_command || undefined,
      };
      await updateHealthCheck(editingCheck.id, request);
      setEditingCheck(null);
      await fetchChecks();
      onSave?.();
    } catch (err) {
      setError('Failed to update check');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCheck = async (check: HealthCheck) => {
    if (!confirm(`Delete "${check.name}"? This action cannot be undone.`)) return;
    try {
      await deleteHealthCheck(check.id);
      await fetchChecks();
      onSave?.();
    } catch (err) {
      setError('Failed to delete check');
      console.error(err);
    }
  };

  const handleToggleCheck = async (check: HealthCheck, enabled: boolean) => {
    try {
      await updateHealthCheck(check.id, { enabled });
      setChecks((prev) => prev.map((c) => (c.id === check.id ? { ...c, enabled } : c)));
      onSave?.();
    } catch (err) {
      setError('Failed to update check');
      console.error(err);
    }
  };

  const handleTestCheck = async (check: HealthCheck) => {
    try {
      setTestResult({ checkId: check.id, loading: true });
      const result = await testHealthCheck(check.id, sessionId);
      setTestResult({ checkId: check.id, loading: false, result });
    } catch (err) {
      setTestResult({
        checkId: check.id,
        loading: false,
        result: { success: false, score: 0, error: 'Test failed' },
      });
      console.error(err);
    }
  };

  const handleEditCheck = (check: HealthCheck) => {
    setEditingCheck(check);
    setShowForm(false);
  };

  if (!open) return null;

  const Icon = categoryIcons[selectedCategory] || Code;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      <div className="relative w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-4 sm:px-6 py-4 shrink-0">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Icon className="h-5 w-5 text-accent-primary" />
              Configure Health Checks
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Manage checks for{' '}
              <span className="font-medium text-text-primary">
                {categoryLabels[selectedCategory]}
              </span>
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1 px-4 sm:px-6 py-2 border-b border-border-subtle overflow-x-auto">
          {categories.map((cat) => {
            const CatIcon = categoryIcons[cat] || Code;
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setShowForm(false);
                  setEditingCheck(null);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap',
                  selectedCategory === cat
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary hover:bg-overlay'
                )}
              >
                <CatIcon className="w-3.5 h-3.5" />
                {categoryLabels[cat]}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-accent-error mb-2">{error}</p>
              <button
                onClick={fetchChecks}
                className="text-xs text-accent-primary hover:text-accent-primary/80"
              >
                Retry
              </button>
            </div>
          ) : showForm || editingCheck ? (
            <CheckForm
              initialData={
                editingCheck
                  ? {
                      name: editingCheck.name,
                      description: editingCheck.description || '',
                      command: editingCheck.command,
                      working_directory: editingCheck.working_directory || '',
                      timeout: editingCheck.timeout,
                      parse_mode: editingCheck.parse_mode,
                      parse_config: editingCheck.parse_config,
                      weight: editingCheck.weight,
                      enabled: editingCheck.enabled,
                      fix_command: editingCheck.fix_command || '',
                    }
                  : undefined
              }
              onSubmit={editingCheck ? handleUpdateCheck : handleCreateCheck}
              onCancel={() => {
                setShowForm(false);
                setEditingCheck(null);
              }}
              isSubmitting={isSubmitting}
            />
          ) : (
            <div className="space-y-3">
              {checks.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-text-muted mb-4">
                    No checks configured for this category
                  </p>
                </div>
              ) : (
                checks.map((check) => (
                  <div key={check.id}>
                    <CheckItem
                      check={check}
                      onEdit={handleEditCheck}
                      onDelete={handleDeleteCheck}
                      onTest={handleTestCheck}
                      onToggle={handleToggleCheck}
                    />
                    {testResult?.checkId === check.id && (
                      <div className="mt-2 p-3 bg-overlay/50 rounded-lg text-xs">
                        {testResult.loading ? (
                          <div className="flex items-center gap-2 text-text-muted">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Running test...
                          </div>
                        ) : testResult.result ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'font-medium',
                                  testResult.result.success
                                    ? 'text-accent-success'
                                    : 'text-accent-error'
                                )}
                              >
                                {testResult.result.success ? 'Test passed' : 'Test failed'}
                              </span>
                              <span className="text-text-muted">
                                Score: {testResult.result.score}
                              </span>
                            </div>
                            {testResult.result.error && (
                              <p className="text-accent-error">{testResult.result.error}</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))
              )}

              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-border-subtle rounded-lg text-sm text-text-muted hover:text-text-primary hover:border-border-default transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Custom Check
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
