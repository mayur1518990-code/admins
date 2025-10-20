import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { serverCache, makeKey } from '@/lib/server-cache';

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

    // Generate unique filename for completed file
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = file.name.split('.').pop() || '';
    const completedFilename = `completed_${timestamp}_${randomString}.${extension}`;
    const completedFilePath = `completed/${fileId}/${completedFilename}`;

    try {
      // Convert file to buffer and then to base64 for database storage
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileContent = buffer.toString('base64');

      // Create completed file document with content stored in database
      const completedFileData = {
        fileId,
        agentId: agent.agentId,
        agentName: agent.name,
        filename: completedFilename,
        originalName: file.name,
        size: file.size,
        mimeType: file.type,
        fileContent: fileContent, // Store file content in database
        uploadedAt: new Date(),
        createdAt: new Date()
      };

      const completedFileRef = adminDb.collection('completedFiles').doc();
      const completedFileId = completedFileRef.id;

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
          updatedAt: new Date()
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
      serverCache.delete(agentFilesCacheKey);

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
