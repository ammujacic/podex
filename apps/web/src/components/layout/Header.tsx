'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, X, Zap, User, LogOut, Settings, ChevronDown } from 'lucide-react';
import { useUser, useIsAuthenticated } from '@/stores/auth';
import { logout } from '@/lib/api';
import { Logo } from '@/components/ui/Logo';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const router = useRouter();
  const user = useUser();
  const isAuthenticated = useIsAuthenticated();

  const handleLogout = () => {
    logout();
    setUserMenuOpen(false);
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-void/80 backdrop-blur-lg">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-8">
        {/* Logo */}
        <Logo />

        {/* Desktop navigation */}
        <div className="hidden md:flex md:items-center md:gap-8">
          <Link
            href="/#agents"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            Agents
          </Link>
          <Link
            href="/#features"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            Features
          </Link>
          <Link
            href="/#demo"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            Demo
          </Link>
          <Link
            href="/#pricing"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            Pricing
          </Link>
        </div>

        {/* Desktop CTA / User menu */}
        <div className="hidden md:flex md:items-center md:gap-4">
          {isAuthenticated ? (
            <div className="relative">
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-overlay transition-colors"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
              >
                <div className="w-8 h-8 rounded-full bg-accent-secondary flex items-center justify-center overflow-hidden">
                  {user?.avatarUrl ? (
                    <Image
                      src={user.avatarUrl}
                      alt={user.name || 'User'}
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                  ) : (
                    <User className="w-4 h-4 text-text-primary" />
                  )}
                </div>
                <span className="text-sm font-medium text-text-primary">
                  {user?.name || user?.email}
                </span>
                <ChevronDown className="w-4 h-4" />
              </button>

              {/* User dropdown */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-lg bg-elevated border border-border-default shadow-lg">
                  <div className="p-3 border-b border-border-subtle">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {user?.name || 'User'}
                    </p>
                    <p className="text-xs text-text-muted truncate">{user?.email}</p>
                  </div>
                  <div className="p-1">
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Zap className="w-4 h-4" />
                      Dashboard
                    </Link>
                    <Link
                      href="/settings"
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </Link>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
                      onClick={handleLogout}
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/auth/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/auth/signup" className="btn btn-primary">
                Get Started
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          className="md:hidden p-2 text-text-secondary hover:text-text-primary"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border-subtle bg-surface">
          <div className="space-y-1 px-4 py-4">
            <Link
              href="/#agents"
              className="block px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
              onClick={() => setMobileMenuOpen(false)}
            >
              Agents
            </Link>
            <Link
              href="/#features"
              className="block px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
              onClick={() => setMobileMenuOpen(false)}
            >
              Features
            </Link>
            <Link
              href="/#demo"
              className="block px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
              onClick={() => setMobileMenuOpen(false)}
            >
              Demo
            </Link>
            <Link
              href="/#pricing"
              className="block px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pricing
            </Link>

            {isAuthenticated ? (
              <div className="pt-4 border-t border-border-subtle space-y-1">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-text-primary">{user?.name || 'User'}</p>
                  <p className="text-xs text-text-muted">{user?.email}</p>
                </div>
                <Link
                  href="/dashboard"
                  className="block px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link
                  href="/settings"
                  className="block px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Settings
                </Link>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-text-secondary hover:text-text-primary hover:bg-overlay rounded-md"
                  onClick={() => {
                    handleLogout();
                    setMobileMenuOpen(false);
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="pt-4 space-y-2">
                <Link
                  href="/auth/login"
                  className="block btn btn-ghost w-full text-center"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/signup"
                  className="block btn btn-primary w-full text-center"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Get Started
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
