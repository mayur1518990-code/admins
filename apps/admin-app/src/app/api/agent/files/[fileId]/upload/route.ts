import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { uploadToB2 } from '@/lib/b2-storage';
import { serverCache, makeKey } from '@/lib/server-cache';
import { getCacheKey, deleteCached } from '@/lib/cache';

/**
 * POST handler for uploading completed files
 * Accepts FormData with file and fileId
 * Handles both first-time uploads and reuploads (for completed files)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const startTime = Date.now();
  
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId } = await params;
    
    // Parse FormData
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fileIdFromForm = formData.get('fileId') as string;

    // Validate file
    if (!file || file.size === 0) {
      return NextResponse.json({
        success: false,
        error: 'No file provided or file is empty'
      }, { status: 400 });
    }

    // Validate fileId matches
    if (fileIdFromForm && fileIdFromForm !== fileId) {
      return NextResponse.json({
        success: false,
        error: 'File ID mismatch'
      }, { status: 400 });
    }

    // Validate file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json({
        success: false,
        error: 'File size exceeds 50MB limit'
      }, { status: 400 });
    }

    // Get file information
    const fileDoc = await adminDb.collection('files').doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json({
        success: false,
        error: 'File not found'
      }, { status: 404 });
    }

    const fileData = fileDoc.data();
    
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

    // Allow upload for processing status (normal upload) or completed status (reupload)
    // Do not allow upload for replacement status (that's handled by replacement logic)
    if (fileData.status !== 'processing' && fileData.status !== 'completed') {
      return NextResponse.json({
        success: false,
        error: 'File must be in processing or completed status to upload completed file'
      }, { status: 400 });
    }

    // Check if this is a reupload (file was already completed)
    const isReupload = fileData.status === 'completed';
    const previousCompletedFileId = fileData.completedFileId;

    // Generate unique filename for completed file
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = file.name.split('.').pop() || '';
    const completedFilename = `completed_${timestamp}_${randomString}.${extension}`;
    
    // Organize in B2: agent-uploads/{agentId}/{fileId}/{filename}
    const completedFilePath = `agent-uploads/${agent.agentId}/${fileId}/${completedFilename}`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to B2
    console.log(`[UPLOAD] Uploading file to B2: ${completedFilePath}`);
    const uploadResult = await uploadToB2(completedFilePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      originalName: file.name,
      uploadedBy: agent.agentId,
      fileId: fileId
    });

    // Create completed file document with B2 metadata
    const endpoint = process.env.B2_ENDPOINT || '';
    const bucket = process.env.B2_BUCKET || '';
    const b2Url = `${endpoint}/${bucket}/${completedFilePath}`;

    const completedFileData = {
      fileId,
      agentId: agent.agentId,
      agentName: agent.name,
      filename: completedFilename,
      originalName: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      b2Key: completedFilePath,
      b2Url,
      uploadedAt: new Date(),
      createdAt: new Date()
    };

    const completedFileRef = adminDb.collection('completedFiles').doc();
    const completedFileId = completedFileRef.id;

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
      completedFileName: file.name,
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

    // Also invalidate client-side cache
    deleteCached(getCacheKey(['agent-files']));

    const elapsed = Date.now() - startTime;
    console.log(`[UPLOAD] ✅ Completed in ${elapsed}ms for file: ${fileId} (${isReupload ? 'reupload' : 'first upload'})`);

    return NextResponse.json({
      success: true,
      message: isReupload ? 'File reuploaded successfully' : 'File uploaded successfully',
      completedFileId,
      completedFileName: file.name,
      isReupload
    });

  } catch (error: any) {
    console.error('[UPLOAD] ❌ Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload file' },
      { status: 500 }
    );
  }
}

