import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

// POST - Reset user password
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "User ID is required" },
        { status: 400 }
      );
    }

    // Check if user exists in any collection
    let userDoc = null;
    let collectionName = '';
    
    // Try to find user in each collection
    const collections = ['users', 'agents', 'admins'];
    for (const collection of collections) {
      const doc = await adminDb.collection(collection).doc(userId).get();
      if (doc.exists) {
        userDoc = doc;
        collectionName = collection;
        break;
      }
    }
    
    if (!userDoc) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Generate a random temporary password
    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase() + '!';

    // Update user password in Firebase Auth
    await adminAuth.updateUser(userId, { password: tempPassword });

    // Log the action
    await adminDb.collection('logs').add({
      actionType: 'password_reset',
      actorId: admin.adminId,
      actorType: 'admin',
      targetUserId: userId,
      details: {
        resetBy: admin.adminId,
        resetAt: new Date()
      },
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: "Password reset successfully",
      data: {
        tempPassword: tempPassword // In production, you might want to send this via email instead
      }
    });

  } catch (error: any) {
    console.error("Error resetting password:", error);
    
    if (error.message.includes("adminAuthentication")) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to reset password" },
      { status: 500 }
    );
  }
}
