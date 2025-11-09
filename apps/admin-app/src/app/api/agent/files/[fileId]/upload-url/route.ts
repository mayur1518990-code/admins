import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { generatePresignedUploadUrl } from '@/lib/b2-storage';

/**
 * OPTIMIZED: Generate pre-signed upload URL (instant response <100ms)
 * Returns a URL that the browser can upload directly to B2
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const startTime = Date.now();
  
  try {
    console.log('[UPLOAD-URL] Starting pre-signed URL generation...');
    
    // Verify agent authentication (cached, ~5-20ms)
    const agent = await verifyAgentAuth();
    if (!agent) {
      console.error('[UPLOAD-URL] Unauthorized');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId } = await params;
    const body = await request.json();
    const { filename, contentType, fileSize } = body;
    
    console.log('[UPLOAD-URL] Request details:', { fileId, filename, contentType, fileSize, agentId: agent.agentId });

    if (!filename || !contentType) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: filename, contentType'
      }, { status: 400 });
    }

    // Validate file size
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (fileSize && fileSize > maxSize) {
      return NextResponse.json({
        success: false,
        error: 'File size exceeds 50MB limit'
      }, { status: 400 });
    }

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

    // Allow upload for processing status (normal upload) or completed status (reupload)
    // Do not allow upload for replacement status (that's handled by replacement logic)
    if (fileData?.status !== 'processing' && fileData?.status !== 'completed') {
      return NextResponse.json({
        success: false,
        error: 'File must be in processing or completed status to upload completed file'
      }, { status: 400 });
    }

    // Generate unique filename for completed file
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = filename.split('.').pop() || '';
    const completedFilename = `completed_${timestamp}_${randomString}.${extension}`;
    
    // Organize in B2: agent-uploads/{agentId}/{fileId}/{filename}
    const completedFilePath = `agent-uploads/${agent.agentId}/${fileId}/${completedFilename}`;

    // Generate pre-signed upload URL (fast, ~10-30ms)
    console.log('[UPLOAD-URL] Generating pre-signed URL for:', completedFilePath);
    const uploadUrl = await generatePresignedUploadUrl(completedFilePath, contentType, 3600); // 1 hour expiry

    const elapsed = Date.now() - startTime;
    console.log(`[UPLOAD-URL] ✅ Generated successfully in ${elapsed}ms for file: ${fileId}`);

    return NextResponse.json({
      success: true,
      uploadUrl,
      b2Key: completedFilePath,
      completedFilename,
      expiresIn: 3600
    });

  } catch (error: any) {
    console.error('[UPLOAD-URL] ❌ Error generating upload URL:', error);
    console.error('[UPLOAD-URL] Error stack:', error.stack);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate upload URL' },
      { status: 500 }
    );
  }
}

