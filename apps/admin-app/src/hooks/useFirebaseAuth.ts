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
    // Check if admin is logged in via cookie
    const customToken = getCookie('admin-token');
    
    if (!customToken || customToken === 'undefined') {
      console.log('[Firebase Auth] No admin token found, skipping client auth');
      setLoading(false);
      return;
    }

    // Sign in with custom token for client-side Firebase Auth
    const signIn = async () => {
      try {
        console.log('[Firebase Auth] Signing in with custom token...');
        const userCredential = await signInWithCustomToken(auth!, customToken);
        console.log('[Firebase Auth] Successfully authenticated:', userCredential.user.uid);
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
      } else if (customToken) {
        // If we have a token but no user, sign in
        signIn();
      } else {
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


