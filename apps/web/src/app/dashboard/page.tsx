'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Clock,
  GitBranch,
  MoreVertical,
  Play,
  Pause,
  Trash2,
  Loader2,
  Server,
  Search,
  Grid,
  List,
  Settings,
  Box,
  Circle,
  AlertCircle,
  ChevronRight,
  Command,
  Activity,
  Coins,
  Bot,
  Pin,
  PinOff,
  Bell,
  Keyboard,
  FileCode,
  GitCommit,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Info,
  X,
  ExternalLink,
  Rocket,
  FolderGit2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { Logo } from '@/components/ui/Logo';
import {
  listSessions,
  listTemplates,
  deleteSession,
  getDashboardStats,
  getActivityFeed,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  pinSession,
  unpinSession,
  getUsageHistory,
  pauseWorkspace,
  resumeWorkspace,
  type Session,
  type PodTemplate,
  type DashboardStats,
  type ActivityItem,
  type Notification,
  type UsageDataPoint,
  type PodUsageSeries,
} from '@/lib/api';
import { useUser, useAuthStore } from '@/stores/auth';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { TimeRangeSelector, getDaysFromValue } from '@/components/dashboard/TimeRangeSelector';
import { ConfirmDialog, useConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { MobileHeader } from '@/components/ui/MobileHeader';
import { InstallBanner } from '@/components/pwa';

// Status colors and labels
const defaultStatus = {
  color: 'text-text-muted',
  bg: 'bg-overlay',
  label: 'Unknown',
  icon: <Circle className="w-2 h-2" />,
};

const statusConfig: Record<
  string,
  { color: string; bg: string; label: string; icon: React.ReactNode }
> = {
  active: {
    color: 'text-accent-success',
    bg: 'bg-accent-success/10',
    label: 'Running',
    icon: <Circle className="w-2 h-2 fill-current" />,
  },
  stopped: {
    color: 'text-text-muted',
    bg: 'bg-overlay',
    label: 'Stopped',
    icon: <Circle className="w-2 h-2" />,
  },
  standby: {
    color: 'text-accent-warning',
    bg: 'bg-accent-warning/10',
    label: 'Standby',
    icon: <Circle className="w-2 h-2 fill-current" />,
  },
  creating: {
    color: 'text-accent-warning',
    bg: 'bg-accent-warning/10',
    label: 'Starting',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  error: {
    color: 'text-accent-error',
    bg: 'bg-accent-error/10',
    label: 'Error',
    icon: <AlertCircle className="w-3 h-3" />,
  },
};

const getStatus = (status: string) => statusConfig[status] ?? defaultStatus;

// Template icon configuration with CDN URLs (Simple Icons)
const templateIconConfig: Record<string, { url: string; color: string }> = {
  nodejs: {
    url: 'https://cdn.simpleicons.org/nodedotjs/339933',
    color: '#339933',
  },
  python: {
    url: 'https://cdn.simpleicons.org/python/3776AB',
    color: '#3776AB',
  },
  go: {
    url: 'https://cdn.simpleicons.org/go/00ADD8',
    color: '#00ADD8',
  },
  rust: {
    url: 'https://cdn.simpleicons.org/rust/DEA584',
    color: '#DEA584',
  },
  typescript: {
    url: 'https://cdn.simpleicons.org/typescript/3178C6',
    color: '#3178C6',
  },
  javascript: {
    url: 'https://cdn.simpleicons.org/javascript/F7DF1E',
    color: '#F7DF1E',
  },
  react: {
    url: 'https://cdn.simpleicons.org/react/61DAFB',
    color: '#61DAFB',
  },
  docker: {
    url: 'https://cdn.simpleicons.org/docker/2496ED',
    color: '#2496ED',
  },
  layers: {
    url: 'https://cdn.simpleicons.org/stackblitz/1389FD',
    color: '#1389FD',
  },
};

// Template Icon component
function TemplateIcon({
  icon,
  iconUrl,
  size = 'md',
}: {
  icon: string | null;
  iconUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };
  const sizePixels = { sm: 16, md: 20, lg: 24 };

  // Use iconUrl from API if available, otherwise fall back to local mapping
  const url = iconUrl || (icon ? templateIconConfig[icon]?.url : null);

  if (url) {
    return (
      <Image
        src={url}
        alt={icon || 'template'}
        width={sizePixels[size]}
        height={sizePixels[size]}
        className={sizeClasses[size]}
        unoptimized
      />
    );
  }

  // Fallback to Box icon
  return <Box className={`${sizeClasses[size]} text-text-muted`} />;
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const router = useRouter();
  const user = useUser();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [templates, setTemplates] = useState<PodTemplate[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [usageHistory, setUsageHistory] = useState<UsageDataPoint[]>([]);
  const [podUsageData, setPodUsageData] = useState<PodUsageSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [pinningSession, setPinningSession] = useState<string | null>(null);
  const [pausingSession, setPausingSession] = useState<string | null>(null);
  const [resumingSession, setResumingSession] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('30d');
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [visiblePods, setVisiblePods] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Click outside handler for notifications dropdown
  const notificationsRef = useClickOutside<HTMLDivElement>(
    () => setShowNotifications(false),
    showNotifications
  );

  // Confirm dialog for delete
  const { openDialog, dialogProps } = useConfirmDialog();

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // CMD+K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // CMD+/ to show shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
      // CMD+N to create new pod
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        router.push('/session/new');
      }
      // Escape to close modals or blur search
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
        } else if (showNotifications) {
          setShowNotifications(false);
        } else if (searchFocused) {
          searchInputRef.current?.blur();
          setSearchQuery('');
        }
      }
    },
    [searchFocused, showShortcuts, showNotifications, router]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    // Wait for auth to initialize before checking user
    if (!isInitialized) {
      return;
    }

    if (!user) {
      router.push('/auth/login');
      return;
    }

    async function loadData() {
      try {
        setLoadError(null);
        const [sessionsData, templatesData, statsData, activityData, notificationsData] =
          await Promise.all([
            listSessions(1, 50),
            listTemplates(true).catch(() => []),
            getDashboardStats().catch(() => null),
            getActivityFeed(10).catch(() => ({ items: [], has_more: false })),
            getNotifications().catch(() => ({ items: [], unread_count: 0 })),
          ]);
        setSessions(sessionsData.items);
        setTemplates(templatesData);
        setStats(statsData);
        setActivities(activityData.items);
        setNotifications(notificationsData.items);
        setUnreadCount(notificationsData.unread_count);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load dashboard data';
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user, router, isInitialized]);

  // Load usage history when period changes
  useEffect(() => {
    if (!user) return;

    async function loadUsageData() {
      try {
        setLoadingUsage(true);
        const days = getDaysFromValue(selectedPeriod);
        const usageData = await getUsageHistory(days).catch((err) => {
          console.error('Failed to fetch usage history:', err);
          return {
            daily: [],
            by_pod: [],
            period_start: '',
            period_end: '',
          };
        });
        // Debug: Uncomment to see usage data loading
        // console.log('Usage history loaded:', {
        //   period: selectedPeriod,
        //   days,
        //   dataPoints: usageData.daily.length,
        //   totalTokens: usageData.daily.reduce((sum, p) => sum + p.tokens, 0),
        // });
        setUsageHistory(usageData.daily);
        setPodUsageData(usageData.by_pod);
        // Initialize all pods as visible
        setVisiblePods(new Set(usageData.by_pod.map((p) => p.session_id)));
      } catch (error) {
        console.error('Failed to load usage history:', error);
      } finally {
        setLoadingUsage(false);
      }
    }

    loadUsageData();
  }, [selectedPeriod, user]);

  const getTemplateForSession = (session: Session): PodTemplate | undefined => {
    if (!session.template_id) return undefined;
    return templates.find((t) => t.id === session.template_id);
  };

  const togglePodVisibility = (sessionId: string) => {
    setVisiblePods((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  // Handle pin/unpin session
  const handlePinSession = async (sessionId: string, isPinned: boolean) => {
    setPinningSession(sessionId);
    try {
      if (isPinned) {
        await unpinSession(sessionId);
      } else {
        await pinSession(sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, pinned: !isPinned } : s))
      );
    } catch {
      // Handle error
    } finally {
      setPinningSession(null);
    }
  };

  // Handle notification read
  const handleMarkNotificationRead = async (notificationId: string) => {
    try {
      await markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Handle error
    }
  };

  // Handle mark all notifications read
  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Handle error
    }
  };

  // Get activity icon
  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'agent_message':
        return <MessageSquare className="w-4 h-4 text-accent-primary" />;
      case 'file_change':
        return <FileCode className="w-4 h-4 text-accent-secondary" />;
      case 'git_commit':
      case 'git_push':
        return <GitCommit className="w-4 h-4 text-accent-warning" />;
      case 'session_created':
      case 'session_started':
        return <Rocket className="w-4 h-4 text-accent-success" />;
      case 'session_stopped':
        return <Circle className="w-4 h-4 text-text-muted" />;
      case 'agent_created':
        return <Bot className="w-4 h-4 text-accent-primary" />;
      case 'agent_error':
        return <AlertTriangle className="w-4 h-4 text-accent-error" />;
      default:
        return <Activity className="w-4 h-4 text-text-muted" />;
    }
  };

  // Get notification icon
  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-accent-success" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-accent-warning" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-accent-error" />;
      default:
        return <Info className="w-4 h-4 text-accent-primary" />;
    }
  };

  // Pinned sessions
  const pinnedSessions = sessions.filter((s) => s.pinned);

  // Actual delete function (called after confirmation)
  const performDeleteSession = async (sessionId: string) => {
    setDeleting(sessionId);
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      // Handle error
    } finally {
      setDeleting(null);
      setOpenMenuId(null);
    }
  };

  // Show confirmation dialog before deleting
  const handleDeleteSession = (session: Session) => {
    openDialog({
      title: 'Delete Pod',
      message: `Are you sure you want to delete "${session.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: () => performDeleteSession(session.id),
    });
  };

  const handlePauseSession = async (sessionId: string, workspaceId: string) => {
    setPausingSession(sessionId);
    try {
      await pauseWorkspace(workspaceId);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'stopped' } : s))
      );
    } catch (error) {
      console.error('Failed to pause session:', error);
    } finally {
      setPausingSession(null);
      setOpenMenuId(null);
    }
  };

  const handleResumeSession = async (sessionId: string, workspaceId: string) => {
    setResumingSession(sessionId);
    try {
      await resumeWorkspace(workspaceId);
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, status: 'active' } : s)));
    } catch (error) {
      console.error('Failed to resume session:', error);
    } finally {
      setResumingSession(null);
      setOpenMenuId(null);
    }
  };

  const filteredSessions = sessions.filter((session) =>
    session.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const recentSessions = filteredSessions.slice(0, 4);
  const allSessions = filteredSessions;

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-void">
      {/* Background effects */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full bg-accent-primary/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-accent-secondary/5 blur-3xl" />
      </div>

      {/* Error Banner */}
      {loadError && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-accent-error/90 text-white px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{loadError}</span>
            </div>
            <button
              onClick={() => setLoadError(null)}
              className="p-1 hover:bg-white/20 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile Header */}
      <MobileHeader />

      {/* Desktop Header */}
      <header className="hidden md:block bg-void/80 backdrop-blur-lg border-b border-border-subtle sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Logo href="/dashboard" />
            <div className="flex items-center gap-2">
              {/* Keyboard Shortcuts */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowShortcuts(true)}
                className="hidden sm:flex min-w-[44px] min-h-[44px]"
              >
                <Keyboard className="w-4 h-4" />
              </Button>

              {/* Notifications */}
              <div className="relative" ref={notificationsRef}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="min-w-[44px] min-h-[44px]"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent-error text-white text-xs rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>

                {/* Notifications Dropdown */}
                <AnimatePresence>
                  {showNotifications && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-80 bg-surface border border-border-default rounded-xl shadow-lg overflow-hidden z-50"
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                        <h3 className="font-medium text-text-primary">Notifications</h3>
                        {unreadCount > 0 && (
                          <button
                            onClick={handleMarkAllRead}
                            className="text-xs text-accent-primary hover:underline"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-[300px] overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="px-4 py-8 text-center text-text-muted text-sm">
                            No notifications yet
                          </div>
                        ) : (
                          notifications.slice(0, 5).map((notification) => (
                            <div
                              key={notification.id}
                              onClick={() => handleMarkNotificationRead(notification.id)}
                              className={`px-4 py-3 border-b border-border-subtle last:border-0 cursor-pointer hover:bg-overlay transition-colors ${
                                !notification.read ? 'bg-accent-primary/5' : ''
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                {getNotificationIcon(notification.type)}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-text-primary">
                                    {notification.title}
                                  </p>
                                  <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                                    {notification.message}
                                  </p>
                                  <p className="text-xs text-text-muted mt-1">
                                    {formatDate(notification.created_at)}
                                  </p>
                                </div>
                                {notification.action_url && (
                                  <Link href={notification.action_url}>
                                    <ExternalLink className="w-4 h-4 text-text-muted hover:text-text-primary" />
                                  </Link>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Link href="/settings">
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Settings</span>
                </Button>
              </Link>
              <Link href="/session/new">
                <Button>
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">New Pod</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* PWA Install Banner */}
        <InstallBanner className="mb-6" />

        {/* Welcome Section */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-text-secondary">
            {sessions.length === 0
              ? 'Create your first pod to start building.'
              : `You have ${sessions.length} pod${sessions.length === 1 ? '' : 's'}. Pick up where you left off.`}
          </p>
        </motion.div>

        {/* Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-10"
        >
          <div
            className={`relative flex items-center bg-surface border rounded-xl transition-all ${
              searchFocused
                ? 'border-accent-primary ring-2 ring-accent-primary/20'
                : 'border-border-default hover:border-border-hover'
            }`}
          >
            <Search className="w-5 h-5 absolute left-4 text-text-muted" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search pods..."
              className="w-full bg-transparent pl-12 pr-24 py-3.5 text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <div className="absolute right-3 flex items-center gap-1.5">
              <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md bg-overlay border border-border-subtle px-2 py-1 text-xs text-text-muted">
                <Command className="w-3 h-3" />
                <span>K</span>
              </kbd>
            </div>
          </div>
        </motion.div>

        {/* Statistics Section */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-10"
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Total Tokens */}
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-primary/10 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-accent-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-text-muted">Tokens Used</p>
                    <p className="text-xl font-semibold text-text-primary">
                      {formatNumber(stats.usage.tokens_this_month)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  {formatNumber(stats.usage.total_tokens_used)} total
                </p>
              </div>

              {/* Active Pods */}
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-secondary/10 flex items-center justify-center">
                    <Server className="w-5 h-5 text-accent-secondary" />
                  </div>
                  <div>
                    <p className="text-sm text-text-muted">Active Pods</p>
                    <p className="text-xl font-semibold text-text-primary">{stats.active_pods}</p>
                  </div>
                </div>
                <p className="text-xs text-text-muted mt-2">{stats.total_pods} total pods</p>
              </div>

              {/* Active Agents */}
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-warning/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-accent-warning" />
                  </div>
                  <div>
                    <p className="text-sm text-text-muted">Active Agents</p>
                    <p className="text-xl font-semibold text-text-primary">{stats.total_agents}</p>
                  </div>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  across {stats.active_pods} active pods
                </p>
              </div>

              {/* Estimated Cost */}
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-success/10 flex items-center justify-center">
                    <Coins className="w-5 h-5 text-accent-success" />
                  </div>
                  <div>
                    <p className="text-sm text-text-muted">This Month</p>
                    <p className="text-xl font-semibold text-text-primary">
                      {formatCost(stats.usage.cost_this_month)}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  {formatCost(stats.usage.total_cost)} total spent
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Quick Actions Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-10"
        >
          <div className="flex flex-wrap gap-3">
            <Link href="/session/new">
              <Button variant="secondary" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                New Pod
              </Button>
            </Link>
            <Link href="/session/new?clone=true">
              <Button variant="ghost" size="sm">
                <FolderGit2 className="w-4 h-4 mr-2" />
                Clone Repo
              </Button>
            </Link>
            {sessions[0] && (
              <Link href={`/session/${sessions[0].id}`}>
                <Button variant="ghost" size="sm">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Resume Last Pod
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowShortcuts(true)}>
              <Keyboard className="w-4 h-4 mr-2" />
              Shortcuts
            </Button>
          </div>
        </motion.div>

        {/* Activity Feed */}
        {activities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-10"
          >
            <div className="bg-surface border border-border-default rounded-xl p-5">
              <h3 className="text-sm font-medium text-text-primary mb-4">Recent Activity</h3>
              <div className="space-y-3 max-h-[180px] overflow-y-auto">
                {activities.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-overlay flex items-center justify-center flex-shrink-0">
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary line-clamp-1">{activity.message}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-text-muted">{activity.session_name}</span>
                        <span className="text-xs text-text-muted">·</span>
                        <span className="text-xs text-text-muted">
                          {formatDate(activity.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Pinned Pods */}
        {pinnedSessions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mb-10"
          >
            <div className="flex items-center gap-2 mb-4">
              <Pin className="w-4 h-4 text-accent-primary" />
              <h2 className="text-lg font-semibold text-text-primary">Pinned Pods</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {pinnedSessions.map((session, index) => {
                const template = getTemplateForSession(session);
                const status = getStatus(session.status);
                return (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="relative group"
                  >
                    <Link href={`/session/${session.id}`}>
                      <div className="bg-surface border border-accent-primary/30 rounded-xl p-4 hover:border-accent-primary hover:bg-elevated transition-all cursor-pointer h-[140px] flex flex-col">
                        <div className="flex items-start justify-between mb-3">
                          <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
                            <TemplateIcon
                              icon={template?.icon || null}
                              iconUrl={template?.icon_url}
                            />
                          </div>
                          <div
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${status.color} ${status.bg}`}
                          >
                            {status.icon}
                            {status.label}
                          </div>
                        </div>
                        <h3 className="font-medium text-text-primary mb-1 truncate group-hover:text-accent-primary transition-colors">
                          {session.name}
                        </h3>
                        <div className="mt-auto">
                          <div className="flex items-center gap-2 text-xs text-text-muted">
                            <Clock className="w-3 h-3" />
                            {formatDate(session.updated_at)}
                          </div>
                        </div>
                      </div>
                    </Link>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handlePinSession(session.id, true);
                      }}
                      disabled={pinningSession === session.id}
                      className="absolute top-2 right-2 p-1.5 rounded bg-surface/80 text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {pinningSession === session.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <PinOff className="w-4 h-4" />
                      )}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Empty State / Main Content */}
        {sessions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-surface border border-border-default rounded-2xl p-8 text-center mb-10"
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center mx-auto mb-4">
              <Server className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">Create your first Pod</h2>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              A pod is your cloud development environment with all the tools you need pre-installed.
            </p>
            <Link href="/session/new">
              <Button size="lg" variant="primary">
                <Plus className="w-5 h-5 mr-2" />
                Create Pod
              </Button>
            </Link>
          </motion.div>
        ) : (
          <>
            {/* Recent Pods */}
            <div className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">Recent Pods</h2>
                <Link
                  href="/session/new"
                  className="text-sm text-accent-primary hover:underline flex items-center gap-1"
                >
                  New Pod
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {recentSessions.map((session, index) => {
                  const template = getTemplateForSession(session);
                  const status = getStatus(session.status);

                  return (
                    <motion.div
                      key={session.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Link href={`/session/${session.id}`}>
                        <div className="bg-surface border border-border-default rounded-xl p-4 hover:border-accent-primary/50 hover:bg-elevated transition-all cursor-pointer group h-[140px] flex flex-col">
                          <div className="flex items-start justify-between mb-3">
                            <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
                              <TemplateIcon
                                icon={template?.icon || null}
                                iconUrl={template?.icon_url}
                              />
                            </div>
                            <div
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${status.color} ${status.bg}`}
                            >
                              {status.icon}
                              {status.label}
                            </div>
                          </div>
                          <h3 className="font-medium text-text-primary mb-1 truncate group-hover:text-accent-primary transition-colors">
                            {session.name}
                          </h3>
                          <div className="mt-auto">
                            <div className="flex items-center gap-2 text-xs text-text-muted">
                              <Clock className="w-3 h-3" />
                              {formatDate(session.updated_at)}
                            </div>
                            {session.git_url && (
                              <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
                                <GitBranch className="w-3 h-3" />
                                {session.branch}
                              </div>
                            )}
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}

                {/* New Pod Card */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: recentSessions.length * 0.05 }}
                >
                  <Link href="/session/new">
                    <div className="bg-surface border-2 border-dashed border-border-default rounded-xl p-4 hover:border-accent-primary hover:bg-elevated transition-all cursor-pointer h-[140px] flex flex-col items-center justify-center gap-2">
                      <div className="w-10 h-10 rounded-lg bg-accent-primary/10 flex items-center justify-center">
                        <Plus className="w-5 h-5 text-accent-primary" />
                      </div>
                      <span className="text-sm font-medium text-text-secondary">New Pod</span>
                    </div>
                  </Link>
                </motion.div>
              </div>
            </div>

            {/* All Pods */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">All Pods</h2>
                <div className="flex items-center gap-3">
                  {/* View Toggle */}
                  <div className="flex items-center bg-surface border border-border-default rounded-lg p-1">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                    >
                      <Grid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {filteredSessions.length === 0 ? (
                <div className="bg-surface border border-border-default rounded-xl p-8 text-center">
                  <p className="text-text-secondary">No pods found matching your search.</p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <AnimatePresence>
                    {allSessions.map((session, index) => {
                      const template = getTemplateForSession(session);
                      const status = getStatus(session.status);

                      return (
                        <motion.div
                          key={session.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ delay: index * 0.02 }}
                          className="bg-surface border border-border-default rounded-xl p-4 hover:border-border-hover transition-all group relative"
                        >
                          {/* Menu Button */}
                          <div className="absolute top-3 right-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(openMenuId === session.id ? null : session.id);
                              }}
                              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenuId === session.id && (
                              <div className="absolute right-0 mt-1 w-40 bg-elevated border border-border-default rounded-lg shadow-lg py-1 z-10">
                                <Link
                                  href={`/session/${session.id}`}
                                  className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
                                >
                                  <Play className="w-4 h-4" />
                                  Open
                                </Link>
                                {session.status === 'active' && session.workspace_id && (
                                  <button
                                    onClick={() =>
                                      handlePauseSession(session.id, session.workspace_id!)
                                    }
                                    disabled={pausingSession === session.id}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
                                  >
                                    {pausingSession === session.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Pause className="w-4 h-4" />
                                    )}
                                    Pause
                                  </button>
                                )}
                                {session.status === 'stopped' && session.workspace_id && (
                                  <button
                                    onClick={() =>
                                      handleResumeSession(session.id, session.workspace_id!)
                                    }
                                    disabled={resumingSession === session.id}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
                                  >
                                    {resumingSession === session.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Play className="w-4 h-4" />
                                    )}
                                    Resume
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    handlePinSession(session.id, !!session.pinned);
                                    setOpenMenuId(null);
                                  }}
                                  disabled={pinningSession === session.id}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
                                >
                                  {pinningSession === session.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : session.pinned ? (
                                    <PinOff className="w-4 h-4" />
                                  ) : (
                                    <Pin className="w-4 h-4" />
                                  )}
                                  {session.pinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button
                                  onClick={() => handleDeleteSession(session)}
                                  disabled={deleting === session.id}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-error hover:bg-overlay"
                                >
                                  {deleting === session.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>

                          <Link href={`/session/${session.id}`}>
                            <div className="flex items-start gap-3 mb-3">
                              <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center flex-shrink-0">
                                <TemplateIcon
                                  icon={template?.icon || null}
                                  iconUrl={template?.icon_url}
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-medium text-text-primary truncate group-hover:text-accent-primary transition-colors">
                                  {session.name}
                                </h3>
                                <p className="text-xs text-text-muted">
                                  {template?.name || 'Custom template'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-xs text-text-muted">
                                <Clock className="w-3 h-3" />
                                {formatDate(session.updated_at)}
                              </div>
                              <div
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${status.color} ${status.bg}`}
                              >
                                {status.icon}
                                {status.label}
                              </div>
                            </div>
                          </Link>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                          Name
                        </th>
                        <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                          Template
                        </th>
                        <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                          Status
                        </th>
                        <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                          Last Active
                        </th>
                        <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {allSessions.map((session) => {
                        const template = getTemplateForSession(session);
                        const status = getStatus(session.status);

                        return (
                          <tr
                            key={session.id}
                            className="border-b border-border-subtle last:border-0 hover:bg-elevated transition-colors"
                          >
                            <td className="px-4 py-3">
                              <Link
                                href={`/session/${session.id}`}
                                className="flex items-center gap-3"
                              >
                                <div className="w-8 h-8 rounded-lg bg-overlay flex items-center justify-center">
                                  <TemplateIcon
                                    icon={template?.icon || null}
                                    iconUrl={template?.icon_url}
                                    size="sm"
                                  />
                                </div>
                                <div>
                                  <p className="font-medium text-text-primary hover:text-accent-primary transition-colors">
                                    {session.name}
                                  </p>
                                  {session.git_url && (
                                    <p className="text-xs text-text-muted flex items-center gap-1">
                                      <GitBranch className="w-3 h-3" />
                                      {session.branch}
                                    </p>
                                  )}
                                </div>
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-sm text-text-secondary">
                              {template?.name || 'Custom'}
                            </td>
                            <td className="px-4 py-3">
                              <div
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${status.color} ${status.bg}`}
                              >
                                {status.icon}
                                {status.label}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-text-muted">
                              {formatDate(session.updated_at)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Link href={`/session/${session.id}`}>
                                  <Button variant="ghost" size="sm">
                                    <Play className="w-4 h-4" />
                                  </Button>
                                </Link>
                                {session.status === 'active' && session.workspace_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handlePauseSession(session.id, session.workspace_id!)
                                    }
                                    disabled={pausingSession === session.id}
                                    title="Pause session"
                                  >
                                    {pausingSession === session.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Pause className="w-4 h-4 text-yellow-500" />
                                    )}
                                  </Button>
                                )}
                                {session.status === 'stopped' && session.workspace_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleResumeSession(session.id, session.workspace_id!)
                                    }
                                    disabled={resumingSession === session.id}
                                    title="Resume session"
                                  >
                                    {resumingSession === session.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Play className="w-4 h-4 text-green-500" />
                                    )}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteSession(session)}
                                  disabled={deleting === session.id}
                                >
                                  {deleting === session.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4 text-accent-error" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Usage Charts */}
        {(usageHistory.length > 0 || loadingUsage) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-10"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Usage</h2>
              <TimeRangeSelector value={selectedPeriod} onChange={setSelectedPeriod} />
            </div>
            {loadingUsage ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Token Usage */}
                <div className="bg-surface border border-border-default rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-text-primary">Token Usage</h3>
                    <span className="text-xs text-text-muted">Tokens</span>
                  </div>

                  {/* Stacked Bar Chart */}
                  <div className="h-40 flex items-end gap-1">
                    {usageHistory.length > 0 &&
                      usageHistory.map((point, dateIndex) => {
                        // Calculate total tokens for this date across all visible pods
                        const visiblePodsData = podUsageData.filter((p) =>
                          visiblePods.has(p.session_id)
                        );
                        const totalTokens = visiblePodsData.reduce(
                          (sum, pod) => sum + (pod.data[dateIndex]?.tokens || 0),
                          0
                        );
                        const maxTokens = Math.max(
                          ...usageHistory.map((_, i) =>
                            visiblePodsData.reduce(
                              (sum, pod) => sum + (pod.data[i]?.tokens || 0),
                              0
                            )
                          ),
                          1
                        );
                        const barHeightPercent = (totalTokens / maxTokens) * 100;

                        // Calculate cumulative heights for proper stacking
                        let cumulativePercent = 0;
                        const segments = visiblePodsData
                          .map((pod) => {
                            const podTokens = pod.data[dateIndex]?.tokens || 0;
                            const segmentPercent =
                              totalTokens > 0 ? (podTokens / totalTokens) * 100 : 0;
                            const segment = {
                              pod,
                              tokens: podTokens,
                              heightPercent: segmentPercent,
                              bottomPercent: cumulativePercent,
                            };
                            cumulativePercent += segmentPercent;
                            return segment;
                          })
                          .filter((s) => s.tokens > 0);

                        return (
                          <div key={dateIndex} className="flex-1 relative h-full">
                            {/* Bar container */}
                            <div
                              className="absolute bottom-0 left-0 right-0 w-full"
                              style={{ height: `${Math.max(barHeightPercent, 2)}%` }}
                            >
                              {segments.map((segment, segmentIndex) => (
                                <div
                                  key={segment.pod.session_id}
                                  className="absolute left-0 right-0 w-full group/segment"
                                  style={{
                                    bottom: `${segment.bottomPercent}%`,
                                    height: `${segment.heightPercent}%`,
                                  }}
                                >
                                  <div
                                    className={`w-full h-full hover:brightness-110 transition-all ${segmentIndex === segments.length - 1 ? 'rounded-t' : ''}`}
                                    style={{
                                      backgroundColor: segment.pod.color,
                                    }}
                                  />
                                  {/* Per-segment tooltip */}
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1.5 bg-elevated border border-border-default rounded text-xs opacity-0 group-hover/segment:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20 shadow-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                      <div
                                        className="w-2 h-2 rounded-sm"
                                        style={{ backgroundColor: segment.pod.color }}
                                      />
                                      <span className="text-text-primary font-medium truncate max-w-[100px]">
                                        {segment.pod.session_name}
                                      </span>
                                    </div>
                                    <div className="text-text-primary">
                                      {formatNumber(segment.tokens)} tokens
                                    </div>
                                    <div className="text-text-muted text-[10px] mt-0.5">
                                      {new Date(point.date).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                      })}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Legend */}
                  {podUsageData.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {podUsageData.map((pod) => (
                        <button
                          key={pod.session_id}
                          onClick={() => togglePodVisibility(pod.session_id)}
                          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                        >
                          <div
                            className="w-3 h-3 rounded transition-opacity"
                            style={{
                              backgroundColor: pod.color,
                              opacity: visiblePods.has(pod.session_id) ? 1 : 0.3,
                            }}
                          />
                          <span
                            className="text-xs truncate max-w-[120px]"
                            style={{
                              color: visiblePods.has(pod.session_id)
                                ? 'var(--text-muted)'
                                : 'var(--text-disabled)',
                              textDecoration: visiblePods.has(pod.session_id)
                                ? 'none'
                                : 'line-through',
                            }}
                          >
                            {pod.session_name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between mt-2 text-xs text-text-muted">
                    <span>
                      {usageHistory[0]
                        ? new Date(usageHistory[0].date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : ''}
                    </span>
                    <span>
                      {(() => {
                        const last = usageHistory[usageHistory.length - 1];
                        return last
                          ? new Date(last.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })
                          : '';
                      })()}
                    </span>
                  </div>
                </div>

                {/* Compute Usage */}
                <div className="bg-surface border border-border-default rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-text-primary">Compute Usage</h3>
                    <span className="text-xs text-text-muted">Minutes</span>
                  </div>

                  {/* Stacked Bar Chart */}
                  <div className="h-40 flex items-end gap-1">
                    {usageHistory.length > 0 &&
                      usageHistory.map((point, dateIndex) => {
                        // Calculate total compute minutes for this date across all visible pods
                        const visiblePodsData = podUsageData.filter((p) =>
                          visiblePods.has(p.session_id)
                        );
                        const totalMinutes = visiblePodsData.reduce(
                          (sum, pod) => sum + (pod.data[dateIndex]?.compute_minutes || 0),
                          0
                        );
                        const maxMinutes = Math.max(
                          ...usageHistory.map((_, i) =>
                            visiblePodsData.reduce(
                              (sum, pod) => sum + (pod.data[i]?.compute_minutes || 0),
                              0
                            )
                          ),
                          1
                        );
                        const barHeightPercent = (totalMinutes / maxMinutes) * 100;

                        // Calculate cumulative heights for proper stacking
                        let cumulativePercent = 0;
                        const segments = visiblePodsData
                          .map((pod) => {
                            const podMinutes = pod.data[dateIndex]?.compute_minutes || 0;
                            const segmentPercent =
                              totalMinutes > 0 ? (podMinutes / totalMinutes) * 100 : 0;
                            const segment = {
                              pod,
                              minutes: podMinutes,
                              heightPercent: segmentPercent,
                              bottomPercent: cumulativePercent,
                            };
                            cumulativePercent += segmentPercent;
                            return segment;
                          })
                          .filter((s) => s.minutes > 0);

                        return (
                          <div key={dateIndex} className="flex-1 relative h-full">
                            {/* Bar container */}
                            <div
                              className="absolute bottom-0 left-0 right-0 w-full"
                              style={{ height: `${Math.max(barHeightPercent, 2)}%` }}
                            >
                              {segments.map((segment, segmentIndex) => (
                                <div
                                  key={segment.pod.session_id}
                                  className="absolute left-0 right-0 w-full group/segment"
                                  style={{
                                    bottom: `${segment.bottomPercent}%`,
                                    height: `${segment.heightPercent}%`,
                                  }}
                                >
                                  <div
                                    className={`w-full h-full hover:brightness-110 transition-all ${segmentIndex === segments.length - 1 ? 'rounded-t' : ''}`}
                                    style={{
                                      backgroundColor: segment.pod.color,
                                    }}
                                  />
                                  {/* Per-segment tooltip */}
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1.5 bg-elevated border border-border-default rounded text-xs opacity-0 group-hover/segment:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20 shadow-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                      <div
                                        className="w-2 h-2 rounded-sm"
                                        style={{ backgroundColor: segment.pod.color }}
                                      />
                                      <span className="text-text-primary font-medium truncate max-w-[100px]">
                                        {segment.pod.session_name}
                                      </span>
                                    </div>
                                    <div className="text-text-primary">
                                      {segment.minutes} minutes
                                    </div>
                                    <div className="text-text-muted text-[10px] mt-0.5">
                                      {new Date(point.date).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                      })}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Legend */}
                  {podUsageData.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {podUsageData.map((pod) => (
                        <button
                          key={pod.session_id}
                          onClick={() => togglePodVisibility(pod.session_id)}
                          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                        >
                          <div
                            className="w-3 h-3 rounded transition-opacity"
                            style={{
                              backgroundColor: pod.color,
                              opacity: visiblePods.has(pod.session_id) ? 1 : 0.3,
                            }}
                          />
                          <span
                            className="text-xs truncate max-w-[120px]"
                            style={{
                              color: visiblePods.has(pod.session_id)
                                ? 'var(--text-muted)'
                                : 'var(--text-disabled)',
                              textDecoration: visiblePods.has(pod.session_id)
                                ? 'none'
                                : 'line-through',
                            }}
                          >
                            {pod.session_name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between mt-2 text-xs text-text-muted">
                    <span>
                      {usageHistory[0]
                        ? new Date(usageHistory[0].date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : ''}
                    </span>
                    <span>
                      {(() => {
                        const last = usageHistory[usageHistory.length - 1];
                        return last
                          ? new Date(last.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })
                          : '';
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </main>

      {/* Keyboard Shortcuts Modal */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-void/80 backdrop-blur-sm"
              onClick={() => setShowShortcuts(false)}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-surface border border-border-default rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                <h2 className="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    Navigation
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Search pods</span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        ⌘ K
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Create new pod</span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        ⌘ N
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Show shortcuts</span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        ⌘ /
                      </kbd>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    General
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">
                        Close modal / Clear search
                      </span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        Esc
                      </kbd>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    In Workspace
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Toggle terminal</span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        ⌘ `
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Open file</span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        ⌘ P
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Command palette</span>
                      <kbd className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-muted">
                        ⌘ ⇧ P
                      </kbd>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 bg-overlay/50 border-t border-border-subtle">
                <p className="text-xs text-text-muted text-center">
                  Press{' '}
                  <kbd className="px-1.5 py-0.5 bg-surface border border-border-subtle rounded text-xs">
                    Esc
                  </kbd>{' '}
                  to close
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
