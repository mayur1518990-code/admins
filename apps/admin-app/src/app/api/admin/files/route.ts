import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { serverCache, makeKey } from '@/lib/server-cache';
import { verifyAdminAuth } from '@/lib/admin-auth';

// Helper function to handle Firestore connection issues with retry logic
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a connection error that we should retry
      if (error.code === 14 || // UNAVAILABLE
          error.message?.includes('No connection established') ||
          error.message?.includes('network socket disconnected') ||
          error.message?.includes('TLS connection') ||
          error.code === 'ECONNRESET' ||
          error.code === 'ENOTFOUND') {
        
        // Retrying...
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
      }
      
      // If it's not a retryable error or we've exhausted retries, throw
      throw error;
    }
  }
  
  throw lastError;
}

// Helper function to trigger automatic assignment for paid files
async function triggerAutoAssignment(fileIds: string[]) {
  try {
    console.log(`[AUTO-ASSIGN] Triggering auto-assignment for ${fileIds.length} files`);
    
    // Get all active agents
    const agentsSnapshot = await withRetry(() => adminDb.collection('agents')
      .where('isActive', '==', true)
      .get());

    if (agentsSnapshot.empty) {
      console.log('[AUTO-ASSIGN] No active agents found');
      return { success: false, error: 'No active agents found' };
    }

    // OPTIMIZED: Get ALL assigned files with limit to prevent huge queries
    const allAssignedFilesSnapshot = await withRetry(() => adminDb.collection('files')
      .where('status', 'in', ['paid', 'assigned', 'in_progress'])
      .limit(2000) // Limit to prevent huge queries
      .get());

    // Build workload map from single query result
    const workloadMap = new Map<string, number>();
    allAssignedFilesSnapshot.docs.forEach(doc => {
      const agentId = doc.data().assignedAgentId;
      if (agentId) {
        workloadMap.set(agentId, (workloadMap.get(agentId) || 0) + 1);
      }
    });

    // Calculate current workload for each agent (no additional queries needed!)
    const agentWorkloads = agentsSnapshot.docs.map((agentDoc) => {
      const agentData = agentDoc.data();
      const agentId = agentDoc.id;

      return {
        agentId,
        agentName: agentData.name || 'Unknown Agent',
        agentEmail: agentData.email || 'No email',
        currentWorkload: workloadMap.get(agentId) || 0, // O(1) lookup
        maxWorkload: agentData.maxWorkload || 20,
        isActive: agentData.isActive || false,
        lastAssigned: agentData.lastAssigned || null
      };
    });

    // Sort agents by workload (least loaded first)
    const sortedAgents = agentWorkloads
      .filter(agent => agent.isActive)
      .sort((a, b) => {
        if (a.currentWorkload !== b.currentWorkload) {
          return a.currentWorkload - b.currentWorkload;
        }
        if (a.lastAssigned && b.lastAssigned) {
          return new Date(a.lastAssigned).getTime() - new Date(b.lastAssigned).getTime();
        }
        if (!a.lastAssigned && b.lastAssigned) return -1;
        if (a.lastAssigned && !b.lastAssigned) return 1;
        return 0;
      });

    if (sortedAgents.length === 0) {
      console.log('[AUTO-ASSIGN] No available agents for assignment');
      return { success: false, error: 'No available agents for assignment' };
    }

    // Assign files to agents using round-robin with workload consideration
    const assignments = [];
    const agentUpdates = new Map<string, Date>();
    let agentIndex = 0;

    // OPTIMIZED: Use Firestore batch writes (up to 500 operations per batch)
    const batch = adminDb.batch();
    let operationCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const fileId of fileIds) {
      // Find the best agent for this file
      let selectedAgent = null;
      
      // Try to find an agent with available capacity
      for (let i = 0; i < sortedAgents.length; i++) {
        const agent = sortedAgents[agentIndex % sortedAgents.length];
        agentIndex++;
        
        if (agent.currentWorkload < agent.maxWorkload) {
          selectedAgent = agent;
          break;
        }
      }

      // If no agent has capacity, assign to the least loaded one
      if (!selectedAgent) {
        selectedAgent = sortedAgents[0];
      }

      // Add file update to batch
      const fileRef = adminDb.collection('files').doc(fileId);
      batch.update(fileRef, {
        assignedAgentId: selectedAgent.agentId,
        assignedAt: new Date(),
        status: 'assigned',
        updatedAt: new Date()
      });
      operationCount++;

      // Track agent update (will be batched later)
      agentUpdates.set(selectedAgent.agentId, new Date());

      // Update agent's workload count
      selectedAgent.currentWorkload++;

      assignments.push({
        fileId,
        agentId: selectedAgent.agentId,
        agentName: selectedAgent.agentName,
        workload: selectedAgent.currentWorkload
      });

      // Commit batch if we hit the limit
      if (operationCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        operationCount = 0;
      }
    }

    // Add agent updates to batch
    agentUpdates.forEach((lastAssigned, agentId) => {
      const agentRef = adminDb.collection('agents').doc(agentId);
      batch.update(agentRef, {
        lastAssigned,
        updatedAt: new Date()
      });
      operationCount++;
    });

    // Commit any remaining operations
    if (operationCount > 0) {
      await batch.commit();
    }
    
    return {
      success: true,
      message: `Successfully auto-assigned ${fileIds.length} file(s)`,
      assignments: assignments,
      totalAssigned: fileIds.length
    };

  } catch (error) {
    console.error('[AUTO-ASSIGN] Error in auto-assignment:', error);
    return { success: false, error: 'Auto-assignment failed' };
  }
}

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

    const fresh = searchParams.get('fresh') === '1';
    const cacheKey = makeKey('files', ['list', page, limit, status || 'all', assignedAgent || 'all', search || '']);
    const cached = fresh ? undefined : serverCache.get<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Build optimized query with filters at database level
    let baseQuery: FirebaseFirestore.Query = adminDb.collection('files');
    
    // Apply status filter at database level
    if (status !== 'all') {
      baseQuery = baseQuery.where('status', '==', status);
    }
    
    // Apply agent filter at database level
    if (assignedAgent !== 'all') {
      baseQuery = baseQuery.where('assignedAgentId', '==', assignedAgent);
    }
    
    // Prefer indexed sort when available
    let filesSnapshot: FirebaseFirestore.QuerySnapshot;
    try {
      const indexedQuery = baseQuery.orderBy('uploadedAt', 'desc').limit(1000);
      filesSnapshot = await withRetry(() => indexedQuery.get());
    } catch (err: any) {
      // Fallback if composite index is missing: fetch without orderBy and sort in memory
      if (err?.code === 9 || err?.message?.includes('requires an index')) {
        const fallbackSnapshot = await withRetry(() => baseQuery.limit(1000).get());
        // Sort docs in-memory by uploadedAt desc to preserve expected ordering
        const sortedDocs = fallbackSnapshot.docs.sort((a, b) => {
          const aTime = a.data()?.uploadedAt?.toDate?.()?.getTime?.() ?? new Date(a.data()?.uploadedAt || 0).getTime();
          const bTime = b.data()?.uploadedAt?.toDate?.()?.getTime?.() ?? new Date(b.data()?.uploadedAt || 0).getTime();
          return bTime - aTime;
        });
        // Create a lightweight snapshot-like object
        filesSnapshot = {
          docs: sortedDocs,
          empty: sortedDocs.length === 0,
          forEach: (cb: any) => sortedDocs.forEach(cb),
          size: sortedDocs.length,
          // Unused properties in our code path; add minimal stubs to satisfy types
          metadata: undefined as any,
          query: undefined as any
        } as unknown as FirebaseFirestore.QuerySnapshot;
      } else {
        throw err;
      }
    }

    // Extract unique user and agent IDs for batch fetching
    const userIds = new Set<string>();
    const agentIds = new Set<string>();
    
    const filesData = filesSnapshot.docs.map(doc => {
      const data = doc.data();
      if (data.userId) userIds.add(data.userId);
      if (data.assignedAgentId) agentIds.add(data.assignedAgentId);
      return { id: doc.id, ...data };
    });

    // OPTIMIZED: Batch fetch users and agents with limits
    const [usersSnapshot, agentsSnapshot] = await Promise.all([
      userIds.size > 0 
        ? withRetry(() => adminDb.collection('users')
            .where(FieldPath.documentId(), 'in', Array.from(userIds).slice(0, 10))
            .limit(100) // Additional limit
            .get())
        : Promise.resolve({ docs: [] } as any),
      agentIds.size > 0
        ? withRetry(() => adminDb.collection('agents')
            .where(FieldPath.documentId(), 'in', Array.from(agentIds).slice(0, 10))
            .limit(100) // Additional limit
            .get())
        : Promise.resolve({ docs: [] } as any)
    ]);

    // Skip additional batch processing for performance - use only first 10 IDs
    // This prevents excessive queries that slow down the API


    // Create lookup maps for O(1) access
    const usersMap = new Map();
    usersSnapshot.docs.forEach((doc: any) => {
      const data = doc.data();
      usersMap.set(doc.id, {
        id: doc.id,
        name: data?.name || 'Unknown',
        email: data?.email || 'Unknown',
        phone: data?.phone || 'Unknown'
      });
    });

    const agentsMap = new Map();
    agentsSnapshot.docs.forEach((doc: any) => {
      const data = doc.data();
      agentsMap.set(doc.id, {
        id: doc.id,
        name: data?.name || 'Unknown',
        email: data?.email || 'Unknown',
        phone: data?.phone || 'Unknown'
      });
    });

    // Map files with user and agent data from lookup maps (O(N) instead of O(N*M))
    let files = filesData.map(data => ({
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
      user: data.userId ? usersMap.get(data.userId) || null : null,
      agent: data.assignedAgentId ? agentsMap.get(data.assignedAgentId) || null : null,
      paymentId: data.paymentId || null
    }));

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

    // Use shorter TTL to reduce staleness after payments; skip caching if explicitly fresh
    if (!fresh) {
      serverCache.set(cacheKey, responsePayload, 10_000); // 10s TTL for fresher files list
    }
    return NextResponse.json(responsePayload);

  } catch (error: any) {
    console.error('Error fetching files:', error);
    
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

    // Auto-assign if file status changed to 'paid' and no agent is assigned
    if (status === 'paid' && !assignedAgentId) {
      try {
        console.log('File marked as paid, triggering auto-assignment for:', fileId);
        const autoAssignResult = await triggerAutoAssignment([fileId]);
        
        if (autoAssignResult.success) {
          console.log('Auto-assignment successful:', autoAssignResult);
        } else {
          console.error('Auto-assignment failed:', autoAssignResult);
        }
      } catch (error) {
        console.error('Error in auto-assignment trigger:', error);
      }
    }

    // Log the action
    await adminDb.collection('logs').add({
      action: 'file_updated',
      adminId: admin.adminId,
      adminName: admin.name,
      fileId,
      changes: updateData,
      autoAssigned: status === 'paid' && !assignedAgentId,
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'File updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating file:', error);
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

    const { fileId, status, triggerAutoAssign = false } = await request.json();

    if (!fileId || !status) {
      return NextResponse.json({ 
        success: false, 
        error: 'File ID and status are required' 
      }, { status: 400 });
    }

    // Update file status
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    await adminDb.collection('files').doc(fileId).update(updateData);
    serverCache.deleteByPrefix(makeKey('files'));

    // If status is 'paid' and auto-assignment is enabled, trigger it
    if (status === 'paid' && triggerAutoAssign) {
      const autoAssignResult = await triggerAutoAssignment([fileId]);
      
      if (autoAssignResult.success) {
        return NextResponse.json({
          success: true,
          message: 'File status updated and auto-assigned successfully',
          autoAssignment: autoAssignResult
        });
      } else {
        return NextResponse.json({
          success: true,
          message: 'File status updated, but auto-assignment failed',
          autoAssignment: autoAssignResult
        });
      }
    }

    // Log the action
    await adminDb.collection('logs').add({
      action: 'file_status_updated',
      adminId: admin.adminId,
      adminName: admin.name,
      fileId,
      newStatus: status,
      triggerAutoAssign,
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'File status updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating file status:', error);
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

    for (const chunk of chunks) {
      const batch = adminDb.batch();
      const fileDocs = await Promise.all(chunk.map(id => adminDb.collection('files').doc(id).get()));
      fileDocs.forEach((doc, idx) => {
        if (doc.exists) {
          const id = chunk[idx];
          batch.delete(doc.ref);
          // Log each deletion
          const data = doc.data();
          const logRef = adminDb.collection('logs').doc();
          batch.set(logRef, {
            action: 'file_deleted',
            adminId: admin.adminId,
            adminName: admin.name,
            fileId: id,
            fileName: data?.filename || 'Unknown',
            originalName: data?.originalName || 'Unknown',
            userId: data?.userId || 'Unknown',
            timestamp: new Date()
          });
          deletedCount += 1;
        }
      });
      await batch.commit();
    }

    serverCache.deleteByPrefix(makeKey('files'));

    return NextResponse.json({
      success: true,
      message: deletedCount === 1 ? 'File deleted successfully' : `Deleted ${deletedCount} files`,
      deletedCount
    });

  } catch (error: any) {
    console.error('Error deleting file:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete file' },
      { status: 500 }
    );
  }
}
