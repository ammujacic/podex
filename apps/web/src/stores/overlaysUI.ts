/**
 * Overlay UI state store.
 * Manages command palette, quick open, global search, and modal state.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface OverlaysUIState {
  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Quick open (Cmd+P)
  quickOpenOpen: boolean;
  openQuickOpen: () => void;
  closeQuickOpen: () => void;
  toggleQuickOpen: () => void;

  // Global search
  globalSearchOpen: boolean;
  openGlobalSearch: () => void;
  closeGlobalSearch: () => void;
  toggleGlobalSearch: () => void;

  // Modals
  activeModal: string | null;
  modalData: Record<string, unknown>;
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

export const useOverlaysUIStore = create<OverlaysUIState>()(
  devtools(
    (set) => ({
      // Command palette
      commandPaletteOpen: false,
      openCommandPalette: () =>
        set({
          commandPaletteOpen: true,
          quickOpenOpen: false,
          globalSearchOpen: false,
        }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      toggleCommandPalette: () =>
        set((state) => ({
          commandPaletteOpen: !state.commandPaletteOpen,
          quickOpenOpen: false,
          globalSearchOpen: false,
        })),

      // Quick open
      quickOpenOpen: false,
      openQuickOpen: () =>
        set({
          quickOpenOpen: true,
          commandPaletteOpen: false,
          globalSearchOpen: false,
        }),
      closeQuickOpen: () => set({ quickOpenOpen: false }),
      toggleQuickOpen: () =>
        set((state) => ({
          quickOpenOpen: !state.quickOpenOpen,
          commandPaletteOpen: false,
          globalSearchOpen: false,
        })),

      // Global search
      globalSearchOpen: false,
      openGlobalSearch: () =>
        set({
          globalSearchOpen: true,
          commandPaletteOpen: false,
          quickOpenOpen: false,
        }),
      closeGlobalSearch: () => set({ globalSearchOpen: false }),
      toggleGlobalSearch: () =>
        set((state) => ({
          globalSearchOpen: !state.globalSearchOpen,
          commandPaletteOpen: false,
          quickOpenOpen: false,
        })),

      // Modals
      activeModal: null,
      modalData: {},
      openModal: (modalId, data = {}) => set({ activeModal: modalId, modalData: data }),
      closeModal: () => set({ activeModal: null, modalData: {} }),
    }),
    {
      name: 'podex-overlays-ui',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// Convenience hooks
export const useCommandPalette = () => {
  const isOpen = useOverlaysUIStore((state) => state.commandPaletteOpen);
  const open = useOverlaysUIStore((state) => state.openCommandPalette);
  const close = useOverlaysUIStore((state) => state.closeCommandPalette);
  const toggle = useOverlaysUIStore((state) => state.toggleCommandPalette);
  return { isOpen, open, close, toggle };
};

export const useQuickOpen = () => {
  const isOpen = useOverlaysUIStore((state) => state.quickOpenOpen);
  const open = useOverlaysUIStore((state) => state.openQuickOpen);
  const close = useOverlaysUIStore((state) => state.closeQuickOpen);
  const toggle = useOverlaysUIStore((state) => state.toggleQuickOpen);
  return { isOpen, open, close, toggle };
};

export const useGlobalSearch = () => {
  const isOpen = useOverlaysUIStore((state) => state.globalSearchOpen);
  const open = useOverlaysUIStore((state) => state.openGlobalSearch);
  const close = useOverlaysUIStore((state) => state.closeGlobalSearch);
  const toggle = useOverlaysUIStore((state) => state.toggleGlobalSearch);
  return { isOpen, open, close, toggle };
};

export const useModal = () => {
  const activeModal = useOverlaysUIStore((state) => state.activeModal);
  const modalData = useOverlaysUIStore((state) => state.modalData);
  const open = useOverlaysUIStore((state) => state.openModal);
  const close = useOverlaysUIStore((state) => state.closeModal);
  return { activeModal, modalData, open, close };
};
