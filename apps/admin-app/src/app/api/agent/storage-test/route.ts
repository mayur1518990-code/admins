import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';

export async function GET(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Test database storage configuration
    const filesSnapshot = await adminDb.collection('files').limit(1).get();
    const completedFilesSnapshot = await adminDb.collection('completedFiles').limit(1).get();
    
    return NextResponse.json({
      success: true,
      storage: {
        type: 'database',
        accessible: true,
        filesCount: filesSnapshot.size,
        completedFilesCount: completedFilesSnapshot.size,
        message: 'Database storage is properly configured'
      }
    });

  } catch (error: any) {
    console.error('Storage test error:', error);
    return NextResponse.json({
      success: false,
      error: 'Storage test failed',
      details: error.message,
      storage: {
        type: 'database',
        accessible: false,
        message: 'Database storage configuration issue'
      }
    }, { status: 500 });
  }
}
