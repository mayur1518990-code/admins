import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged, User } from 'firebase/auth';

/**
 * Hook to authenticate Firebase client SDK with admin custom token
 * This is required for real-time Firestore listeners to work
 */
export function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if Firebase auth is available
    if (!auth) {
      console.warn('[Firebase Auth] Firebase auth not initialized, skipping client auth');
      setLoading(false);
      return;
    }

    // Sign in with custom token for client-side Firebase Auth
    const signIn = async () => {
      try {
        const customToken = getCookie('admin-custom-token');
        if (!customToken) {
          console.log('[Firebase Auth] No custom token found');
          setLoading(false);
          return;
        }
        
        console.log('[Firebase Auth] Signing in with custom token...');
        const userCredential = await signInWithCustomToken(auth!, customToken);
        console.log('[Firebase Auth] Successfully authenticated:', userCredential.user.uid);
        
        // CRITICAL FIX: Get ID token after successful sign-in and update cookie
        const idToken = await userCredential.user.getIdToken();
        console.log('[Firebase Auth] Got ID token, updating cookies...');
        
        // Set ID token in cookie for API authentication
        document.cookie = `admin-token=${idToken}; path=/; max-age=3600`; // ID token expires in 1 hour
        
        // Clear custom token cookie (one-time use)
        document.cookie = `admin-custom-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
        
        setUser(userCredential.user);
        setError(null);
      } catch (err: any) {
        console.error('[Firebase Auth] Sign-in failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    // Listen to auth state changes
    const unsubscribe = onAuthStateChanged(auth!, (currentUser) => {
      if (currentUser) {
        console.log('[Firebase Auth] User authenticated:', currentUser.uid);
        setUser(currentUser);
        setLoading(false);
      } else if (getCookie('admin-custom-token')) {
        // If we have a custom token but no user, sign in
        console.log('[Firebase Auth] No current user, attempting sign-in with custom token');
        signIn();
      } else {
        console.log('[Firebase Auth] No user and no custom token');
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return { user, loading, error, isAuthenticated: !!user };
}

// Helper to get cookie value
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}


