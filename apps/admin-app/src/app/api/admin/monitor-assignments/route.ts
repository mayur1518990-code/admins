import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

// Helper function to trigger automatic assignment for paid files
async function triggerAutoAssignment(fileIds: string[]) {
  const startTime = Date.now();
  try {
    console.log(`Monitor auto-assign: Starting for ${fileIds.length} files`);
    
    // Get all active agents
    const agentsQueryStart = Date.now();
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .get();
    console.log(`Monitor: Agents query: ${Date.now() - agentsQueryStart}ms, count: ${agentsSnapshot.size}`);

    if (agentsSnapshot.empty) {
      console.log('[MONITOR] No active agents found');
      return { success: false, error: 'No active agents found' };
    }

    // OPTIMIZED: Get ALL assigned files with limit to prevent huge queries
    const allAssignedFilesSnapshot = await adminDb.collection('files')
      .where('status', 'in', ['paid', 'assigned', 'in_progress'])
      .limit(2000) // Limit to prevent huge queries
      .get();

    // Build workload map from single query result
    const workloadMap = new Map<string, number>();
    allAssignedFilesSnapshot.docs.forEach(doc => {
      const agentId = doc.data().assignedAgentId;
      if (agentId) {
        workloadMap.set(agentId, (workloadMap.get(agentId) || 0) + 1);
      }
    });

    // Build agent workload array
    const agentWorkloads = agentsSnapshot.docs.map(agentDoc => {
      const agentData = agentDoc.data();
      const agentId = agentDoc.id;
      
      return {
        agentId,
        agentName: agentData.name || 'Unknown Agent',
        agentEmail: agentData.email || 'No email',
        currentWorkload: workloadMap.get(agentId) || 0,
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
      console.log('[MONITOR] No available agents for assignment');
      return { success: false, error: 'No available agents for assignment' };
    }

    // Assign files to agents using round-robin with workload consideration
    const assignments = [];
    const agentUpdates = new Map<string, Date>();
    let agentIndex = 0;

    // OPTIMIZED: Use Firestore batch writes (up to 500 operations per batch)
    let batch = adminDb.batch();
    let operationCount = 0;
    const MAX_BATCH_SIZE = 500;

    const assignmentStart = Date.now();
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
        console.log(`Monitor: Committed batch of ${operationCount} operations`);
        batch = adminDb.batch(); // Create new batch
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
      console.log(`Monitor: Final batch committed with ${operationCount} operations`);
    }

    console.log(`Monitor: Assignment logic: ${Date.now() - assignmentStart}ms`);
    console.log(`Monitor: Total time: ${Date.now() - startTime}ms (assigned: ${assignments.length})`);

    return {
      success: true,
      message: `Successfully auto-assigned ${fileIds.length} file(s)`,
      assignments: assignments,
      totalAssigned: fileIds.length
    };

  } catch (error) {
    console.error(`[PERF] Monitor error after: ${Date.now() - startTime}ms`);
    console.error('[MONITOR] Error in auto-assignment:', error);
    return { success: false, error: 'Auto-assignment failed' };
  }
}

// GET - Check for unassigned paid files and auto-assign them
export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Find all unassigned paid files with limit
    const unassignedPaidFilesSnapshot = await adminDb.collection('files')
      .where('status', '==', 'paid')
      .where('assignedAgentId', '==', null)
      .limit(1000) // Limit to prevent huge queries
      .get();

    if (unassignedPaidFilesSnapshot.empty) {
      return NextResponse.json({
        success: true,
        message: 'No unassigned paid files found',
        assignedCount: 0
      });
    }

    const unassignedFiles = unassignedPaidFilesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Found ${unassignedFiles.length} unassigned paid files`);

    // Auto-assign all unassigned paid files
    const fileIds = unassignedFiles.map(file => file.id);
    const autoAssignResult = await triggerAutoAssignment(fileIds);

    if (autoAssignResult.success) {
      return NextResponse.json({
        success: true,
        message: `Auto-assigned ${autoAssignResult.totalAssigned || 0} files`,
        assignedCount: autoAssignResult.totalAssigned || 0,
        assignments: autoAssignResult.assignments || []
      });
    } else {
      return NextResponse.json({
        success: false,
        error: autoAssignResult.error || 'Auto-assignment failed',
        assignedCount: 0
      });
    }

  } catch (error: any) {
    console.error('Error in monitor assignments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to monitor assignments' },
      { status: 500 }
    );
  }
}

// POST - Manually trigger assignment monitoring
export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { force = false } = await request.json();

    // Find all unassigned paid files with limit
    const unassignedPaidFilesSnapshot = await adminDb.collection('files')
      .where('status', '==', 'paid')
      .where('assignedAgentId', '==', null)
      .limit(1000) // Limit to prevent huge queries
      .get();

    if (unassignedPaidFilesSnapshot.empty) {
      return NextResponse.json({
        success: true,
        message: 'No unassigned paid files found',
        assignedCount: 0
      });
    }

    const unassignedFiles = unassignedPaidFilesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Manual trigger: Found ${unassignedFiles.length} unassigned paid files`);

    // Auto-assign all unassigned paid files
    const fileIds = unassignedFiles.map(file => file.id);
    const autoAssignResult = await triggerAutoAssignment(fileIds);

    if (autoAssignResult.success) {
      // Log the manual trigger
      await adminDb.collection('logs').add({
        action: 'manual_assignment_trigger',
        adminId: admin.adminId,
        adminName: admin.name,
        fileIds: fileIds,
        assignedCount: autoAssignResult.totalAssigned || 0,
        timestamp: new Date()
      });

      return NextResponse.json({
        success: true,
        message: `Manually triggered assignment of ${autoAssignResult.totalAssigned || 0} files`,
        assignedCount: autoAssignResult.totalAssigned || 0,
        assignments: autoAssignResult.assignments || []
      });
    } else {
      return NextResponse.json({
        success: false,
        error: autoAssignResult.error || 'Auto-assignment failed',
        assignedCount: 0
      });
    }

  } catch (error: any) {
    console.error('Error in manual assignment trigger:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to trigger assignments' },
      { status: 500 }
    );
  }
}
