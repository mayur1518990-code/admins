import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { serverCache, makeKey } from "@/lib/server-cache";
import { verifyAdminAuth } from "@/lib/admin-auth";

// Helper function to handle Firestore connection issues with retry logic
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a connection error that we should retry
      if (error.code === 14 || // UNAVAILABLE
          error.message?.includes('No connection established') ||
          error.message?.includes('network socket disconnected') ||
          error.message?.includes('TLS connection') ||
          error.code === 'ECONNRESET' ||
          error.code === 'ENOTFOUND') {
        
        // Retrying...
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
      }
      
      // If it's not a retryable error or we've exhausted retries, throw
      throw error;
    }
  }
  
  throw lastError;
}

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
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 100); // Cap at 100
    const search = (searchParams.get('search') || '').toLowerCase();
    const status = searchParams.get('status') || 'all';
    const includeStats = searchParams.get('includeStats') === 'true';

    // More aggressive caching - agent data changes infrequently
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
    
    // Apply reasonable limit to prevent fetching thousands of agents
    // For search, we need more records; otherwise use strict limit
    const queryLimit = search ? 1000 : limit * 2; // Allow some buffer for pagination
    baseQuery = baseQuery.limit(queryLimit);
    
    // Use retry logic for the main query
    const snapshot = await withRetry(() => baseQuery.get());

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

    // OPTIMIZED: Get stats for ALL agents in ONE BATCH QUERY instead of N queries
    let agentsWithStats = paginatedAgents;
    
    if (includeStats) {
      const agentIds = paginatedAgents.map(a => a.id);
      
      if (agentIds.length > 0) {
        // OPTIMIZED: Use aggregation queries with limits for better performance
        const statsMap = new Map<string, { totalFiles: number, completedFiles: number, pendingFiles: number }>();
        
        // Initialize all agents with zero stats
        agentIds.forEach(id => {
          statsMap.set(id, { totalFiles: 0, completedFiles: 0, pendingFiles: 0 });
        });
        
        // Process agents in batches of 10 (Firestore 'in' query limit)
        for (let i = 0; i < agentIds.length; i += 10) {
          const batchIds = agentIds.slice(i, Math.min(i + 10, agentIds.length));
          
          // Get files for this batch with limit to prevent huge queries
          const batchSnapshot = await withRetry(() => 
            adminDb.collection('files')
              .where('assignedAgentId', 'in', batchIds)
              .limit(1000) // Limit to prevent huge queries
              .get()
          );
          
          batchSnapshot.forEach(doc => {
            const data = doc.data();
            const agentId = data.assignedAgentId;
            if (agentId && statsMap.has(agentId)) {
              const stats = statsMap.get(agentId)!;
              stats.totalFiles += 1;
              if (data.status === 'completed') stats.completedFiles += 1;
              if (data.status === 'paid' || data.status === 'processing') stats.pendingFiles += 1;
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
      }
    } else {
      // ALWAYS return stats with default values to prevent undefined errors
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
    
    // Longer cache for agent data (5 minutes) since it changes infrequently
    serverCache.set(cacheKey, payload, 300_000); // 5 min cache
    return NextResponse.json(payload);

  } catch (error: any) {
    console.error("Error fetching agents:", error);
    
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
      { success: false, error: "Failed to fetch agents" },
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

    // Check if user already exists
    const existingUser = await adminAuth.getUserByEmail(trimmedEmail).catch(() => null);
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "User with this email already exists" },
        { status: 409 }
      );
    }

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
    console.error("Error creating agent:", error);
    
    if (error.code === 'adminAuth/email-already-exists') {
      return NextResponse.json(
        { success: false, error: "Agent with this email already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to create agent" },
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
    console.error("Error updating agent:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update agent" },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate agent (soft delete)
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
          error: `Cannot deactivate agent. ${pendingFilesSnapshot.size} files are still pending. Please reassign them first.` 
        },
        { status: 400 }
      );
    }

    // OPTIMIZED: Run deactivation operations in parallel
    await Promise.all([
      // Soft delete - deactivate agent in Firestore
      adminDb.collection('agents').doc(agentId).update({
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedBy: admin.adminId,
        updatedAt: new Date()
      }),
      // Disable agent in Firebase Auth
      adminAuth.updateUser(agentId, { disabled: true }),
      // Log the action
      adminDb.collection('logs').add({
        action: 'agent_deactivated',
        adminId: admin.adminId,
        adminName: admin.name,
        targetUserId: agentId,
        details: {
          reason: 'Admin deactivation'
        },
        timestamp: new Date()
      })
    ]);
    
    // Invalidate cache after successful deactivation
    serverCache.deleteByPrefix(makeKey('agents', ['list']));

    return NextResponse.json({
      success: true,
      message: "Agent deactivated successfully"
    });

  } catch (error: any) {
    console.error("Error deactivating agent:", error);
    return NextResponse.json(
      { success: false, error: "Failed to deactivate agent" },
      { status: 500 }
    );
  }
}
