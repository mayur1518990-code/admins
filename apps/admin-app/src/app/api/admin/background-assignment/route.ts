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
    console.log('Background auto-assignment result:', result);
    return result;
  } catch (error) {
    console.error('Error in background auto-assignment:', error);
    return { success: false, error: 'Auto-assignment failed' };
  }
}

// GET - Background assignment check (can be called by cron jobs)
export async function GET(request: NextRequest) {
  try {
    // This endpoint can be called without authentication for cron jobs
    // But we'll add a simple token check for security
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.BACKGROUND_ASSIGNMENT_TOKEN || 'admin-background-token';
    
    if (authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Background assignment check started...');

    // Find all unassigned paid files
    const unassignedPaidFilesSnapshot = await adminDb.collection('files')
      .where('status', '==', 'paid')
      .where('assignedAgentId', '==', null)
      .get();

    if (unassignedPaidFilesSnapshot.empty) {
      console.log('No unassigned paid files found');
      return NextResponse.json({
        success: true,
        message: 'No unassigned paid files found',
        assignedCount: 0,
        timestamp: new Date().toISOString()
      });
    }

    const unassignedFiles = unassignedPaidFilesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Background check: Found ${unassignedFiles.length} unassigned paid files`);

    // Auto-assign all unassigned paid files
    const fileIds = unassignedFiles.map(file => file.id);
    const autoAssignResult = await triggerAutoAssignment(fileIds);

    if (autoAssignResult.success) {
      // Log the background assignment
      await adminDb.collection('logs').add({
        action: 'background_auto_assignment',
        adminId: 'system',
        adminName: 'Background Service',
        fileIds: fileIds,
        assignedCount: autoAssignResult.totalAssigned || 0,
        timestamp: new Date()
      });

      console.log(`Background assignment completed: ${autoAssignResult.totalAssigned || 0} files assigned`);

      return NextResponse.json({
        success: true,
        message: `Background auto-assigned ${autoAssignResult.totalAssigned || 0} files`,
        assignedCount: autoAssignResult.totalAssigned || 0,
        assignments: autoAssignResult.assignments || [],
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('Background auto-assignment failed:', autoAssignResult.error);
      return NextResponse.json({
        success: false,
        error: autoAssignResult.error || 'Background auto-assignment failed',
        assignedCount: 0,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error: any) {
    console.error('Error in background assignment:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to run background assignment',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// POST - Manual trigger for background assignment
export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Manual background assignment trigger started...');

    // Find all unassigned paid files
    const unassignedPaidFilesSnapshot = await adminDb.collection('files')
      .where('status', '==', 'paid')
      .where('assignedAgentId', '==', null)
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

    console.log(`Manual background trigger: Found ${unassignedFiles.length} unassigned paid files`);

    // Auto-assign all unassigned paid files
    const fileIds = unassignedFiles.map(file => file.id);
    const autoAssignResult = await triggerAutoAssignment(fileIds);

    if (autoAssignResult.success) {
      // Log the manual background trigger
      await adminDb.collection('logs').add({
        action: 'manual_background_assignment',
        adminId: admin.adminId,
        adminName: admin.name,
        fileIds: fileIds,
        assignedCount: autoAssignResult.totalAssigned || 0,
        timestamp: new Date()
      });

      return NextResponse.json({
        success: true,
        message: `Manual background assignment completed: ${autoAssignResult.totalAssigned || 0} files assigned`,
        assignedCount: autoAssignResult.totalAssigned || 0,
        assignments: autoAssignResult.assignments || []
      });
    } else {
      return NextResponse.json({
        success: false,
        error: autoAssignResult.error || 'Background auto-assignment failed',
        assignedCount: 0
      });
    }

  } catch (error: any) {
    console.error('Error in manual background assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to trigger background assignment' },
      { status: 500 }
    );
  }
}
