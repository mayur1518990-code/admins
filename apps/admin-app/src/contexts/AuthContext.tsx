"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged, User } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  adminToken: string | null;
  agentToken: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  isAuthenticated: false,
  adminToken: null,
  agentToken: null,
});

// Helper to get cookie value
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

/**
 * CENTRALIZED AUTH PROVIDER
 * This runs ONCE at the root level and shares auth state with all pages
 * No multiple auth checks, no redundant requests!
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [agentToken, setAgentToken] = useState<string | null>(null);

  useEffect(() => {
    console.log('[Auth Provider] Initializing - ONE TIME CHECK');
    
    // Read tokens from cookies
    const admin = getCookie('admin-token');
    const agent = getCookie('agent-token');
    const customToken = getCookie('admin-custom-token');
    setAdminToken(admin);
    setAgentToken(agent);

    if (agent && !admin && !customToken) {
      console.log('[Auth Provider] Agent token detected, skipping Firebase auth flow');
      setLoading(false);
      return;
    }

    // If no Firebase auth available, just check cookies
    if (!auth) {
      console.log('[Auth Provider] Firebase not available, using cookie-based auth only');
      setLoading(false);
      return;
    }

    // Firebase authentication for real-time Firestore
    const signIn = async () => {
      try {
        if (!customToken) {
          console.log('[Auth Provider] No custom token found');
          setLoading(false);
          return;
        }
        
        console.log('[Auth Provider] Signing in with custom token...');
        const userCredential = await signInWithCustomToken(auth!, customToken);
        console.log('[Auth Provider] Firebase authenticated:', userCredential.user.uid);
        
        // Get ID token and update cookie
        const idToken = await userCredential.user.getIdToken();
        document.cookie = `admin-token=${idToken}; path=/; max-age=3600`;
        document.cookie = `admin-custom-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
        
        setAdminToken(idToken);
        setUser(userCredential.user);
        setError(null);
      } catch (err: any) {
        console.error('[Auth Provider] Sign-in failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    // Listen to Firebase auth state changes (runs ONCE)
    const unsubscribe = onAuthStateChanged(auth!, (currentUser) => {
      if (currentUser) {
        console.log('[Auth Provider] Firebase user authenticated:', currentUser.uid);
        setUser(currentUser);
        setLoading(false);
      } else if (customToken) {
        console.log('[Auth Provider] No Firebase user, attempting sign-in');
        signIn();
      } else {
        console.log('[Auth Provider] No Firebase user and no custom token');
        setLoading(false);
      }
    });

    return () => {
      console.log('[Auth Provider] Cleanup');
      unsubscribe();
    };
  }, []); // Empty deps = runs ONCE on mount

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user || !!adminToken || !!agentToken,
    adminToken,
    agentToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to use auth state anywhere in the app
 * NO additional requests, just reads from context!
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}


