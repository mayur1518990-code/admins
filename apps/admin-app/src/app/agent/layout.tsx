"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

// This layout wraps ALL /agent/* pages and handles authentication
// Auth check happens ONCE in AuthProvider (no redundant requests!)
export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { agentToken, loading } = useAuth();

  useEffect(() => {
    // Wait for auth to finish loading
    if (loading) {
      return;
    }

    // Check if agent token exists
    if (!agentToken || agentToken === 'undefined') {
      console.log('[Agent Layout] No agent token, redirecting to login...');
      // Clear any stale tokens
      document.cookie = 'agent-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      
      // Redirect to agent login
      router.push('/agent/login');
      return;
    }

    console.log('[Agent Layout] Agent authenticated ✓');
  }, [agentToken, loading, router]);

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
  if (!agentToken || agentToken === 'undefined') {
    return null;
  }

  // Agent is authenticated, render the agent pages
  return <>{children}</>;
}

