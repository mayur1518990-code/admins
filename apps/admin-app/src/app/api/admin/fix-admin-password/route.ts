import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const { adminId, password } = await request.json();

    if (!adminId || !password) {
      return NextResponse.json({ 
        success: false, 
        error: 'Admin ID and password are required' 
      }, { status: 400 });
    }

    // Update the admin document to include password
    await adminDb.collection('admins').doc(adminId).update({
      password: password,
      updatedAt: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'Admin password updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating admin password:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update admin password' },
      { status: 500 }
    );
  }
}
