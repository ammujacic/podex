'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  Eye,
  EyeOff,
  Box,
  Plus,
  Edit2,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type AdminTemplate } from '@/stores/admin';

// Available icons for templates
const AVAILABLE_ICONS = [
  { id: 'nodejs', name: 'Node.js' },
  { id: 'python', name: 'Python' },
  { id: 'go', name: 'Go' },
  { id: 'rust', name: 'Rust' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'react', name: 'React' },
  { id: 'docker', name: 'Docker' },
  { id: 'layers', name: 'Full Stack' },
  { id: 'box', name: 'Blank' },
];

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface TemplateRowProps {
  template: AdminTemplate;
  onTogglePublic: (templateId: string, isPublic: boolean) => void;
  onToggleOfficial: (templateId: string, isOfficial: boolean) => void;
  onEdit: (template: AdminTemplate) => void;
  onDelete: (templateId: string) => void;
}

function TemplateRow({
  template,
  onTogglePublic,
  onToggleOfficial,
  onEdit,
  onDelete,
}: TemplateRowProps) {
  return (
    <tr className="border-b border-border-subtle hover:bg-overlay/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-primary/10 flex items-center justify-center">
            {template.icon_url ? (
              <Image
                src={template.icon_url}
                alt={template.name}
                width={24}
                height={24}
                className="w-6 h-6"
              />
            ) : (
              <Box className="h-5 w-5 text-accent-primary" />
            )}
          </div>
          <div>
            <p className="text-text-primary font-medium">{template.name}</p>
            <p className="text-text-muted text-sm">{template.slug}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleOfficial(template.id, !template.is_official)}
            className={cn(
              'p-1.5 rounded transition-colors',
              template.is_official
                ? 'bg-yellow-500/20 text-yellow-500'
                : 'bg-elevated text-text-muted hover:text-text-primary'
            )}
            title={template.is_official ? 'Official' : 'Make Official'}
          >
            <Star className="h-4 w-4" fill={template.is_official ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => onTogglePublic(template.id, !template.is_public)}
            className={cn(
              'p-1.5 rounded transition-colors',
              template.is_public
                ? 'bg-green-500/20 text-green-500'
                : 'bg-elevated text-text-muted hover:text-text-primary'
            )}
            title={template.is_public ? 'Public' : 'Private'}
          >
            {template.is_public ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">
        {template.base_image.split(':')[0]?.split('/').pop() ?? template.base_image}
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{template.usage_count}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">{template.active_session_count}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">
        {template.owner_email || (template.is_official ? 'Podex Official' : '-')}
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{formatDate(template.created_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(template)}
            className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
            title="Edit"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(template.id)}
            className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

interface TemplateModalProps {
  template: AdminTemplate | null;
  onClose: () => void;
  onSave: (data: Partial<AdminTemplate>) => Promise<void>;
  isCreating: boolean;
}

function TemplateModal({ template, onClose, onSave, isCreating }: TemplateModalProps) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    slug: template?.slug || '',
    description: template?.description || '',
    icon: template?.icon || 'box',
    base_image: template?.base_image || 'podex/workspace:latest',
    is_public: template?.is_public ?? true,
    is_official: template?.is_official ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle p-6 w-full max-w-lg">
        <h2 className="text-xl font-semibold text-text-primary mb-6">
          {isCreating ? 'Create Template' : 'Edit Template'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1">Slug</label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              required
              disabled={!isCreating}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1">Icon</label>
            <select
              value={formData.icon}
              onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
            >
              {AVAILABLE_ICONS.map((icon) => (
                <option key={icon.id} value={icon.id}>
                  {icon.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1">Base Image</label>
            <input
              type="text"
              value={formData.base_image}
              onChange={(e) => setFormData({ ...formData, base_image: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
            />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_public}
                onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">Public</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_official}
                onChange={(e) => setFormData({ ...formData, is_official: e.target.checked })}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">Official</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : isCreating ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TemplatesManagement() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [officialFilter, setOfficialFilter] = useState<boolean | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AdminTemplate | null>(null);
  const pageSize = 20;

  const {
    templates,
    templatesTotal,
    templatesLoading,
    fetchTemplates,
    updateTemplate,
    createTemplate,
    deleteTemplate,
    error,
  } = useAdminStore();

  useEffect(() => {
    const filters: Record<string, string | boolean | null> = {};
    if (search) filters.search = search;
    if (officialFilter !== null) filters.is_official = officialFilter;

    fetchTemplates(page, pageSize, filters);
  }, [page, search, officialFilter, fetchTemplates]);

  const handleTogglePublic = async (templateId: string, isPublic: boolean) => {
    await updateTemplate(templateId, { is_public: isPublic });
  };

  const handleToggleOfficial = async (templateId: string, isOfficial: boolean) => {
    await updateTemplate(templateId, { is_official: isOfficial });
  };

  const handleEdit = (template: AdminTemplate) => {
    setEditingTemplate(template);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingTemplate(null);
    setShowModal(true);
  };

  const handleDelete = async (templateId: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      await deleteTemplate(templateId);
    }
  };

  const handleSave = async (data: Partial<AdminTemplate>) => {
    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, data);
    } else {
      await createTemplate(data as Parameters<typeof createTemplate>[0]);
    }
  };

  const totalPages = Math.ceil(templatesTotal / pageSize);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Pod Templates</h1>
          <p className="text-text-muted mt-1">Manage workspace templates and their visibility</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
          />
        </div>

        <select
          value={officialFilter === null ? '' : String(officialFilter)}
          onChange={(e) => {
            setOfficialFilter(e.target.value === '' ? null : e.target.value === 'true');
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
        >
          <option value="">All Templates</option>
          <option value="true">Official Only</option>
          <option value="false">User Templates</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-elevated">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Template
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Base Image
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Uses
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Active
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Owner
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {templatesLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    <td colSpan={8} className="px-4 py-4">
                      <div className="h-10 bg-elevated rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : templates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                    No templates found
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <TemplateRow
                    key={template.id}
                    template={template}
                    onTogglePublic={handleTogglePublic}
                    onToggleOfficial={handleToggleOfficial}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <p className="text-sm text-text-muted">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, templatesTotal)} of{' '}
            {templatesTotal} templates
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="p-2 rounded hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-text-secondary">
              Page {page} of {totalPages || 1}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <TemplateModal
          template={editingTemplate}
          onClose={() => {
            setShowModal(false);
            setEditingTemplate(null);
          }}
          onSave={handleSave}
          isCreating={!editingTemplate}
        />
      )}
    </div>
  );
}
