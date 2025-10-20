import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

// Helper function to trigger automatic assignment for paid files
async function triggerAutoAssignment(fileIds: string[]) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/admin/auto-assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileIds: fileIds,
        assignmentType: 'auto_workload'
      })
    });
    
    const result = await response.json();
    console.log('Test auto-assignment result:', result);
    return result;
  } catch (error) {
    console.error('Error triggering test auto-assignment:', error);
    return { success: false, error: 'Auto-assignment failed' };
  }
}

// GET - Test assignment for debugging
export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Test assignment: Starting...');

    // Get all files
    const filesSnapshot = await adminDb.collection('files').get();
    const allFiles = filesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Test assignment: Found ${allFiles.length} total files`);

    // Find unassigned paid files
    const unassignedPaidFiles = allFiles.filter(file => 
      file.status === 'paid' && !file.assignedAgentId
    );

    console.log(`Test assignment: Found ${unassignedPaidFiles.length} unassigned paid files`);

    if (unassignedPaidFiles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No unassigned paid files found',
        totalFiles: allFiles.length,
        unassignedPaidFiles: 0,
        assignedCount: 0
      });
    }

    // Get agent information
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .get();

    console.log(`Test assignment: Found ${agentsSnapshot.size} active agents`);

    if (agentsSnapshot.empty) {
      return NextResponse.json({
        success: false,
        error: 'No active agents found',
        totalFiles: allFiles.length,
        unassignedPaidFiles: unassignedPaidFiles.length,
        activeAgents: 0
      });
    }

    // Try to assign files
    const fileIds = unassignedPaidFiles.map(file => file.id);
    console.log(`Test assignment: Attempting to assign files: ${fileIds.join(', ')}`);

    const autoAssignResult = await triggerAutoAssignment(fileIds);

    if (autoAssignResult.success) {
      console.log(`Test assignment: Successfully assigned ${autoAssignResult.totalAssigned || 0} files`);
      
      return NextResponse.json({
        success: true,
        message: `Test assignment completed: ${autoAssignResult.totalAssigned || 0} files assigned`,
        totalFiles: allFiles.length,
        unassignedPaidFiles: unassignedPaidFiles.length,
        assignedCount: autoAssignResult.totalAssigned || 0,
        assignments: autoAssignResult.assignments || [],
        activeAgents: agentsSnapshot.size
      });
    } else {
      console.error('Test assignment: Auto-assignment failed:', autoAssignResult.error);
      
      return NextResponse.json({
        success: false,
        error: autoAssignResult.error || 'Auto-assignment failed',
        totalFiles: allFiles.length,
        unassignedPaidFiles: unassignedPaidFiles.length,
        assignedCount: 0,
        activeAgents: agentsSnapshot.size
      });
    }

  } catch (error: any) {
    console.error('Error in test assignment:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to run test assignment',
        details: error.message 
      },
      { status: 500 }
    );
  }
}
