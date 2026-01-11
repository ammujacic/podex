'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Settings,
  Palette,
  Keyboard,
  Code,
  Bot,
  User,
  Bell,
  Shield,
  ChevronLeft,
  Search,
  Plug,
  Server,
  Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const settingsNavItems = [
  { href: '/settings', label: 'General', icon: Settings },
  { href: '/settings/editor', label: 'Editor', icon: Code },
  { href: '/settings/themes', label: 'Themes', icon: Palette },
  { href: '/settings/keybindings', label: 'Keyboard Shortcuts', icon: Keyboard },
  { href: '/settings/agents', label: 'Agents & AI', icon: Bot },
  { href: '/settings/voice', label: 'Voice & Audio', icon: Volume2 },
  { href: '/settings/local-pods', label: 'Local Pods', icon: Server },
  { href: '/settings/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings/account', label: 'Account', icon: User },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/privacy', label: 'Privacy & Security', icon: Shield },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = settingsNavItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
        </div>

        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-elevated border border-border-subtle text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== '/settings' && pathname.startsWith(item.href));

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
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle text-xs text-text-muted">
          <p>Podex v1.0.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
