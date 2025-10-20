'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCached, setCached, getCacheKey, isFresh } from '@/lib/cache';

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
  const [selectedFile, setSelectedFile] = useState<AssignedFile | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'assigned' | 'processing' | 'completed' | 'paid'>('all');

  // OPTIMIZATION: Add client-side caching with useCallback
  const fetchAssignedFiles = useCallback(async (forceRefresh = false) => {
    const startTime = Date.now();
    
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
        console.log(`[DEBUG] Force refresh requested - bypassing cache`);
      }
      
      const fetchStart = Date.now();
      const response = await fetch('/api/agent/files');
      const data = await response.json();

      if (data.success) {
        console.log(`[DEBUG] API returned ${data.files.length} files`);
        console.log(`[DEBUG] File statuses:`, data.files.map((f: any) => ({ id: f.id, status: f.status, name: f.originalName })));
        
        setFiles(data.files);
        calculateStats(data.files);
        
        // Cache the result
        setCached(cacheKey, { files: data.files });
        console.log(`[DEBUG] Files loaded:`, data.files.length);
        console.log(`[DEBUG] File statuses:`, data.files.map((f: any) => ({ id: f.id, status: f.status })));
      } else {
        console.error('Failed to fetch files:', data.error);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps - stable callback

  useEffect(() => {
    fetchAssignedFiles();
  }, [fetchAssignedFiles]);

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
      console.error('Logout API error:', error);
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
    const startTime = Date.now();
    setUpdatingStatus(fileId);
    
    try {
      const response = await fetch(`/api/agent/files/${fileId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status })
      });

      const data = await response.json();
      
      if (data.success) {
        // FIXED: Switch to 'All Files' view so user can see the status change
        if (status === 'processing') {
          setStatusFilter('all');
        }
        
        // Optimistic update - update UI immediately without full refresh
        setFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, status } : file
        ));
        
        // Recalculate stats with the updated file
        setFiles(prev => {
          const updatedFiles = prev.map(file => 
            file.id === fileId ? { ...file, status } : file
          );
          calculateStats(updatedFiles);
          return updatedFiles;
        });
        
        // Show success notification immediately (no refresh needed)
        const statusMessage = status === 'processing' 
          ? 'File status updated to Processing! ✅\n\nProcessing count increased. You can now upload the completed file.'
          : 'File marked as Completed! ✅';
        alert(statusMessage);
        console.log(`[DEBUG] File ${fileId} status changed to: ${status}`);
      } else {
        console.error('Failed to update status:', data.error);
        alert('Failed to update file status. Please try again.');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Error updating file status. Please try again.');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const downloadOriginalFile = async (fileId: string, filename: string) => {
    try {
      console.log(`[AGENT-DOWNLOAD] Attempting to download file ${fileId} with name ${filename}`);
      const response = await fetch(`/api/agent/files/${fileId}/download`);
      console.log(`[AGENT-DOWNLOAD] Response status: ${response.status}`);
      
      if (response.ok) {
        const blob = await response.blob();
        console.log(`[AGENT-DOWNLOAD] Blob size: ${blob.size} bytes`);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        console.log(`[AGENT-DOWNLOAD] Download completed successfully`);
      } else {
        const errorData = await response.json();
        console.error(`[AGENT-DOWNLOAD] Download failed:`, errorData);
        alert(`Download failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[AGENT-DOWNLOAD] Error downloading file:', error);
      alert('Error downloading file. Please check console for details.');
    }
  };

  const uploadCompletedFile = async (fileId: string) => {
    if (!uploadFile || uploading) return;

    const startTime = Date.now();
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('fileId', fileId);

      const response = await fetch(`/api/agent/files/${fileId}/upload`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      
      if (data.success) {
        console.log(`[DEBUG] Upload successful, refreshing data...`);
        setUploadFile(null);
        setSelectedFile(null);
        
        // FIXED: Await the refresh BEFORE showing alert so stats update first
        await fetchAssignedFiles(true);
        console.log(`[DEBUG] Data refresh completed after upload`);
        
        // Now show the alert after data is refreshed
        alert('File uploaded successfully! ✅\n\nThe page has been refreshed and your Completed count has been updated.');
      } else {
        console.error('Failed to upload file:', data.error);
        alert('Failed to upload file');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error uploading file');
    } finally {
      setUploading(false);
    }
  };


  const filteredFiles = files.filter(file => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'assigned') return file.status === 'assigned' || file.status === 'paid';
    return file.status === statusFilter;
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

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
            <h2 className="text-lg font-semibold text-gray-900">Assigned Files</h2>
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
            <div className="divide-y divide-gray-200">
              {filteredFiles.map((file) => (
                <div key={file.id} className="p-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-4">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                        </div>
                        
                        <div className="flex-1 min-w-0">
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