import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { findAgentFiles } from '@/lib/agent-utils';
import { serverCache, makeKey } from '@/lib/server-cache';

export async function GET(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check cache first
    const cacheKey = makeKey('agent-files', [agent.agentId]);
    const cached = serverCache.get<{ files: any[] }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        files: cached.files
      });
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

    // OPTIMIZATION: Batch fetch all user data (fixes N+1 query problem)
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
        completedFile
      };
    });

    // Cache the result for 3 minutes (agent files change frequently)
    serverCache.set(cacheKey, { files }, 180_000);

    return NextResponse.json({
      success: true,
      files
    });

  } catch (error: any) {
    console.error('Error fetching agent files:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch files' },
      { status: 500 }
    );
  }
}
