import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    // Sign in with Firebase Auth
    const authStart = Date.now();
    const userRecord = await adminAuth.getUserByEmail(email);
 Firebase auth by email: ${Date.now() - authStart}ms`);
    
    // Verify the user exists in agents collection
    const queryStart = Date.now();
    const agentDoc = await adminDb.collection('agents').doc(userRecord.uid).get();
 Agent doc query: ${Date.now() - queryStart}ms`);
    
    if (!agentDoc.exists) {
      return NextResponse.json(
        { success: false, message: "Agent not found" },
        { status: 404 }
      );
    }

    const agentData = agentDoc.data();

    if (!agentData?.isActive) {
      return NextResponse.json(
        { success: false, message: "Account is deactivated" },
        { status: 403 }
      );
    }

    // Create custom token for agent
    const tokenStart = Date.now();
    const customToken = await adminAuth.createCustomToken(userRecord.uid, {
      role: 'agent',
      email: agentData.email,
      name: agentData.name
    });
 Custom token creation: ${Date.now() - tokenStart}ms`);

    // OPTIMIZATION: Parallel operations (update last login + set cookie)
    const operationStart = Date.now();
    const cookieStore = await cookies();
    await Promise.all([
      adminDb.collection('agents').doc(userRecord.uid).update({
        lastLoginAt: new Date()
      }),
      Promise.resolve(cookieStore.set('agent-token', customToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7 // 7 days
      }))
    ]);
 Parallel update and cookie set: ${Date.now() - operationStart}ms`);
 Agents auth login total: ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      message: "Agent login successful",
      user: {
        id: userRecord.uid,
        email: agentData.email,
        name: agentData.name,
        role: 'agent'
      }
    });

  } catch (error: any) {
    console.error("Agent login error:", error);
    
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
    // Clear the agent token cookie
    const cookieStore = await cookies();
    cookieStore.delete('agent-token');

    return NextResponse.json({
      success: true,
      message: "Agent logout successful"
    });

  } catch (error) {
    console.error("Agent logout error:", error);
    return NextResponse.json(
      { success: false, message: "Logout failed" },
      { status: 500 }
    );
  }
}
