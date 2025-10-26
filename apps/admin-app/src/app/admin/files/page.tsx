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
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}, []);

interface File {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  status: string;
  uploadedAt: string;
  processedAt?: string;
  assignedAgentId?: string;
  assignedAt?: string;
  respondedAt?: string;
  responseFileURL?: string;
  responseMessage?: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  agent?: {
    id: string;
    name: string;
    email: string;
  };
  paymentId?: string | null;
}

interface Agent {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

export default function FilesPage() {
  const formatDate = useFormatDate();
  const [files, setFiles] = useState<File[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "pending_payment" | "paid" | "processing" | "completed">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300); // Debounce search by 300ms
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [backgroundMonitoring, setBackgroundMonitoring] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    loadFiles();
    loadAgents();
  }, []);

  // CRITICAL FIX: Reload files when filter changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Force refresh when filter changes to avoid stale cache
    loadFiles(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]); // Reload when filter changes

  // OPTIMIZED: Consolidated polling logic - single interval for all monitoring
  useEffect(() => {
    if (!backgroundMonitoring) return;

    // Combined monitoring and refresh - every 3 minutes
    const interval = setInterval(async () => {
      try {
        // Check for auto-assignments and refresh if needed
        const response = await fetch('/api/admin/monitor-assignments', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        setLastCheckTime(new Date());
        
        // Always refresh files to catch any changes
        if (result.success) {
          await loadFiles();
        }
      } catch (_) {
        // Still refresh files even if monitoring endpoint fails
        await loadFiles();
      }
    }, 180000); // 3 minutes (180 seconds)

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundMonitoring]); // loadFiles is stable (useCallback), safe to omit

  useEffect(() => {}, [files]);

  const isLoadingFilesRef = useRef(false);
  const loadFiles = useCallback(async (forceRefresh = false) => {
    if (isLoadingFilesRef.current) return;
    isLoadingFilesRef.current = true;
    try {
      setIsLoading(true);
      const ttlMs = 2 * 60 * 1000; // 2 minutes cache for consistency with other endpoints
      const cacheKey = getCacheKey(['admin-files', filter]);
      
      if (!forceRefresh) {
        const cached = getCached<{ files: File[] }>(cacheKey);
        if (isFresh(cached, ttlMs)) {
          setFiles(cached!.data.files || []);
          setError("");
          setIsLoading(false);
          isLoadingFilesRef.current = false;
          return;
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased to 30s
      
      // Apply filters at API level for better performance
      const params = new URLSearchParams();
      params.append('limit', '50');
      if (filter !== 'all') params.append('status', filter);
      // Force a fresh fetch on initial load to avoid stale server cache after payments
      params.append('fresh', '1');
      
      const response = await fetch(`/api/admin/files?${params.toString()}`, { 
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to load files');
      }
      
      setFiles(result.files || []);
      setCached(cacheKey, { files: result.files || [] });
      setError("");
    } catch (error: any) {
      console.error('Error loading files:', error);
      
      // Handle specific error types
      if (error.message?.includes('Database connection failed')) {
        setError('Database connection failed. Please try again.');
      } else if (error.message?.includes('Request timed out')) {
        setError('Request timed out. Please try again.');
      } else {
        setError(error.message || 'Failed to load files');
      }
      
      // Only set empty array on non-connection errors
      if (!error.message?.includes('connection') && !error.message?.includes('timeout')) {
        setFiles([]);
      }
    } finally {
      setIsLoading(false);
      isLoadingFilesRef.current = false;
    }
  }, [filter]);

  const loadAgents = useCallback(async () => {
    try {
      // OPTIMIZED: Cache agents for 5 minutes (they rarely change)
      const ttlMs = 5 * 60 * 1000;
      const cacheKey = getCacheKey(['admin-agents']);
      
      const cached = getCached<{ agents: Agent[] }>(cacheKey);
      if (isFresh(cached, ttlMs)) {
        setAgents(cached!.data.agents || []);
        return;
      }

      const response = await fetch('/api/admin/agents');
      const result = await response.json();
      
      if (result.success) {
        const activeAgents = result.agents.filter((agent: Agent) => agent.isActive);
        setAgents(activeAgents);
        setCached(cacheKey, { agents: activeAgents });
      }
    } catch (error: any) {
      console.error('Error loading agents:', error);
    }
  }, []);

  const handleAssignFiles = async () => {
    if (!selectedAgent || selectedFiles.length === 0) {
      alert('Please select files and an agent');
      return;
    }

    try {
      const prev = files;
      setFiles(prev.map(f => selectedFiles.includes(f.id) ? { ...f, assignedAgentId: selectedAgent } : f));

      const response = await fetch('/api/admin/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: selectedFiles,
          agentId: selectedAgent,
          assignmentType: 'manual'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        setFiles(prev);
        throw new Error(result.message || 'Failed to assign files');
      }
      
      setShowAssignModal(false);
      setSelectedFiles([]);
      setSelectedAgent("");
      deleteCached(getCacheKey(['admin-files', filter]));
      await loadFiles(true); // Force refresh
      alert('Files assigned successfully');
    } catch (error: any) {
      setError(error.message || 'Failed to assign files');
    }
  };

  const handleReassignFile = async (fileId: string, newAgentId: string) => {
    try {
      const prev = files;
      setFiles(prev.map(f => f.id === fileId ? { ...f, assignedAgentId: newAgentId } : f));
      
      const response = await fetch('/api/admin/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: [fileId],
          agentId: newAgentId,
          assignmentType: 'manual'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        setFiles(prev);
        throw new Error(result.message || 'Failed to reassign file');
      }
      
      deleteCached(getCacheKey(['admin-files', filter]));
      await loadFiles(true);
      alert('File reassigned successfully');
    } catch (error: any) {
      setError(error.message || 'Failed to reassign file');
    }
  };

  const handleUnassignFile = async (fileId: string, showConfirmation: boolean = true) => {
    const file = files.find(f => f.id === fileId);
    const fileName = file?.originalName || file?.filename || 'this file';
    
    if (showConfirmation) {
      const confirmed = window.confirm(
        `Are you sure you want to remove the assigned work from "${fileName}"?\n\nThis will set the assignment to "none" and make the file available for reassignment.`
      );
      if (!confirmed) return;
    }
    
    try {
      const prev = files;
      setFiles(prev.map(f => f.id === fileId ? { ...f, assignedAgentId: undefined } : f));
      
      const response = await fetch('/api/admin/assign', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId: fileId
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        setFiles(prev);
        throw new Error(result.message || 'Failed to unassign file');
      }
      
      deleteCached(getCacheKey(['admin-files', filter]));
      await loadFiles(true);
      if (showConfirmation) alert('Assignment removed successfully! File is now unassigned.');
    } catch (error: any) {
      setError(error.message || 'Failed to unassign file');
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    const fileName = file?.originalName || file?.filename || 'this file';
    
    const confirmed = window.confirm(
      `Are you sure you want to DELETE "${fileName}" permanently?\n\nThis action cannot be undone and will remove the file from the system completely.`
    );
    if (!confirmed) return;
    
    try {
      const prev = files;
      setFiles(prev.filter(f => f.id !== fileId));
      
      const response = await fetch('/api/admin/files', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileId: fileId }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        setFiles(prev);
        throw new Error(result.error || 'Failed to delete file');
      }
      
      alert('File deleted successfully!');
      deleteCached(getCacheKey(['admin-files', filter]));
      await loadFiles(true);
      
    } catch (error: any) {
      setError(error.message || 'Failed to delete file');
    }
  };

  const handleAutoAssign = async () => {
    try {
      const response = await fetch('/api/admin/assign', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'round_robin'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to auto-assign files');
      }
      
      deleteCached(getCacheKey(['admin-files']));
      loadFiles();
      alert(`Files auto-assigned successfully! ${result.assignedCount || 0} files assigned.`);
    } catch (error: any) {
      console.error('Error auto-assigning files:', error);
      setError(error.message || 'Failed to auto-assign files');
    }
  };

  // New auto-assignment functions
  const handleSmartAutoAssign = async () => {
    try {
      setIsAutoAssigning(true);
      
      // Get all unassigned paid files
      const unassignedPaidFiles = files.filter(file => 
        file.status === 'paid' && !file.assignedAgentId
      );

      if (unassignedPaidFiles.length === 0) {
        alert('No unassigned paid files found!');
        return;
      }

      const fileIds = unassignedPaidFiles.map(file => file.id);
      
      const response = await fetch('/api/admin/auto-assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: fileIds,
          assignmentType: 'auto_workload'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to auto-assign files');
      }
      
      deleteCached(getCacheKey(['admin-files']));
      loadFiles();
      alert(`Smart auto-assignment completed! ${result.totalAssigned || 0} files assigned based on agent workload.`);
    } catch (error: any) {
      console.error('Error in smart auto-assignment:', error);
      setError(error.message || 'Failed to auto-assign files');
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleToggleAutoAssign = async (fileId: string, enabled: boolean) => {
    try {
      const response = await fetch('/api/admin/files', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId: fileId,
          status: 'paid',
          triggerAutoAssign: enabled
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update file');
      }
      
      if (enabled && result.autoAssignment?.success) {
        alert('File marked as paid and auto-assigned successfully!');
      } else if (enabled) {
        alert('File marked as paid, but auto-assignment failed. Please assign manually.');
      } else {
        alert('File status updated successfully!');
      }
      
      loadFiles();
    } catch (error: any) {
      console.error('Error updating file status:', error);
      setError(error.message || 'Failed to update file');
    }
  };

  const filteredFiles = useMemo(() => {
    const search = debouncedSearchTerm.toLowerCase(); // Use debounced value
    return files.filter(file => {
      const matchesFilter = filter === "all" || (file.status || 'unknown') === filter;
      const matchesSearch = !search ||
        (file.originalName?.toLowerCase().includes(search) || false) ||
        (file.user?.name?.toLowerCase().includes(search) || false) ||
        (file.user?.email?.toLowerCase().includes(search) || false) ||
        (file.agent?.name?.toLowerCase().includes(search) || false) ||
        (file.agent?.email?.toLowerCase().includes(search) || false);
      
      return matchesFilter && matchesSearch;
    });
  }, [files, filter, debouncedSearchTerm]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending_payment':
        return 'bg-yellow-100 text-yellow-800';
      case 'paid':
        return 'bg-blue-100 text-blue-800';
      case 'processing':
        return 'bg-purple-100 text-purple-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatFileSize = useCallback((bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const toggleFileSelection = useCallback((fileId: string) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  }, []);

  const allSelected = useMemo(() => selectedFiles.length > 0 && filteredFiles.every(f => selectedFiles.includes(f.id)), [filteredFiles, selectedFiles]);
  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(filteredFiles.map(f => f.id));
    }
  }, [allSelected, filteredFiles]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    const confirmed = window.confirm(`Delete ${selectedFiles.length} selected file(s)? This cannot be undone.`);
    if (!confirmed) return;
    try {
      const prev = files;
      setFiles(prev.filter(f => !selectedFiles.includes(f.id)));
      const response = await fetch('/api/admin/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: selectedFiles })
      });
      const result = await response.json();
      if (!result.success) {
        setFiles(prev);
        throw new Error(result.error || 'Failed to delete selected files');
      }
      deleteCached(getCacheKey(['admin-files', filter]));
      setSelectedFiles([]);
      await loadFiles(true);
      alert(result.message || 'Deleted selected files');
    } catch (e: any) {
      setError(e.message || 'Failed to delete selected files');
    }
  }, [selectedFiles, files, filter, loadFiles]);

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
    <div className="mobile-app-container bg-gray-50 flex">
      <Sidebar />
      <main className="flex-1 p-6 mobile-app-content">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                File Management
              </h1>
              {backgroundMonitoring && (
                <div className="flex items-center mt-2 text-sm text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                  Auto-assignment monitoring active
                  {lastCheckTime && (
                    <span className="ml-2 text-gray-500">
                      (Last check: {lastCheckTime.toLocaleTimeString()})
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleDeleteSelected}
                disabled={selectedFiles.length === 0}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                title="Delete all selected files"
              >
                Delete Selected ({selectedFiles.length})
              </button>
              <button
                onClick={() => setBackgroundMonitoring(!backgroundMonitoring)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  backgroundMonitoring 
                    ? 'bg-red-600 text-white hover:bg-red-700' 
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {backgroundMonitoring ? 'Stop Auto-Monitoring & Refresh' : 'Start Auto-Monitoring & Refresh'}
              </button>
              <button
                onClick={handleSmartAutoAssign}
                disabled={isAutoAssigning}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isAutoAssigning ? 'Smart Assigning...' : 'Smart Auto Assign'}
              </button>
              <button
                onClick={handleAutoAssign}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                Auto Assign All
              </button>
              <button
                onClick={() => setShowAssignModal(true)}
                disabled={selectedFiles.length === 0}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Assign Selected ({selectedFiles.length})
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

          {/* Filters and Search */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "All Files" },
                  { key: "pending_payment", label: "Pending Payment" },
                  { key: "paid", label: "Paid" },
                  { key: "processing", label: "Processing" },
                  { key: "completed", label: "Completed" },
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
                  placeholder="Search files..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Files List */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      File
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Assigned Agent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Upload Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredFiles.map((file) => (
                    <tr key={file.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedFiles.includes(file.id)}
                          onChange={() => toggleFileSelection(file.id)}
                          disabled={false}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-lg bg-gray-200 flex items-center justify-center">
                              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {file.originalName || file.filename || 'Unknown File'}
                            </div>
                            <div className="text-sm text-gray-500">
                              {formatFileSize(file.size || 0)} • {file.mimeType || 'Unknown'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {file.user?.name || 'Unknown User'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {file.user?.email || 'No email'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(file.status || 'unknown')}`}>
                          {(file.status || 'unknown').replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {file.agent ? (
                          <div className="text-sm text-gray-900">
                            {file.agent.name}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {file.uploadedAt ? formatDate(file.uploadedAt).date : 'Unknown'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {file.uploadedAt ? formatDate(file.uploadedAt).time : 'Unknown'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          {(file.status || 'unknown') === 'paid' && (
                            <>
                              <select
                                onChange={(e) => {
                                  if (e.target.value === 'none') {
                                    handleUnassignFile(file.id, false);
                                  } else if (e.target.value) {
                                    handleReassignFile(file.id, e.target.value);
                                  }
                                }}
                                value={file.assignedAgentId || ''}
                                className="text-xs border border-gray-300 rounded px-2 py-1"
                              >
                                <option value="">Assign to...</option>
                                <option value="none">None (Unassigned)</option>
                                {agents.map(agent => (
                                  <option key={agent.id} value={agent.id}>
                                    {agent.name}
                                  </option>
                                ))}
                              </select>
                              {!file.assignedAgentId && (
                                <button
                                  onClick={() => handleToggleAutoAssign(file.id, true)}
                                  className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200 transition-colors"
                                  title="Auto-assign based on agent workload"
                                >
                                  Smart Assign
                                </button>
                              )}
                            </>
                          )}
                          {file.responseFileURL && (
                            <a
                              href={file.responseFileURL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-900 text-xs"
                            >
                              View Response
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteFile(file.id)}
                            className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 transition-colors ml-2"
                            title="Delete this file permanently"
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

          

          {filteredFiles.length === 0 && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No files found</h3>
              <p className="text-gray-500 mb-4">
                {searchTerm ? 'Try adjusting your search criteria' : 'No files have been uploaded yet'}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Assign Files Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Assign Files to Agent</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Agent
                </label>
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose an agent...</option>
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-sm text-gray-600">
                  {selectedFiles.length} file(s) selected for assignment
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignFiles}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Assign Files
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
