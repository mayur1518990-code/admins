import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { deleteCached, getCacheKey } from '@/lib/cache';
import { serverCache, makeKey } from '@/lib/server-cache';

export async function PATCH(
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
    const { status } = await request.json();

    if (!status || !['processing', 'completed'].includes(status)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid status. Must be "processing" or "completed"'
      }, { status: 400 });
    }

    // Verify the file is assigned to this agent
    const fileDoc = await adminDb.collection('files').doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json({
        success: false,
        error: 'File not found'
      }, { status: 404 });
    }

    const fileData = fileDoc.data();
    if (fileData?.assignedAgentId !== agent.agentId) {
      return NextResponse.json({
        success: false,
        error: 'File not assigned to you'
      }, { status: 403 });
    }

    // Update file status
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (status === 'processing') {
      updateData.processingStartedAt = new Date();
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    // OPTIMIZATION: Parallel operations (update + log)
    await Promise.all([
      adminDb.collection('files').doc(fileId).update(updateData),
      adminDb.collection('logs').add({
        action: 'file_status_updated',
        agentId: agent.agentId,
        agentName: agent.name,
        fileId,
        oldStatus: fileData.status,
        newStatus: status,
        timestamp: new Date()
      })
    ]);

    // Invalidate user-app cache for this user's files so processing reflects quickly
    if (fileData?.userId) {
      const cacheKey = getCacheKey(['user_files', fileData.userId]);
      deleteCached(cacheKey);
    }

    // NOTE: No server-side cache invalidation for status updates
    // We use optimistic updates on the frontend instead of full refresh

    return NextResponse.json({
      success: true,
      message: `File status updated to ${status}`,
      status
    });

  } catch (error: any) {
    console.error('Error updating file status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update file status' },
      { status: 500 }
    );
  }
}
