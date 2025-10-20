"use client";

import dynamic from "next/dynamic";
const Sidebar = dynamic(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getCached, setCached, getCacheKey, isFresh, deleteCached } from "@/lib/cache";

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

// Utility function to format dates consistently
const useFormatDate = () => useCallback((date: string | Date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}, []);

interface Agent {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
  phone?: string;
  stats: {
    totalFiles: number;
    completedFiles: number;
    pendingFiles: number;
  };
}

interface AgentFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
  phone: string;
}

export default function AgentsPage() {
  const formatDate = useFormatDate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [resettingAgent, setResettingAgent] = useState<Agent | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300); // Debounce search by 300ms
  
  const [formData, setFormData] = useState<AgentFormData>({
    name: "",
    email: "",
    password: "",
    phone: ""
  });

  useEffect(() => {
    loadAgents();
  }, []);

  // Populate form data when editing an agent
  useEffect(() => {
    if (editingAgent) {
      setFormData({
        name: editingAgent.name || "",
        email: editingAgent.email || "",
        password: "", // Don't populate password for security
        phone: editingAgent.phone || ""
      });
    }
  }, [editingAgent]);

  const isLoadingRef = useRef(false);
  const loadAgents = useCallback(async (forceRefresh = false) => {
    // Prevent duplicate requests
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    
    try {
      setIsLoading(true);
      setError("");
      
      const ttlMs = 5 * 60 * 1000; // 5 minutes cache
      const cacheKey = getCacheKey(['admin-agents']);
      
      // Check cache first unless force refresh
      if (!forceRefresh) {
        const cached = getCached<{ agents: Agent[] }>(cacheKey);
        if (isFresh(cached, ttlMs)) {
          setAgents(cached!.data.agents || []);
          return;
        }
      }

      // OPTIMIZED: Longer timeout with retry logic
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased to 30s
      
      const response = await fetch('/api/admin/agents?includeStats=true&limit=100', { 
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        }
      });
      clearTimeout(timeoutId);
      
      // Validate response
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Expected JSON but got ${contentType}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || result.error || 'Failed to load agents');
      }
      
      // Update state with new data
      const agentsData = result.agents || [];
      setAgents(agentsData);
      setCached(cacheKey, { agents: agentsData });
      
    } catch (error: any) {
      console.error('Error loading agents:', error);
      // Don't set empty array on abort - keep existing data
      if (error.name !== 'AbortError') {
        // Handle specific error types
        if (error.message?.includes('Database connection failed')) {
          setError('Database connection failed. Please try again.');
        } else if (error.message?.includes('Request timed out')) {
          setError('Request timed out. Please try again.');
        } else {
          setError(error.message || 'Failed to load agents');
        }
        // Only clear agents on non-timeout errors
        if (!error.message?.includes('timeout') && !error.message?.includes('connection')) {
          setAgents([]);
        }
      }
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, []); // Empty dependency array is correct - this should never change

  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Trim inputs
    const trimmedData = {
      name: formData.name.trim(),
      email: formData.email.trim(),
      password: formData.password,
      phone: formData.phone.trim()
    };
    
    // Frontend validation
    if (!trimmedData.name || !trimmedData.email || !trimmedData.password) {
      setError('Please fill in all required fields');
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
      const response = await fetch('/api/admin/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(trimmedData),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || result.error || 'Failed to create agent');
      }
      
      setShowAddModal(false);
      setFormData({ name: "", email: "", password: "", phone: "" });
      setSuccess('Agent created successfully!');
      setTimeout(() => setSuccess(''), 3000);
      deleteCached(getCacheKey(['admin-agents']));
      await loadAgents(true); // Force refresh after mutation
    } catch (error: any) {
      setError(error.message || 'Failed to create agent');
      // Keep modal open so user can fix the error
    }
  };

  const handleUpdateAgent = async (agentId: string, updates: Partial<Agent>) => {
    try {
      setError("");
      setSuccess("");
      // optimistic update
      const prev = agents;
      setAgents(prev.map(a => a.id === agentId ? { ...a, ...updates } as Agent : a));

      const response = await fetch('/api/admin/agents', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId,
          ...updates
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        setAgents(prev); // revert
        throw new Error(result.message || 'Failed to update agent');
      }
      
      setSuccess('Agent updated successfully');
      setTimeout(() => setSuccess(''), 3000);
      deleteCached(getCacheKey(['admin-agents']));
      await loadAgents(true); // Force refresh after mutation
    } catch (error: any) {
      setError(error.message || 'Failed to update agent');
    }
  };

  const handleUpdatePassword = async (agentId: string) => {
    if (!resettingAgent) return;

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
          userId: resettingAgent.id,
          newPassword: formData.password
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to update password');
      }
      
      setSuccess('Password updated successfully!');
      setTimeout(() => setSuccess(''), 5000);
      setResettingAgent(null);
      setFormData({ ...formData, password: '', confirmPassword: '' });
    } catch (error: any) {
      console.error('Error updating password:', error);
      setError(error.message || 'Failed to update password');
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('Are you sure you want to DELETE this agent permanently? This action cannot be undone.')) {
      return;
    }

    try {
      setError("");
      setSuccess("");
      // optimistic remove
      const prev = agents;
      setAgents(prev.filter(a => a.id !== agentId));

      const response = await fetch(`/api/admin/agents?agentId=${agentId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      
      if (!result.success) {
        setAgents(prev); // revert
        throw new Error(result.message || 'Failed to delete agent');
      }
      
      setSuccess('Agent deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
      deleteCached(getCacheKey(['admin-agents']));
      await loadAgents(true); // Force refresh after mutation
    } catch (error: any) {
      setError(error.message || 'Failed to delete agent');
    }
  };

  const filteredAgents = useMemo(() => {
    const search = debouncedSearchTerm.toLowerCase(); // Use debounced value
    return (agents || []).filter(agent => {
      const matchesFilter = filter === "all" || 
        (filter === "active" && agent.isActive) || 
        (filter === "inactive" && !agent.isActive);
      const matchesSearch = !search ||
        agent.name?.toLowerCase().includes(search) ||
        agent.email?.toLowerCase().includes(search) ||
        agent.phone?.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [agents, filter, debouncedSearchTerm]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <Sidebar />
        <main className="flex-1 p-6">
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
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">
              Agent Management
            </h1>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add New Agent
            </button>
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
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex space-x-2">
                {[
                  { key: "all", label: "All Agents" },
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
              
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Agents List */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Agent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Performance
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
                  {filteredAgents.map((agent) => (
                    <tr key={agent.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center">
                              <span className="text-white font-medium">
                                {agent.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {agent.name}
                            </div>
                            <div className="text-sm text-gray-500">
                              {agent.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {agent.phone || 'No phone'}
                        </div>
                        <div className="text-sm text-gray-500">
                          Last login: {agent.lastLoginAt ? formatDate(agent.lastLoginAt) : 'Never'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {agent.stats.completedFiles}/{agent.stats.totalFiles} completed
                        </div>
                        <div className="text-sm text-gray-500">
                          {agent.stats.pendingFiles} pending
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          agent.isActive 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {agent.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setEditingAgent(agent)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleUpdateAgent(agent.id, { isActive: !agent.isActive })}
                            className={`${
                              agent.isActive 
                                ? 'text-red-600 hover:text-red-900' 
                                : 'text-green-600 hover:text-green-900'
                            }`}
                          >
                            {agent.isActive ? 'Block' : 'Unblock'}
                          </button>
                          <button
                            onClick={() => setResettingAgent(agent)}
                            className="text-yellow-600 hover:text-yellow-900"
                          >
                            Update Password
                          </button>
                          <button
                            onClick={() => handleDeleteAgent(agent.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {filteredAgents.length === 0 && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No agents found</h3>
              <p className="text-gray-500 mb-4">
                {searchTerm ? 'Try adjusting your search criteria' : 'Get started by adding your first agent'}
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add Agent
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Add Agent Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add New Agent</h2>
            
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
            
            <form onSubmit={handleAddAgent}>
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
                    Email
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
                    Password
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
                  Create Agent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Agent Modal */}
      {editingAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Edit Agent</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              
              // Trim and validate inputs
              const trimmedName = formData.name.trim();
              const trimmedEmail = formData.email.trim();
              const trimmedPhone = formData.phone.trim();
              
              if (!trimmedName || !trimmedEmail) {
                setError('Name and email are required');
                return;
              }
              
              // Validate email format
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(trimmedEmail)) {
                setError('Please enter a valid email address');
                return;
              }
              
              handleUpdateAgent(editingAgent.id, {
                name: trimmedName,
                email: trimmedEmail,
                phone: trimmedPhone
              });
              setEditingAgent(null);
              setFormData({ name: "", email: "", password: "", phone: "" });
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
                    Email
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
                    setEditingAgent(null);
                    setFormData({ name: "", email: "", password: "", phone: "" });
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Update Agent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Password Modal */}
      {resettingAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Update Password</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdatePassword(resettingAgent.id);
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
                        Update Password for {resettingAgent.name}
                      </h3>
                      <div className="mt-2 text-sm text-blue-700">
                        <p>Enter a new password for this agent. They will need to use this password for their next login.</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Agent Details:</h4>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p><strong>Name:</strong> {resettingAgent.name}</p>
                    <p><strong>Email:</strong> {resettingAgent.email}</p>
                    <p><strong>Role:</strong> Agent</p>
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
                    setResettingAgent(null);
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
