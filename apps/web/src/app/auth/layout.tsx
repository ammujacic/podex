import { type ReactNode } from 'react';
import { Logo } from '@/components/ui/Logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-void">
      {/* Header */}
      <header className="border-b border-border-subtle">
        <div className="container mx-auto px-4 py-4">
          <Logo />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border-subtle py-4">
        <div className="container mx-auto px-4 text-center text-text-muted text-sm">
          <p>&copy; {new Date().getFullYear()} Podex. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
