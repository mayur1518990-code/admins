import { NextResponse } from "next/server";

export async function GET() {
  // Check server-side config (Admin SDK)
  const serverConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID || 'MISSING',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || 'MISSING',
    hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length || 0,
  };

  // Check client-side config (Web SDK)
  const clientConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? 'SET' : 'MISSING',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'MISSING',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'MISSING',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'MISSING',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || 'MISSING',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? 'SET' : 'MISSING',
  };

  // Check for mismatches
  const projectIdMatch = serverConfig.projectId === clientConfig.projectId;

  return NextResponse.json({
    status: 'Configuration Check',
    serverConfig,
    clientConfig,
    validation: {
      projectIdMatch,
      allServerVarsSet: Object.values(serverConfig).every(v => v !== 'MISSING' && v !== false && v !== 0),
      allClientVarsSet: Object.values(clientConfig).every(v => v !== 'MISSING'),
    },
    issues: [
      ...(!projectIdMatch ? ['❌ PROJECT ID MISMATCH - Server and client project IDs must match!'] : []),
      ...(serverConfig.projectId === 'MISSING' ? ['❌ FIREBASE_PROJECT_ID not set'] : []),
      ...(serverConfig.clientEmail === 'MISSING' ? ['❌ FIREBASE_CLIENT_EMAIL not set'] : []),
      ...(!serverConfig.hasPrivateKey ? ['❌ FIREBASE_PRIVATE_KEY not set'] : []),
      ...(clientConfig.apiKey === 'MISSING' ? ['❌ NEXT_PUBLIC_FIREBASE_API_KEY not set'] : []),
      ...(clientConfig.projectId === 'MISSING' ? ['❌ NEXT_PUBLIC_FIREBASE_PROJECT_ID not set'] : []),
    ]
  }, {
    headers: {
      'Cache-Control': 'no-store',
    }
  });
}

