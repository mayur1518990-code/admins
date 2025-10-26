"use client";

import dynamic from "next/dynamic";
const Sidebar = dynamic(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect, useCallback, useRef } from "react";
import { getCached, setCached, getCacheKey, isFresh } from "@/lib/cache";

interface AuditLog {
  id: string;
  actionType: string;
  actorId: string;
  actorType: string;
  targetUserId?: string;
  fileId?: string;
  details: any;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  actor: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  targetUser?: {
    id: string;
    name: string;
    email: string;
  };
}

interface LogStats {
  totalLogs: number;
  logsToday: number;
  logsThisWeek: number;
  logsThisMonth: number;
  actionTypes: Record<string, number>;
  actorTypes: Record<string, number>;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "user_created" | "agent_created" | "file_uploaded" | "payment_successful" | "agent_assignment" | "agent_response" | "user_deactivated" | "agent_deactivated">("all");
  const [actorFilter, setActorFilter] = useState<"all" | "user" | "agent" | "admin" | "system">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "pdf">("csv");
  
  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      console.log('Logs page - Mobile check:', mobile);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [filter, actorFilter, dateFilter]);

  const isLoadingRef = useRef(false);
  const loadLogs = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        filter,
        actorFilter,
        dateFilter,
        search: searchTerm
      });
      
      const ttlMs = 2 * 60 * 1000; // short TTL due to filters
      const cacheKey = getCacheKey(['admin-logs', filter, actorFilter, dateFilter, searchTerm]);
      const cached = getCached<{ logs: AuditLog[]; stats: LogStats }>(cacheKey);
      if (isFresh(cached, ttlMs)) {
        setLogs(cached!.data.logs);
        setStats(cached!.data.stats);
        setError("");
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(`/api/admin/logs?${params}`, { signal: controller.signal });
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to load logs');
      }
      
      setLogs(result.logs);
      setStats(result.stats);
      setCached(cacheKey, { logs: result.logs, stats: result.stats });
    } catch (error: any) {
      console.error('Error loading logs:', error);
      setError(error.message || 'Failed to load logs');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [filter, actorFilter, dateFilter, searchTerm]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        format: exportFormat,
        filter,
        actorFilter,
        dateFilter,
        search: searchTerm
      });
      
      const response = await fetch(`/api/admin/logs/export?${params}`);
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setShowExportModal(false);
    } catch (error: any) {
      console.error('Error exporting logs:', error);
      setError(error.message || 'Failed to export logs');
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      (log.actor?.name?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      (log.actor?.email?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      (log.actionType?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      (log.targetUser?.name?.toLowerCase().includes(searchTerm.toLowerCase()) || false);
    
    return matchesSearch;
  });

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'user_created':
        return (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        );
      case 'agent_created':
        return (
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'file_uploaded':
        return (
          <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        );
      case 'payment_successful':
        return (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
          </svg>
        );
      case 'agent_assignment':
        return (
          <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'agent_response':
        return (
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
      case 'user_deactivated':
      case 'agent_deactivated':
        return (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getActionDescription = (log: AuditLog) => {
    const { actionType, details } = log;
    
    switch (actionType) {
      case 'user_created':
        return `New user registered: ${details?.email || 'Unknown'}`;
      case 'agent_created':
        return `New agent added: ${details?.name || 'Unknown'}`;
      case 'file_uploaded':
        return `File uploaded: ${details?.originalName || 'Unknown file'}`;
      case 'payment_successful':
        return `Payment received: ₹${details?.amount || 0}`;
      case 'agent_assignment':
        return `File assigned to agent: ${details?.assignmentType || 'manual'}`;
      case 'agent_response':
        return `Agent responded to file: ${details?.hasFile ? 'with attachment' : 'message only'}`;
      case 'user_deactivated':
        return `User deactivated: ${details?.reason || 'Admin action'}`;
      case 'agent_deactivated':
        return `Agent deactivated: ${details?.reason || 'Admin action'}`;
      default:
        return `${actionType.replace('_', ' ')} action performed`;
    }
  };

  const getActorColor = (actorType: string) => {
    switch (actorType) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'agent':
        return 'bg-blue-100 text-blue-800';
      case 'user':
        return 'bg-green-100 text-green-800';
      case 'system':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  if (isLoading) {
    return (
      <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col">
          <MobileHeader 
            title="Audit Logs" 
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
          title="Audit Logs" 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        />
        <main className="flex-1 p-6 mobile-app-content">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">
              Audit Logs
            </h1>
            <button
              onClick={() => setShowExportModal(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
            >
              Export Logs
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

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Logs</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalLogs}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Today</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.logsToday}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">This Week</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.logsThisWeek}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">This Month</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.logsThisMonth}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filters and Search */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All Actions" },
                  { key: "user_created", label: "User Created" },
                  { key: "agent_created", label: "Agent Created" },
                  { key: "file_uploaded", label: "File Uploaded" },
                  { key: "payment_successful", label: "Payment" },
                  { key: "agent_assignment", label: "Assignment" },
                  { key: "agent_response", label: "Response" },
                  { key: "user_deactivated", label: "User Deactivated" },
                  { key: "agent_deactivated", label: "Agent Deactivated" },
                ].map((filterOption) => (
                  <button
                    key={filterOption.key}
                    onClick={() => setFilter(filterOption.key as any)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
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
                  { key: "all", label: "All Actors" },
                  { key: "user", label: "Users" },
                  { key: "agent", label: "Agents" },
                  { key: "admin", label: "Admins" },
                  { key: "system", label: "System" },
                ].map((actorOption) => (
                  <button
                    key={actorOption.key}
                    onClick={() => setActorFilter(actorOption.key as any)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      actorFilter === actorOption.key
                        ? "bg-green-100 text-green-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {actorOption.label}
                  </button>
                ))}
              </div>
              
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All Time" },
                  { key: "today", label: "Today" },
                  { key: "week", label: "This Week" },
                  { key: "month", label: "This Month" },
                ].map((dateOption) => (
                  <button
                    key={dateOption.key}
                    onClick={() => setDateFilter(dateOption.key as any)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      dateFilter === dateOption.key
                        ? "bg-purple-100 text-purple-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {dateOption.label}
                  </button>
                ))}
              </div>
              
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && loadLogs()}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Logs List */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Target
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP Address
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 mr-3">
                            {getActionIcon(log.actionType)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {(log.actionType || 'unknown').replace('_', ' ').toUpperCase()}
                            </div>
                            <div className="text-sm text-gray-500">
                              {getActionDescription(log)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {log.actor?.name || 'Unknown Actor'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {log.actor?.email || 'No email'}
                        </div>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getActorColor(log.actorType || 'unknown')}`}>
                          {(log.actorType || 'unknown').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.targetUser ? (
                          <div className="text-sm text-gray-900">
                            {log.targetUser.name || 'Unknown Target'}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {log.details ? JSON.stringify(log.details) : 'No details'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {log.timestamp ? formatTimestamp(log.timestamp) : 'Unknown Time'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500 font-mono">
                          {log.ipAddress || '-'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-4 p-4">
              {filteredLogs.map((log) => (
                <div key={`mobile-${log.id}`} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start space-x-3 mb-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      {getActionIcon(log.actionType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900">
                        {(log.actionType || 'unknown').replace('_', ' ').toUpperCase()}
                      </h3>
                      <p className="text-xs text-gray-500">{log.actor?.name || 'Unknown Actor'}</p>
                    </div>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getActorColor(log.actorType || 'unknown')}`}>
                      {(log.actorType || 'unknown').toUpperCase()}
                    </span>
                  </div>
                  
                  <div className="space-y-1 ml-12 mt-2">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Email:</span> {log.actor?.email || 'No email'}
                    </p>
                    {log.targetUser && (
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Target:</span> {log.targetUser.name} ({log.targetUser.email})
                      </p>
                    )}
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Time:</span> {new Date(log.timestamp).toLocaleString()}
                    </p>
                    {log.ipAddress && (
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">IP:</span> {log.ipAddress}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {filteredLogs.length === 0 && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No logs found</h3>
              <p className="text-gray-500 mb-4">
                {searchTerm ? 'Try adjusting your search criteria' : 'No audit logs have been recorded yet'}
              </p>
            </div>
          )}
        </div>
        </main>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Export Audit Logs</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Export Format
                </label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
              <div>
                <p className="text-sm text-gray-600">
                  Export will include all logs matching current filters
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
