'use client';

import { useState, useEffect } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Wand2,
  FileCode,
  Settings,
  Eye,
  Sparkles,
  Zap,
  ArrowRight,
  GitBranch,
  Play,
  AlertCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createSkillFromTemplate } from '@/lib/api';

// Types
interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  default?: string | number | boolean | string[];
  required?: boolean;
}

interface TemplateStep {
  name: string;
  description: string;
  tool?: string;
  skill?: string;
  parameters?: Record<string, unknown>;
  condition?: string;
  on_success?: string;
  on_failure?: string;
  parallel_with?: string[];
}

interface SkillTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon?: string;
  default_triggers?: string[];
  default_tags?: string[];
  required_tools?: string[];
  step_templates?: TemplateStep[];
  variables?: TemplateVariable[];
  is_system: boolean;
  usage_count: number;
}

interface SkillWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (skill: CreatedSkill) => void;
  templates: SkillTemplate[];
  isLoading?: boolean;
}

interface CreatedSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  triggers: string[];
  tags: string[];
  required_tools: string[];
  steps: TemplateStep[];
}

const STEPS = [
  { id: 'template', label: 'Choose Template', icon: Wand2 },
  { id: 'variables', label: 'Configure', icon: Settings },
  { id: 'steps', label: 'Customize Steps', icon: FileCode },
  { id: 'review', label: 'Review & Create', icon: Eye },
];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  deployment: <GitBranch className="h-5 w-5" />,
  testing: <Play className="h-5 w-5" />,
  generation: <Sparkles className="h-5 w-5" />,
  documentation: <FileCode className="h-5 w-5" />,
  maintenance: <Settings className="h-5 w-5" />,
  default: <Zap className="h-5 w-5" />,
};

export function SkillWizard({
  isOpen,
  onClose,
  onComplete,
  templates,
  isLoading = false,
}: SkillWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<SkillTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [customSteps, setCustomSteps] = useState<TemplateStep[]>([]);
  const [skillName, setSkillName] = useState('');
  const [skillSlug, setSkillSlug] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setSelectedTemplate(null);
      setVariables({});
      setCustomSteps([]);
      setSkillName('');
      setSkillSlug('');
      setSkillDescription('');
      setError(null);
    }
  }, [isOpen]);

  // Update steps when template is selected
  useEffect(() => {
    if (selectedTemplate) {
      setCustomSteps(selectedTemplate.step_templates || []);
      setSkillDescription(selectedTemplate.description);

      // Initialize variables with defaults
      const defaultVars: Record<string, unknown> = {};
      for (const v of selectedTemplate.variables || []) {
        if (v.default !== undefined) {
          defaultVars[v.name] = v.default;
        }
      }
      setVariables(defaultVars);
    }
  }, [selectedTemplate]);

  // Auto-generate slug from name
  useEffect(() => {
    if (skillName && !skillSlug) {
      setSkillSlug(
        skillName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
      );
    }
  }, [skillName, skillSlug]);

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleCreate = async () => {
    if (!selectedTemplate || !skillName || !skillSlug) {
      setError('Please fill in all required fields');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const skill = await createSkillFromTemplate(selectedTemplate.slug, {
        name: skillName,
        slug: skillSlug,
        description: skillDescription,
        variables,
      });

      onComplete(skill as CreatedSkill);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setIsCreating(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return selectedTemplate !== null;
      case 1:
        // Check required variables
        if (!selectedTemplate) return false;
        for (const v of selectedTemplate.variables || []) {
          if (v.required && !variables[v.name]) return false;
        }
        return true;
      case 2:
        return customSteps.length > 0;
      case 3:
        return skillName.length > 0 && skillSlug.length > 0;
      default:
        return true;
    }
  };

  const updateStep = (index: number, field: string, value: unknown) => {
    setCustomSteps((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value } as TemplateStep;
      return updated;
    });
  };

  const addStep = () => {
    setCustomSteps((prev) => [
      ...prev,
      {
        name: `step_${prev.length + 1}`,
        description: 'New step',
        tool: '',
      },
    ]);
  };

  const removeStep = (index: number) => {
    setCustomSteps((prev) => prev.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <TemplateSelection
            templates={templates}
            selectedTemplate={selectedTemplate}
            onSelect={setSelectedTemplate}
            isLoading={isLoading}
          />
        );
      case 1:
        return (
          <VariablesForm
            template={selectedTemplate}
            variables={variables}
            onChange={setVariables}
          />
        );
      case 2:
        return (
          <StepsEditor
            steps={customSteps}
            onUpdate={updateStep}
            onAdd={addStep}
            onRemove={removeStep}
          />
        );
      case 3:
        return (
          <ReviewStep
            template={selectedTemplate}
            name={skillName}
            slug={skillSlug}
            description={skillDescription}
            variables={variables}
            steps={customSteps}
            onNameChange={setSkillName}
            onSlugChange={setSkillSlug}
            onDescriptionChange={setSkillDescription}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-primary/10">
              <Wand2 className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Create Skill from Template
              </h2>
              <p className="text-sm text-text-muted">
                Step {currentStep + 1} of {STEPS.length}: {STEPS[currentStep]?.label}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-3 border-b border-border-subtle bg-surface-alt">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isComplete = index < currentStep;

              return (
                <div key={step.id} className="flex items-center">
                  <div
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
                      isActive && 'bg-accent-primary/10 text-accent-primary',
                      isComplete && 'text-accent-success',
                      !isActive && !isComplete && 'text-text-muted'
                    )}
                  >
                    {isComplete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    <span className="text-sm font-medium">{step.label}</span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-text-muted mx-2" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{renderStepContent()}</div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle bg-surface-alt">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              currentStep === 0
                ? 'text-text-muted cursor-not-allowed'
                : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-overlay transition-colors"
            >
              Cancel
            </button>

            {currentStep === STEPS.length - 1 ? (
              <button
                onClick={handleCreate}
                disabled={!canProceed() || isCreating}
                className={cn(
                  'flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-colors',
                  canProceed() && !isCreating
                    ? 'bg-accent-primary hover:bg-accent-primary/80 text-white'
                    : 'bg-surface-alt text-text-muted cursor-not-allowed'
                )}
              >
                {isCreating ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Create Skill
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className={cn(
                  'flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-colors',
                  canProceed()
                    ? 'bg-accent-primary hover:bg-accent-primary/80 text-white'
                    : 'bg-surface-alt text-text-muted cursor-not-allowed'
                )}
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Template Selection Component
function TemplateSelection({
  templates,
  selectedTemplate,
  onSelect,
  isLoading,
}: {
  templates: SkillTemplate[];
  selectedTemplate: SkillTemplate | null;
  onSelect: (template: SkillTemplate) => void;
  isLoading: boolean;
}) {
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const categories = [...new Set(templates.map((t) => t.category))];
  const filteredTemplates = categoryFilter
    ? templates.filter((t) => t.category === categoryFilter)
    : templates;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setCategoryFilter(null)}
          className={cn(
            'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
            !categoryFilter
              ? 'bg-accent-primary text-white'
              : 'bg-overlay text-text-secondary hover:text-text-primary'
          )}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setCategoryFilter(category)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize',
              categoryFilter === category
                ? 'bg-accent-primary text-white'
                : 'bg-overlay text-text-secondary hover:text-text-primary'
            )}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Templates grid */}
      <div className="grid grid-cols-2 gap-4">
        {filteredTemplates.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={cn(
              'p-4 rounded-lg border text-left transition-all',
              selectedTemplate?.id === template.id
                ? 'border-accent-primary bg-accent-primary/5 ring-2 ring-accent-primary/20'
                : 'border-border-subtle hover:border-border-medium hover:bg-overlay'
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'p-2 rounded-lg flex-shrink-0',
                  selectedTemplate?.id === template.id
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'bg-overlay text-text-muted'
                )}
              >
                {CATEGORY_ICONS[template.category] || CATEGORY_ICONS.default}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-text-primary truncate">{template.name}</h3>
                <p className="text-sm text-text-muted line-clamp-2 mt-1">{template.description}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-text-muted capitalize">{template.category}</span>
                  <span className="text-xs text-text-muted">
                    {template.step_templates?.length || 0} steps
                  </span>
                  {template.usage_count > 0 && (
                    <span className="text-xs text-text-muted">{template.usage_count} uses</span>
                  )}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-8 text-text-muted">No templates found in this category</div>
      )}
    </div>
  );
}

// Variables Form Component
function VariablesForm({
  template,
  variables,
  onChange,
}: {
  template: SkillTemplate | null;
  variables: Record<string, unknown>;
  onChange: (vars: Record<string, unknown>) => void;
}) {
  if (!template) return null;

  const templateVars = template.variables || [];

  if (templateVars.length === 0) {
    return (
      <div className="text-center py-8">
        <Settings className="h-12 w-12 text-text-muted mx-auto mb-3" />
        <h3 className="text-lg font-medium text-text-primary">No Variables Required</h3>
        <p className="text-sm text-text-muted mt-1">
          This template doesn&apos;t require any configuration. Continue to the next step.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-muted mb-4">
        Configure the template variables below. These values will be used to customize your skill.
      </div>

      {templateVars.map((variable) => (
        <div key={variable.name} className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            {variable.name}
            {variable.required && <span className="text-red-400">*</span>}
          </label>
          <p className="text-xs text-text-muted">{variable.description}</p>

          {variable.type === 'boolean' ? (
            <label className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={Boolean(variables[variable.name])}
                onChange={(e) => onChange({ ...variables, [variable.name]: e.target.checked })}
                className="w-4 h-4 rounded border-border-subtle bg-surface text-accent-primary focus:ring-accent-primary"
              />
              <span className="text-sm text-text-secondary">Enabled</span>
            </label>
          ) : variable.type === 'number' ? (
            <input
              type="number"
              value={String(variables[variable.name] || '')}
              onChange={(e) => onChange({ ...variables, [variable.name]: Number(e.target.value) })}
              placeholder={`Enter ${variable.name}`}
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary placeholder-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary outline-none"
            />
          ) : variable.type === 'array' ? (
            <textarea
              value={
                Array.isArray(variables[variable.name])
                  ? (variables[variable.name] as string[]).join('\n')
                  : ''
              }
              onChange={(e) =>
                onChange({
                  ...variables,
                  [variable.name]: e.target.value.split('\n').filter(Boolean),
                })
              }
              placeholder="Enter values, one per line"
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary placeholder-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary outline-none font-mono text-sm"
            />
          ) : (
            <input
              type="text"
              value={String(variables[variable.name] || '')}
              onChange={(e) => onChange({ ...variables, [variable.name]: e.target.value })}
              placeholder={`Enter ${variable.name}`}
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary placeholder-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary outline-none"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Steps Editor Component
function StepsEditor({
  steps,
  onUpdate,
  onAdd,
  onRemove,
}: {
  steps: TemplateStep[];
  onUpdate: (index: number, field: string, value: unknown) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          Customize the steps for your skill. You can add, remove, or modify steps.
        </p>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Step
        </button>
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => (
          <div
            key={index}
            className="p-4 rounded-lg border border-border-subtle bg-surface-alt space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-overlay flex items-center justify-center text-xs font-medium text-text-muted">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-text-primary">{step.name}</span>

                {/* Step type badges */}
                <div className="flex items-center gap-1.5">
                  {step.skill && (
                    <span className="px-2 py-0.5 rounded text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Chain
                    </span>
                  )}
                  {step.parallel_with && step.parallel_with.length > 0 && (
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      Parallel
                    </span>
                  )}
                  {(step.on_success || step.on_failure) && (
                    <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                      Branch
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => onRemove(index)}
                className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted block mb-1">Step Name</label>
                <input
                  type="text"
                  value={step.name}
                  onChange={(e) => onUpdate(index, 'name', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted block mb-1">Tool or Skill</label>
                <input
                  type="text"
                  value={step.tool || step.skill || ''}
                  onChange={(e) => {
                    // If it looks like a skill reference (contains underscore or is lowercase)
                    const value = e.target.value;
                    if (value.includes('skill:')) {
                      onUpdate(index, 'skill', value.replace('skill:', ''));
                      onUpdate(index, 'tool', undefined);
                    } else {
                      onUpdate(index, 'tool', value);
                      onUpdate(index, 'skill', undefined);
                    }
                  }}
                  placeholder="tool_name or skill:skill_name"
                  className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted block mb-1">Description</label>
              <input
                type="text"
                value={step.description}
                onChange={(e) => onUpdate(index, 'description', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none"
              />
            </div>

            {/* Advanced options */}
            <details className="group">
              <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                Advanced options
              </summary>
              <div className="mt-3 space-y-3 pt-3 border-t border-border-subtle">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-text-muted block mb-1">
                      Condition (optional)
                    </label>
                    <input
                      type="text"
                      value={step.condition || ''}
                      onChange={(e) => onUpdate(index, 'condition', e.target.value || undefined)}
                      placeholder="e.g., result.success == true"
                      className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted block mb-1">
                      Parallel With (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={step.parallel_with?.join(', ') || ''}
                      onChange={(e) =>
                        onUpdate(
                          index,
                          'parallel_with',
                          e.target.value
                            ? e.target.value.split(',').map((s) => s.trim())
                            : undefined
                        )
                      }
                      placeholder="step_name1, step_name2"
                      className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-text-muted block mb-1">
                      On Success (jump to)
                    </label>
                    <input
                      type="text"
                      value={step.on_success || ''}
                      onChange={(e) => onUpdate(index, 'on_success', e.target.value || undefined)}
                      placeholder="step_name"
                      className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted block mb-1">
                      On Failure (jump to)
                    </label>
                    <input
                      type="text"
                      value={step.on_failure || ''}
                      onChange={(e) => onUpdate(index, 'on_failure', e.target.value || undefined)}
                      placeholder="step_name"
                      className="w-full px-2.5 py-1.5 bg-surface border border-border-subtle rounded text-sm text-text-primary focus:border-accent-primary outline-none"
                    />
                  </div>
                </div>
              </div>
            </details>
          </div>
        ))}
      </div>

      {steps.length === 0 && (
        <div className="text-center py-8 text-text-muted">
          <FileCode className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No steps defined. Add at least one step to continue.</p>
        </div>
      )}
    </div>
  );
}

// Review Step Component
function ReviewStep({
  template,
  name,
  slug,
  description,
  variables,
  steps,
  onNameChange,
  onSlugChange,
  onDescriptionChange,
}: {
  template: SkillTemplate | null;
  name: string;
  slug: string;
  description: string;
  variables: Record<string, unknown>;
  steps: TemplateStep[];
  onNameChange: (name: string) => void;
  onSlugChange: (slug: string) => void;
  onDescriptionChange: (desc: string) => void;
}) {
  if (!template) return null;

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
          Skill Details
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-text-muted block mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="My Custom Skill"
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">
              Slug <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => onSlugChange(e.target.value)}
              placeholder="my_custom_skill"
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary font-mono focus:border-accent-primary outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-text-muted block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="p-4 rounded-lg bg-surface-alt border border-border-subtle space-y-3">
        <h4 className="text-sm font-medium text-text-primary">Summary</h4>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-text-muted">Based on:</span>
            <span className="ml-2 text-text-primary">{template.name}</span>
          </div>
          <div>
            <span className="text-text-muted">Steps:</span>
            <span className="ml-2 text-text-primary">{steps.length}</span>
          </div>
          <div>
            <span className="text-text-muted">Variables:</span>
            <span className="ml-2 text-text-primary">{Object.keys(variables).length}</span>
          </div>
          <div>
            <span className="text-text-muted">Category:</span>
            <span className="ml-2 text-text-primary capitalize">{template.category}</span>
          </div>
        </div>

        {/* Step preview */}
        <div className="mt-3 pt-3 border-t border-border-subtle">
          <span className="text-xs text-text-muted block mb-2">Step Flow:</span>
          <div className="flex items-center gap-2 flex-wrap">
            {steps.map((step, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="px-2 py-1 rounded bg-overlay text-xs font-medium text-text-secondary">
                  {step.name}
                </span>
                {index < steps.length - 1 && <ArrowRight className="h-3 w-3 text-text-muted" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SkillWizard;
