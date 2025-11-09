import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { serverCache, makeKey } from '@/lib/server-cache';
import { fileExistsInB2 } from '@/lib/b2-storage';

/**
 * OPTIMIZED: Confirm that upload was completed (fast, <200ms)
 * Called after browser uploads directly to B2 via pre-signed URL
 */
export async function POST(
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
    const body = await request.json();
    const { b2Key, completedFilename, originalName, size, mimeType } = body;

    if (!b2Key || !completedFilename || !originalName) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields'
      }, { status: 400 });
    }

    // Verify file exists in B2 (quick check)
    const exists = await fileExistsInB2(b2Key);
    if (!exists) {
      return NextResponse.json({
        success: false,
        error: 'File not found in storage. Upload may have failed.'
      }, { status: 404 });
    }

    // Get file information
    const fileDoc = await adminDb.collection('files').doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json({
        success: false,
        error: 'File record not found'
      }, { status: 404 });
    }

    const fileData = fileDoc.data();
    
    // Verify fileData exists
    if (!fileData) {
      return NextResponse.json({
        success: false,
        error: 'File data not found'
      }, { status: 404 });
    }
    
    // Verify the file is assigned to this agent
    if (fileData.assignedAgentId !== agent.agentId) {
      return NextResponse.json({
        success: false,
        error: 'File not assigned to you'
      }, { status: 403 });
    }

    // Create completed file document with B2 metadata
    const endpoint = process.env.B2_ENDPOINT || '';
    const bucket = process.env.B2_BUCKET || '';
    const b2Url = `${endpoint}/${bucket}/${b2Key}`;

    const completedFileData = {
      fileId,
      agentId: agent.agentId,
      agentName: agent.name,
      filename: completedFilename,
      originalName,
      size: size || 0,
      mimeType: mimeType || 'application/octet-stream',
      b2Key,
      b2Url,
      uploadedAt: new Date(),
      createdAt: new Date()
    };

    const completedFileRef = adminDb.collection('completedFiles').doc();
    const completedFileId = completedFileRef.id;

    // Check if this is a reupload (file was already completed)
    const isReupload = fileData.status === 'completed';
    const previousCompletedFileId = fileData.completedFileId;

    // Get default timer from settings
    const settingsDoc = await adminDb.collection('settings').doc('app_settings').get();
    const defaultTimerMinutes = settingsDoc.exists ? (settingsDoc.data()?.defaultEditTimerMinutes || 10) : 10;

    // Prepare file update data
    // For reuploads, keep status as 'completed' (don't change to replacement)
    const fileUpdateData: any = {
      completedFileId,
      completedAt: new Date(),
      updatedAt: new Date(),
    };

    // Only update status if it's not already completed (first-time completion)
    if (!isReupload) {
      fileUpdateData.status = 'completed';
      // Automatically start timer when file is completed for the first time
      fileUpdateData.editTimerMinutes = defaultTimerMinutes;
      fileUpdateData.editTimerStartedAt = new Date().toISOString();
    }

    // Prepare log data (avoid undefined values for Firestore)
    const logData: any = {
      action: isReupload ? 'file_reuploaded' : 'file_completed',
      agentId: agent.agentId,
      agentName: agent.name,
      fileId,
      completedFileId,
      originalFileName: fileData.originalName,
      completedFileName: originalName,
      timestamp: new Date()
    };
    
    // Only include previousCompletedFileId if it exists (for reuploads)
    if (isReupload && previousCompletedFileId) {
      logData.previousCompletedFileId = previousCompletedFileId;
    }

    // OPTIMIZATION: Parallel database operations
    await Promise.all([
      completedFileRef.set({
        id: completedFileId,
        ...completedFileData
      }),
      adminDb.collection('files').doc(fileId).update(fileUpdateData),
      adminDb.collection('logs').add(logData)
    ]);

    // Invalidate server-side cache so fresh data is returned
    const agentFilesCacheKey = makeKey('agent-files', [agent.agentId]);
    const agentDashboardKey = makeKey('agent-dashboard', [agent.agentId, '30d']);
    const agentDashboard7dKey = makeKey('agent-dashboard', [agent.agentId, '7d']);
    const agentDashboard90dKey = makeKey('agent-dashboard', [agent.agentId, '90d']);
    
    serverCache.delete(agentFilesCacheKey);
    serverCache.delete(agentDashboardKey);
    serverCache.delete(agentDashboard7dKey);
    serverCache.delete(agentDashboard90dKey);
    
    // Clear user cache so timer appears immediately
    if (fileData.userId) {
      const userFilesCacheKey = makeKey('user_files', [fileData.userId]);
      serverCache.delete(userFilesCacheKey);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[CONFIRM-UPLOAD] Completed in ${elapsed}ms for file: ${fileId}`);

    return NextResponse.json({
      success: true,
      message: 'File upload confirmed and processed',
      completedFileId,
      completedFileName: originalName
    });

  } catch (error: any) {
    console.error('Error confirming upload:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to confirm upload' },
      { status: 500 }
    );
  }
}

