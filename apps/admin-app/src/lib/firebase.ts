import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if config is valid
const isConfigValid = Object.values(firebaseConfig).every(value => value && value !== 'undefined');

if (!isConfigValid) {
  console.warn('Firebase configuration is incomplete. Some features may not work properly.');
}

// Initialize Firebase with error handling
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

// Only initialize if we're in a browser environment or have valid config
if (typeof window !== 'undefined' || isConfigValid) {
  try {
    // Use existing app if available to prevent multiple initializations
    const existingApps = getApps();
    if (existingApps.length > 0) {
      app = existingApps[0];
    } else if (isConfigValid) {
      app = initializeApp(firebaseConfig);
    }
    
    // Initialize services only if app was created
    if (app) {
      auth = getAuth(app);
      db = getFirestore(app);
    }
    
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    // Don't throw during build - just log the error
    if (typeof window !== 'undefined') {
      console.warn('Firebase will not be available. Please check your configuration.');
    }
  }
}

// Export services (may be undefined during build)
export { auth, db };
export default app as FirebaseApp;


