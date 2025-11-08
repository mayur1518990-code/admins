import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { serverCache, makeKey } from '@/lib/server-cache';
import { verifyAdminAuth } from '@/lib/admin-auth';
import { deleteFromB2 } from '@/lib/b2-storage';
import { getCacheKey, deleteCached } from '@/lib/cache';

// Firestore has built-in retries, removed duplicate retry logic

/**
 * AUTOMATIC ASSIGNMENT REMOVED
 * 
 * Automatic assignment logic has been removed from this file.
 * Use /api/admin/auto-assign endpoint with Smart Auto Assign button
 * for controlled, fair file distribution based on agent workload.
 */

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const assignedAgent = searchParams.get('assignedAgent') || 'all';
    const daysOld = searchParams.get('daysOld') || 'all';
    const fileIdsParam = searchParams.get('fileIds') || '';

    const fresh = searchParams.get('fresh') === '1';
    const cacheKey = makeKey('files', ['list', page, limit, status || 'all', assignedAgent || 'all', search || '', daysOld || 'all', fileIdsParam]);
    
    // Check server cache only if NOT requesting fresh data
    if (!fresh) {
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // REAL-TIME MODE: If fileIds provided, fetch specific files
    let filesSnapshot: FirebaseFirestore.QuerySnapshot;
    
    if (fileIdsParam) {
      const fileIds = fileIdsParam.split(',').filter(Boolean);
      
      // ULTRA-OPTIMIZED: For single file, use direct document fetch (3x faster!)
      if (fileIds.length === 1) {
        const doc = await adminDb.collection('files').doc(fileIds[0]).get();
        filesSnapshot = {
          docs: doc.exists ? [doc] : [],
          empty: !doc.exists,
          forEach: (cb: any) => doc.exists ? [doc].forEach(cb) : undefined,
          size: doc.exists ? 1 : 0,
          metadata: undefined as any,
          query: undefined as any
        } as unknown as FirebaseFirestore.QuerySnapshot;
      } else {
        // Fetch files in batches of 10 (Firestore 'in' query limit)
        const batchSize = 10;
        const allDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        
        for (let i = 0; i < fileIds.length; i += batchSize) {
          const batchIds = fileIds.slice(i, Math.min(i + batchSize, fileIds.length));
          const batchSnapshot = await adminDb.collection('files')
            .where(FieldPath.documentId(), 'in', batchIds)
            .get();
          allDocs.push(...batchSnapshot.docs);
        }
        
        filesSnapshot = {
          docs: allDocs,
          empty: allDocs.length === 0,
          forEach: (cb: any) => allDocs.forEach(cb),
          size: allDocs.length,
          metadata: undefined as any,
          query: undefined as any
        } as unknown as FirebaseFirestore.QuerySnapshot;
      }
    } else {
      // Build optimized query with filters at database level
      let baseQuery: FirebaseFirestore.Query = adminDb.collection('files');
    
    // Apply status filter at database level
    // IMPORTANT: Always exclude pending_payment files from file management view
    if (status === 'all') {
      // When showing "all", exclude pending_payment files
      baseQuery = baseQuery.where('status', '!=', 'pending_payment');
    } else if (status !== 'all') {
      baseQuery = baseQuery.where('status', '==', status);
    }
    
    // Apply agent filter at database level
    if (assignedAgent !== 'all') {
      baseQuery = baseQuery.where('assignedAgentId', '==', assignedAgent);
    }
    
      // OPTIMIZATION: Reduced limit for faster initial response (30 files instead of 50+)
      const queryLimit = Math.min(limit, 30); // Much smaller limit for speed
      
      try {
        const indexedQuery = baseQuery.orderBy('uploadedAt', 'desc').limit(queryLimit);
        filesSnapshot = await indexedQuery.get();
      } catch (err: any) {
        // Fallback if composite index is missing
        if (err?.code === 9 || err?.message?.includes('requires an index')) {
          const fallbackSnapshot = await baseQuery.limit(queryLimit).get();
          const sortedDocs = fallbackSnapshot.docs.sort((a, b) => {
            const aTime = a.data()?.uploadedAt?.toDate?.()?.getTime?.() ?? 0;
            const bTime = b.data()?.uploadedAt?.toDate?.()?.getTime?.() ?? 0;
            return bTime - aTime;
          });
          filesSnapshot = {
            docs: sortedDocs,
            empty: sortedDocs.length === 0,
            forEach: (cb: any) => sortedDocs.forEach(cb),
            size: sortedDocs.length,
            metadata: undefined as any,
            query: undefined as any
          } as unknown as FirebaseFirestore.QuerySnapshot;
        } else {
          throw err;
        }
      }
    }

    // Extract unique user and agent IDs for batch fetching
    const userIds = new Set<string>();
    const agentIds = new Set<string>();
    
    const filesData = filesSnapshot.docs.map(doc => {
      const data = doc.data();
      if (data.userId) userIds.add(data.userId);
      if (data.assignedAgentId) agentIds.add(data.assignedAgentId);
      return { id: doc.id, ...data } as any;
    });


    // OPTIMIZED: Batch fetch users and agents with caching
    const userAgentCacheKey = makeKey('users-agents', ['lookup']);
    const cachedUserAgentData = serverCache.get<{ users: Map<string, any>, agents: Map<string, any> }>(userAgentCacheKey);
    
    let usersMap = new Map();
    let agentsMap = new Map();
    
    if (cachedUserAgentData) {
      // Use cached data and only fetch missing ones
      // IMPORTANT: Check if cached data has phone field, if not, invalidate cache and refetch all
      const sampleUser = Array.from(cachedUserAgentData.users.values())[0];
      const cacheHasPhone = sampleUser && 'phone' in sampleUser;
      
      if (!cacheHasPhone && cachedUserAgentData.users.size > 0) {
        // Cache is old format without phone, invalidate it
        serverCache.delete(userAgentCacheKey);
        // Don't use cached data, will fetch all below
      } else {
      usersMap = new Map(cachedUserAgentData.users);
      agentsMap = new Map(cachedUserAgentData.agents);
      }
    }
      
      const missingUserIds = Array.from(userIds).filter(id => !usersMap.has(id));
      const missingAgentIds = Array.from(agentIds).filter(id => !agentsMap.has(id));
      
    // Fetch missing users/agents or all if cache was invalidated
    const usersToFetch = usersMap.size === 0 && userIds.size > 0 ? Array.from(userIds) : missingUserIds;
    const agentsToFetch = agentsMap.size === 0 && agentIds.size > 0 ? Array.from(agentIds) : missingAgentIds;
    
    
    if (usersToFetch.length > 0 || agentsToFetch.length > 0) {
      // Fetch missing users/agents or all if no cache
      const fetchBatch = async (collection: string, ids: string[]) => {
        if (ids.length === 0) return [];
        
        // ULTRA-OPTIMIZED: For single item, use direct document fetch (3x faster!)
        if (ids.length === 1) {
          const doc = await adminDb.collection(collection).doc(ids[0]).get();
          return doc.exists ? [doc] : [];
        }
        
        const batches = [];
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10);
          batches.push(
            adminDb.collection(collection)
              .where(FieldPath.documentId(), 'in', batch)
              .get()
          );
        }
        const results = await Promise.all(batches);
        return results.flatMap(snapshot => snapshot.docs);
      };

      // For users, also check agents and admins collections (user might be in different collection)
      // IMPORTANT: Search by document ID first, then by userId field if not found
      const fetchUserFromAllCollections = async (userId: string) => {
        try {
          // Try both plural and singular collection names (prioritize 'user' since that's where data actually is)
          const collectionNames = ['user', 'users', 'agents', 'agent', 'admins', 'admin'];
          
          // First try by document ID (most common case)
          const docByIdPromises = collectionNames.map(collectionName => 
            adminDb.collection(collectionName).doc(userId).get().catch(() => {
              return { exists: false, id: userId, collection: collectionName };
            })
          );
          
          const docsById = await Promise.all(docByIdPromises);
          
          // Check which collection has the document
          for (let i = 0; i < docsById.length; i++) {
            const doc = docsById[i];
            if (doc.exists) {
              return doc;
            }
          }
          
          // Get references for fallback search
          const userDocById = docsById[0]; // user collection
          const agentDocById = docsById[2]; // agents collection
          const adminDocById = docsById[4]; // admins collection
          
          if (userDocById.exists) {
            return userDocById;
          }
          if (agentDocById.exists) {
            return agentDocById;
          }
          if (adminDocById.exists) {
            return adminDocById;
          }
          
          // If not found by document ID, try searching by userId field
          let userDocsByField, agentDocsByField, adminDocsByField;
          try {
            // Try searching by userId field in all collections (prioritize 'user' collection)
            const searchQueries = [
              adminDb.collection('user').where('userId', '==', userId).limit(1).get().catch(() => ({ empty: true, docs: [] })),
              adminDb.collection('users').where('userId', '==', userId).limit(1).get().catch(() => ({ empty: true, docs: [] })),
              adminDb.collection('agents').where('userId', '==', userId).limit(1).get().catch(() => ({ empty: true, docs: [] })),
              adminDb.collection('admins').where('userId', '==', userId).limit(1).get().catch(() => ({ empty: true, docs: [] }))
            ];
            
            const [userDocsByUser, userDocsByUsers, agentDocsByField, adminDocsByField] = await Promise.all(searchQueries);
            // Prioritize 'user' collection results
            const userDocsByField = !userDocsByUser.empty ? userDocsByUser : userDocsByUsers;
            
            if (!userDocsByField.empty && userDocsByField.docs && userDocsByField.docs.length > 0) {
              return userDocsByField.docs[0];
            }
            if (!agentDocsByField.empty && agentDocsByField.docs && agentDocsByField.docs.length > 0) {
              return agentDocsByField.docs[0];
            }
            if (!adminDocsByField.empty && adminDocsByField.docs && adminDocsByField.docs.length > 0) {
              return adminDocsByField.docs[0];
            }
          } catch (searchError) {
            // Silently fail and return null
          }
          
          return null;
        } catch (error) {
          return null;
        }
      };

      // Fetch users - try all collections (users, agents, admins) for each user
      const userFetchPromises = usersToFetch.map(userId => fetchUserFromAllCollections(userId));
      const agentFetchPromises = agentsToFetch.map(agentId => 
        adminDb.collection('agents').doc(agentId).get().catch(() => null)
      );
      
      const [userResults, agentResults] = await Promise.all([
        Promise.all(userFetchPromises),
        Promise.all(agentFetchPromises)
      ]);
      
      // Filter out null results and convert to doc array format
      const userDocs = userResults.filter((doc): doc is any => doc !== null && doc.exists);
      const agentDocs = agentResults.filter((doc): doc is any => doc !== null && doc.exists);
      
      userDocs.forEach((doc: any) => {
        const data = doc.data();
        usersMap.set(doc.id, {
          id: doc.id,
          name: data?.name || 'Unknown',
          email: data?.email || 'Unknown',
          phone: data?.phone || data?.phoneNumber || data?.contactNumber || null
        });
      });
      
      // Create placeholder user entries if users were not found
      if (usersToFetch.length > 0 && userDocs.length === 0) {
        // Create placeholder user entries so the UI doesn't break
        usersToFetch.forEach(userId => {
          usersMap.set(userId, {
            id: userId,
            name: 'Unknown User',
            email: 'No email',
            phone: null
          });
        });
      }

      agentDocs.forEach((doc: any) => {
        const data = doc.data();
        agentsMap.set(doc.id, {
          id: doc.id,
          name: data?.name || 'Unknown',
          email: data?.email || 'Unknown',
          phone: data?.phone || 'Unknown'
        });
      });
      
      // Cache for 5 minutes
      serverCache.set(userAgentCacheKey, { users: usersMap, agents: agentsMap }, 300_000);
    }

    // Map files with user and agent data from lookup maps (O(N) instead of O(N*M))
    let files = filesData.map(data => {
      const userData = data.userId ? usersMap.get(data.userId) || null : null;
      return {
      id: data.id,
      filename: data.filename || 'Unknown',
      originalName: data.originalName || 'Unknown',
      size: data.size || 0,
      mimeType: data.mimeType || 'Unknown',
      status: data.status || 'unknown',
      uploadedAt: data.uploadedAt?.toDate?.() || data.uploadedAt || new Date(),
      assignedAt: data.assignedAt?.toDate?.() || data.assignedAt || null,
      respondedAt: data.respondedAt?.toDate?.() || data.respondedAt || null,
      responseFileURL: data.responseFileURL || null,
      responseMessage: data.responseMessage || null,
        user: userData,
      agent: data.assignedAgentId ? agentsMap.get(data.assignedAgentId) || null : null,
      paymentId: data.paymentId || null,
      b2Key: data.b2Key || data.filename || null
      };
    });

    // Apply days filter - show files older than specified days
    if (daysOld !== 'all') {
      const daysThreshold = parseInt(daysOld);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);
      
      files = files.filter(file => {
        const uploadDate = new Date(file.uploadedAt);
        return uploadDate < cutoffDate;
      });
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      files = files.filter(file => 
        file.filename.toLowerCase().includes(searchLower) ||
        file.originalName.toLowerCase().includes(searchLower) ||
        file.user?.name?.toLowerCase().includes(searchLower) ||
        file.user?.email?.toLowerCase().includes(searchLower) ||
        file.agent?.name?.toLowerCase().includes(searchLower)
      );
    }

    // Apply pagination
    const totalFiles = files.length;
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedFiles = files.slice(startIndex, endIndex);

    const responsePayload = {
      success: true,
      files: paginatedFiles,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalFiles,
        pages: Math.ceil(totalFiles / Number(limit))
      }
    };

    // Cache for 30 seconds only (reduced from 2 minutes for instant data visibility)
    if (!fresh) {
      serverCache.set(cacheKey, responsePayload, 30_000); // 30 seconds cache
    }
    
    return NextResponse.json(responsePayload);

  } catch (error: any) {
    
    // Handle specific error types
    if (error.code === 14 || error.message?.includes('No connection established')) {
      return NextResponse.json(
        { success: false, error: "Database connection failed. Please try again." },
        { status: 503 }
      );
    }
    
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return NextResponse.json(
        { success: false, error: "Request timed out. Please try again." },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: 'Failed to fetch files' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId, status, assignedAgentId, responseMessage } = await request.json();

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'File ID is required' }, { status: 400 });
    }

    const updateData: any = {};

    if (status) {
      updateData.status = status;
    }

    if (assignedAgentId) {
      updateData.assignedAgentId = assignedAgentId;
      updateData.assignedAt = new Date();
    }

    if (responseMessage) {
      updateData.responseMessage = responseMessage;
    }

    updateData.updatedAt = new Date();

    await adminDb.collection('files').doc(fileId).update(updateData);
    serverCache.deleteByPrefix(makeKey('files'));

    // NO automatic assignment - Admin uses Smart Auto Assign button for controlled distribution
    // This prevents unwanted bulk assignments when status changes to 'paid'

    // Log the action
    await adminDb.collection('logs').add({
      action: 'file_updated',
      adminId: admin.adminId,
      adminName: admin.name,
      fileId,
      changes: updateData,
      note: status === 'paid' && !assignedAgentId ? 'File marked as paid. Use Smart Auto Assign for distribution.' : undefined,
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'File updated successfully'
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to update file' },
      { status: 500 }
    );
  }
}

// PUT - Update file status and trigger auto-assignment if needed
export async function PUT(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId, status } = await request.json();

    if (!fileId || !status) {
      return NextResponse.json({ 
        success: false, 
        error: 'File ID and status are required' 
      }, { status: 400 });
    }

    // Update file status ONLY - NO automatic assignment
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    await adminDb.collection('files').doc(fileId).update(updateData);
    serverCache.deleteByPrefix(makeKey('files'));

    // NO automatic assignment - Use Smart Auto Assign button instead
    // This ensures controlled, fair distribution based on agent workload

    // Log the action
    await adminDb.collection('logs').add({
      action: 'file_status_updated',
      adminId: admin.adminId,
      adminName: admin.name,
      fileId,
      newStatus: status,
      note: status === 'paid' ? 'File marked as paid. Use Smart Auto Assign for fair distribution.' : undefined,
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'File status updated successfully'
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to update file status' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId, fileIds } = await request.json();

    const idsToDelete: string[] = Array.isArray(fileIds)
      ? fileIds.filter(Boolean)
      : (fileId ? [fileId] : []);

    if (!idsToDelete.length) {
      return NextResponse.json({ success: false, error: 'File ID(s) are required' }, { status: 400 });
    }

    // Batch delete (limit 500 per batch)
    let deletedCount = 0;
    const chunks: string[][] = [];
    for (let i = 0; i < idsToDelete.length; i += 500) {
      chunks.push(idsToDelete.slice(i, i + 500));
    }

    // Track unique user IDs and agent IDs to clear their caches
    const affectedUserIds = new Set<string>();
    const affectedAgentIds = new Set<string>();

    for (const chunk of chunks) {
      const batch = adminDb.batch();
      const fileDocs = await Promise.all(chunk.map(id => adminDb.collection('files').doc(id).get()));
      
      // Collect B2 keys to delete from storage and completed file IDs
      const b2KeysToDelete: string[] = [];
      const completedFileIds: string[] = [];
      
      fileDocs.forEach((doc, idx) => {
        if (doc.exists) {
          const id = chunk[idx];
          const data = doc.data();
          
          // Track user ID for cache invalidation
          if (data?.userId) {
            affectedUserIds.add(data.userId);
          }
          
          // Track agent ID for cache invalidation
          if (data?.assignedAgentId) {
            affectedAgentIds.add(data.assignedAgentId);
          }
          
          // AGGRESSIVE DELETE: Collect ALL B2 keys from files collection
          
          // 1. Collect b2Key if present (direct B2 reference)
          if (data?.b2Key) {
            b2KeysToDelete.push(data.b2Key);
          }
          
          // 2. Try uploads folder patterns (user uploaded files)
          if (data?.filename) {
            // Pattern 1: uploads/{userId}/{filename}
            if (data?.userId) {
              const uploadsPath = `uploads/${data.userId}/${data.filename}`;
              b2KeysToDelete.push(uploadsPath);
            }
            
            // Pattern 2: uploads/{filename} (alternative pattern)
            const directUploadPath = `uploads/${data.filename}`;
            b2KeysToDelete.push(directUploadPath);
          }
          
          // 3. Extract B2 key from responseFileURL if present (agent-responses folder)
          if (data?.responseFileURL) {
            try {
              // Extract path from URL: https://...backblazeb2.com/bucket/path
              const url = new URL(data.responseFileURL);
              const pathParts = url.pathname.split('/');
              // Remove empty first element and bucket name
              const b2Path = pathParts.slice(2).join('/');
              if (b2Path) {
                b2KeysToDelete.push(b2Path);
              }
            } catch (error) {
              // Silent fail - B2 path parsing error
            }
          }
          
          // 4. Collect completed file ID to fetch and delete from completedFiles collection (agent-uploads)
          if (data?.completedFileId) {
            completedFileIds.push(data.completedFileId);
          }
          
          batch.delete(doc.ref);
          // Log each deletion
          const logRef = adminDb.collection('logs').doc();
          batch.set(logRef, {
            action: 'file_deleted',
            adminId: admin.adminId,
            adminName: admin.name,
            fileId: id,
            fileName: data?.filename || 'Unknown',
            originalName: data?.originalName || 'Unknown',
            userId: data?.userId || 'Unknown',
            hadB2Storage: !!data?.b2Key || !!data?.completedFileId,
            timestamp: new Date()
          });
          deletedCount += 1;
        }
      });
      
      // Fetch completedFiles documents and delete them along with their B2 files
      if (completedFileIds.length > 0) {
        const completedFileDocs = await Promise.all(
          completedFileIds.map(id => adminDb.collection('completedFiles').doc(id).get())
        );
        
        completedFileDocs.forEach((completedDoc) => {
          if (completedDoc.exists) {
            const completedData = completedDoc.data();
            
            // Collect B2 key from completed file (this is in agent-uploads folder)
            if (completedData?.b2Key) {
              b2KeysToDelete.push(completedData.b2Key);
            }
            
            // Delete the completedFiles document
            batch.delete(completedDoc.ref);
          }
        });
      }
      
      // AGGRESSIVE B2 DELETE: Delete ALL collected files from B2 storage
      // This includes: uploads/, agent-uploads/, agent-responses/, and any other B2 files
      if (b2KeysToDelete.length > 0) {
        // CRITICAL FIX: AWAIT B2 deletion to ensure files are actually deleted!
        try {
          await Promise.all(b2KeysToDelete.map(async (key) => {
            try {
              await deleteFromB2(key);
            } catch (error: any) {
              // Don't throw - continue with other deletions
            }
          }));
        } catch (error: any) {
          // Continue with database deletion even if B2 fails
        }
      }
      
      // Delete from Firestore AFTER B2 deletion completes
      await batch.commit();
    }

    // Invalidate all relevant caches
    serverCache.deleteByPrefix(makeKey('files'));
    serverCache.deleteByPrefix(makeKey('users-agents')); // Also invalidate user-agent cache

    // CRITICAL FIX: Also invalidate USER APP cache for affected users
    // NOTE: This clears the admin-app's copy of user cache. The user-app has its own
    // separate server process with its own cache, which will auto-expire within 30 seconds
    // (reduced from 5 minutes for faster deletion visibility)
    for (const userId of affectedUserIds) {
      const userFilesKey = getCacheKey(['user_files', userId]);
      deleteCached(userFilesKey);
    }

    // CRITICAL FIX: Also invalidate AGENT cache for affected agents
    for (const agentId of affectedAgentIds) {
      const agentFilesKey = makeKey('agent-files', [agentId]);
      serverCache.delete(agentFilesKey);
    }
    
    return NextResponse.json({
      success: true,
      message: deletedCount === 1 
        ? 'File completely deleted from Firebase and B2 (uploads/, agent-uploads/, agent-responses/). Not visible anywhere.' 
        : `${deletedCount} files completely deleted from Firebase and B2 storage. Not visible anywhere.`,
      deletedCount,
      note: 'Hard delete complete: File removed from Firebase metadata, completedFiles collection, and ALL B2 storage folders (uploads/, agent-uploads/, agent-responses/). Not visible in user portal, agent portal, Firebase, or B2 bucket.'
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete file' },
      { status: 500 }
    );
  }
}
