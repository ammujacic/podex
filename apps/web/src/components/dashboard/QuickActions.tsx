'use client';

import { useRouter } from 'next/navigation';
import { Clock, FolderGit2, Keyboard, Plus, Sparkles } from 'lucide-react';
import { Button } from '@podex/ui';

interface QuickActionsProps {
  lastSessionId?: string;
  onNewPod: () => void;
  onCloneRepo: () => void;
  onShowShortcuts: () => void;
}

export function QuickActions({
  lastSessionId,
  onNewPod,
  onCloneRepo,
  onShowShortcuts,
}: QuickActionsProps) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-3" data-tour="quick-actions">
      <Button onClick={onNewPod} className="gap-2">
        <Plus className="w-4 h-4" />
        New Pod
      </Button>

      <Button variant="secondary" onClick={onCloneRepo} className="gap-2">
        <FolderGit2 className="w-4 h-4" />
        <span className="hidden sm:inline">Clone Repo</span>
        <span className="sm:hidden">Clone</span>
      </Button>

      {lastSessionId && (
        <Button
          variant="secondary"
          onClick={() => router.push(`/session/${lastSessionId}`)}
          className="gap-2"
        >
          <Clock className="w-4 h-4" />
          <span className="hidden sm:inline">Resume Last</span>
          <span className="sm:hidden">Resume</span>
        </Button>
      )}

      <Button variant="ghost" onClick={onShowShortcuts} className="gap-2 hidden md:flex">
        <Keyboard className="w-4 h-4" />
        Shortcuts
        <kbd className="ml-1 px-1.5 py-0.5 text-xs bg-elevated rounded">⌘/</kbd>
      </Button>
    </div>
  );
}

interface TemplateCardProps {
  icon: React.ReactNode;
  name: string;
  description?: string;
  onClick: () => void;
}

export function TemplateCard({ icon, name, description, onClick }: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center p-4 bg-surface border border-border-default rounded-xl hover:border-border-strong hover:shadow-panel transition-all min-h-[100px] group"
    >
      <div className="w-12 h-12 rounded-xl bg-elevated flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <span className="text-sm font-medium text-text-primary">{name}</span>
      {description && (
        <span className="text-xs text-text-muted mt-1 text-center">{description}</span>
      )}
    </button>
  );
}

interface QuickStartTemplatesProps {
  onSelectTemplate: (template: string) => void;
}

export function QuickStartTemplates({ onSelectTemplate }: QuickStartTemplatesProps) {
  const templates = [
    {
      id: 'blank',
      name: 'Blank',
      icon: <Plus className="w-6 h-6 text-text-muted" />,
    },
    {
      id: 'react',
      name: 'React',
      icon: <span className="text-2xl">⚛️</span>,
    },
    {
      id: 'nextjs',
      name: 'Next.js',
      icon: <span className="text-2xl">▲</span>,
    },
    {
      id: 'python',
      name: 'Python',
      icon: <span className="text-2xl">🐍</span>,
    },
    {
      id: 'node',
      name: 'Node.js',
      icon: <span className="text-2xl">💚</span>,
    },
    {
      id: 'ai',
      name: 'AI Agent',
      icon: <Sparkles className="w-6 h-6 text-accent-primary" />,
    },
  ];

  return (
    <div>
      <h3 className="text-lg font-medium text-text-primary mb-4">Quick Start</h3>
      <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            icon={template.icon}
            name={template.name}
            onClick={() => onSelectTemplate(template.id)}
          />
        ))}
      </div>
    </div>
  );
}
