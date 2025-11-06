import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";
import { serverCache, makeKey } from "@/lib/server-cache";

/**
 * SMART FILE ASSIGNMENT ALGORITHM
 * 
 * This algorithm distributes files fairly among agents based on:
 * 1. Completed files (less is better - agent has less overall work done)
 * 2. Pending files (less is better - agent has less current workload)
 * 
 * The algorithm prevents bulk assignments to any single agent by:
 * - Rotating through agents as files are assigned
 * - Prioritizing agents with the least total work (completed + pending)
 * - Ensuring equal distribution when workloads are similar
 */

// POST - Smart assignment based on completed and pending files
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileIds, assignmentType = 'smart_balanced' } = await request.json();
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'File IDs are required' 
      }, { status: 400 });
    }

    console.log(`Smart-assign: Starting for ${fileIds.length} files`);

    // CRITICAL: Get user IDs from files to clear their caches later
    const fileDocsPromises = fileIds.map(fileId => 
      adminDb.collection('files').doc(fileId).get()
    );
    const fileDocs = await Promise.all(fileDocsPromises);
    const userIds = new Set<string>();
    fileDocs.forEach(doc => {
      if (doc.exists) {
        const userId = doc.data()?.userId;
        if (userId) userIds.add(userId);
      }
    });

    // Get all active agents
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .get();

    if (agentsSnapshot.empty) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active agents found' 
      }, { status: 404 });
    }

    // Get ALL files to calculate both completed and pending counts per agent
    const allFilesSnapshot = await adminDb.collection('files')
      .limit(5000) // Reasonable limit
      .get();

    // Build comprehensive workload map: { agentId: { completed, pending, total } }
    const workloadMap = new Map<string, { completed: number; pending: number; total: number }>();
    
    allFilesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const agentId = data.assignedAgentId;
      const status = data.status;
      
      if (agentId) {
        const current = workloadMap.get(agentId) || { completed: 0, pending: 0, total: 0 };
        
        // Count completed files
        if (status === 'completed') {
          current.completed++;
        }
        
        // Count pending files (paid, assigned, processing)
        if (status === 'paid' || status === 'assigned' || status === 'processing') {
          current.pending++;
        }
        
        current.total = current.completed + current.pending;
        workloadMap.set(agentId, current);
      }
    });

    // Build agent workload array with detailed stats
    const agentWorkloads = agentsSnapshot.docs.map((agentDoc) => {
      const agentData = agentDoc.data();
      const agentId = agentDoc.id;
      const workload = workloadMap.get(agentId) || { completed: 0, pending: 0, total: 0 };

      return {
        agentId,
        agentName: agentData.name || 'Unknown Agent',
        agentEmail: agentData.email || 'No email',
        completedFiles: workload.completed,
        pendingFiles: workload.pending,
        totalWorkload: workload.total,
        isActive: agentData.isActive || false
      };
    });

    // SMART SORTING: Prioritize agents with less total work (completed + pending)
    const sortedAgents = agentWorkloads
      .filter(agent => agent.isActive)
      .sort((a, b) => {
        // Primary: Sort by total workload (less is better)
        if (a.totalWorkload !== b.totalWorkload) {
          return a.totalWorkload - b.totalWorkload;
        }
        // Secondary: If total is same, prioritize less pending
        if (a.pendingFiles !== b.pendingFiles) {
          return a.pendingFiles - b.pendingFiles;
        }
        // Tertiary: If pending is same, prioritize less completed
        return a.completedFiles - b.completedFiles;
      });

    if (sortedAgents.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No available agents for assignment' 
      }, { status: 404 });
    }

    console.log('Agent workloads before assignment:', sortedAgents.map(a => ({
      name: a.agentName,
      completed: a.completedFiles,
      pending: a.pendingFiles,
      total: a.totalWorkload
    })));

    // SMART DISTRIBUTION: Assign files in a way that prevents bulk assignments
    const assignments = [];
    let agentIndex = 0;

    // Use batch writes for efficiency
    const batches: any[] = [];
    let currentBatch = adminDb.batch();
    let operationCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const fileId of fileIds) {
      // Re-sort agents after each assignment to maintain fair distribution
      sortedAgents.sort((a, b) => {
        // Primary: Sort by pending files (current workload)
        if (a.pendingFiles !== b.pendingFiles) {
          return a.pendingFiles - b.pendingFiles;
        }
        // Secondary: Sort by total workload
        if (a.totalWorkload !== b.totalWorkload) {
          return a.totalWorkload - b.totalWorkload;
        }
        return 0;
      });

      // Select the agent with the least workload
      const selectedAgent = sortedAgents[0];

      // Add file update to batch
      const fileRef = adminDb.collection('files').doc(fileId);
      currentBatch.update(fileRef, {
        assignedAgentId: selectedAgent.agentId,
        assignedAt: new Date(),
        status: 'assigned',
        updatedAt: new Date()
      });
      operationCount++;

      // Update agent's pending and total workload for next iteration
      selectedAgent.pendingFiles++;
      selectedAgent.totalWorkload++;

      assignments.push({
        fileId,
        agentId: selectedAgent.agentId,
        agentName: selectedAgent.agentName,
        newPending: selectedAgent.pendingFiles,
        newTotal: selectedAgent.totalWorkload
      });

      // Commit batch if we hit the limit
      if (operationCount >= MAX_BATCH_SIZE) {
        batches.push(currentBatch);
        currentBatch = adminDb.batch();
        operationCount = 0;
      }
    }

    // Add remaining batch
    if (operationCount > 0) {
      batches.push(currentBatch);
    }

    // Commit all batches
    await Promise.all(batches.map(batch => batch.commit()));
    console.log(`Smart-assign: Committed ${batches.length} batch(es)`);

    console.log('Agent workloads after assignment:', sortedAgents.map(a => ({
      name: a.agentName,
      completed: a.completedFiles,
      pending: a.pendingFiles,
      total: a.totalWorkload
    })));

    // Log the assignment
    await adminDb.collection('logs').add({
      action: 'smart_auto_assignment',
      adminId: admin.adminId,
      adminName: admin.name,
      fileIds: fileIds,
      assignmentType,
      assignments: assignments,
      timestamp: new Date()
    });

    // Clear caches
    serverCache.deleteByPrefix(makeKey('assign'));
    serverCache.deleteByPrefix(makeKey('files'));
    serverCache.deleteByPrefix(makeKey('agent-files'));
    serverCache.deleteByPrefix(makeKey('agent-dashboard'));
    
    // CRITICAL: Clear user caches so users see updated file status (paid -> assigned/processing)
    userIds.forEach(userId => {
      serverCache.delete(makeKey('user_files', [userId]));
    });

    console.log(`Smart-assign total: ${Date.now() - startTime}ms`);
    return NextResponse.json({
      success: true,
      message: `Successfully assigned ${fileIds.length} file(s) using smart distribution`,
      assignments: assignments,
      totalAssigned: fileIds.length,
      distributionSummary: sortedAgents.map(a => ({
        agentName: a.agentName,
        completedFiles: a.completedFiles,
        pendingFiles: a.pendingFiles,
        totalWorkload: a.totalWorkload
      }))
    });

  } catch (error: any) {
    console.error('[PERF] Smart-assign error after:', Date.now() - startTime, 'ms');
    console.error('Error in smart assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to assign files' },
      { status: 500 }
    );
  }
}

// GET - Get comprehensive assignment statistics showing completed and pending files
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active agents
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .get();

    // Get ALL files to calculate both completed and pending counts per agent
    const allFilesSnapshot = await adminDb.collection('files')
      .limit(5000) // Reasonable limit
      .get();

    // Build comprehensive workload map
    const workloadMap = new Map<string, { completed: number; pending: number; total: number }>();
    let totalUnassigned = 0;
    
    allFilesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const agentId = data.assignedAgentId;
      const status = data.status;
      
      if (agentId) {
        const current = workloadMap.get(agentId) || { completed: 0, pending: 0, total: 0 };
        
        if (status === 'completed') {
          current.completed++;
        }
        
        if (status === 'paid' || status === 'assigned' || status === 'processing') {
          current.pending++;
        }
        
        current.total = current.completed + current.pending;
        workloadMap.set(agentId, current);
      } else if (status === 'paid') {
        totalUnassigned++;
      }
    });

    // Build comprehensive agent workload data
    const agentWorkloads = agentsSnapshot.docs.map((agentDoc) => {
      const agentData = agentDoc.data();
      const agentId = agentDoc.id;
      const workload = workloadMap.get(agentId) || { completed: 0, pending: 0, total: 0 };

      return {
        agentId,
        agentName: agentData.name || 'Unknown Agent',
        agentEmail: agentData.email || 'No email',
        completedFiles: workload.completed,
        pendingFiles: workload.pending,
        totalWorkload: workload.total,
        isActive: agentData.isActive || false
      };
    });

    // Sort by total workload
    agentWorkloads.sort((a, b) => {
      if (a.totalWorkload !== b.totalWorkload) {
        return a.totalWorkload - b.totalWorkload;
      }
      if (a.pendingFiles !== b.pendingFiles) {
        return a.pendingFiles - b.pendingFiles;
      }
      return a.completedFiles - b.completedFiles;
    });
    
    console.log(`Smart-assign GET total: ${Date.now() - startTime}ms`);
    return NextResponse.json({
      success: true,
      data: {
        agentWorkloads: agentWorkloads,
        unassignedFiles: totalUnassigned,
        totalAgents: agentWorkloads.length,
        activeAgents: agentWorkloads.filter(a => a.isActive).length,
        distributionSummary: {
          mostLoaded: agentWorkloads[agentWorkloads.length - 1],
          leastLoaded: agentWorkloads[0]
        }
      }
    });

  } catch (error: any) {
    console.error('[PERF] Smart-assign GET error after:', Date.now() - startTime, 'ms');
    console.error('Error fetching assignment stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch assignment statistics' },
      { status: 500 }
    );
  }
}
