import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, newPassword } = await request.json();

    if (!userId || !newPassword) {
      return NextResponse.json({ 
        success: false, 
        error: 'User ID and new password are required' 
      }, { status: 400 });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return NextResponse.json({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      }, { status: 400 });
    }

    // Get user data to verify they exist in any collection
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
      return NextResponse.json({ 
        success: false, 
        error: 'User not found in any collection' 
      }, { status: 404 });
    }

    const userData = userDoc.data();

    // Update password in Firebase Auth
    try {
      await adminAuth.updateUser(userData?.uid || userId, {
        password: newPassword
      });
    } catch (authError: any) {
      console.error('Error updating password in Firebase Auth:', authError);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update password in authentication system' 
      }, { status: 500 });
    }

    // Update user document in Firestore (using the correct collection)
    await adminDb.collection(collectionName).doc(userId).update({
      password: newPassword,
      updatedAt: new Date(),
      passwordUpdatedAt: new Date(),
      passwordUpdatedBy: admin.adminId
    });

    // Log the action
    await adminDb.collection('logs').add({
      action: 'password_updated',
      adminId: admin.adminId,
      adminName: admin.name,
      targetUserId: userId,
      targetUserName: userData?.name || 'Unknown',
      targetUserEmail: userData?.email || 'Unknown',
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating password:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update password' },
      { status: 500 }
    );
  }
}
