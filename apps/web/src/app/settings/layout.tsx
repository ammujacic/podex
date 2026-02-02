'use client';

import { useState, createContext, useContext } from 'react';
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
  ChevronRight,
  Search,
  Plug,
  Server,
  Volume2,
  BarChart3,
  Package,
  CreditCard,
  Building2,
  Brain,
  Link2,
  KeyRound,
  Sparkles,
  Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuotaAlertProvider } from '@/components/billing';

const settingsNavItems = [
  { href: '/settings', label: 'General', icon: Settings },
  { href: '/settings/editor', label: 'Editor', icon: Code },
  { href: '/settings/themes', label: 'Themes', icon: Palette },
  { href: '/settings/keybindings', label: 'Keyboard Shortcuts', icon: Keyboard },
  { href: '/settings/agents', label: 'Agents & AI', icon: Bot },
  { href: '/settings/templates', label: 'Agent Templates', icon: Sparkles },
  { href: '/settings/memory', label: 'Memory', icon: Brain },
  { href: '/settings/voice', label: 'Voice & Audio', icon: Volume2 },
  { href: '/settings/connections', label: 'AI Subscriptions (API)', icon: Link2 },
  { href: '/settings/local-pods', label: 'Local Pods', icon: Server },
  { href: '/settings/ssh-keys', label: 'SSH Keys', icon: KeyRound },
  { href: '/settings/integrations', label: 'Integrations (MCP)', icon: Plug },
  { href: '/settings/organization', label: 'Organization', icon: Building2 },
  { href: '/settings/usage', label: 'Usage', icon: BarChart3 },
  { href: '/settings/plans', label: 'Plans', icon: Package },
  { href: '/settings/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings/account', label: 'Account', icon: User },
  { href: '/settings/devices', label: 'Devices & Sessions', icon: Smartphone },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/privacy', label: 'Privacy & Security', icon: Shield },
];

// Context to share mobile navigation state with child pages
interface SettingsMobileContextType {
  showSubNav: boolean;
  setShowSubNav: (show: boolean) => void;
}

const SettingsMobileContext = createContext<SettingsMobileContextType>({
  showSubNav: false,
  setShowSubNav: () => {},
});

export const useSettingsMobile = () => useContext(SettingsMobileContext);

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSubNav, setShowSubNav] = useState(false);

  const filteredItems = settingsNavItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Find current page label for mobile header
  const currentPage = settingsNavItems.find(
    (item) =>
      pathname === item.href || (item.href !== '/settings' && pathname.startsWith(item.href))
  );

  return (
    <SettingsMobileContext.Provider value={{ showSubNav, setShowSubNav }}>
      <div className="flex h-screen bg-void text-text-primary">
        {/* Mobile Header - only visible on mobile */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-surface border-b border-border-subtle">
          <div className="flex items-center justify-between p-4">
            {showSubNav ? (
              <button
                onClick={() => setShowSubNav(false)}
                className="flex items-center gap-2 text-text-muted hover:text-text-primary"
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="text-sm">Settings</span>
              </button>
            ) : (
              <Link
                href="/dashboard"
                className="flex items-center gap-2 text-text-muted hover:text-text-primary"
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="text-sm">Back to Dashboard</span>
              </Link>
            )}
            <h1 className="text-lg font-semibold text-text-primary">
              {showSubNav ? currentPage?.label || 'Settings' : 'Settings'}
            </h1>
            <div className="w-20" /> {/* Spacer for centering */}
          </div>
        </div>

        {/* Desktop Sidebar - hidden on mobile */}
        <aside className="hidden md:flex w-64 flex-col border-r border-border-subtle bg-surface">
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

        {/* Mobile Navigation List - visible on mobile when not showing sub-nav */}
        <div
          className={cn(
            'md:hidden fixed inset-0 top-[57px] bg-void z-40 overflow-y-auto',
            showSubNav && 'hidden'
          )}
        >
          {/* Search */}
          <div className="p-3 border-b border-border-subtle bg-surface">
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
          <nav className="p-2">
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
                      onClick={() => setShowSubNav(true)}
                      className={cn(
                        'flex items-center justify-between px-4 py-3 rounded-lg text-sm transition-colors',
                        isActive
                          ? 'bg-accent-primary/10 text-accent-primary'
                          : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 flex-shrink-0" />
                        <span className="text-base">{item.label}</span>
                      </div>
                      <ChevronRight className="h-5 w-5 text-text-muted" />
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
        </div>

        {/* Main content - on mobile only show when sub-nav is active */}
        <main
          className={cn(
            'flex-1 overflow-y-auto flex flex-col',
            'md:block',
            showSubNav ? 'block pt-[57px] md:pt-0' : 'hidden'
          )}
        >
          <QuotaAlertProvider>{children}</QuotaAlertProvider>
        </main>
      </div>
    </SettingsMobileContext.Provider>
  );
}
