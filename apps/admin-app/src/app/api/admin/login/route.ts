import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ 
        success: false, 
        error: 'Email and password are required' 
      }, { status: 400 });
    }

    // Search for admin in admins collection by email
    const adminsSnapshot = await adminDb.collection('admins')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (adminsSnapshot.empty) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, { status: 401 });
    }

    const adminDoc = adminsSnapshot.docs[0];
    const adminData = adminDoc.data();
    const adminId = adminDoc.id;

    // Check if admin is active
    if (!adminData.isActive) {
      return NextResponse.json({ 
        success: false, 
        error: 'Admin account is deactivated' 
      }, { status: 401 });
    }

    // Check if password matches (stored in document)
    if (adminData.password !== password) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, { status: 401 });
    }

    // Check if Firebase Auth user exists, if not create one
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.getUser(adminId);
    } catch (error) {
      // User doesn't exist in Firebase Auth, create one
      try {
        firebaseUser = await adminAuth.createUser({
          uid: adminId,
          email: adminData.email,
          password: adminData.password,
          displayName: adminData.name,
          disabled: !adminData.isActive
        });
        console.log('Created Firebase Auth user for admin:', adminId);
      } catch (createError) {
        console.error('Error creating Firebase Auth user:', createError);
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to create authentication user' 
        }, { status: 500 });
      }
    }

    // Generate custom token for admin
    console.log('[Admin Login] Generating custom token for:', {
      adminId,
      email: adminData.email,
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    
    const customToken = await adminAuth.createCustomToken(adminId, {
      role: 'admin',
      adminId: adminId,
      name: adminData.name,
      email: adminData.email
    });
    
    console.log('[Admin Login] Custom token generated successfully');

    // Update last login time
    await adminDb.collection('admins').doc(adminId).update({
      lastLoginAt: new Date(),
      updatedAt: new Date()
    });

    // Log the login
    await adminDb.collection('logs').add({
      action: 'admin_login',
      adminId: adminId,
      adminName: adminData.name,
      adminEmail: adminData.email,
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      data: {
        adminId: adminId,
        name: adminData.name,
        email: adminData.email,
        role: 'admin',
        customToken: customToken
      }
    });

  } catch (error: any) {
    console.error('Error in admin login:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    );
  }
}
