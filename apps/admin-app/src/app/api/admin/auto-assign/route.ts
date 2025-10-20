import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

// POST - Automatically assign files to agents based on workload
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileIds, assignmentType = 'auto_workload' } = await request.json();
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'File IDs are required' 
      }, { status: 400 });
    }

    console.log(`Auto-assign POST: Starting for ${fileIds.length} files`);

    // Get all active agents
    const agentsQueryStart = Date.now();
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .get();
    console.log(`Auto-assign POST: Agents query: ${Date.now() - agentsQueryStart}ms, count: ${agentsSnapshot.size}`);

    if (agentsSnapshot.empty) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active agents found' 
      }, { status: 404 });
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
        // Primary sort: by current workload
        if (a.currentWorkload !== b.currentWorkload) {
          return a.currentWorkload - b.currentWorkload;
        }
        // Secondary sort: by last assigned time (oldest first)
        if (a.lastAssigned && b.lastAssigned) {
          return new Date(a.lastAssigned).getTime() - new Date(b.lastAssigned).getTime();
        }
        // If one has no lastAssigned, prioritize it
        if (!a.lastAssigned && b.lastAssigned) return -1;
        if (a.lastAssigned && !b.lastAssigned) return 1;
        return 0;
      });

    if (sortedAgents.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No available agents for assignment' 
      }, { status: 404 });
    }

    // Assign files to agents using round-robin with workload consideration
    const assignmentStart = Date.now();
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
        console.log(`Auto-assign POST: Committed batch of ${operationCount} operations`);
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
      console.log(`Auto-assign POST: Final batch committed with ${operationCount} operations`);
    }

    console.log(`Auto-assign POST: Assignment logic: ${Date.now() - assignmentStart}ms`);

    // Log the automatic assignment
    await adminDb.collection('logs').add({
      action: 'auto_assignment',
      adminId: admin.adminId,
      adminName: admin.name,
      fileIds: fileIds,
      assignmentType,
      assignments: assignments,
      timestamp: new Date()
    });

    console.log(`Auto-assign POST total: ${Date.now() - startTime}ms`);
    return NextResponse.json({
      success: true,
      message: `Successfully auto-assigned ${fileIds.length} file(s)`,
      assignments: assignments,
      totalAssigned: fileIds.length
    });

  } catch (error: any) {
    console.error('[PERF] Auto-assign POST error after:', Date.now() - startTime, 'ms');
    console.error('Error in auto-assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to auto-assign files' },
      { status: 500 }
    );
  }
}

// GET - Get assignment statistics and agent workload
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }


    // Get all active agents
    const agentsQueryStart = Date.now();
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .get();
 Auto-assign GET: Agents query: ${Date.now() - agentsQueryStart}ms, count: ${agentsSnapshot.size}`);

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

    // Calculate agent workloads (no additional queries!)
    const agentWorkloads = agentsSnapshot.docs.map((agentDoc) => {
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

    // Get unassigned paid files with limit
    const unassignedFilesSnapshot = await adminDb.collection('files')
      .where('status', '==', 'paid')
      .where('assignedAgentId', '==', null)
      .limit(1000) // Limit to prevent huge queries
      .get();

 Auto-assign GET total: ${Date.now() - startTime}ms`);
    return NextResponse.json({
      success: true,
      data: {
        agentWorkloads: agentWorkloads.sort((a, b) => a.currentWorkload - b.currentWorkload),
        unassignedFiles: unassignedFilesSnapshot.size,
        totalAgents: agentWorkloads.length,
        activeAgents: agentWorkloads.filter(a => a.isActive).length
      }
    });

  } catch (error: any) {
    console.error('[PERF] Auto-assign GET error after:', Date.now() - startTime, 'ms');
    console.error('Error fetching assignment stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch assignment statistics' },
      { status: 500 }
    );
  }
}
