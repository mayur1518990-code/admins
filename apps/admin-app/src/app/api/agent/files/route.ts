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
        // Even if cached, check if there are replacement files - if cached data doesn't have them,
        // we should fetch fresh to ensure replacement files are visible immediately
        const hasReplacementInCache = cached.files?.some(f => f.status === 'replacement');
        // If cache exists but no replacement files, still use cache (normal case)
        // But if fresh is requested, always bypass cache
        return NextResponse.json({
          success: true,
          files: cached.files
        });
      }
    } else {
      // Fresh data requested - clear server cache to ensure latest replacement status
      serverCache.delete(cacheKey);
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

    // OPTIMIZED: Batch fetch all user data using getAll() for better performance
    // Firestore getAll() is faster than individual gets when fetching multiple documents
    const userIds = [...new Set(filesSnapshot.docs.map(doc => doc.data().userId).filter(Boolean))];
    const completedFileIds = filesSnapshot.docs
      .map(doc => doc.data().completedFileId)
      .filter(Boolean);

    // Batch fetch users using getAll() - more efficient for multiple documents
    const userMap = new Map<string, any>();
    if (userIds.length > 0) {
      // Firestore getAll() supports up to 10 documents per call, so we need to chunk
      const userChunks: string[][] = [];
      for (let i = 0; i < userIds.length; i += 10) {
        userChunks.push(userIds.slice(i, i + 10));
      }
      
      const userPromises = userChunks.map(chunk => {
        const refs = chunk.map(id => adminDb.collection('users').doc(id));
        return adminDb.getAll(...refs).catch(() => []);
      });
      
      const userDocArrays = await Promise.all(userPromises);
      userDocArrays.flat().forEach(doc => {
        if (doc && doc.exists) {
          userMap.set(doc.id, doc.data());
        }
      });
    }

    // Batch fetch completed files using getAll() - more efficient
    const completedFileMap = new Map<string, any>();
    if (completedFileIds.length > 0) {
      // Firestore getAll() supports up to 10 documents per call
      const fileChunks: string[][] = [];
      for (let i = 0; i < completedFileIds.length; i += 10) {
        fileChunks.push(completedFileIds.slice(i, i + 10));
      }
      
      const completedPromises = fileChunks.map(chunk => {
        const refs = chunk.map(id => adminDb.collection('completedFiles').doc(id));
        return adminDb.getAll(...refs).catch(() => []);
      });
      
      const completedDocArrays = await Promise.all(completedPromises);
      completedDocArrays.flat().forEach(doc => {
        if (doc && doc.exists) {
          completedFileMap.set(doc.id, doc.data());
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
          // Handle Firestore Timestamp conversion
          let uploadedAt = '';
          if (completedData.uploadedAt) {
            if (completedData.uploadedAt.toDate) {
              // Firestore Timestamp object
              uploadedAt = completedData.uploadedAt.toDate().toISOString();
            } else if (completedData.uploadedAt instanceof Date) {
              // Already a Date object
              uploadedAt = completedData.uploadedAt.toISOString();
            } else if (typeof completedData.uploadedAt === 'string') {
              // Already a string
              uploadedAt = completedData.uploadedAt;
            } else {
              // Try to convert to ISO string
              uploadedAt = new Date(completedData.uploadedAt).toISOString();
            }
          }
          
          completedFile = {
            filename: completedData.filename || '',
            originalName: completedData.originalName || '',
            size: completedData.size || 0,
            uploadedAt
          };
        }
      }

      // Handle Firestore Timestamp conversion for assignedAt
      let assignedAt = '';
      if (fileData.assignedAt) {
        if (fileData.assignedAt.toDate) {
          // Firestore Timestamp object
          assignedAt = fileData.assignedAt.toDate().toISOString();
        } else if (fileData.assignedAt instanceof Date) {
          // Already a Date object
          assignedAt = fileData.assignedAt.toISOString();
        } else if (typeof fileData.assignedAt === 'string') {
          // Already a string
          assignedAt = fileData.assignedAt;
        } else {
          // Try to convert to ISO string
          assignedAt = new Date(fileData.assignedAt).toISOString();
        }
      }

      // Handle Firestore Timestamp conversion for uploadedAt
      let uploadedAt = '';
      if (fileData.uploadedAt) {
        if (fileData.uploadedAt.toDate) {
          // Firestore Timestamp object
          uploadedAt = fileData.uploadedAt.toDate().toISOString();
        } else if (fileData.uploadedAt instanceof Date) {
          // Already a Date object
          uploadedAt = fileData.uploadedAt.toISOString();
        } else if (typeof fileData.uploadedAt === 'string') {
          // Already a string
          uploadedAt = fileData.uploadedAt;
        } else {
          // Try to convert to ISO string
          uploadedAt = new Date(fileData.uploadedAt).toISOString();
        }
      }

      return {
        id: doc.id,
        originalName: fileData.originalName || '',
        filename: fileData.filename || '',
        size: fileData.size || 0,
        mimeType: fileData.mimeType || '',
        status: fileData.status || 'assigned',
        uploadedAt,
        assignedAt,
        userId: fileData.userId || '',
        userEmail,
        userPhone,
        completedFile,
        // User message/comment from file edit
        userComment: fileData.userComment || '',
        userCommentUpdatedAt: fileData.userCommentUpdatedAt || ''
      };
    });

    // Cache the result - shorter cache time if replacement files exist (for faster updates)
    const hasReplacementFiles = files.some(f => f.status === 'replacement');
    const cacheTime = hasReplacementFiles ? 30_000 : 180_000; // 30s for replacement, 3min for normal
    serverCache.set(cacheKey, { files }, cacheTime);

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
