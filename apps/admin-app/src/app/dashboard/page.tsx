"use client";

// Force dynamic rendering for authenticated pages
export const dynamic = 'force-dynamic';

import dynamicImport from "next/dynamic";
const Sidebar = dynamicImport(() => import("@/components/AdminSidebar").then(m => m.Sidebar), { ssr: false });
const DashboardStats = dynamicImport(() => import("@/components/DashboardStats").then(m => m.DashboardStats));
const RecentActivity = dynamicImport(() => import("@/components/RecentActivity").then(m => m.RecentActivity));
const QuickActions = dynamicImport(() => import("@/components/QuickActions").then(m => m.QuickActions));
import { MobileHeader } from "@/components/MobileHeader";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getCached, setCached, getCacheKey, isFresh } from "@/lib/cache";

interface DashboardData {
  overview: {
    totalUsers: number;
    activeUsers: number;
    newUsers: number;
    totalAgents: number;
    activeAgents: number;
    newAgents: number;
    totalFiles: number;
    newFiles: number;
    unassignedFiles: number;
    totalPayments: number;
    successfulPayments: number;
    newPayments: number;
    totalRevenue: number;
    newRevenue: number;
  };
  files: {
    total: number;
    byStatus: Record<string, number>;
    new: number;
    unassigned: number;
    completionRate: string;
  };
  payments: {
    total: number;
    successful: number;
    new: number;
    totalRevenue: number;
    newRevenue: number;
    successRate: string;
  };
  agents: {
    total: number;
    active: number;
    new: number;
    performance: Array<{
      id: string;
      name: string;
      email: string;
      totalFiles: number;
      completedFiles: number;
      pendingFiles: number;
      completionRate: string;
    }>;
  };
  activity: {
    recent: Array<{
      id: string;
      actionType: string;
      actorId: string;
      actorType: string;
      timestamp: Date;
      details: any;
    }>;
    dailyStats: Array<{
      date: string;
      files: number;
      payments: number;
      revenue: number;
      users: number;
    }>;
  };
}

export default function AdminDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState('30d');
  
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

  useEffect(() => {
    // Check if user is authenticated
    const adminToken = document.cookie.includes('admin-token');
    if (!adminToken) {
      window.location.href = '/';
      return;
    }
    
    loadDashboardData();
  }, [period]);

  const isLoadingRef = useRef(false);
  const loadDashboardData = useCallback(async (forceRefresh = false) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      // OPTIMIZED: Don't show full-screen loading if we have cached data
      const ttlMs = 2 * 60 * 1000; // 2 minutes (matching server cache)
      const cacheKey = getCacheKey(['admin-dashboard', period]);
      
      // Check cache FIRST before showing loading
      if (!forceRefresh) {
        const cached = getCached<DashboardData>(cacheKey);
        if (isFresh(cached, ttlMs)) {
          setDashboardData(cached!.data);
          setError("");
          setIsLoading(false);
          isLoadingRef.current = false;
          return; // Return from cache, no API call!
        }
      }
      
      // Only show loading if no cached data
      if (!dashboardData) {
        setIsLoading(true);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Reduced from 20s to 15s
      const response = await fetch(`/api/admin/dashboard?period=${period}`, { signal: controller.signal });
      const result = await response.json();
      
      if (result.success) {
        setDashboardData(result);
        setError("");
        setCached(cacheKey, result); // Cache for next time
      } else {
        setError(result.message || 'Failed to load dashboard data');
      }
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error('Dashboard error:', err);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [period]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Dashboard</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={() => loadDashboardData()}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-app-container bg-gray-50 flex flex-col md:flex-row">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="flex-1 flex flex-col">
        <MobileHeader 
          title="Admin Dashboard" 
          onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
        />
        <main className="flex-1 p-6 mobile-app-content">
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-3xl font-bold text-gray-900 hidden md:block">
                Admin Dashboard
              </h1>
            <div className="flex space-x-2">
              {['7d', '30d', '90d'].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    period === p
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
                </button>
              ))}
              <button 
                onClick={() => loadDashboardData(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Refresh Data
              </button>
            </div>
          </div>
          
          {dashboardData && (
            <>
              <DashboardStats data={dashboardData} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
                <RecentActivity activities={dashboardData.activity.recent.map(a => ({ ...a, timestamp: a.timestamp.toISOString() }))} />
                <QuickActions />
              </div>
            </>
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
