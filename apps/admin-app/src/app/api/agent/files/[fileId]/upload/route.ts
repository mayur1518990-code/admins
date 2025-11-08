import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { serverCache, makeKey } from '@/lib/server-cache';
import { uploadToB2 } from '@/lib/b2-storage';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId } = await params;

    // Get file information
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

    // Verify the file is in processing status
    if (fileData?.status !== 'processing') {
      return NextResponse.json({
        success: false,
        error: 'File must be in processing status to upload completed file'
      }, { status: 400 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No file provided'
      }, { status: 400 });
    }

    // Validate file
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json({
        success: false,
        error: 'File size exceeds 50MB limit'
      }, { status: 400 });
    }

    // Generate unique filename for completed file with organized folder structure
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = file.name.split('.').pop() || '';
    const completedFilename = `completed_${timestamp}_${randomString}.${extension}`;
    
    // Organize in B2: agent-uploads/{agentId}/{fileId}/{filename}
    const completedFilePath = `agent-uploads/${agent.agentId}/${fileId}/${completedFilename}`;

    try {
      // Convert file to buffer for B2 upload
      const buffer = Buffer.from(await file.arrayBuffer());

      // Upload file to Backblaze B2
      const uploadResult = await uploadToB2(completedFilePath, buffer, {
        contentType: file.type,
        originalName: file.name,
        uploadedBy: agent.agentId,
      });

      // Create completed file document with B2 metadata
      const completedFileData = {
        fileId,
        agentId: agent.agentId,
        agentName: agent.name,
        filename: completedFilename,
        originalName: file.name,
        size: file.size,
        mimeType: file.type,
        b2Key: uploadResult.key, // Store B2 key for retrieval
        b2Url: uploadResult.url, // Store B2 URL for reference
        uploadedAt: new Date(),
        createdAt: new Date()
      };

      const completedFileRef = adminDb.collection('completedFiles').doc();
      const completedFileId = completedFileRef.id;

      // Get default timer from settings
      const settingsDoc = await adminDb.collection('settings').doc('app_settings').get();
      const defaultTimerMinutes = settingsDoc.exists ? (settingsDoc.data()?.defaultEditTimerMinutes || 10) : 10;

      // OPTIMIZATION: Parallel database operations (3 operations in parallel)
      await Promise.all([
        completedFileRef.set({
          id: completedFileId,
          ...completedFileData
        }),
        adminDb.collection('files').doc(fileId).update({
          status: 'completed',
          completedFileId,
          completedAt: new Date(),
          updatedAt: new Date(),
          // Automatically start timer when file is completed
          editTimerMinutes: defaultTimerMinutes,
          editTimerStartedAt: new Date().toISOString()
        }),
        adminDb.collection('logs').add({
          action: 'file_completed',
          agentId: agent.agentId,
          agentName: agent.name,
          fileId,
          completedFileId,
          originalFileName: fileData.originalName,
          completedFileName: file.name,
          timestamp: new Date()
        })
      ]);
      // Invalidate server-side cache so fresh data is returned
      const agentFilesCacheKey = makeKey('agent-files', [agent.agentId]);
      const agentDashboardKey = makeKey('agent-dashboard', [agent.agentId, '30d']);
      const agentDashboard7dKey = makeKey('agent-dashboard', [agent.agentId, '7d']);
      const agentDashboard90dKey = makeKey('agent-dashboard', [agent.agentId, '90d']);
      
      // Clear user cache so timer appears immediately
      if (fileData.userId) {
        const userFilesCacheKey = makeKey('user_files', [fileData.userId]);
        serverCache.delete(userFilesCacheKey);
      }
      
      serverCache.delete(agentFilesCacheKey);
      serverCache.delete(agentDashboardKey);
      serverCache.delete(agentDashboard7dKey);
      serverCache.delete(agentDashboard90dKey);

      return NextResponse.json({
        success: true,
        message: 'File uploaded successfully',
        completedFileId,
        completedFileName: file.name
      });

    } catch (storageError) {
      console.error('Storage upload error:', storageError);
      return NextResponse.json({
        success: false,
        error: 'Failed to upload file to storage'
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Error uploading completed file:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}
