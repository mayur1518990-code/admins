import { NextResponse } from 'next/server';

export async function GET() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  
  return NextResponse.json({
    // Client-side Firebase (NEXT_PUBLIC_*)
    hasFirebaseApiKey: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    hasFirebaseProjectId: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    hasFirebaseAuthDomain: !!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    hasFirebaseStorageBucket: !!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    
    // Server-side Firebase Admin SDK
    hasServerProjectId: !!process.env.FIREBASE_PROJECT_ID,
    hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
    hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    
    // Private key details (for debugging)
    privateKeyLength: privateKey.length,
    privateKeyStartsWith: privateKey.substring(0, 30),
    privateKeyHasBegin: privateKey.includes('BEGIN PRIVATE KEY'),
    privateKeyHasNewlines: privateKey.includes('\n'),
    privateKeyHasEscapedNewlines: privateKey.includes('\\n'),
    
    // Other services
    hasB2KeyId: !!process.env.B2_KEY_ID,
    
    // Show values (first part only for security)
    clientApiKeyPreview: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.substring(0, 10),
    clientProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    serverProjectId: process.env.FIREBASE_PROJECT_ID,
    clientEmailPreview: process.env.FIREBASE_CLIENT_EMAIL?.substring(0, 20),
  });
}

