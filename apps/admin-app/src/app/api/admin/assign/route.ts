import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAdminAuth } from '@/lib/admin-auth';
import { serverCache, makeKey } from '@/lib/server-cache';

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check cache
    const cacheKey = makeKey('assign', ['stats']);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // OPTIMIZED: Parallel queries with limits to prevent huge data fetches
    const [filesSnapshot, agentsSnapshot] = await Promise.all([
      adminDb.collection('files')
        .orderBy('uploadedAt', 'desc')
        .limit(500) // Reduced limit for better performance
        .get(),
      adminDb.collection('agents')
        .limit(100) // Limit agents query
        .get()
    ]);

    // OPTIMIZED: Process data efficiently - extract only needed fields
    
    // Count assignments and build workload map in single pass
    let totalFiles = 0;
    let assignedFiles = 0;
    let unassignedFiles = 0;
    const workloadMap = new Map<string, { total: number; pending: number; completed: number }>();
    
    filesSnapshot.docs.forEach(doc => {
      totalFiles++;
      const data = doc.data();
      const agentId = data.assignedAgentId;
      const status = data.status;
      
      if (agentId) {
        assignedFiles++;
        const current = workloadMap.get(agentId) || { total: 0, pending: 0, completed: 0 };
        current.total++;
        if (status === 'paid' || status === 'assigned') current.pending++;
        if (status === 'completed') current.completed++;
        workloadMap.set(agentId, current);
      } else {
        unassignedFiles++;
      }
    });

    // Build agent workload array - only extract needed fields
    const agentWorkload = agentsSnapshot.docs.map(doc => {
      const data = doc.data();
      const workload = workloadMap.get(doc.id) || { total: 0, pending: 0, completed: 0 };
      return {
        agentId: doc.id,
        agentName: data.name || 'Unknown',
        totalFiles: workload.total,
        pendingFiles: workload.pending,
        completedFiles: workload.completed
      };
    });

    const responsePayload = {
      success: true,
      data: {
        totalFiles,
        assignedFiles,
        unassignedFiles,
        agentWorkload
      }
    };

    // OPTIMIZED: Cache for 2 minutes (consistent with other sections)
    serverCache.set(cacheKey, responsePayload, 120_000);
    return NextResponse.json(responsePayload);

  } catch (error: any) {
    console.error('Error fetching assignment stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch assignment statistics' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileIds, agentId, assignmentType } = await request.json();

    if (!fileIds || !agentId) {
      return NextResponse.json({ 
        success: false, 
        error: 'File IDs and Agent ID are required' 
      }, { status: 400 });
    }

    // Handle both single fileId and array of fileIds
    const filesToAssign = Array.isArray(fileIds) ? fileIds : [fileIds];

    // Verify agent exists
    const agentDoc = await adminDb.collection('agents').doc(agentId).get();
    if (!agentDoc.exists) {
      return NextResponse.json({ 
        success: false, 
        error: 'Agent not found' 
      }, { status: 404 });
    }

    const agentData = agentDoc.data();

    // OPTIMIZED: Use batched writes for better performance
    const maxBatchSize = 500; // Firestore batch limit
    let processedCount = 0;

    for (let i = 0; i < filesToAssign.length; i += maxBatchSize) {
      const batchFiles = filesToAssign.slice(i, Math.min(i + maxBatchSize, filesToAssign.length));
      const batch = adminDb.batch();

      batchFiles.forEach(fileId => {
        const fileRef = adminDb.collection('files').doc(fileId);
        batch.update(fileRef, {
          assignedAgentId: agentId,
          assignedAt: new Date(),
          status: 'assigned',
          updatedAt: new Date()
        });
      });

      await batch.commit();
      processedCount += batchFiles.length;
    }

    // OPTIMIZED: Parallel logging and cache clearing
    await Promise.all([
      adminDb.collection('logs').add({
        action: 'file_assigned',
        adminId: admin.adminId,
        adminName: admin.name,
        fileIds: filesToAssign,
        agentId,
        agentName: agentData?.name || 'Unknown',
        assignmentType: assignmentType || 'manual',
        timestamp: new Date()
      }),
      Promise.resolve().then(() => {
        serverCache.deleteByPrefix(makeKey('assign'));
        serverCache.deleteByPrefix(makeKey('files'));
      })
    ]);

    return NextResponse.json({
      success: true,
      message: `Successfully assigned ${filesToAssign.length} file(s) to agent`,
      assignedCount: filesToAssign.length
    });

  } catch (error: any) {
    console.error('Error assigning file:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to assign file' },
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

    const { fileId } = await request.json();

    if (!fileId) {
      return NextResponse.json({ 
        success: false, 
        error: 'File ID is required' 
      }, { status: 400 });
    }

    // OPTIMIZED: Parallel operations for update and logging
    await Promise.all([
      adminDb.collection('files').doc(fileId).update({
        assignedAgentId: null,
        assignedAt: null,
        updatedAt: new Date()
      }),
      adminDb.collection('logs').add({
        action: 'file_unassigned',
        adminId: admin.adminId,
        adminName: admin.name,
        fileId,
        timestamp: new Date()
      })
    ]);

    // Clear cache
    serverCache.deleteByPrefix(makeKey('assign'));
    serverCache.deleteByPrefix(makeKey('files'));

    return NextResponse.json({
      success: true,
      message: 'File unassigned successfully'
    });

  } catch (error: any) {
    console.error('Error unassigning file:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to unassign file' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { type = 'round_robin' } = await request.json();

    // OPTIMIZED: Fetch both queries in parallel with limits
    const [unassignedFilesSnapshot, agentsSnapshot] = await Promise.all([
      adminDb.collection('files')
        .where('status', '==', 'paid')
        .where('assignedAgentId', '==', null)
        .limit(1000) // Limit to prevent huge queries
        .get(),
      adminDb.collection('agents')
        .where('isActive', '==', true)
        .limit(100) // Limit agents query
        .get()
    ]);

    if (unassignedFilesSnapshot.empty) {
      return NextResponse.json({
        success: true,
        message: 'No unassigned files found',
        assignedCount: 0
      });
    }

    if (agentsSnapshot.empty) {
      return NextResponse.json({
        success: false,
        error: 'No active agents found'
      }, { status: 400 });
    }

    // OPTIMIZED: Extract only needed agent fields
    const agents = agentsSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      maxWorkload: doc.data().maxWorkload || 20
    }));
    const unassignedFiles = unassignedFilesSnapshot.docs;

    let assignedCount = 0;
    const assignmentPlan: Array<{ fileId: string; agentId: string }> = [];

    if (type === 'round_robin') {
      // OPTIMIZED: Calculate assignments first, then batch write
      for (let i = 0; i < unassignedFiles.length; i++) {
        const file = unassignedFiles[i];
        const agent = agents[i % agents.length];
        assignmentPlan.push({ fileId: file.id, agentId: agent.id });
      }
    } else if (type === 'load_balanced') {
      // OPTIMIZED: Batch query for current workload with limits
      const agentWorkload = new Map<string, number>();
      
      // Initialize workload for each agent
      agents.forEach(agent => {
        agentWorkload.set(agent.id, 0);
      });

      // OPTIMIZED: Single query to get current assignments with limit
      const agentIds = agents.map(a => a.id);
      
      // Handle Firestore 'in' query limit of 10 items
      for (let i = 0; i < agentIds.length; i += 10) {
        const batchIds = agentIds.slice(i, Math.min(i + 10, agentIds.length));
        const batchSnapshot = await adminDb.collection('files')
          .where('assignedAgentId', 'in', batchIds)
          .where('status', 'in', ['paid', 'assigned', 'in_progress'])
          .limit(1000) // Limit to prevent huge queries
          .get();

        batchSnapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.assignedAgentId) {
            agentWorkload.set(
              data.assignedAgentId, 
              (agentWorkload.get(data.assignedAgentId) || 0) + 1
            );
          }
        });
      }

      // Calculate load-balanced assignments
      for (const file of unassignedFiles) {
        const leastLoadedAgent = Array.from(agentWorkload.entries())
          .reduce((min, current) => current[1] < min[1] ? current : min);
        
        assignmentPlan.push({ fileId: file.id, agentId: leastLoadedAgent[0] });
        
        // Update workload count for next iteration
        agentWorkload.set(leastLoadedAgent[0], leastLoadedAgent[1] + 1);
      }
    }

    // OPTIMIZED: Use batch writes for all assignments
    const maxBatchSize = 500; // Firestore batch limit
    
    for (let i = 0; i < assignmentPlan.length; i += maxBatchSize) {
      const batchPlan = assignmentPlan.slice(i, Math.min(i + maxBatchSize, assignmentPlan.length));
      const batch = adminDb.batch();
      
      batchPlan.forEach(({ fileId, agentId }) => {
        const fileRef = adminDb.collection('files').doc(fileId);
        batch.update(fileRef, {
          assignedAgentId: agentId,
          assignedAt: new Date(),
          status: 'assigned',
          updatedAt: new Date()
        });
      });

      await batch.commit();
      assignedCount += batchPlan.length;
    }

    // Log the action (parallel with cache clear)
    await Promise.all([
      adminDb.collection('logs').add({
        action: 'bulk_assignment',
        adminId: admin.adminId,
        adminName: admin.name,
        assignmentType: type,
        assignedCount,
        timestamp: new Date()
      }),
      // Clear cache
      Promise.resolve().then(() => {
        serverCache.deleteByPrefix(makeKey('assign'));
        serverCache.deleteByPrefix(makeKey('files'));
      })
    ]);

    return NextResponse.json({
      success: true,
      message: `Successfully assigned ${assignedCount} files using ${type} method`,
      assignedCount
    });

  } catch (error: any) {
    console.error('Error performing bulk assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to perform bulk assignment' },
      { status: 500 }
    );
  }
}