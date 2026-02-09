/**
 * Tests for notifications store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNotificationsStore, type AppNotification } from '../notifications';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockNotification: AppNotification = {
  id: 'notif-1',
  type: 'info',
  title: 'Test',
  message: 'Test message',
  read: false,
  created_at: new Date().toISOString(),
};

describe('notificationsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useNotificationsStore.setState({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        isOpen: false,
      });
    });
  });

  describe('Initial State', () => {
    it('has empty notifications', () => {
      const { result } = renderHook(() => useNotificationsStore());
      expect(result.current.notifications).toEqual([]);
      expect(result.current.unreadCount).toBe(0);
    });

    it('is not loading', () => {
      const { result } = renderHook(() => useNotificationsStore());
      expect(result.current.isLoading).toBe(false);
    });

    it('is closed', () => {
      const { result } = renderHook(() => useNotificationsStore());
      expect(result.current.isOpen).toBe(false);
    });
  });

  describe('setNotifications', () => {
    it('sets notifications and updates unread count', () => {
      const { result } = renderHook(() => useNotificationsStore());
      const notifs: AppNotification[] = [
        { ...mockNotification, id: '1', read: false },
        { ...mockNotification, id: '2', read: true },
      ];

      act(() => {
        result.current.setNotifications(notifs);
      });

      expect(result.current.notifications).toHaveLength(2);
      expect(result.current.unreadCount).toBe(1);
    });
  });

  describe('addNotification', () => {
    it('adds notification at front and increments unread', () => {
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.addNotification(mockNotification);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0]).toEqual(mockNotification);
      expect(result.current.unreadCount).toBe(1);
    });

    it('does not increment unread when notification is read', () => {
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.addNotification({ ...mockNotification, read: true });
      });

      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe('markAsRead', () => {
    it('marks notification as read and decrements unread', async () => {
      vi.mocked(api.post).mockResolvedValue({});
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([{ ...mockNotification, id: '1', read: false }]);
      });
      expect(result.current.unreadCount).toBe(1);

      await act(async () => {
        await result.current.markAsRead('1');
      });

      expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/1/read', {});
      expect(result.current.notifications[0]?.read).toBe(true);
      expect(result.current.unreadCount).toBe(0);
    });

    it('handles API error gracefully', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([{ ...mockNotification, id: '1' }]);
      });

      await act(async () => {
        await result.current.markAsRead('1');
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('markAllAsRead', () => {
    it('marks all as read and sets unread to 0', async () => {
      vi.mocked(api.post).mockResolvedValue({});
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([
          { ...mockNotification, id: '1', read: false },
          { ...mockNotification, id: '2', read: false },
        ]);
      });

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/read-all', {});
      expect(result.current.unreadCount).toBe(0);
      expect(result.current.notifications.every((n) => n.read)).toBe(true);
    });

    it('handles API error gracefully', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Read-all failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([{ ...mockNotification, id: '1', read: false }]);
      });

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('deleteNotification', () => {
    it('removes notification and updates unread', async () => {
      vi.mocked(api.delete).mockResolvedValue(undefined);
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([{ ...mockNotification, id: '1', read: false }]);
      });

      await act(async () => {
        await result.current.deleteNotification('1');
      });

      expect(api.delete).toHaveBeenCalledWith('/api/v1/notifications/1');
      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.unreadCount).toBe(0);
    });

    it('removes notification but does not decrement unread when deleted item was read', async () => {
      vi.mocked(api.delete).mockResolvedValue(undefined);
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([
          { ...mockNotification, id: '1', read: true },
          { ...mockNotification, id: '2', read: false },
        ]);
      });
      expect(result.current.unreadCount).toBe(1);

      await act(async () => {
        await result.current.deleteNotification('1');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0]?.id).toBe('2');
      expect(result.current.unreadCount).toBe(1);
    });

    it('handles API error gracefully', async () => {
      vi.mocked(api.delete).mockRejectedValue(new Error('Delete failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setNotifications([{ ...mockNotification, id: '1' }]);
      });

      await act(async () => {
        await result.current.deleteNotification('1');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('fetchNotifications', () => {
    it('fetches and sets notifications', async () => {
      vi.mocked(api.get).mockResolvedValue({
        items: [mockNotification],
        unread_count: 1,
      });

      const { result } = renderHook(() => useNotificationsStore());

      await act(async () => {
        await result.current.fetchNotifications();
      });

      expect(api.get).toHaveBeenCalledWith('/api/v1/notifications');
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.unreadCount).toBe(1);
      expect(result.current.isLoading).toBe(false);
    });

    it('sets isLoading false on error', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useNotificationsStore());

      await act(async () => {
        await result.current.fetchNotifications();
      });

      expect(result.current.isLoading).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('setIsOpen and toggle', () => {
    it('setIsOpen sets panel open state', () => {
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.setIsOpen(true);
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.setIsOpen(false);
      });
      expect(result.current.isOpen).toBe(false);
    });

    it('toggle flips open state', () => {
      const { result } = renderHook(() => useNotificationsStore());

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(false);
    });
  });
});
