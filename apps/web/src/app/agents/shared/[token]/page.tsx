'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Bot,
  User,
  Copy,
  Check,
  ArrowLeft,
  Loader2,
  Code,
  Terminal,
  FileText,
  Search,
  FolderOpen,
  GitBranch,
  Cpu,
  Download,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { getSharedTemplate, cloneSharedTemplate, type SharedTemplate } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

// Tool icon mapping
const TOOL_ICONS: Record<string, typeof Code> = {
  read_file: FileText,
  write_file: Code,
  search_code: Search,
  run_command: Terminal,
  list_directory: FolderOpen,
  create_task: GitBranch,
};

const TOOL_LABELS: Record<string, string> = {
  read_file: 'Read Files',
  write_file: 'Write Files',
  search_code: 'Search Code',
  run_command: 'Run Commands',
  list_directory: 'List Directories',
  create_task: 'Create Tasks',
};

export default function SharedAgentPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const { tokens } = useAuthStore();
  const isAuthenticated = !!tokens?.accessToken;

  const [template, setTemplate] = useState<SharedTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    async function fetchTemplate() {
      try {
        const data = await getSharedTemplate(token);
        setTemplate(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load shared agent');
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      fetchTemplate();
    }
  }, [token]);

  const handleClone = async () => {
    if (!isAuthenticated) {
      // Redirect to login with return URL
      router.push(`/auth/login?returnTo=/agents/shared/${token}`);
      return;
    }

    setCloning(true);
    try {
      await cloneSharedTemplate(token);
      setCloned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone agent');
    } finally {
      setCloning(false);
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading agent...</span>
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary mb-2">Agent Not Found</h1>
          <p className="text-text-muted mb-6">
            {error || 'This shared agent link may have expired or been revoked.'}
          </p>
          <Link href="/dashboard">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border-subtle bg-surface">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to Dashboard</span>
          </Link>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-overlay transition-colors"
          >
            {linkCopied ? (
              <>
                <Check className="h-4 w-4 text-green-400" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                <span>Copy Link</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Agent Header */}
        <div className="flex items-start gap-6 mb-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20">
            {template.icon ? (
              <span className="text-4xl">{template.icon}</span>
            ) : (
              <Bot className="h-10 w-10 text-indigo-400" />
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-text-primary mb-2">{template.name}</h1>
            {template.description && (
              <p className="text-lg text-text-secondary mb-4">{template.description}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-text-muted">
              {template.owner.name && (
                <div className="flex items-center gap-2">
                  {template.owner.avatar_url ? (
                    <Image
                      src={template.owner.avatar_url}
                      alt={template.owner.name}
                      width={20}
                      height={20}
                      className="rounded-full"
                    />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                  <span>Created by {template.owner.name}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Download className="h-4 w-4" />
                <span>{template.clone_count} clones</span>
              </div>
            </div>
          </div>
        </div>

        {/* Clone CTA */}
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
          {cloned ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                  <Check className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">Agent Added Successfully!</p>
                  <p className="text-sm text-text-muted">
                    You can now use this agent in your sessions.
                  </p>
                </div>
              </div>
              <Link href="/dashboard">
                <Button>Go to Dashboard</Button>
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text-primary mb-1">
                  Add this agent to your collection
                </p>
                <p className="text-sm text-text-muted">
                  Clone this agent template and customize it for your own use.
                </p>
              </div>
              <Button onClick={handleClone} disabled={cloning}>
                {cloning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Cloning...
                  </>
                ) : isAuthenticated ? (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Clone Agent
                  </>
                ) : (
                  <>
                    <User className="h-4 w-4 mr-2" />
                    Sign in to Clone
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Agent Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Model */}
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <div className="flex items-center gap-2 text-text-muted mb-3">
              <Cpu className="h-4 w-4" />
              <span className="text-sm font-medium">AI Model</span>
            </div>
            <p className="text-text-primary font-mono">{template.model}</p>
          </div>

          {/* Tools */}
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <div className="flex items-center gap-2 text-text-muted mb-3">
              <Terminal className="h-4 w-4" />
              <span className="text-sm font-medium">Available Tools</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {template.allowed_tools.map((tool) => {
                const Icon = TOOL_ICONS[tool] || Code;
                return (
                  <div
                    key={tool}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-elevated text-text-secondary text-sm"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{TOOL_LABELS[tool] || tool}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* System Prompt Preview */}
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <div className="flex items-center gap-2 text-text-muted mb-4">
            <FileText className="h-4 w-4" />
            <span className="text-sm font-medium">System Prompt Preview</span>
          </div>
          <div className="bg-elevated rounded-lg p-4 font-mono text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {template.system_prompt_preview}
          </div>
          {template.system_prompt_preview.endsWith('...') && (
            <p className="mt-3 text-xs text-text-muted">
              Full system prompt will be available after cloning.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
