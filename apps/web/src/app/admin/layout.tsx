'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Server,
  Box,
  Settings,
  BarChart3,
  ChevronLeft,
  Shield,
  TrendingUp,
  DollarSign,
  Activity,
  Terminal,
  Brain,
  Bot,
  FileSearch,
  ShieldCheck,
  Building2,
  Zap,
  Store,
  Cloud,
  Plug,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUser, useAuthLoading } from '@/stores/auth';

const adminNavItems = [
  {
    section: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    section: 'Analytics',
    items: [
      { href: '/admin/analytics', label: 'Overview', icon: BarChart3 },
      { href: '/admin/analytics/revenue', label: 'Revenue', icon: DollarSign },
      { href: '/admin/analytics/usage', label: 'Usage', icon: Activity },
      { href: '/admin/analytics/growth', label: 'User Growth', icon: TrendingUp },
    ],
  },
  {
    section: 'Management',
    items: [
      { href: '/admin/management/users', label: 'Users', icon: Users },
      { href: '/admin/management/organizations', label: 'Organizations', icon: Building2 },
      { href: '/admin/management/plans', label: 'Subscription Plans', icon: CreditCard },
      { href: '/admin/management/models', label: 'LLM Models', icon: Brain },
      { href: '/admin/management/providers', label: 'LLM Providers', icon: Cloud },
      { href: '/admin/management/mcp-servers', label: 'MCP Servers', icon: Plug },
      { href: '/admin/management/hardware', label: 'Hardware Specs', icon: Server },
      { href: '/admin/management/templates', label: 'Pod Templates', icon: Box },
      { href: '/admin/management/terminal-agents', label: 'Terminal Agents', icon: Terminal },
      { href: '/admin/management/agent-roles', label: 'Agent Roles', icon: Bot },
      { href: '/admin/management/skills', label: 'System Skills', icon: Zap },
      { href: '/admin/management/marketplace', label: 'Skill Marketplace', icon: Store },
      { href: '/admin/management/settings', label: 'Platform Settings', icon: Settings },
    ],
  },
  {
    section: 'Security',
    items: [
      { href: '/admin/audit', label: 'Audit Logs', icon: FileSearch },
      { href: '/admin/compliance', label: 'Compliance', icon: ShieldCheck },
    ],
  },
  {
    section: 'Developer',
    items: [
      { href: '/admin/api/docs', label: 'API Documentation', icon: BookOpen, external: true },
      { href: '/admin/api/redoc', label: 'API Reference', icon: ExternalLink, external: true },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useUser();
  const isLoading = useAuthLoading();

  // Check admin access
  useEffect(() => {
    if (!isLoading && user && user.role !== 'admin' && user.role !== 'super_admin') {
      router.push('/dashboard');
    }
  }, [user, isLoading, router]);

  // Show loading or redirect if not admin
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-void">
        <div className="animate-spin h-8 w-8 border-2 border-accent-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return null;
  }

  return (
    <div className="flex h-screen bg-void text-text-primary">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-r border-border-subtle bg-surface">
        {/* Header */}
        <div className="p-4 border-b border-border-subtle">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-text-muted hover:text-text-primary mb-4"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-sm">Back to Dashboard</span>
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-accent-primary" />
            <h1 className="text-xl font-semibold text-text-primary">Admin Panel</h1>
          </div>
          <p className="text-xs text-text-muted mt-1">
            {user.role === 'super_admin' ? 'Super Administrator' : 'Administrator'}
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2">
          {adminNavItems.map((section) => (
            <div key={section.section} className="mb-4">
              <h3 className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                {section.section}
              </h3>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  // Use exact matching - all nav items are explicit routes
                  const isActive = pathname === item.href;
                  const isExternal = 'external' in item && item.external;

                  // External links (API docs) - use anchor tag to API server
                  if (isExternal) {
                    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '';
                    return (
                      <li key={item.href}>
                        <a
                          href={`${apiBaseUrl}${item.href}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-text-secondary hover:text-text-primary hover:bg-overlay"
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          <ExternalLink className="h-3 w-3 text-text-muted" />
                        </a>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                          isActive
                            ? 'bg-accent-primary/10 text-accent-primary'
                            : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle text-xs text-text-muted">
          <p>Podex Admin v1.0.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
