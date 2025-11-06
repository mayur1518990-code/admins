"use client";

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import dynamicImport from "next/dynamic";
const Sidebar = dynamicImport(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getCached, setCached, getCacheKey, isFresh, deleteCached } from "@/lib/cache";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, orderBy, limit as firestoreLimit, Timestamp } from "firebase/firestore";
import { useFirebaseAuth } from "@/hooks/useFirebaseAuth";

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

// OPTIMIZED: Pure function for date formatting (no re-creation on every render)
const formatDate = (date: string | Date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
};

// OPTIMIZED: Status color map (constant lookup instead of function calls)
const STATUS_COLORS: Record<string, string> = {
  'pending_payment': 'bg-yellow-100 text-yellow-800',
  'paid': 'bg-blue-100 text-blue-800',
  'processing': 'bg-purple-100 text-purple-800',
  'completed': 'bg-green-100 text-green-800',
  'unknown': 'bg-gray-100 text-gray-800'
};

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
  const { isAuthenticated, loading: authLoading, error: authError } = useFirebaseAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "paid" | "processing" | "completed">("all");
  const [daysFilter, setDaysFilter] = useState<"all" | "7" | "15" | "30">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300); // Debounce search by 300ms
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const isInitialMount = useRef(true);
  const assignedFileIdsRef = useRef<Set<string>>(new Set()); // Track which specific files have been assigned
  
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

  // REAL-TIME FIRESTORE LISTENER
  // This replaces the need for manual refresh and enables instant updates
  useEffect(() => {
    // Wait for Firebase authentication before setting up listener
    if (authLoading) {
      return;
    }
    
    if (!isAuthenticated || !db) {
      // Fallback to regular API loading if not authenticated or Firebase not initialized
      loadFiles(true);
      return;
    }
    
    // Build the Firestore query based on current filters
    let firestoreQuery = collection(db, 'files');
    let q = query(firestoreQuery);
    
    // Apply status filter
    if (filter === 'all') {
      // When showing "all", exclude pending_payment files
      q = query(q, where('status', '!=', 'pending_payment'));
    } else {
      q = query(q, where('status', '==', filter));
    }
    
    // Apply ordering and limit
    try {
      q = query(q, orderBy('uploadedAt', 'desc'), firestoreLimit(30));
    } catch (error) {
      // If ordering fails (missing index), just use limit
      q = query(q, firestoreLimit(30));
    }
    
    // Set up the real-time listener
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        
        // Extract file IDs from the snapshot
        const fileIds = snapshot.docs.map(doc => doc.id);
        
        // Fetch full file details with user and agent data from API
        // (We still need the API for user/agent population which requires joins)
        if (fileIds.length > 0) {
          const params = new URLSearchParams();
          params.append('fileIds', fileIds.join(','));
          params.append('fresh', '1');
          
          fetch(`/api/admin/files?${params.toString()}`)
            .then(res => res.json())
            .then(async result => {
              if (result.success) {
                setFiles(result.files || []);
                setError("");
                
                // Clean up tracking set: remove files that now have assignments
                result.files.forEach((file: File) => {
                  if (file.assignedAgentId && assignedFileIdsRef.current.has(file.id)) {
                    assignedFileIdsRef.current.delete(file.id);
                  }
                });
                
                // Check for NEW unassigned paid files that haven't been auto-assigned yet
                const newUnassignedFiles = result.files.filter((file: File) => 
                  file.status === 'paid' && 
                  !file.assignedAgentId &&
                  !assignedFileIdsRef.current.has(file.id) // Only files we haven't processed yet
                );
                
                if (newUnassignedFiles.length > 0 && !isAutoAssigning) {
                  // Mark these files as being processed
                  newUnassignedFiles.forEach((f: any) => assignedFileIdsRef.current.add(f.id));
                  
                  // Trigger auto-assignment with the file IDs directly
                  await triggerAutoAssignment(newUnassignedFiles.map((f: any) => f.id));
                }
              }
            })
            .catch(() => {
              // Silent fail - real-time updates will retry
            });
        } else {
          setFiles([]);
        }
        
        setIsLoading(false);
      },
      (error) => {
        setError('Failed to connect to real-time updates. Falling back to manual refresh.');
        // Fallback to manual loading
        loadFiles(true);
      }
    );
    
    // Cleanup listener on unmount or when filters change
    return () => {
      unsubscribe();
    };
  }, [filter, daysFilter, isAuthenticated, authLoading]); // Re-subscribe when filters or auth state changes

  useEffect(() => {
    // Load agents on mount
    loadAgents();
  }, []);

  // NOTE: Auto-assign logic is now handled in the real-time Firestore listener above
  // NOTE: Filter changes are also handled by the real-time listener re-subscription

  const isLoadingFilesRef = useRef(false);
  const loadFiles = useCallback(async (forceRefresh = false) => {
    if (isLoadingFilesRef.current) return;
    isLoadingFilesRef.current = true;
    try {
      setIsLoading(true);
      const ttlMs = 30 * 1000; // REDUCED to 30 seconds cache for instant data visibility
      const cacheKey = getCacheKey(['admin-files', filter, daysFilter]);
      
      // Check cache only if NOT forcing refresh AND within TTL
      if (!forceRefresh) {
        const cached = getCached<{ files: File[] }>(cacheKey);
        if (isFresh(cached, ttlMs)) {
          setFiles(cached!.data.files || []);
          setError("");
          setIsLoading(false);
          isLoadingFilesRef.current = false;
          return;
        }
      } else {
        // Force refresh: clear cache before fetching
        deleteCached(cacheKey);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased to 30s
      
      // Apply filters at API level for better performance
      const params = new URLSearchParams();
      params.append('limit', '30'); // Reduced from 50 to 30 for faster load
      if (filter !== 'all') params.append('status', filter);
      if (daysFilter !== 'all') params.append('daysOld', daysFilter);
      // ALWAYS force fresh data to see new uploads instantly
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
  }, [filter, daysFilter]);

  const loadAgents = useCallback(async () => {
    try {
      // Cache agents for 10 minutes - they rarely change
      const ttlMs = 10 * 60 * 1000;
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
      // Get the old agent ID before updating
      const file = files.find(f => f.id === fileId);
      const oldAgentId = file?.assignedAgentId;
      
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
          oldAgentId: oldAgentId, // Pass old agent ID to API for cache clearing
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
      alert('File reassigned successfully! Agent performance stats will update shortly.');
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
      `Are you sure you want to DELETE "${fileName}" permanently?\n\n` +
      `This will:\n` +
      `• Remove file from database\n` +
      `• Delete file from B2 storage (if present)\n` +
      `• Delete completed file records\n\n` +
      `This action CANNOT be undone!`
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
      
      // Clear cache immediately
      const cacheKey = getCacheKey(['admin-files', filter, daysFilter]);
      deleteCached(cacheKey);
      
      alert('File deleted successfully!');
      await loadFiles(true);
      
    } catch (error: any) {
      setError(error.message || 'Failed to delete file');
    }
  };

  // Helper function to trigger auto-assignment (used by real-time listener)
  const triggerAutoAssignment = async (fileIds: string[]) => {
    try {
      setIsAutoAssigning(true);
      
      const response = await fetch('/api/admin/auto-assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: fileIds,
          assignmentType: 'smart_balanced'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to assign files');
      }
      
      // Clear cache and immediately refresh to show updated assignments
      deleteCached(getCacheKey(['admin-files']));
      
      // Force immediate refresh via API to update UI instantly
      // Real-time listener will continue to work for future updates
      await loadFiles(true);
      
    } catch (error: any) {
      // Silent fail - real-time updates will retry
    } finally {
      setIsAutoAssigning(false);
    }
  };

  // SMART AUTO ASSIGNMENT - Considers both completed and pending files for fair distribution
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
          assignmentType: 'smart_balanced'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to assign files');
      }
      
      // Show detailed distribution summary
      const summary = result.distributionSummary || [];
      const summaryText = summary.map((agent: any) => 
        `${agent.agentName}: ${agent.pendingFiles} pending, ${agent.completedFiles} completed, ${agent.totalWorkload} total`
      ).join('\n');
      
      deleteCached(getCacheKey(['admin-files']));
      
      // Force immediate refresh to show updated assignments instantly
      await loadFiles(true);
      
      alert(
        `Smart Assignment Completed!\n\n` +
        `${result.totalAssigned || 0} files assigned fairly based on workload.\n\n` +
        `Distribution Summary:\n${summaryText}`
      );
    } catch (error: any) {
      setError(error.message || 'Failed to assign files');
    } finally {
      setIsAutoAssigning(false);
    }
  };

  // Smart assign a single file
  const handleSmartAssignSingle = async (fileId: string) => {
    try {
      const response = await fetch('/api/admin/auto-assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: [fileId],
          assignmentType: 'smart_balanced'
        }),
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to assign file');
      }
      
      const assignment = result.assignments?.[0];
      if (assignment) {
        alert(`File assigned to ${assignment.agentName}\n\nNew workload: ${assignment.newPending} pending, ${assignment.newTotal} total`);
      } else {
        alert('File assigned successfully!');
      }
      
      deleteCached(getCacheKey(['admin-files', filter]));
      await loadFiles(true);
    } catch (error: any) {
      setError(error.message || 'Failed to assign file');
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

  // OPTIMIZED: Use direct STATUS_COLORS lookup instead of function
  const getStatusColor = (status: string) => STATUS_COLORS[status] || STATUS_COLORS['unknown'];

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
    
    const ageInfo = daysFilter !== 'all' ? ` older than ${daysFilter} days` : '';
    const confirmed = window.confirm(
      `Delete ${selectedFiles.length} selected file(s)${ageInfo}?\n\n` +
      `This will:\n` +
      `• Remove files from database\n` +
      `• Delete files from B2 storage (agent-uploads folder)\n` +
      `• Delete completed files records\n\n` +
      `This action CANNOT be undone!`
    );
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
      
      // Clear cache immediately
      const cacheKey = getCacheKey(['admin-files', filter, daysFilter]);
      deleteCached(cacheKey);
      
      setSelectedFiles([]);
      await loadFiles(true);
      alert(result.message || 'Deleted selected files');
    } catch (e: any) {
      setError(e.message || 'Failed to delete selected files');
    }
  }, [selectedFiles, files, filter, daysFilter, loadFiles]);

  if (isLoading) {
    return (
      <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col">
          <MobileHeader 
            title="File Management" 
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
          title="File Management" 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        />
        <main className="flex-1 p-6 mobile-app-content">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                File Management
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Smart assignment distributes work fairly based on completed and pending files
              </p>
              {daysFilter !== 'all' && (
                <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Showing files older than {daysFilter} days ({filteredFiles.length} files)
                </div>
              )}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleDeleteSelected}
                disabled={selectedFiles.length === 0}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                title="Delete all selected files (includes B2 storage cleanup)"
              >
                Delete Selected ({selectedFiles.length})
              </button>
              <button
                onClick={handleSmartAutoAssign}
                disabled={isAutoAssigning}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                title="Smart assignment based on agent workload (completed + pending files)"
              >
                {isAutoAssigning ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Assigning...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Smart Auto Assign
                  </>
                )}
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
            <div className="flex flex-col gap-4">
              {/* Status Filters */}
              <div className="flex flex-wrap gap-2">
                <span className="text-sm font-medium text-gray-700 self-center mr-2">Status:</span>
                {[
                  { key: "all", label: "All Paid Files" },
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

              {/* Days Filter */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm font-medium text-gray-700 self-center mr-2">File Age:</span>
                {[
                  { key: "all", label: "All Files" },
                  { key: "7", label: "Older than 7 days" },
                  { key: "15", label: "Older than 15 days" },
                  { key: "30", label: "Older than 30 days" },
                ].map((daysOption) => (
                  <button
                    key={daysOption.key}
                    onClick={() => setDaysFilter(daysOption.key as any)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      daysFilter === daysOption.key
                        ? "bg-orange-100 text-orange-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {daysOption.label}
                  </button>
                ))}
                {daysFilter !== 'all' && filteredFiles.length > 0 && (
                  <button
                    onClick={toggleSelectAll}
                    className="ml-2 px-3 py-2 rounded-md text-sm font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors"
                    title={allSelected ? "Deselect all old files" : "Select all old files for deletion"}
                  >
                    {allSelected ? "Deselect All" : "Select All Old Files"}
                  </button>
                )}
              </div>
              
              {/* Search */}
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
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
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
                          {(['paid', 'assigned', 'processing'].includes(file.status || 'unknown')) && (
                            <>
                              <select
                                onChange={(e) => {
                                  const selectedValue = e.target.value;
                                  if (selectedValue === 'none') {
                                    handleUnassignFile(file.id, false);
                                  } else if (selectedValue && selectedValue !== file.assignedAgentId) {
                                    handleReassignFile(file.id, selectedValue);
                                  }
                                  // Reset dropdown to show placeholder
                                  e.target.value = '';
                                }}
                                defaultValue=""
                                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                              >
                                <option value="">
                                  {file.assignedAgentId 
                                    ? `Change from ${agents.find(a => a.id === file.assignedAgentId)?.name || 'Unknown'}` 
                                    : 'Assign to...'}
                                </option>
                                <option value="none">❌ Unassign</option>
                                {agents.map(agent => (
                                  <option 
                                    key={agent.id} 
                                    value={agent.id}
                                    disabled={agent.id === file.assignedAgentId}
                                  >
                                    {agent.name} {agent.id === file.assignedAgentId ? '(Current)' : ''}
                                  </option>
                                ))}
                              </select>
                              {!file.assignedAgentId && (
                                <button
                                  onClick={() => handleSmartAssignSingle(file.id)}
                                  className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200 transition-colors"
                                  title="Smart assign based on agent workload (completed + pending)"
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

            {/* Mobile Cards */}
            <div className="md:hidden space-y-4 p-4">
              {filteredFiles.map((file) => (
                <div key={`mobile-${file.id}`} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start space-x-3 mb-3">
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file.id)}
                      onChange={() => toggleFileSelection(file.id)}
                      className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start space-x-2 mb-2">
                        <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 truncate">
                            {file.originalName || file.filename || 'Unknown File'}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(file.size || 0)} • {file.mimeType || 'Unknown'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="space-y-1 ml-10">
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">User:</span> {file.user?.name || 'Unknown'}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Email:</span> {file.user?.email || 'No email'}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Agent:</span> {file.agent ? file.agent.name : 'Unassigned'}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Upload:</span> {file.uploadedAt ? formatDate(file.uploadedAt).date : 'Unknown'}
                        </p>
                        <div className="mt-2">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(file.status || 'unknown')}`}>
                            {(file.status || 'unknown').replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                      </div>
                      
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(['paid', 'assigned', 'processing'].includes(file.status || 'unknown')) && (
                          <select
                            onChange={(e) => {
                              const selectedValue = e.target.value;
                              if (selectedValue === 'none') {
                                handleUnassignFile(file.id, false);
                              } else if (selectedValue && selectedValue !== file.assignedAgentId) {
                                handleReassignFile(file.id, selectedValue);
                              }
                              // Reset dropdown to show placeholder
                              e.target.value = '';
                            }}
                            defaultValue=""
                            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                          >
                            <option value="">
                              {file.assignedAgentId 
                                ? `Change from ${agents.find(a => a.id === file.assignedAgentId)?.name || 'Unknown'}` 
                                : 'Assign to...'}
                            </option>
                            <option value="none">❌ Unassign</option>
                            {agents.map(agent => (
                              <option 
                                key={agent.id} 
                                value={agent.id}
                                disabled={agent.id === file.assignedAgentId}
                              >
                                {agent.name} {agent.id === file.assignedAgentId ? '(Current)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => handleDeleteFile(file.id)}
                          className="bg-red-600 text-white text-xs px-3 py-1 rounded hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
      </div>

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
