import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { cookies } from "next/headers";
import { serverCache, makeKey } from "@/lib/server-cache";

// Helper function to verify agent authentication
async function verifyAgentAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('agent-token')?.value;
  
  if (!token) {
    throw new Error("No authentication token found");
  }

  // In a real implementation, you would verify the JWT token here
  // For now, we'll assume the token is valid if it exists
  return { agentId: "agent_123", name: "Agent Name" }; // Placeholder
}

export async function GET(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'paid';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Check cache first (only for first page)
    const cacheKey = makeKey('agents-files', [agent.agentId, status, limit, offset]);
    if (offset === 0) {
      const cached = serverCache.get<any>(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // OPTIMIZATION: Single query to get files (limit + 1 to check hasMore)
    const baseQuery = adminDb.collection('files')
      .where('status', '==', status)
      .where('assignedAgentId', '==', agent.agentId);
    let snapshot;
    let ordered = false;
    try {
      // Prefer ordered query for stable pagination if index exists
      snapshot = await baseQuery
        .orderBy('uploadedAt', 'desc')
        .limit(limit + 1)
        .get();
      ordered = true;
    } catch (e: any) {
      // Fallback: if index is missing, retry without orderBy
      snapshot = await baseQuery
        .limit(limit + 1)
        .get();
      ordered = false;
    }

    if (offset > 0) {
      // For pagination, you would need to implement cursor-based pagination
      // This is a simplified version
    }

    
    // Check if there are more results
    const hasMore = snapshot.docs.length > limit;
    const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

    const files = docs.map(doc => {
      const data = doc.data();
      return {
        fileId: doc.id,
        fileName: data.originalName,
        userId: data.userId,
        uploadedAt: data.uploadedAt?.toDate?.() || data.uploadedAt,
        status: data.status,
        mimeType: data.mimeType,
        size: data.size,
        hasResponse: !!data.responseFileURL,
        respondedAt: data.respondedAt?.toDate?.() || data.respondedAt
      };
    });

    // If we couldn't order in Firestore, sort by uploadedAt in-memory
    if (!ordered) {
      files.sort((a, b) => {
        const aTime = new Date(a.uploadedAt || 0).getTime();
        const bTime = new Date(b.uploadedAt || 0).getTime();
        return bTime - aTime;
      });
    }

    // OPTIMIZATION: Use the same query result for total count estimation
    // For accurate count, we use snapshot.size, but for large datasets
    // we can estimate based on hasMore flag
    const total = hasMore ? limit + offset + 1 : files.length + offset;

    const response = {
      success: true,
      files,
      pagination: {
        total,
        limit,
        offset,
        hasMore
      }
    };

    // Cache the result for 3 minutes (only first page)
    if (offset === 0) {
      serverCache.set(cacheKey, response, 180_000);
    }

    return NextResponse.json(response);

  } catch (error: any) {
    console.error("Error fetching agent files:", error);
    
    if (error.message.includes("authentication")) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to fetch files" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();

    const { fileId, status, notes } = await request.json();

    if (!fileId) {
      return NextResponse.json(
        { success: false, message: "File ID is required" },
        { status: 400 }
      );
    }

    // Update file status
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (notes) {
      updateData.agentNotes = notes;
    }

    if (status === 'processing') {
      updateData.processingStartedAt = new Date();
    }

    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    // OPTIMIZATION: Parallel operations
    const operationStart = Date.now();
    await Promise.all([
      adminDb.collection('files').doc(fileId).update(updateData),
      adminDb.collection('logs').add({
        actionType: 'file_status_update',
        actorId: agent.agentId,
        actorType: 'agent',
        fileId,
        details: {
          newStatus: status,
          notes
        },
        timestamp: new Date()
      })
    ]);
 Parallel file update and log: ${Date.now() - operationStart}ms`);

    // Invalidate cache
    serverCache.deleteByPrefix('agents-files:');
    serverCache.deleteByPrefix('agent-files:');

 Agents files PATCH total: ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      message: "File status updated successfully"
    });

  } catch (error: any) {
    console.error("Error updating file status:", error);
    
    if (error.message.includes("authentication")) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to update file status" },
      { status: 500 }
    );
  }
}
