import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    // Sign in with Firebase Auth
    const userRecord = await adminAuth.getUserByEmail(email);
    
    // Verify the user exists in admins collection
    const adminDoc = await adminDb.collection('admins').doc(userRecord.uid).get();
    
    if (!adminDoc.exists) {
      return NextResponse.json(
        { success: false, message: "Admin not found" },
        { status: 404 }
      );
    }

    const adminData = adminDoc.data();

    if (!adminData?.isActive) {
      return NextResponse.json(
        { success: false, message: "Account is deactivated" },
        { status: 403 }
      );
    }

    // Create custom token for admin
    const customToken = await adminAuth.createCustomToken(userRecord.uid, {
      role: 'admin',
      email: adminData.email,
      name: adminData.name
    });

    // Update last login
    await adminDb.collection('admins').doc(userRecord.uid).update({
      lastLoginAt: new Date()
    });

    // Set HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set('admin-token', customToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    return NextResponse.json({
      success: true,
      message: "Admin login successful",
      user: {
        id: userRecord.uid,
        email: adminData.email,
        name: adminData.name,
        role: 'admin'
      }
    });

  } catch (error: any) {
    console.error("Admin login error:", error);
    
    if (error.code === 'auth/user-not-found') {
      return NextResponse.json(
        { success: false, message: "Invalid credentials" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Login failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Clear the admin token cookie
    const cookieStore = await cookies();
    cookieStore.delete('admin-token');

    return NextResponse.json({
      success: true,
      message: "Admin logout successful"
    });

  } catch (error) {
    console.error("Admin logout error:", error);
    return NextResponse.json(
      { success: false, message: "Logout failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    if (!token) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    // In a real implementation, you would verify the JWT token here
    // For now, we'll return a placeholder response
    return NextResponse.json({
      success: true,
      message: "Admin authenticated",
      user: {
        id: "admin_123",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin"
      }
    });

  } catch (error) {
    console.error("Admin verification error:", error);
    return NextResponse.json(
      { success: false, message: "Authentication verification failed" },
      { status: 500 }
    );
  }
}
