import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Try to import Firebase Admin
    const { adminAuth } = await import('@/lib/firebase-admin');
    
    // Try to create a test custom token
    const testToken = await adminAuth.createCustomToken('test-user-id');
    
    return NextResponse.json({
      success: true,
      message: 'Firebase Admin SDK is working correctly',
      tokenPreview: testToken.substring(0, 50) + '...',
      tokenLength: testToken.length,
    });
    
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      errorCode: error.code,
      errorStack: error.stack?.split('\n').slice(0, 5),
    }, { status: 500 });
  }
}

