import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { findAgentFiles } from '@/lib/agent-utils';
import { serverCache, makeKey } from '@/lib/server-cache';

// DELETE method for deleting multiple files
export async function DELETE(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileIds } = body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files selected for deletion' },
        { status: 400 }
      );
    }

    // Verify that all files belong to this agent
    const agentFiles = await findAgentFiles(agent.agentId);
    const agentFileIds = agentFiles.map(f => f.id);
    
    const unauthorizedFiles = fileIds.filter(id => !agentFileIds.includes(id));
    if (unauthorizedFiles.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Some files do not belong to this agent' },
        { status: 403 }
      );
    }

    // Delete files from database
    const batch = adminDb.batch();
    let deletedCount = 0;

    for (const fileId of fileIds) {
      const fileRef = adminDb.collection('files').doc(fileId);
      batch.delete(fileRef);
      deletedCount++;
    }

    await batch.commit();

    // Clear cache
    const cacheKey = makeKey('agent-files', [agent.agentId]);
    serverCache.delete(cacheKey);

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${deletedCount} file(s)`
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete files' },
      { status: 500 }
    );
  }
}

// OPTIMIZED: Get agent files with caching, batch user/completed file fetching
export async function GET(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check for fresh parameter to bypass cache
    const searchParams = request.nextUrl.searchParams;
    const fresh = searchParams.get('fresh') === '1';

    // Check cache first (unless fresh data is requested)
    const cacheKey = makeKey('agent-files', [agent.agentId]);
    if (!fresh) {
      const cached = serverCache.get<{ files: any[] }>(cacheKey);
      if (cached) {
        return NextResponse.json({
          success: true,
          files: cached.files
        });
      }
    }

    // Use the utility function to find files with multiple ID formats
    const agentFiles = await findAgentFiles(agent.agentId);

    // Convert to the format expected by the rest of the function
    const filesSnapshot = {
      docs: agentFiles.map(file => ({
        id: file.id,
        data: () => file
      }))
    };

    // OPTIMIZED: Batch fetch all user data (fixes N+1 query problem)
    const userIds = [...new Set(filesSnapshot.docs.map(doc => doc.data().userId).filter(Boolean))];
    const completedFileIds = filesSnapshot.docs
      .map(doc => doc.data().completedFileId)
      .filter(Boolean);

    // Batch fetch users
    const userMap = new Map<string, any>();
    if (userIds.length > 0) {
      const userPromises = userIds.map(userId => 
        adminDb.collection('users').doc(userId).get().catch(() => null)
      );
      const userDocs = await Promise.all(userPromises);
      userDocs.forEach((doc, idx) => {
        if (doc && doc.exists) {
          userMap.set(userIds[idx], doc.data());
        }
      });
    }

    // Batch fetch completed files
    const completedFileMap = new Map<string, any>();
    if (completedFileIds.length > 0) {
      const completedPromises = completedFileIds.map(fileId => 
        adminDb.collection('completedFiles').doc(fileId).get().catch(() => null)
      );
      const completedDocs = await Promise.all(completedPromises);
      completedDocs.forEach((doc, idx) => {
        if (doc && doc.exists) {
          completedFileMap.set(completedFileIds[idx], doc.data());
        }
      });
    }

    // Map files with batch-fetched data (no more N+1 queries!)
    const files = filesSnapshot.docs.map(doc => {
      const fileData = doc.data();
      
      // Get user information from batch-fetched map
      const userData = userMap.get(fileData.userId);
      const userEmail = userData?.email || '';
      const userPhone = userData?.phone || '';

      // Get completed file information from batch-fetched map
      let completedFile = null;
      if (fileData.status === 'completed' && fileData.completedFileId) {
        const completedData = completedFileMap.get(fileData.completedFileId);
        if (completedData) {
          completedFile = {
            filename: completedData.filename || '',
            originalName: completedData.originalName || '',
            size: completedData.size || 0,
            uploadedAt: completedData.uploadedAt || ''
          };
        }
      }

      return {
        id: doc.id,
        originalName: fileData.originalName || '',
        filename: fileData.filename || '',
        size: fileData.size || 0,
        mimeType: fileData.mimeType || '',
        status: fileData.status || 'assigned',
        uploadedAt: fileData.uploadedAt || '',
        assignedAt: fileData.assignedAt || '',
        userId: fileData.userId || '',
        userEmail,
        userPhone,
        completedFile,
        // User message/comment from file edit
        userComment: fileData.userComment || '',
        userCommentUpdatedAt: fileData.userCommentUpdatedAt || ''
      };
    });

    // Cache the result for 3 minutes (agent files change frequently)
    serverCache.set(cacheKey, { files }, 180_000);

    return NextResponse.json({
      success: true,
      files
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch files' },
      { status: 500 }
    );
  }
}
