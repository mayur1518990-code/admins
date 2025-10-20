import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const { userId, password, collection } = await request.json();

    if (!userId || !password || !collection) {
      return NextResponse.json({ 
        success: false, 
        error: 'User ID, password, and collection are required' 
      }, { status: 400 });
    }

    // Validate collection name
    const validCollections = ['users', 'agents', 'admins'];
    if (!validCollections.includes(collection)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid collection name' 
      }, { status: 400 });
    }

    // Update the document to include password
    await adminDb.collection(collection).doc(userId).update({
      password: password,
      updatedAt: new Date()
    });

    return NextResponse.json({
      success: true,
      message: `Password updated successfully for ${collection} collection`
    });

  } catch (error: any) {
    console.error('Error updating password:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update password' },
      { status: 500 }
    );
  }
}
