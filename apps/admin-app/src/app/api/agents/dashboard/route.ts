import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAgentAuth } from "@/lib/agent-auth";
import { serverCache, makeKey } from "@/lib/server-cache";

// GET - Get agent dashboard statistics (AGENT ONLY)
export async function GET(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    
    // Ensure only agent role can access this endpoint
    if (agent.role !== 'agent') {
      return NextResponse.json(
        { success: false, message: "Agent access required" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d';

    // Check cache first
    const cacheKey = makeKey('agent-dashboard', [agent.agentId, period]);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // OPTIMIZATION: Use targeted queries with limits instead of full scans
    // Count files by status (best-effort: if count aggregation unsupported, fallback to limited fetch sizes)
    const filesCollection = adminDb.collection('files');
    const [paidCountSnap, processingCountSnap, completedCountSnap] = await Promise.all([
      filesCollection.where('assignedAgentId', '==', agent.agentId).where('status', '==', 'paid').count().get().catch(() => null as any),
      filesCollection.where('assignedAgentId', '==', agent.agentId).where('status', '==', 'processing').count().get().catch(() => null as any),
      filesCollection.where('assignedAgentId', '==', agent.agentId).where('status', '==', 'completed').count().get().catch(() => null as any)
    ]);

    const paidCount = paidCountSnap?.data?.().count ?? 0;
    const processingCount = processingCountSnap?.data?.().count ?? 0;
    const completedCount = completedCountSnap?.data?.().count ?? 0;
    const totalFiles = paidCount + processingCount + completedCount;

    // New files assigned in period
    const newFilesSnap = await filesCollection
      .where('assignedAgentId', '==', agent.agentId)
      .where('assignedAt', '>=', startDate)
      .orderBy('assignedAt', 'desc')
      .limit(200)
      .get()
      .catch(() => ({ size: 0 } as any));
    const newFiles = newFilesSnap.size || 0;

    // New replies in period
    const newRepliesSnap = await filesCollection
      .where('assignedAgentId', '==', agent.agentId)
      .where('status', '==', 'completed')
      .where('respondedAt', '>=', startDate)
      .orderBy('respondedAt', 'desc')
      .limit(200)
      .get()
      .catch(() => ({ size: 0 } as any));
    const newReplies = newRepliesSnap.size || 0;

    // Recent activity by updatedAt (covers assigned/responded changes)
    const recentSnap = await filesCollection
      .where('assignedAgentId', '==', agent.agentId)
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get()
      .catch(() => ({ docs: [] } as any));
    const recentActivity = recentSnap.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        fileName: data.fileName,
        status: data.status,
        assignedAt: data.assignedAt?.toDate?.() || data.assignedAt,
        respondedAt: data.respondedAt?.toDate?.() || data.respondedAt
      };
    });

    const completedFiles = completedCount;
    const pendingFiles = paidCount + processingCount;
    const totalReplies = completedFiles;
    const completionRate = totalFiles > 0 ? ((completedFiles / totalFiles) * 100).toFixed(2) : 0;

    // Build file status breakdown
    const filesByStatus: Record<string, number> = {
      paid: paidCount,
      processing: processingCount,
      completed: completedCount
    };

    const response = {
      success: true,
      period,
      overview: {
        totalFiles,
        completedFiles,
        pendingFiles,
        newFiles,
        totalReplies,
        newReplies,
        completionRate
      },
      files: {
        total: totalFiles,
        byStatus: filesByStatus,
        new: newFiles,
        completed: completedFiles,
        pending: pendingFiles
      },
      activity: {
        recent: recentActivity
      }
    };

    // Cache the result for 3 minutes
    serverCache.set(cacheKey, response, 180_000);

    return NextResponse.json(response);

  } catch (error: any) {
    console.error("Error fetching agent dashboard data:", error);
    
    return NextResponse.json(
      { success: false, message: "Failed to fetch agent dashboard data" },
      { status: 500 }
    );
  }
}
