'use client';

import { useEffect, useState } from 'react';
import { Save, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type PlatformSetting } from '@/stores/admin';

interface SettingEditorProps {
  setting: PlatformSetting;
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>;
}

function SettingEditor({ setting, onSave }: SettingEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editValue, setEditValue] = useState(JSON.stringify(setting.value, null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    try {
      const parsed = JSON.parse(editValue);
      setSaving(true);
      await onSave(setting.key, parsed);
    } catch {
      setError('Invalid JSON');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface rounded-lg border border-border-subtle overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-overlay/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )}
          <div className="text-left">
            <p className="font-medium text-text-primary">{setting.key}</p>
            {setting.description && (
              <p className="text-sm text-text-muted">{setting.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-xs',
              setting.is_public
                ? 'bg-green-500/20 text-green-500'
                : 'bg-yellow-500/20 text-yellow-500'
            )}
          >
            {setting.is_public ? 'Public' : 'Admin only'}
          </span>
          <span className="text-xs text-text-muted">{setting.category}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border-subtle">
          <div className="mt-4">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full h-64 px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary font-mono text-sm resize-y"
              spellCheck={false}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-text-muted">
                Last updated: {new Date(setting.updated_at).toLocaleString()}
              </p>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors disabled:opacity-50 text-sm"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsManagement() {
  const { settings, settingsLoading, fetchSettings, updateSetting, error } = useAdminStore();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Group settings by category
  const categories = settings.reduce<Record<string, PlatformSetting[]>>((acc, setting) => {
    const category = setting.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category]!.push(setting);
    return acc;
  }, {});

  const categoryList = Object.keys(categories).sort();

  const handleSave = async (key: string, value: Record<string, unknown>) => {
    await updateSetting(key, value);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Platform Settings</h1>
          <p className="text-text-muted mt-1">Configure platform-wide defaults and features</p>
        </div>
        <button
          onClick={() => fetchSettings()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      <div className="flex gap-8">
        {/* Category sidebar */}
        <div className="w-48 flex-shrink-0">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            Categories
          </p>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveCategory(null)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                activeCategory === null
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
              )}
            >
              All Settings
            </button>
            {categoryList.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors capitalize',
                  activeCategory === category
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
                )}
              >
                {category}
                <span className="ml-2 text-xs text-text-muted">
                  ({categories[category]?.length ?? 0})
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Settings list */}
        <div className="flex-1">
          {settingsLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="bg-surface rounded-lg border border-border-subtle p-4 animate-pulse"
                >
                  <div className="h-5 bg-elevated rounded w-32 mb-2" />
                  <div className="h-4 bg-elevated rounded w-64" />
                </div>
              ))}
            </div>
          ) : settings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-muted">No platform settings configured yet.</p>
              <p className="text-text-muted text-sm mt-1">
                Settings will appear here once they are created via the API.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {(activeCategory ? categories[activeCategory] || [] : settings).map((setting) => (
                <SettingEditor key={setting.key} setting={setting} onSave={handleSave} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
