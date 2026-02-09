/**
 * Notifications store for managing in-app notifications.
 *
 * Handles fetching, displaying, and managing notification state with
 * real-time updates via WebSocket.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { api } from '@/lib/api';

export interface AppNotification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  action_url?: string;
  action_label?: string;
  read: boolean;
  created_at: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  isOpen: boolean;

  // Actions
  setNotifications: (notifications: AppNotification[]) => void;
  addNotification: (notification: AppNotification) => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  fetchNotifications: () => Promise<void>;
  setIsOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useNotificationsStore = create<NotificationsState>()(
  devtools(
    (set, _get) => ({
      notifications: [],
      unreadCount: 0,
      isLoading: false,
      isOpen: false,

      setNotifications: (notifications) =>
        set({
          notifications,
          unreadCount: notifications.filter((n) => !n.read).length,
        }),

      addNotification: (notification) =>
        set((state) => ({
          notifications: [notification, ...state.notifications],
          unreadCount: state.unreadCount + (notification.read ? 0 : 1),
        })),

      markAsRead: async (id) => {
        try {
          await api.post(`/api/v1/notifications/${id}/read`, {});
          set((state) => ({
            notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
            unreadCount: Math.max(0, state.unreadCount - 1),
          }));
        } catch (error) {
          console.error('Failed to mark notification as read:', error);
        }
      },

      markAllAsRead: async () => {
        try {
          await api.post('/api/v1/notifications/read-all', {});
          set((state) => ({
            notifications: state.notifications.map((n) => ({ ...n, read: true })),
            unreadCount: 0,
          }));
        } catch (error) {
          console.error('Failed to mark all notifications as read:', error);
        }
      },

      deleteNotification: async (id) => {
        try {
          await api.delete(`/api/v1/notifications/${id}`);
          set((state) => {
            const notification = state.notifications.find((n) => n.id === id);
            return {
              notifications: state.notifications.filter((n) => n.id !== id),
              unreadCount:
                notification && !notification.read
                  ? Math.max(0, state.unreadCount - 1)
                  : state.unreadCount,
            };
          });
        } catch (error) {
          console.error('Failed to delete notification:', error);
        }
      },

      fetchNotifications: async () => {
        set({ isLoading: true });
        try {
          const response = (await api.get('/api/v1/notifications')) as {
            items: AppNotification[];
            unread_count: number;
          };
          set({
            notifications: response.items,
            unreadCount: response.unread_count,
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to fetch notifications:', error);
          set({ isLoading: false });
        }
      },

      setIsOpen: (open) => set({ isOpen: open }),

      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
    }),
    { name: 'notifications-store' }
  )
);
