'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
  Eye,
  MoreVertical,
  Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type AdminUser, type AdminPlan } from '@/stores/admin';
import { useUser } from '@/stores/auth';
import { UserDetailsModal } from '@/components/admin/UserDetailsModal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

interface UserRowProps {
  user: AdminUser;
  plans: AdminPlan[];
  currentUserRole: string;
  onRoleChange: (userId: string, role: string) => void;
  onToggleActive: (userId: string, isActive: boolean) => void;
  onViewDetails: (user: AdminUser) => void;
}

function UserRow({
  user,
  plans,
  currentUserRole,
  onRoleChange,
  onToggleActive,
  onViewDetails,
}: UserRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const planName = user.subscription_plan
    ? plans.find((p) => p.id === user.subscription_plan)?.name
    : null;

  return (
    <tr className="border-b border-border-subtle hover:bg-overlay/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {user.avatar_url ? (
            <Image
              src={user.avatar_url}
              alt={user.name || ''}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center text-sm font-medium text-accent-primary">
              {(user.name || user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-text-primary font-medium">{user.name || 'No name'}</p>
            <p className="text-text-muted text-sm">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <select
          value={user.role}
          onChange={(e) => onRoleChange(user.id, e.target.value)}
          className="bg-elevated border border-border-subtle rounded px-2 py-1 text-sm text-text-primary"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {currentUserRole === 'super_admin' && <option value="super_admin">Super Admin</option>}
        </select>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            'px-2 py-1 rounded-full text-xs font-medium',
            user.is_active ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
          )}
        >
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">
        {user.subscription_status ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {planName && <span className="text-text-primary font-medium">{planName}</span>}
              {user.is_sponsored && (
                <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-xs font-medium rounded flex items-center gap-1">
                  <Crown className="w-3 h-3" />
                  Sponsored
                </span>
              )}
            </div>
            <span
              className={cn(
                'px-2 py-1 rounded text-xs w-fit',
                user.subscription_status === 'active'
                  ? 'bg-green-500/20 text-green-500'
                  : 'bg-yellow-500/20 text-yellow-500'
              )}
            >
              {user.subscription_status}
            </span>
          </div>
        ) : (
          <span className="text-text-muted">No subscription</span>
        )}
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{user.session_count}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">
        {formatCurrency(user.credit_balance_cents)}
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{formatDate(user.created_at)}</td>
      <td className="px-4 py-3">
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="p-1 hover:bg-elevated rounded">
            <MoreVertical className="h-4 w-4 text-text-muted" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-8 bg-surface border border-border-subtle rounded-lg shadow-lg py-1 z-10 min-w-[160px]">
              <button
                onClick={() => {
                  onViewDetails(user);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2"
              >
                <Eye className="h-4 w-4 text-accent-primary" />
                <span>View Details</span>
              </button>
              <button
                onClick={() => {
                  onToggleActive(user.id, !user.is_active);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2"
              >
                {user.is_active ? (
                  <>
                    <UserX className="h-4 w-4 text-red-500" />
                    <span>Deactivate</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="h-4 w-4 text-green-500" />
                    <span>Activate</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function UsersManagement() {
  useDocumentTitle('User Management');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<boolean | ''>('');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const pageSize = 20;

  const currentUser = useUser();
  const { users, usersTotal, usersLoading, fetchUsers, updateUser, plans, fetchPlans, error } =
    useAdminStore();

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    const filters: Record<string, string> = {};
    if (search) filters.search = search;
    if (roleFilter) filters.role = roleFilter;
    if (statusFilter !== '') filters.is_active = String(statusFilter);

    fetchUsers(page, pageSize, filters);
  }, [page, search, roleFilter, statusFilter, fetchUsers]);

  const handleRoleChange = async (userId: string, role: string) => {
    await updateUser(userId, { role });
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    await updateUser(userId, { is_active: isActive });
  };

  const totalPages = Math.ceil(usersTotal / pageSize);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">User Management</h1>
        <p className="text-text-muted mt-1">Manage users, roles, and permissions</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
        >
          <option value="">All Roles</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>

        <select
          value={statusFilter === '' ? '' : String(statusFilter)}
          onChange={(e) => {
            setStatusFilter(e.target.value === '' ? '' : e.target.value === 'true');
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-xl border border-border-subtle">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full">
            <thead className="bg-elevated">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Subscription
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Sessions
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Credits
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {usersLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    <td colSpan={8} className="px-4 py-4">
                      <div className="h-8 bg-elevated rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    plans={plans}
                    currentUserRole={currentUser?.role || 'member'}
                    onRoleChange={handleRoleChange}
                    onToggleActive={handleToggleActive}
                    onViewDetails={setSelectedUser}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <p className="text-sm text-text-muted">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, usersTotal)} of{' '}
            {usersTotal} users
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="p-2 rounded hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-text-secondary">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* User Details Modal */}
      <UserDetailsModal
        isOpen={selectedUser !== null}
        onClose={() => setSelectedUser(null)}
        user={selectedUser}
        plans={plans}
      />
    </div>
  );
}
