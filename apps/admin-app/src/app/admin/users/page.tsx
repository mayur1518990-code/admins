"use client";

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import dynamicImport from "next/dynamic";
const Sidebar = dynamicImport(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { getCached, setCached, isFresh, getCacheKey, deleteCached } from "@/lib/cache";

// Debounce hook for search optimization
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Format date function (pure, no hook needed)
const formatDate = (date: string | Date | null | undefined) => {
  if (!date) return 'Unknown';
  const normalized =
    typeof date === 'string' || date instanceof Date ? date : undefined;
  const d = new Date(normalized || 0);
  if (Number.isNaN(d.getTime())) {
    return 'Unknown';
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Static role color map (faster than function)
const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-800',
  agent: 'bg-blue-100 text-blue-800',
  user: 'bg-green-100 text-green-800',
  default: 'bg-gray-100 text-gray-800'
};

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
  phone?: string;
}

interface UserFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
  phone: string;
  role: "user" | "agent" | "admin";
}

// Memoized User Row Component for performance
const UserRow = memo(({ 
  user, 
  onEdit, 
  onToggleActive, 
  onResetPassword, 
  onDelete 
}: { 
  user: User; 
  onEdit: () => void;
  onToggleActive: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
}) => {
  const roleColor = ROLE_COLORS[user.role] || ROLE_COLORS.default;
  
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10">
            <div className="h-10 w-10 rounded-full bg-gray-500 flex items-center justify-center">
              <span className="text-white font-medium">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div className="ml-4">
            <div className="text-sm font-medium text-gray-900">
              {user.name}
            </div>
            <div className="text-sm text-gray-500">
              {user.email || user.phone || 'No contact info'}
            </div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${roleColor}`}>
          {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {user.phone || 'No phone'}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          Joined: {formatDate(user.createdAt)}
        </div>
        <div className="text-sm text-gray-500">
          Last login: {user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never'}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
          user.isActive 
            ? 'bg-green-100 text-green-800' 
            : 'bg-red-100 text-red-800'
        }`}>
          {user.isActive ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onEdit}
            className="text-blue-600 hover:text-blue-900"
          >
            Edit
          </button>
          <button
            onClick={onToggleActive}
            className={`${
              user.isActive 
                ? 'text-red-600 hover:text-red-900' 
                : 'text-green-600 hover:text-green-900'
            }`}
          >
            {user.isActive ? 'Block' : 'Unblock'}
          </button>
          <button
            onClick={onResetPassword}
            className="text-yellow-600 hover:text-yellow-900"
          >
            Update Password
          </button>
          <button
            onClick={onDelete}
            className="text-red-600 hover:text-red-900"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
});

UserRow.displayName = 'UserRow';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "user" | "agent" | "admin">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300); // Debounce search by 300ms
  
  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const [formData, setFormData] = useState<UserFormData>({
    name: "",
    email: "",
    password: "",
    phone: "",
    role: "agent"
  });

  useEffect(() => {
    loadUsers();
  }, []);

  // Populate form data when editing a user
  useEffect(() => {
    if (editingUser) {
      setFormData({
        name: editingUser.name || "",
        email: editingUser.email || "",
        password: "", // Don't populate password for security
        phone: editingUser.phone || "",
        role: (editingUser.role as "admin" | "agent" | "user") || "user"
      });
    }
  }, [editingUser]);

  const isLoadingRef = useRef(false);
  const isMountedRef = useRef(true);
  
  const loadUsers = useCallback(async (forceRefresh = false) => {
    if (isLoadingRef.current && !forceRefresh) {
      return;
    }

    isLoadingRef.current = true;

    try {
      if (isMountedRef.current) {
        setIsLoading(true);
        setError("");
      }

      const ttlMs = 5 * 60 * 1000; // 5 minutes cache
      const cacheKey = getCacheKey(['admin-users']);

      if (!forceRefresh) {
        const cached = getCached<{ users: User[] }>(cacheKey);
        if (isFresh(cached, ttlMs)) {
          if (isMountedRef.current) {
            setUsers(cached!.data.users);
            setIsLoading(false);
            setError("");
          }
          isLoadingRef.current = false;
          return;
        }
      }

      const res = await fetch('/api/admin/users?limit=100', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const data = await res.json();
      console.log('Admin users payload:', data);

      if (!data?.success) {
        throw new Error(data?.message || data?.error || 'Failed to load users');
      }

      const normalizedUsers: User[] = Array.isArray(data.users)
        ? data.users.map((user: any) => {
            const createdAt = user?.createdAt?.seconds
              ? new Date(user.createdAt.seconds * 1000).toISOString()
              : user?.createdAt?.toDate?.()?.toISOString?.() || user?.createdAt || '';
            const lastLoginAt = user?.lastLoginAt?.seconds
              ? new Date(user.lastLoginAt.seconds * 1000).toISOString()
              : user?.lastLoginAt?.toDate?.()?.toISOString?.() || user?.lastLoginAt || undefined;

            return {
              id: String(user?.id ?? user?.uid ?? ''),
              email: String(user?.email ?? ''),
              name:
                String(user?.name ?? user?.displayName ?? '').trim() ||
                'Unnamed User',
              role: String(user?.role ?? 'user').toLowerCase(),
              isActive: Boolean(user?.isActive ?? true),
              createdAt: createdAt ? String(createdAt) : new Date().toISOString(),
              lastLoginAt: lastLoginAt ? String(lastLoginAt) : undefined,
              phone: user?.phone != null ? String(user.phone) : undefined,
            } satisfies User;
          })
        : [];

      if (isMountedRef.current) {
        setUsers(normalizedUsers);
        setCached(cacheKey, { users: normalizedUsers });
        setError("");
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.debug('Fetch aborted before completion');
        return;
      }

      console.error('Fetch failed:', error);

      if (!isMountedRef.current) {
        return;
      }

      if (error?.message?.includes('Database connection failed')) {
        setError('Database connection failed. Please try again.');
      } else if (error?.message?.includes('Request timed out')) {
        setError('Request timed out. Please try again.');
      } else if (error?.message?.includes('Server error')) {
        setError('Unable to load users. Please try again in a moment.');
      } else {
        setError(error?.message || 'Failed to load users');
      }

      setUsers([]);
    } finally {
      isLoadingRef.current = false;
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Trim inputs
    const trimmedData = {
      name: formData.name.trim(),
      email: formData.email.trim(),
      password: formData.password,
      phone: formData.phone.trim(),
      role: formData.role
    };
    
    // Frontend validation
    if (!trimmedData.name || !trimmedData.email || !trimmedData.password) {
      setError('Please fill in all required fields');
      return;
    }
    
    // Validate role is agent or admin only
    if (!['agent', 'admin'].includes(trimmedData.role)) {
      setError('Role must be either Agent or Admin');
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedData.email)) {
      setError('Please enter a valid email address');
      return;
    }
    
    if (trimmedData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }
    
    try {
      setError(''); // Clear any previous errors
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(trimmedData),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || result.error || 'Failed to create user');
      }
      
      setShowAddModal(false);
      setFormData({ name: "", email: "", password: "", phone: "", role: "agent" });
      setSuccess('User created successfully!');
      setTimeout(() => setSuccess(''), 3000);
      deleteCached(getCacheKey(['admin-users']));
      await loadUsers(true); // Force refresh after mutation
    } catch (error: any) {
      setError(error.message || 'Failed to create user');
      // Keep modal open so user can fix the error
    }
  };

  const handleUpdateUser = async (userId: string, updates: Partial<User>) => {
    try {
      setError("");
      setSuccess("");
      // optimistic update
      const prev = users;
      setUsers(prev.map(u => u.id === userId ? { ...u, ...updates } as User : u));

      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          ...updates
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        setUsers(prev); // revert
        throw new Error(result.message || 'Failed to update user');
      }
      
      setSuccess('User updated successfully');
      setTimeout(() => setSuccess(''), 3000);
      deleteCached(getCacheKey(['admin-users']));
      await loadUsers(true); // Force refresh after mutation
    } catch (error: any) {
      setError(error.message || 'Failed to update user');
    }
  };

  const handleUpdatePassword = async (userId: string) => {
    if (!resettingUser) return;

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password length
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    try {
      setError("");
      setSuccess("");
      
      const response = await fetch('/api/admin/users/update-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          userId: resettingUser.id,
          newPassword: formData.password
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to update password');
      }
      
      setSuccess('Password updated successfully!');
      setTimeout(() => setSuccess(''), 5000);
      setResettingUser(null);
      setFormData({ ...formData, password: '', confirmPassword: '' });
    } catch (error: any) {
      console.error('Error updating password:', error);
      setError(error.message || 'Failed to update password');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    console.log('handleDeleteUser called with userId:', userId);
    if (!confirm('Are you sure you want to DELETE this user permanently? This action cannot be undone.')) {
      return;
    }

    try {
      setError("");
      setSuccess("");
      // optimistic remove
      const prev = users;
      setUsers(prev.filter(u => u.id !== userId));

      const response = await fetch(`/api/admin/users?userId=${userId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      
      if (!result.success) {
        setUsers(prev); // revert
        throw new Error(result.message || 'Failed to delete user');
      }
      
      setSuccess('User deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
      deleteCached(getCacheKey(['admin-users']));
      await loadUsers(true); // Force refresh after mutation
    } catch (error: any) {
      setError(error.message || 'Failed to delete user');
    }
  };

  const filteredUsers = useMemo(() => {
    const search = debouncedSearchTerm.trim().toLowerCase();

    return users.filter((user) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && user.isActive) ||
        (filter === "inactive" && !user.isActive);

      const matchesRole = roleFilter === "all" || user.role === roleFilter;

      const lowerName = (user.name ?? '').toLowerCase();
      const lowerEmail = (user.email ?? '').toLowerCase();
      const lowerPhone = (user.phone ?? '').toLowerCase();

      const matchesSearch =
        !search ||
        lowerName.includes(search) ||
        lowerEmail.includes(search) ||
        lowerPhone.includes(search);

      return matchesFilter && matchesRole && matchesSearch;
    });
  }, [users, filter, roleFilter, debouncedSearchTerm]);

  if (isLoading) {
    return (
      <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col">
          <MobileHeader 
            title="User Management" 
            onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
          />
          <main className="flex-1 p-6 mobile-app-content">
          <div className="max-w-7xl mx-auto">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-48 mb-6"></div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="flex-1 flex flex-col">
        <MobileHeader 
          title="User Management" 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        />
        <main className="flex-1 p-6 mobile-app-content">
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-3xl font-bold text-gray-900 hidden md:block">
                User Management
              </h1>
              <div className="flex gap-2">
                {/* Debug button - remove this later */}
                <button
                  onClick={() => {
                    console.log('Debug: Toggling sidebar, current state:', sidebarOpen);
                    setSidebarOpen(!sidebarOpen);
                  }}
                  className="bg-red-600 text-white px-2 py-1 rounded text-sm"
                >
                  Toggle Sidebar
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add New User
                </button>
              </div>
            </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-red-800">{error}</span>
              </div>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-800">{success}</span>
              </div>
            </div>
          )}

          {/* Filters and Search */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All Users" },
                  { key: "active", label: "Active" },
                  { key: "inactive", label: "Inactive" },
                ].map((filterOption) => (
                  <button
                    key={filterOption.key}
                    onClick={() => setFilter(filterOption.key as any)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      filter === filterOption.key
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {filterOption.label}
                  </button>
                ))}
              </div>
              
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All Roles" },
                  { key: "user", label: "Users" },
                  { key: "agent", label: "Agents" },
                  { key: "admin", label: "Admins" },
                ].map((roleOption) => (
                  <button
                    key={roleOption.key}
                    onClick={() => setRoleFilter(roleOption.key as any)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      roleFilter === roleOption.key
                        ? "bg-purple-100 text-purple-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {roleOption.label}
                  </button>
                ))}
              </div>
              
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Users List */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Activity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredUsers.map((user) => (
                    <UserRow 
                      key={user.id}
                      user={user}
                      onEdit={() => setEditingUser(user)}
                      onToggleActive={() => handleUpdateUser(user.id, { isActive: !user.isActive })}
                      onResetPassword={() => setResettingUser(user)}
                      onDelete={() => handleDeleteUser(user.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-4 p-4">
              {filteredUsers.map((user) => (
                <div key={`mobile-${user.id}`} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start space-x-3 mb-3">
                    <div className="h-10 w-10 rounded-full bg-gray-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-medium">
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-medium text-gray-900">
                        {user.name}
                      </h3>
                      <p className="text-sm text-gray-500">{user.email || user.phone || 'No contact info'}</p>
                    </div>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${ROLE_COLORS[user.role] || ROLE_COLORS.default}`}>
                      {user.role}
                    </span>
                  </div>
                  
                  <div className="space-y-2 ml-12 mt-3">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Phone:</span> {user.phone || 'No phone'}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Last login:</span> {user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never'}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Status:</span> 
                      <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${
                        user.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </p>
                  </div>
                  
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        const userToEdit = users.find(u => u.id === user.id);
                        if (userToEdit) setEditingUser(userToEdit);
                      }}
                      className="bg-blue-600 text-white text-xs px-3 py-1 rounded hover:bg-blue-700 flex-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        const userToUpdate = users.find(u => u.id === user.id);
                        if (userToUpdate) handleUpdateUser(user.id, { isActive: !user.isActive });
                      }}
                      className={`text-xs px-3 py-1 rounded flex-1 ${
                        user.isActive 
                          ? 'bg-red-600 text-white hover:bg-red-700' 
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {user.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => {
                        const userToReset = users.find(u => u.id === user.id);
                        if (userToReset) setResettingUser(userToReset);
                      }}
                      className="bg-yellow-600 text-white text-xs px-3 py-1 rounded hover:bg-yellow-700 flex-1"
                    >
                      Reset Password
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="bg-red-600 text-white text-xs px-3 py-1 rounded hover:bg-red-700 flex-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {filteredUsers.length === 0 && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No users found</h3>
              <p className="text-gray-500 mb-4">
                {searchTerm ? 'Try adjusting your search criteria' : 'Get started by adding your first user'}
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add User
              </button>
            </div>
          )}
          </div>
        </main>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add New User</h2>
            
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-red-800 text-sm">{error}</span>
                </div>
              </div>
            )}
            
            <form onSubmit={handleAddUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum 6 characters</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone (Optional)
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setError(''); // Clear error when closing
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Edit User</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              
              // Trim and validate inputs
              const trimmedName = formData.name.trim();
              const trimmedEmail = formData.email.trim();
              const trimmedPhone = formData.phone.trim();
              
              if (!trimmedName) {
                setError('Name is required');
                return;
              }
              
              // For agents/admins, email is required
              if (!trimmedEmail) {
                setError('Email is required for agents and admins');
                return;
              }
              
              // Validate email format
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(trimmedEmail)) {
                setError('Please enter a valid email address');
                return;
              }
              
              handleUpdateUser(editingUser.id, {
                name: trimmedName,
                email: trimmedEmail,
                role: formData.role,
                phone: trimmedPhone
              });
              setEditingUser(null);
              setFormData({ name: "", email: "", password: "", phone: "", role: "agent" });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone (Optional)
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setEditingUser(null);
                    setFormData({ name: "", email: "", password: "", phone: "", role: "agent" });
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Update User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Password Modal */}
      {resettingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Update Password</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdatePassword(resettingUser.id);
            }}>
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800">
                        Update Password for {resettingUser.name}
                      </h3>
                      <div className="mt-2 text-sm text-blue-700">
                        <p>Enter a new password for this user. They will need to use this password for their next login.</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">User Details:</h4>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p><strong>Name:</strong> {resettingUser.name}</p>
                    <p><strong>Email:</strong> {resettingUser.email || 'No email'}</p>
                    <p><strong>Phone:</strong> {resettingUser.phone || 'No phone'}</p>
                    <p><strong>Role:</strong> {resettingUser.role}</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter new password"
                    required
                    minLength={6}
                  />
                  <p className="text-xs text-gray-500 mt-1">Password must be at least 6 characters long</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={formData.confirmPassword || ''}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Confirm new password"
                    required
                    minLength={6}
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setResettingUser(null);
                    setFormData({ ...formData, password: '', confirmPassword: '' });
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
