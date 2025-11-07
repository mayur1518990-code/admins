"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function AgentLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { agentToken, loading } = useAuth();
  
  // Redirect if already authenticated (uses centralized auth - no extra requests!)
  useEffect(() => {
    if (loading) return; // Wait for auth to load
    
    if (agentToken && agentToken !== 'undefined') {
      console.log('[Agent Login] Already authenticated, redirecting...');
      router.push('/agent');
    }
  }, [agentToken, loading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      // Call the real agent login API
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
        // Redirect to agent dashboard
        window.location.href = "/agent";
      } else {
        setError(result.error || "Invalid credentials");
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

  // Safety auth timeout if UI gets stuck
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false);
        setError("Login timed out. Please try again.");
      }
    }, 10000);
    return () => clearTimeout(t);
  }, [isLoading]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">
            Agent Portal
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            File Processing System
          </p>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleLogin}>
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
                  placeholder="Enter your email"
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
                {isLoading ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Need Help?</span>
              </div>
            </div>

            <div className="mt-6 bg-blue-50 rounded-md p-4">
              <h3 className="text-sm font-medium text-blue-900 mb-2">Agent Access:</h3>
              <div className="text-sm text-blue-700">
                <p>Use the credentials provided by your administrator to login.</p>
                <p className="mt-1">Contact admin if you need access or password reset.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={() => router.push('/')}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              ← Back to Main Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
