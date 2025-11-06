import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { serverCache, makeKey } from "@/lib/server-cache";
import { verifyAdminAuth } from "@/lib/admin-auth";

// Firestore has built-in retries, removed duplicate retry logic

// GET - List all agents
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 30); // OPTIMIZED: Reduced from 100 to 30
    const search = (searchParams.get('search') || '').toLowerCase();
    const status = searchParams.get('status') || 'all';
    const includeStats = searchParams.get('includeStats') === 'true'; // OFF by default for speed

    // Longer cache TTL - agent data changes infrequently  
    const cacheKey = makeKey('agents', ['list', page, limit, status || 'all', search || '', includeStats]);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Build optimized Firestore query with database-level limits
    let baseQuery: FirebaseFirestore.Query = adminDb.collection('agents');
    
    // Apply status filter at database level
    if (status !== 'all') {
      const isActive = status === 'active';
      baseQuery = baseQuery.where('isActive', '==', isActive);
    }
    
    // Sort by createdAt desc
    baseQuery = baseQuery.orderBy('createdAt', 'desc');
    
    // Apply reasonable limit - further reduced for performance
    const queryLimit = search ? 100 : Math.min(limit * 2, 50);
    baseQuery = baseQuery.limit(queryLimit);
    
    const snapshot = await baseQuery.get();

    // Map agents data (minimal transformation)
    let agents = snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        email: data.email,
        name: data.name,
        isActive: data.isActive,
        createdAt: data.createdAt,
        lastLoginAt: data.lastLoginAt,
        phone: data.phone,
        role: 'agent' 
      };
    });
    
    // Apply search filter in memory (Firestore doesn't support LIKE queries)
    if (search) {
      agents = agents.filter(agent =>
        agent.name?.toLowerCase().includes(search) ||
        agent.email?.toLowerCase().includes(search) ||
        agent.phone?.toLowerCase().includes(search)
      );
    }

    const totalAgents = agents.length;

    // Apply pagination in memory
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedAgents = agents.slice(startIndex, endIndex);

    // OPTIMIZED: Get stats efficiently with single query when needed
    let agentsWithStats = paginatedAgents;
    
    if (includeStats && paginatedAgents.length > 0) {
      const agentIds = paginatedAgents.map(a => a.id);
      const statsMap = new Map<string, { totalFiles: number, completedFiles: number, pendingFiles: number }>();
      
      // Initialize all agents with zero stats
      agentIds.forEach(id => {
        statsMap.set(id, { totalFiles: 0, completedFiles: 0, pendingFiles: 0 });
      });
      
      // OPTIMIZED: Fetch only recent files (last 100 per batch) for speed
      // Firestore 'in' supports up to 10 values, so batch if needed
      for (let i = 0; i < agentIds.length; i += 10) {
        const batchIds = agentIds.slice(i, i + 10);
        
        const batchSnapshot = await adminDb.collection('files')
          .where('assignedAgentId', 'in', batchIds)
          .select('assignedAgentId', 'status') // Only fetch needed fields
          .orderBy('uploadedAt', 'desc')
          .limit(100) // Only last 100 files for stats
          .get();
        
        // Process results
        batchSnapshot.forEach(doc => {
          const data = doc.data();
          const agentId = data.assignedAgentId;
          if (agentId && statsMap.has(agentId)) {
            const stats = statsMap.get(agentId)!;
            stats.totalFiles++;
            if (data.status === 'completed') stats.completedFiles++;
            if (data.status === 'paid' || data.status === 'processing') stats.pendingFiles++;
          }
        });
      }

      agentsWithStats = paginatedAgents.map(agent => ({
        id: agent.id,
        email: agent.email,
        name: agent.name,
        role: 'agent',
        isActive: agent.isActive,
        createdAt: agent.createdAt?.toDate?.() || agent.createdAt,
        lastLoginAt: agent.lastLoginAt?.toDate?.() || agent.lastLoginAt,
        phone: agent.phone || null,
        stats: statsMap.get(agent.id) || { totalFiles: 0, completedFiles: 0, pendingFiles: 0 }
      }));
    } else {
      // Return agents without stats
      agentsWithStats = paginatedAgents.map(agent => ({
        id: agent.id,
        email: agent.email,
        name: agent.name,
        role: 'agent',
        isActive: agent.isActive,
        createdAt: agent.createdAt?.toDate?.() || agent.createdAt,
        lastLoginAt: agent.lastLoginAt?.toDate?.() || agent.lastLoginAt,
        phone: agent.phone || null,
        stats: { totalFiles: 0, completedFiles: 0, pendingFiles: 0 }
      }));
    }

    const payload = {
      success: true,
      agents: agentsWithStats,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalAgents,
        pages: Math.ceil(totalAgents / Number(limit)),
        hasMore: endIndex < totalAgents
      }
    };
    
    // Longer cache for agent data - 5 minutes for better performance
    serverCache.set(cacheKey, payload, 300_000); // 5 minute cache
    return NextResponse.json(payload);

  } catch (error: any) {
    // Handle specific error types
    if (error.code === 14 || error.message?.includes('No connection established')) {
      return NextResponse.json(
        { success: false, error: "Database connection failed. Please try again." },
        { status: 503 }
      );
    }
    
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return NextResponse.json(
        { success: false, error: "Request timed out. Please try again." },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: "Failed to fetch agents", message: error?.message || "Failed to fetch agents" },
      { status: 500 }
    );
  }
}

// POST - Create new agent
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { email, name, password, phone } = await request.json();

    // Trim and validate inputs
    const trimmedEmail = email?.trim();
    const trimmedName = name?.trim();
    
    if (!trimmedEmail || !trimmedName || !password) {
      return NextResponse.json(
        { success: false, error: "Email, name, and password are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    // Validate password length
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: "Password must be at least 6 characters long" },
        { status: 400 }
      );
    }

    // OPTIMIZED: Removed redundant email check - Firebase Auth will throw error if exists
    // This saves ~1.5 seconds per request!

    // Create user in Firebase Auth
    const userRecord = await adminAuth.createUser({
      email: trimmedEmail,
      password,
      displayName: trimmedName
    });

    // Create agent document in agents collection
    const agentData = {
      email: trimmedEmail,
      name: trimmedName,
      phone: phone?.trim() || null,
      isActive: true,
      createdAt: new Date(),
      createdBy: admin.adminId,
      // Agent-specific fields
      maxConcurrentFiles: 10, // Default limit
      specializations: [], // Can be added later
      performance: {
        totalFilesProcessed: 0,
        averageResponseTime: 0,
        rating: 0
      }
    };

    // OPTIMIZED: Run Firestore writes in parallel
    await Promise.all([
      adminDb.collection('agents').doc(userRecord.uid).set(agentData),
      // Log the action
      adminDb.collection('logs').add({
        action: 'agent_created',
        adminId: admin.adminId,
        adminName: admin.name,
        targetUserId: userRecord.uid,
        details: {
          email: trimmedEmail,
          name: trimmedName,
          phone: phone?.trim() || null
        },
        timestamp: new Date()
      })
    ]);
    
    // Invalidate cache after successful creation
    serverCache.deleteByPrefix(makeKey('agents', ['list']));

    return NextResponse.json({
      success: true,
      message: "Agent created successfully",
      data: {
        agent: {
          id: userRecord.uid,
          email: trimmedEmail,
          name: trimmedName,
          isActive: true,
          createdAt: agentData.createdAt,
          phone: phone?.trim() || null
        }
      }
    });

  } catch (error: any) {
    if (error.code === 'auth/email-already-exists' || error.code === 'adminAuth/email-already-exists') {
      return NextResponse.json(
        { success: false, error: "Agent with this email already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to create agent", message: error?.message || "Failed to create agent" },
      { status: 500 }
    );
  }
}

// PUT - Update agent
export async function PUT(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { agentId, name, email, isActive, phone, maxConcurrentFiles, specializations } = await request.json();

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: "Agent ID is required" },
        { status: 400 }
      );
    }

    // Check if agent exists
    const agentDoc = await adminDb.collection('agents').doc(agentId).get();
    if (!agentDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    const updateData: any = {
      updatedAt: new Date(),
      updatedBy: admin.adminId
    };

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (phone !== undefined) updateData.phone = phone;
    if (maxConcurrentFiles !== undefined) updateData.maxConcurrentFiles = maxConcurrentFiles;
    if (specializations !== undefined) updateData.specializations = specializations;

    // OPTIMIZED: Run Firestore updates and Auth updates in parallel
    const updatePromises: Promise<any>[] = [
      adminDb.collection('agents').doc(agentId).update(updateData)
    ];

    // Build Auth update object
    const authUpdates: any = {};
    if (email !== undefined) authUpdates.email = email;
    if (isActive !== undefined) authUpdates.disabled = !isActive;
    
    // If there are auth updates, add to parallel execution
    if (Object.keys(authUpdates).length > 0) {
      updatePromises.push(adminAuth.updateUser(agentId, authUpdates));
    }

    // Add logging to parallel execution
    updatePromises.push(
      adminDb.collection('logs').add({
        action: 'agent_updated',
        adminId: admin.adminId,
        adminName: admin.name,
        targetUserId: agentId,
        details: updateData,
        timestamp: new Date()
      })
    );

    // Execute all updates in parallel
    await Promise.all(updatePromises);
    
    // Invalidate cache after successful update
    serverCache.deleteByPrefix(makeKey('agents', ['list']));

    return NextResponse.json({
      success: true,
      message: "Agent updated successfully"
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: "Failed to update agent", message: error?.message || "Failed to update agent" },
      { status: 500 }
    );
  }
}

// DELETE - Hard delete agent (complete removal)
export async function DELETE(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: "Agent ID is required" },
        { status: 400 }
      );
    }

    // Check if agent exists
    const agentDoc = await adminDb.collection('agents').doc(agentId).get();
    if (!agentDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Check if agent has pending files
    const pendingFilesSnapshot = await adminDb.collection('files')
      .where('assignedAgentId', '==', agentId)
      .where('status', 'in', ['paid', 'processing'])
      .get();

    if (pendingFilesSnapshot.size > 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Cannot delete agent. ${pendingFilesSnapshot.size} files are still pending. Please reassign them first.` 
        },
        { status: 400 }
      );
    }

    const agentData = agentDoc.data();

    // HARD DELETE: Remove agent completely from database and auth
    await Promise.all([
      // Delete agent from Firestore
      adminDb.collection('agents').doc(agentId).delete(),
      // Delete agent from Firebase Auth
      adminAuth.deleteUser(agentId),
      // Log the action
      adminDb.collection('logs').add({
        action: 'agent_deleted',
        adminId: admin.adminId,
        adminName: admin.name,
        targetUserId: agentId,
        details: {
          reason: 'Admin deletion',
          agentName: agentData?.name || 'Unknown',
          agentEmail: agentData?.email || 'Unknown'
        },
        timestamp: new Date()
      })
    ]);
    
    // Invalidate cache after successful deletion
    serverCache.deleteByPrefix(makeKey('agents', ['list']));
    serverCache.deleteByPrefix(makeKey('users-agents')); // Also invalidate user-agent cache

    return NextResponse.json({
      success: true,
      message: "Agent deleted successfully"
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: "Failed to delete agent", message: error?.message || "Failed to delete agent" },
      { status: 500 }
    );
  }
}
