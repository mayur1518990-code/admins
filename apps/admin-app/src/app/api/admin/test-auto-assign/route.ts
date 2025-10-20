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

// POST - Test automatic assignment by creating a test scenario
export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Test auto-assignment: Starting test scenario...');

    // Get all files
    const filesSnapshot = await adminDb.collection('files').get();
    const allFiles = filesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Test auto-assignment: Found ${allFiles.length} total files`);

    // Find a file to test with (preferably one that's assigned)
    const assignedFile = allFiles.find(file => 
      file.status === 'assigned' && file.assignedAgentId
    );

    if (!assignedFile) {
      return NextResponse.json({
        success: false,
        error: 'No assigned files found to test with',
        totalFiles: allFiles.length
      });
    }

    console.log(`Test auto-assignment: Using file ${assignedFile.id} for testing`);

    // Reset the file to paid status (unassigned)
    await adminDb.collection('files').doc(assignedFile.id).update({
      status: 'paid',
      assignedAgentId: null,
      assignedAt: null,
      updatedAt: new Date()
    });

    console.log(`Test auto-assignment: Reset file ${assignedFile.id} to paid status`);

    // Now test the automatic assignment
    const fileIds = [assignedFile.id];
    console.log(`Test auto-assignment: Attempting to assign file: ${fileIds.join(', ')}`);

    const autoAssignResult = await triggerAutoAssignment(fileIds);

    if (autoAssignResult.success) {
      console.log(`Test auto-assignment: Successfully assigned ${autoAssignResult.totalAssigned || 0} files`);
      
      return NextResponse.json({
        success: true,
        message: `Test auto-assignment completed: ${autoAssignResult.totalAssigned || 0} files assigned`,
        testFileId: assignedFile.id,
        assignedCount: autoAssignResult.totalAssigned || 0,
        assignments: autoAssignResult.assignments || []
      });
    } else {
      console.error('Test auto-assignment: Auto-assignment failed:', autoAssignResult.error);
      
      return NextResponse.json({
        success: false,
        error: autoAssignResult.error || 'Auto-assignment failed',
        testFileId: assignedFile.id,
        assignedCount: 0
      });
    }

  } catch (error: any) {
    console.error('Error in test auto-assignment:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to run test auto-assignment',
        details: error.message 
      },
      { status: 500 }
    );
  }
}
