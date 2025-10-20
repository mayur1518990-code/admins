import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

// POST - Create a test file to test automatic assignment
export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Creating test file for auto-assignment testing...');

    // Create a test file with paid status
    const testFileData = {
      userId: 'test-user-id',
      filename: 'test-file.pdf',
      originalName: 'Test File for Auto-Assignment.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      status: 'paid', // This should trigger auto-assignment
      uploadedAt: new Date(),
      assignedAgentId: null, // Not assigned yet
      assignedAt: null,
      updatedAt: new Date()
    };

    const docRef = await adminDb.collection('files').add(testFileData);
    const fileId = docRef.id;

    console.log(`Test file created with ID: ${fileId}`);

    // Log the test file creation
    await adminDb.collection('logs').add({
      action: 'test_file_created',
      adminId: admin.adminId,
      adminName: admin.name,
      fileId: fileId,
      details: {
        purpose: 'Testing automatic assignment',
        status: 'paid',
        assignedAgentId: null
      },
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'Test file created successfully',
      fileId: fileId,
      fileData: testFileData
    });

  } catch (error: any) {
    console.error('Error creating test file:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to create test file',
        details: error.message 
      },
      { status: 500 }
    );
  }
}
