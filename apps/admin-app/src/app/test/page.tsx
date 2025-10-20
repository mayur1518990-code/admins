"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TestPage() {
  const [loginMode, setLoginMode] = useState<'admin' | 'agent'>('admin');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (loginMode === 'admin') {
        if (email === "admin@docuploaer.com" && password === "admin123456") {
          document.cookie = "admin-token=dev_admin_token; path=/; max-age=86400";
          router.push("/");
        } else {
          setError("Invalid admin credentials");
        }
      } else {
        if (email === "agent@docuploaer.com" && password === "agent123456") {
          document.cookie = "agent-token=dev_agent_token; path=/; max-age=86400";
          router.push("/agent");
        } else {
          setError("Invalid agent credentials");
        }
      }
    } catch (error: any) {
      setError(error.message || "Login failed");
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
                  placeholder={loginMode === 'admin' ? 'admin@docuploaer.com' : 'agent@docuploaer.com'}
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
                  placeholder={loginMode === 'admin' ? 'admin123456' : 'agent123456'}
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

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Development Credentials</span>
              </div>
            </div>

            <div className="mt-6 bg-gray-50 rounded-md p-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">
                {loginMode === 'admin' ? 'Admin Credentials:' : 'Agent Credentials:'}
              </h3>
              <div className="text-sm text-gray-600">
                <p><strong>Email:</strong> {loginMode === 'admin' ? 'admin@docuploaer.com' : 'agent@docuploaer.com'}</p>
                <p><strong>Password:</strong> {loginMode === 'admin' ? 'admin123456' : 'agent123456'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
