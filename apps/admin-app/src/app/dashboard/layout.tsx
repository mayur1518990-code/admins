"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

// This layout wraps the /dashboard page and handles authentication
// Auth check happens ONCE in AuthProvider (no redundant requests!)
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { adminToken, loading } = useAuth();

  useEffect(() => {
    // Wait for auth to finish loading
    if (loading) {
      return;
    }

    // Check if admin token exists
    if (!adminToken || adminToken === 'undefined') {
      console.log('[Dashboard Layout] No admin token, redirecting to login...');
      // Clear any stale tokens
      document.cookie = 'admin-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'admin-custom-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      
      // Redirect to login
      router.push('/');
      return;
    }

    console.log('[Dashboard Layout] Admin authenticated ✓');
  }, [adminToken, loading, router]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, don't render anything (will redirect)
  if (!adminToken || adminToken === 'undefined') {
    return null;
  }

  // User is authenticated, render the dashboard
  return <>{children}</>;
}

