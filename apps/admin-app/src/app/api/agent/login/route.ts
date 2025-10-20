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

    // Search for agent in agents collection by email
    const queryStart = Date.now();
    const agentsSnapshot = await adminDb.collection('agents')
      .where('email', '==', email)
      .limit(1)
      .get();
    

    if (agentsSnapshot.empty) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, { status: 401 });
    }

    const agentDoc = agentsSnapshot.docs[0];
    const agentData = agentDoc.data();
    const agentId = agentDoc.id;

    // Check if agent is active
    if (!agentData.isActive) {
      return NextResponse.json({ 
        success: false, 
        error: 'Agent account is deactivated' 
      }, { status: 401 });
    }

    // Check if password matches (stored in document)
    if (agentData.password !== password) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, { status: 401 });
    }

    // Check if Firebase Auth user exists, if not create one
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.getUser(agentId);
    } catch (error) {
      // User doesn't exist in Firebase Auth, create one
      try {
        firebaseUser = await adminAuth.createUser({
          uid: agentId,
          email: agentData.email,
          password: agentData.password,
          displayName: agentData.name,
          disabled: !agentData.isActive
        });
        
      } catch (createError) {
        console.error('Error creating Firebase Auth user:', createError);
        return NextResponse.json({ 
          success: false, 
          error: 'Failed to create authentication user' 
        }, { status: 500 });
      }
    }

    // Generate custom token for agent
    const customToken = await adminAuth.createCustomToken(agentId, {
      role: 'agent',
      agentId: agentId,
      name: agentData.name,
      email: agentData.email
    });

    // OPTIMIZATION: Parallel operations (update last login + log)
    await Promise.all([
      adminDb.collection('agents').doc(agentId).update({
        lastLoginAt: new Date(),
        updatedAt: new Date()
      }),
      adminDb.collection('logs').add({
        action: 'agent_login',
        agentId: agentId,
        agentName: agentData.name,
        agentEmail: agentData.email,
        timestamp: new Date()
      })
    ]);

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      data: {
        agentId: agentId,
        name: agentData.name,
        email: agentData.email,
        role: 'agent',
        customToken: customToken
      }
    });

  } catch (error: any) {
    console.error('Error in agent login:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    );
  }
}
