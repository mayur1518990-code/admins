import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
// Handle both true multiline and "\n"-escaped private keys
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
  .replace(/^"|"$/g, '')
  .replace(/\\n/g, '\n');

const firebaseAdminConfig = {
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
};

// Initialize Firebase Admin
const adminApp = getApps().length === 0 ? initializeApp(firebaseAdminConfig) : getApps()[0];

// Initialize Firebase Admin services
// Note: Firebase Storage has been replaced with Backblaze B2
// All file operations now use the b2-storage utility
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);

export default adminApp;
