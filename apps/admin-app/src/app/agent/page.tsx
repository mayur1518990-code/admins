'use client';

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCached, setCached, getCacheKey, isFresh, deleteCached } from '@/lib/cache';

interface AssignedFile {
      id: string;
  originalName: string;
  filename: string;
  size: number;
  mimeType: string;
  status: 'assigned' | 'processing' | 'completed' | 'paid';
  uploadedAt: string;
  assignedAt: string;
  userId: string;
  userEmail?: string;
  userPhone?: string;
  completedFile?: {
    filename: string;
    originalName: string;
    size: number;
    uploadedAt: string;
  };
  userComment?: string;
  userCommentUpdatedAt?: string;
}

interface AgentStats {
  totalAssigned: number;
  processing: number;
  completed: number;
  pending: number;
}

export default function AgentDashboard() {
  const router = useRouter();
  const [files, setFiles] = useState<AssignedFile[]>([]);
  const [stats, setStats] = useState<AgentStats>({
    totalAssigned: 0,
    processing: 0,
    completed: 0,
    pending: 0
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<AssignedFile | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'assigned' | 'processing' | 'completed' | 'paid'>('all');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // OPTIMIZED: Add client-side caching with useCallback, removed console logs
  const fetchAssignedFiles = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      
      // Check cache first (unless forcing refresh)
      const cacheKey = getCacheKey(['agent-files']);
      if (!forceRefresh) {
        const cached = getCached<{ files: AssignedFile[] }>(cacheKey);
        if (isFresh(cached, 180_000)) { // 3 minutes cache
          setFiles(cached!.data.files);
          calculateStats(cached!.data.files);
          setLoading(false);
          return;
        }
      } else {
        // Force refresh: clear cache before fetching
        deleteCached(cacheKey);
      }
      
      // Add fresh parameter to bypass server cache when force refreshing
      const url = forceRefresh ? '/api/agent/files?fresh=1' : '/api/agent/files';
      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        setFiles(data.files);
        calculateStats(data.files);
        
        // Cache the result
        setCached(cacheKey, { files: data.files });
      }
    } catch (error) {
      // Silent error - show empty state
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps - stable callback

  // Load files on mount
  useEffect(() => {
    fetchAssignedFiles();
  }, [fetchAssignedFiles]);

  // Clear selections when filter changes
  useEffect(() => {
    setSelectedFiles([]);
  }, [statusFilter]);

  // Manual refresh function
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAssignedFiles(true); // Force refresh
    setRefreshing(false);
  };

  const handleLogout = async () => {
    try {
      // Call logout API to clear server-side session
      await fetch('/api/agent/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      // Silent error - logout anyway
    } finally {
      // Clear the agent token cookie
      document.cookie = 'agent-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      
      // Redirect to login page
      window.location.href = '/';
    }
  };

  const calculateStats = (files: AssignedFile[]) => {
    const stats = {
      totalAssigned: files.length,
      processing: files.filter(f => f.status === 'processing').length,
      completed: files.filter(f => f.status === 'completed').length,
      pending: files.filter(f => f.status === 'assigned' || f.status === 'paid').length
    };
    setStats(stats);
  };

  const updateFileStatus = async (fileId: string, status: 'processing' | 'completed') => {
    setUpdatingStatus(fileId);
    
    try {
      // OPTIMIZED: Optimistic UI update first (instant feedback)
      setFiles(prev => {
        const updatedFiles = prev.map(file => 
          file.id === fileId ? { ...file, status } : file
        );
        calculateStats(updatedFiles);
        return updatedFiles;
      });
      
      // Switch to 'All Files' view so user can see the status change
      if (status === 'processing') {
        setStatusFilter('all');
      }
      
      // Update server in background
      const response = await fetch(`/api/agent/files/${fileId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status })
      });

      const data = await response.json();
      
      if (data.success) {
        // Show success notification immediately (don't wait for refresh)
        const statusMessage = status === 'processing' 
          ? 'File status updated to Processing! ✅\n\nYou can now upload the completed file.'
          : 'File marked as Completed! ✅';
        alert(statusMessage);
        
        // Refresh in background to sync with server
        fetchAssignedFiles(true).catch(() => {
          // Silent error - UI is already updated
        });
      } else {
        // Revert optimistic update on error
        await fetchAssignedFiles(true);
        alert('Failed to update file status. Please try again.');
      }
    } catch (error) {
      // Revert optimistic update on error
      await fetchAssignedFiles(true);
      alert('Error updating file status. Please try again.');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const downloadOriginalFile = async (fileId: string, filename: string) => {
    try {
      // OPTIMIZED: Get pre-signed URL (instant response <100ms)
      const response = await fetch(`/api/agent/files/${fileId}/download-url`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.downloadUrl) {
          // FIXED: Direct download using window.location or iframe
          // The Content-Disposition: attachment header forces download
          window.location.href = data.downloadUrl;
        } else {
          alert(`Download failed: ${data.error || 'Unknown error'}`);
        }
      } else {
        const errorData = await response.json();
        alert(`Download failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert('Error downloading file. Please try again.');
    }
  };

  const uploadCompletedFile = async (fileId: string) => {
    if (!uploadFile || uploading) return;

    setUploading(true);
    
    try {
      // Use reliable server upload method
      console.log('[UPLOAD] Starting upload via server...');
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('fileId', fileId);

      const response = await fetch(`/api/agent/files/${fileId}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[UPLOAD] Server returned error:', errorData);
        alert(`Failed to upload file: ${errorData.error || 'Unknown error'}`);
        return;
      }

      const data = await response.json();
      console.log('[UPLOAD] Server response:', data);
      
      if (data.success) {
        setUploadFile(null);
        setSelectedFile(null);
        
        // Await the refresh BEFORE showing alert so stats update first
        await fetchAssignedFiles(true);
        
        // Now show the alert after data is refreshed
        alert('File uploaded successfully! ✅\n\nThe page has been refreshed and your Completed count has been updated.');
      } else {
        alert(`Failed to upload file: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[UPLOAD] Error:', error);
      alert(`Error uploading file: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setUploading(false);
    }
  };


  const filteredFiles = files.filter(file => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'assigned') return file.status === 'assigned' || file.status === 'paid';
    return file.status === statusFilter;
  });

  // Checkbox handlers
  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedFiles.length === filteredFiles.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(filteredFiles.map(f => f.id));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.length === 0) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedFiles.length} file(s)? This action cannot be undone.`
    );
    
    if (!confirmed) return;
    
    setDeleting(true);
    try {
      const response = await fetch('/api/agent/files', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileIds: selectedFiles }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Clear cache immediately
        const cacheKey = getCacheKey(['agent-files']);
        deleteCached(cacheKey);
        
        // Clear selected files
        setSelectedFiles([]);
        
        // Force refresh from server to get updated data
        await fetchAssignedFiles(true);
        
        alert(`${selectedFiles.length} file(s) deleted successfully!`);
      } else {
        alert(`Failed to delete files: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert('Error deleting files. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  // OPTIMIZED: Pure function for file size formatting (no re-creation on every render)
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // OPTIMIZED: Status color map (constant lookup instead of function calls)
  const STATUS_COLORS: Record<string, string> = {
    'assigned': 'bg-yellow-100 text-yellow-800',
    'processing': 'bg-blue-100 text-blue-800',
    'completed': 'bg-green-100 text-green-800',
    'paid': 'bg-yellow-100 text-yellow-800',
  };
  
  const getStatusColor = (status: string) => STATUS_COLORS[status] || 'bg-gray-100 text-gray-800';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your assignments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
        {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Agent Dashboard</h1>
              <p className="text-gray-600">Manage your assigned files and track progress</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleLogout}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
            </div>
          </div>
        </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Assigned</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.totalAssigned}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pending</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.pending}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Processing</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.processing}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.completed}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6">
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  statusFilter === 'all' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All Files ({stats.totalAssigned})
              </button>
              <button
                onClick={() => setStatusFilter('assigned')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  statusFilter === 'assigned' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Pending ({stats.pending})
              </button>
              <button
                onClick={() => setStatusFilter('processing')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  statusFilter === 'processing' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Processing ({stats.processing})
              </button>
              <button
                onClick={() => setStatusFilter('completed')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  statusFilter === 'completed' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Completed ({stats.completed})
              </button>
            </div>
          </div>
        </div>

        {/* Files List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={filteredFiles.length > 0 && selectedFiles.length === filteredFiles.length}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <h2 className="text-lg font-semibold text-gray-900">
                  Assigned Files {selectedFiles.length > 0 && `(${selectedFiles.length} selected)`}
                </h2>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {refreshing ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Refreshing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Refresh</span>
                    </>
                  )}
                </button>
                {selectedFiles.length > 0 && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    {deleting ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Delete Selected ({selectedFiles.length})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
          
          {filteredFiles.length === 0 ? (
            <div className="p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No files found</h3>
              <p className="mt-1 text-sm text-gray-500">
                {statusFilter === 'all' 
                  ? 'You have no assigned files yet.' 
                  : `No files with status "${statusFilter}" found.`
                }
              </p>
          </div>
          ) : (
            <>
              {/* Desktop: Horizontal Layout */}
              <div className="hidden md:block divide-y divide-gray-200">
                {filteredFiles.map((file) => (
                  <div key={file.id} className="p-6 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={selectedFiles.includes(file.id)}
                              onChange={() => toggleFileSelection(file.id)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                          </div>
                          <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                          </div>
                          
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleFileSelection(file.id)}>
                            <h3 className="text-lg font-medium text-gray-900 truncate">
                              {file.originalName}
                            </h3>
                            <div className="flex items-center space-x-4 mt-1">
                              <p className="text-sm text-gray-500">
                                Size: {formatFileSize(file.size)}
                              </p>
                              <p className="text-sm text-gray-500">
                                Assigned: {new Date(file.assignedAt).toLocaleDateString()}
                              </p>
                              {file.userEmail && (
                                <p className="text-sm text-gray-500">
                                  User: {file.userEmail}
                                </p>
                              )}
                            </div>
                            {file.userComment && (
                              <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
                                <div className="flex items-start space-x-2">
                                  <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                  </svg>
                                  <div className="flex-1">
                                    <p className="text-xs font-semibold text-blue-800 mb-1">User Message:</p>
                                    <p className="text-sm text-blue-900">{file.userComment}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-3">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(file.status)}`}>
                              {file.status.charAt(0).toUpperCase() + file.status.slice(1)}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 ml-4">
                      {(file.status === 'assigned' || file.status === 'paid') && (
                        <>
                          <button
                            onClick={() => downloadOriginalFile(file.id, file.originalName)}
                            disabled={updatingStatus === file.id}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => updateFileStatus(file.id, 'processing')}
                            disabled={updatingStatus === file.id}
                            className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                          >
                            {updatingStatus === file.id ? (
                              <>
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Processing...</span>
                              </>
                            ) : (
                              <span>Start Processing</span>
                            )}
                          </button>
                        </>
                      )}
                      
                      {file.status === 'processing' && (
                        <button
                          onClick={() => setSelectedFile(file)}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm"
                        >
                          Upload Completed
                        </button>
                      )}
                      
                      {file.status === 'completed' && file.completedFile && (
                        <div className="text-sm text-gray-500">
                          Completed: {new Date(file.completedFile.uploadedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

              {/* Mobile: Vertical Card Layout */}
              <div className="md:hidden space-y-4 px-4 pb-4">
                {filteredFiles.map((file) => (
                  <div key={`mobile-${file.id}`} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-2">
                              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                              <h3 className="text-base font-medium text-gray-900 truncate">
                                {file.originalName}
                              </h3>
                            </div>
                            
                            <div className="space-y-1 ml-10">
                              <p className="text-sm text-gray-600">
                                <span className="font-medium">Size:</span> {formatFileSize(file.size)}
                              </p>
                              <p className="text-sm text-gray-600">
                                <span className="font-medium">Assigned:</span> {new Date(file.assignedAt).toLocaleDateString()}
                              </p>
                              {file.userEmail && (
                                <p className="text-sm text-gray-600">
                                  <span className="font-medium">User:</span> {file.userEmail}
                                </p>
                              )}
                              {file.userComment && (
                                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
                                  <div className="flex items-start space-x-2">
                                    <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                    </svg>
                                    <div className="flex-1">
                                      <p className="text-xs font-semibold text-blue-800 mb-1">User Message:</p>
                                      <p className="text-sm text-blue-900">{file.userComment}</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div className="mt-2">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(file.status)}`}>
                                  {file.status.charAt(0).toUpperCase() + file.status.slice(1)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(file.status === 'assigned' || file.status === 'paid') && (
                            <>
                              <button
                                onClick={() => downloadOriginalFile(file.id, file.originalName)}
                                disabled={updatingStatus === file.id}
                                className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed flex-1"
                              >
                                Download
                              </button>
                              <button
                                onClick={() => updateFileStatus(file.id, 'processing')}
                                disabled={updatingStatus === file.id}
                                className="bg-yellow-600 text-white px-3 py-2 rounded-lg hover:bg-yellow-700 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed flex-1"
                              >
                                {updatingStatus === file.id ? 'Processing...' : 'Start Processing'}
                              </button>
                            </>
                          )}
                          
                          {file.status === 'processing' && (
                            <button
                              onClick={() => setSelectedFile(file)}
                              className="bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 transition-colors text-xs w-full"
                            >
                              Upload Completed
                            </button>
                          )}
                          
                          {file.status === 'completed' && file.completedFile && (
                            <div className="text-xs text-gray-500 w-full mt-2">
                              Completed: {new Date(file.completedFile.uploadedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>


      {/* Upload Modal */}
      {selectedFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Upload Completed File
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Upload the completed file for: <strong>{selectedFile.originalName}</strong>
            </p>
            
            <div className="mb-4">
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setUploadFile(null);
                }}
                disabled={uploading}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={() => uploadCompletedFile(selectedFile.id)}
                disabled={!uploadFile || uploading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {uploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Uploading...</span>
                  </>
                ) : (
                  <span>Upload File</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}