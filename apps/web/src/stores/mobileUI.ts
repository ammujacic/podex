/**
 * Mobile UI state store.
 * Manages mobile-specific UI state like menu, widgets, file viewer, and actions.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface MobileFileState {
  path: string;
  content: string;
  language: string;
}

interface MobileFileActionsTarget {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

interface MobileUIState {
  // Mobile menu
  isMobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;

  // Mobile widgets (for workspace bottom sheets)
  mobileActiveWidget: string | null;
  openMobileWidget: (widgetId: string) => void;
  closeMobileWidget: () => void;

  // Mobile file viewer
  mobileOpenFile: MobileFileState | null;
  openMobileFile: (path: string, content: string, language: string) => void;
  closeMobileFile: () => void;

  // Mobile file actions (quick actions sheet)
  mobileFileActionsTarget: MobileFileActionsTarget | null;
  openMobileFileActions: (path: string, name: string, type: 'file' | 'directory') => void;
  closeMobileFileActions: () => void;
}

export const useMobileUIStore = create<MobileUIState>()(
  devtools(
    (set) => ({
      // Mobile menu
      isMobileMenuOpen: false,
      setMobileMenuOpen: (open) => set({ isMobileMenuOpen: open }),
      toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),

      // Mobile widgets
      mobileActiveWidget: null,
      openMobileWidget: (widgetId) => set({ mobileActiveWidget: widgetId }),
      closeMobileWidget: () => set({ mobileActiveWidget: null }),

      // Mobile file viewer
      mobileOpenFile: null,
      openMobileFile: (path, content, language) =>
        set({ mobileOpenFile: { path, content, language } }),
      closeMobileFile: () => set({ mobileOpenFile: null }),

      // Mobile file actions
      mobileFileActionsTarget: null,
      openMobileFileActions: (path, name, type) =>
        set({ mobileFileActionsTarget: { path, name, type } }),
      closeMobileFileActions: () => set({ mobileFileActionsTarget: null }),
    }),
    {
      name: 'podex-mobile-ui',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// Convenience hooks
export const useMobileMenu = () => {
  const isOpen = useMobileUIStore((state) => state.isMobileMenuOpen);
  const setOpen = useMobileUIStore((state) => state.setMobileMenuOpen);
  const toggle = useMobileUIStore((state) => state.toggleMobileMenu);
  return { isOpen, setOpen, toggle };
};

export const useMobileWidget = () => {
  const activeWidget = useMobileUIStore((state) => state.mobileActiveWidget);
  const open = useMobileUIStore((state) => state.openMobileWidget);
  const close = useMobileUIStore((state) => state.closeMobileWidget);
  return { activeWidget, open, close };
};

export const useMobileFileViewer = () => {
  const file = useMobileUIStore((state) => state.mobileOpenFile);
  const open = useMobileUIStore((state) => state.openMobileFile);
  const close = useMobileUIStore((state) => state.closeMobileFile);
  return { file, open, close };
};

export const useMobileFileActions = () => {
  const target = useMobileUIStore((state) => state.mobileFileActionsTarget);
  const open = useMobileUIStore((state) => state.openMobileFileActions);
  const close = useMobileUIStore((state) => state.closeMobileFileActions);
  return { target, open, close };
};
