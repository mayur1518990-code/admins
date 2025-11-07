import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { generatePresignedDownloadUrl } from '@/lib/b2-storage';

/**
 * OPTIMIZED: Generate pre-signed download URL (instant response <100ms)
 * Instead of streaming file through server, return a direct B2 download URL
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const startTime = Date.now();
  
  try {
    // Verify agent authentication (cached, ~5-20ms)
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId } = await params;

    // Get file information (single query, ~20-50ms)
    const fileDoc = await adminDb.collection('files').doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json({
        success: false,
        error: 'File not found'
      }, { status: 404 });
    }

    const fileData = fileDoc.data();
    
    // Verify the file is assigned to this agent
    if (fileData?.assignedAgentId !== agent.agentId) {
      return NextResponse.json({
        success: false,
        error: 'File not assigned to you'
      }, { status: 403 });
    }

    // Get B2 key (priority: b2Key -> filePath -> error)
    const b2Key = fileData!.b2Key || fileData!.filePath;
    
    if (!b2Key) {
      // Legacy database files not supported for pre-signed URLs
      return NextResponse.json({
        success: false,
        error: 'File is stored in legacy format. Please use regular download.'
      }, { status: 400 });
    }

    // Generate pre-signed URL with Content-Disposition header (fast, ~10-30ms)
    const downloadUrl = await generatePresignedDownloadUrl(b2Key, fileData!.originalName, 3600); // 1 hour expiry

    const elapsed = Date.now() - startTime;
    console.log(`[DOWNLOAD-URL] Generated in ${elapsed}ms for file: ${fileId}`);

    return NextResponse.json({
      success: true,
      downloadUrl,
      filename: fileData!.originalName,
      expiresIn: 3600
    });

  } catch (error: any) {
    console.error('Error generating download URL:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate download URL' },
      { status: 500 }
    );
  }
}

