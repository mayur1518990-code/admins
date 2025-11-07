"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

// Unified Login Form Component
function UnifiedLoginForm() {
  const [loginMode, setLoginMode] = useState<'admin' | 'agent'>('admin');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { adminToken, agentToken, loading } = useAuth();
  
  // Redirect if already authenticated (uses centralized auth - no extra requests!)
  useEffect(() => {
    if (loading) return; // Wait for auth to load
    
    if (adminToken && adminToken !== 'undefined') {
      console.log('[Login] Already authenticated as admin, redirecting...');
      router.push('/dashboard');
    } else if (agentToken && agentToken !== 'undefined') {
      console.log('[Login] Already authenticated as agent, redirecting...');
      router.push('/agent');
    }
  }, [adminToken, agentToken, loading, router]);

  // OPTIMIZED: Add request timeout and improved error handling
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      if (loginMode === 'admin') {
        const response = await fetch('/api/admin/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const result = await response.json();

        if (result.success) {
          // Set admin custom token cookie (temporary, will be replaced with ID token after Firebase sign-in)
          document.cookie = `admin-token=${result.data.customToken}; path=/; max-age=86400`;
          document.cookie = `admin-custom-token=${result.data.customToken}; path=/; max-age=3600`; // Custom token expires in 1 hour
          // Store admin info in localStorage
          localStorage.setItem('adminId', result.data.adminId);
          localStorage.setItem('adminName', result.data.name);
          localStorage.setItem('adminEmail', result.data.email);
          // Force page reload to show dashboard
          window.location.href = "/dashboard";
        } else {
          setError(result.error || "Invalid admin credentials");
        }
      } else {
        // Agent login logic
        const response = await fetch('/api/agent/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const result = await response.json();

        if (result.success) {
          // Set agent token cookie
          document.cookie = `agent-token=${result.data.customToken}; path=/; max-age=86400`;
          // Store agent info in localStorage
          localStorage.setItem('agentId', result.data.agentId);
          localStorage.setItem('agentName', result.data.name);
          localStorage.setItem('agentEmail', result.data.email);
          // Force page reload to show agent dashboard
          window.location.href = "/agent";
        } else {
          setError(result.error || "Invalid agent credentials");
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setError("Login timed out. Please try again.");
      } else {
        setError(error.message || "Login failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = (mode: 'admin' | 'agent') => {
    setLoginMode(mode);
    setEmail("");
    setPassword("");
    setError("");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">
            {loginMode === 'admin' ? 'Admin Portal' : 'Agent Portal'}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {loginMode === 'admin' ? 'Document Management System' : 'File Processing System'}
          </p>
        </div>
        
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {/* Mode Toggle */}
          <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
            <button
              onClick={() => switchMode('admin')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                loginMode === 'admin'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              👑 Admin
            </button>
            <button
              onClick={() => switchMode('agent')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                loginMode === 'agent'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              🤖 Agent
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Enter your email address"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Enter your password"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Signing in..." : `Sign in as ${loginMode === 'admin' ? 'Admin' : 'Agent'}`}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    // Check authentication
    const adminToken = document.cookie.includes('admin-token');
    const agentToken = document.cookie.includes('agent-token');
    
    if (adminToken) {
      // Redirect to admin dashboard
      window.location.href = '/dashboard';
    } else if (agentToken) {
      // Redirect to agent dashboard
      window.location.href = '/agent';
    } else {
      // Show login form
      setIsAuthenticated(false);
      setCheckingAuth(false);
    }
  }, []);

  if (checkingAuth) {
  return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
    </div>
  );
}

  // Show login form if not authenticated
  return <UnifiedLoginForm />;
}