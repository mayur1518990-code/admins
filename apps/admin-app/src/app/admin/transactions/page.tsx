"use client";

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import dynamicImport from "next/dynamic";
const Sidebar = dynamicImport(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getCached, setCached, getCacheKey, isFresh } from "@/lib/cache";

interface Transaction {
  id: string;
  userId: string;
  fileId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    phone: string | null;
  };
  file: {
    id: string;
    originalName: string;
    filename: string;
  };
}

interface TransactionStats {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalRevenue: number;
  averageTransactionValue: number;
  successRate: number;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<TransactionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "successful" | "failed" | "pending">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "pdf">("csv");
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
  
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

  // Debounce search term to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const isLoadingRef = useRef(false);
  const loadTransactions = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    
    try {
      setIsLoading(true);
      setError("");
      
      // Build query parameters
      const params = new URLSearchParams();
      
      // Map frontend filters to backend status values
      if (filter !== 'all') {
        if (filter === 'successful') {
          params.append('status', 'captured');
        } else {
          params.append('status', filter);
        }
      }
      
      // Add date filtering
      if (dateFilter !== 'all') {
        const now = new Date();
        let startDate: Date | null = null;
        
        switch (dateFilter) {
          case 'today':
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        }
        
        if (startDate) {
          params.append('startDate', startDate.toISOString());
        }
      }
      
      // Add search parameter (server-side filtering) using debounced value
      if (debouncedSearch.trim()) {
        params.append('search', debouncedSearch.trim());
      }

      // Force fresh results to avoid stale cache after new payments
      params.append('fresh', '1');
      
      // Cache key includes all parameters
      const ttlMs = 2 * 60 * 1000; // 2 minute TTL
      const cacheKey = getCacheKey(['admin-transactions', filter, dateFilter, debouncedSearch]);
      const cached = getCached<{ transactions: Transaction[]; stats: TransactionStats }>(cacheKey);
      
      if (isFresh(cached, ttlMs)) {
        setTransactions(cached!.data.transactions);
        setStats(cached!.data.stats);
        setIsLoading(false);
        isLoadingRef.current = false;
        return;
      }

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      try {
        const response = await fetch(`/api/admin/transactions?${params}`, { 
          signal: controller.signal 
        });
        clearTimeout(timeoutId);
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.message || 'Failed to load transactions');
        }
        
        // Update state with results
        setTransactions(result.transactions || []);
        setStats(result.stats || null);
        
        // Cache the results
        setCached(cacheKey, { 
          transactions: result.transactions || [], 
          stats: result.stats || null 
        });
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') {
          throw new Error('Request timeout - please try again');
        }
        throw fetchError;
      }
    } catch (error: any) {
      console.error('Error loading transactions:', error);
      setError(error.message || 'Failed to load transactions');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [filter, dateFilter, debouncedSearch]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const toggleTransactionSelection = useCallback((id: string) => {
    setSelectedTransactions(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const allSelected = useMemo(
    () => selectedTransactions.length > 0 && transactions.every(t => selectedTransactions.includes(t.id)),
    [selectedTransactions, transactions]
  );

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelectedTransactions([]);
    else setSelectedTransactions(transactions.map(t => t.id));
  }, [allSelected, transactions]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedTransactions.length === 0) return;
    const confirmed = window.confirm(`Delete ${selectedTransactions.length} selected transaction(s)? This cannot be undone.`);
    if (!confirmed) return;
    try {
      const prev = transactions;
      setTransactions(prev.filter(t => !selectedTransactions.includes(t.id)));
      const response = await fetch('/api/admin/transactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: selectedTransactions })
      });
      const result = await response.json();
      if (!result.success) {
        setTransactions(prev);
        throw new Error(result.message || 'Failed to delete selected transactions');
      }
      // Clear any client-side cache so reload pulls fresh data
      const cacheKey = getCacheKey(['admin-transactions', filter, dateFilter, debouncedSearch]);
      setCached(cacheKey, { transactions: [], stats: null as any });
      setSelectedTransactions([]);
      await loadTransactions();
      alert(result.message || 'Deleted selected transactions');
    } catch (e: any) {
      setError(e.message || 'Failed to delete selected transactions');
    }
  }, [selectedTransactions, transactions, loadTransactions]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        format: exportFormat,
        filter,
        dateFilter,
        search: searchTerm
      });
      
      const response = await fetch(`/api/admin/transactions/export?${params}`);
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${new Date().toISOString().split('T')[0]}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setShowExportModal(false);
    } catch (error: any) {
      console.error('Error exporting transactions:', error);
      setError(error.message || 'Failed to export transactions');
    }
  };

  // Server-side filtering is now handled by the API, no need for client-side filtering
  // const filteredTransactions = transactions; // Not needed anymore, use transactions directly

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'captured': // Backend returns 'captured' not 'successful'
      case 'successful':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'refunded':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <div className="flex-1 flex flex-col">
          <MobileHeader 
            title="Transaction History" 
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
          title="Transaction History" 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        />
        <main className="flex-1 p-6 mobile-app-content">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">
              Transaction History
            </h1>
            <button
              onClick={() => setShowExportModal(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
            >
              Export Data
            </button>
          </div>

          {/* Top actions row */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600">
              Selected: {selectedTransactions.length}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleDeleteSelected}
                disabled={selectedTransactions.length === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Delete Selected ({selectedTransactions.length})
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

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Transactions</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalTransactions}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Successful</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.successfulTransactions}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Revenue</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.totalRevenue)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Success Rate</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.successRate.toFixed(1)}%</p>
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
                  { key: "all", label: "All Transactions" },
                  { key: "successful", label: "Successful" },
                  { key: "failed", label: "Failed" },
                  { key: "pending", label: "Pending" },
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
                  { key: "all", label: "All Time" },
                  { key: "today", label: "Today" },
                  { key: "week", label: "This Week" },
                  { key: "month", label: "This Month" },
                ].map((dateOption) => (
                  <button
                    key={dateOption.key}
                    onClick={() => setDateFilter(dateOption.key as any)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      dateFilter === dateOption.key
                        ? "bg-green-100 text-green-700"
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
                  placeholder="Search transactions... (auto-search after typing)"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Transactions List */}
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
                      Transaction ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      File
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment ID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedTransactions.includes(transaction.id)}
                          onChange={() => toggleTransactionSelection(transaction.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {transaction.razorpayOrderId}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {transaction.user?.name || 'Unknown User'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {transaction.user?.phone || 'No phone'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {transaction.file?.originalName || 'Unknown File'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatCurrency(transaction.amount)}
                        </div>
                        <div className="text-sm text-gray-500">
                          {transaction.currency?.toUpperCase() || 'INR'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(transaction.status || 'unknown')}`}>
                          {(transaction.status || 'unknown').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {transaction.createdAt ? new Date(transaction.createdAt).toLocaleDateString() : 'Unknown Date'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {transaction.createdAt ? new Date(transaction.createdAt).toLocaleTimeString() : 'Unknown Time'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 font-mono">
                          {transaction.razorpayPaymentId || 'No Payment ID'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-4 p-4">
              {transactions.map((transaction) => (
                <div key={`mobile-${transaction.id}`} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start space-x-3 mb-3">
                    <input
                      type="checkbox"
                      checked={selectedTransactions.includes(transaction.id)}
                      onChange={() => toggleTransactionSelection(transaction.id)}
                      className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {transaction.user?.name || 'Unknown User'}
                      </h3>
                      <p className="text-xs text-gray-500">{transaction.file?.originalName || 'Unknown File'}</p>
                    </div>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(transaction.status || 'unknown')}`}>
                      {(transaction.status || 'unknown').toUpperCase()}
                    </span>
                  </div>
                  
                  <div className="space-y-1 ml-8 mt-2">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Order ID:</span> {transaction.razorpayOrderId}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Phone:</span> {transaction.user?.phone || 'No phone'}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Amount:</span> {formatCurrency(transaction.amount)} {transaction.currency?.toUpperCase() || 'INR'}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Date:</span> {transaction.createdAt ? new Date(transaction.createdAt).toLocaleDateString() : 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Payment ID:</span> {transaction.razorpayPaymentId || 'No Payment ID'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {transactions.length === 0 && !isLoading && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center mt-6">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No transactions found</h3>
              <p className="text-gray-500 mb-4">
                {searchTerm ? 'Try adjusting your search criteria' : 'No transactions have been recorded yet'}
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
            <h2 className="text-xl font-bold text-gray-900 mb-4">Export Transactions</h2>
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
                  Export will include all transactions matching current filters
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
