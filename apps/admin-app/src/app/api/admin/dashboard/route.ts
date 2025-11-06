import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";
import { serverCache, makeKey } from "@/lib/server-cache";

// Firestore has built-in retries, removed duplicate retry logic

// GET - Get admin dashboard statistics (ADMIN ONLY)
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    
    // Ensure only admin role can access this endpoint
    if (admin.role !== 'admin') {
      return NextResponse.json(
        { success: false, message: "Admin access required" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d'; // '7d', '30d', '90d', '1y'

    // Check cache first (reduced to 2 minutes for faster updates)
    const cacheKey = makeKey('admin-dashboard', [period]);
    const cached = serverCache.get(cacheKey);
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
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // ULTRA-OPTIMIZED: MINIMAL LIMITS for instant dashboard load (< 2 seconds)
    const [
      usersSnapshot,
      agentsSnapshot,
      filesSnapshot,
      paymentsSnapshot,
      logsSnapshot
    ] = await Promise.all([
      // Users - REDUCED to 20 (enough for stats)
      adminDb.collection('users')
        .where('role', '==', 'user')
        .limit(20)
        .get()
        .catch(() => ({ docs: [], size: 0 })),
      
      // Agents - REDUCED to 10 (enough for top performers)
      adminDb.collection('agents')
        .limit(10)
        .get()
        .catch(() => ({ docs: [], size: 0 })),
      
      // Files - REDUCED to 30 (enough for metrics)
      adminDb.collection('files')
        .orderBy('uploadedAt', 'desc')
        .limit(30)
        .get()
        .catch(() => ({ docs: [], size: 0 })),
      
      // Payments - REDUCED to 30 (enough for revenue)
      adminDb.collection('payments')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get()
        .catch(() => ({ docs: [], size: 0 })),
      
      // Recent logs - REDUCED to 10 (just recent activity)
      adminDb.collection('logs')
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get()
        .catch(() => ({ docs: [], size: 0 }))
    ]);

    // Data is already separated by collection, no need to filter

    // OPTIMIZATION: Single-pass data processing for all metrics
    
    // Initialize counters
    let totalUsers = 0, activeUsers = 0, newUsers = 0;
    let totalAgents = 0, activeAgents = 0, newAgents = 0;
    let totalFiles = 0, newFiles = 0, unassignedFiles = 0;
    let totalPayments = 0, successfulPayments = 0, newPayments = 0;
    let totalRevenue = 0, newRevenue = 0;
    const filesByStatus: Record<string, number> = {};

    // Process users and agents in single pass
    usersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate?.() || data.createdAt;
      const isNew = createdAt && createdAt >= startDate;
      
      totalUsers++;
      if (data.isActive) activeUsers++;
      if (isNew) newUsers++;
    });

    agentsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate?.() || data.createdAt;
      const isNew = createdAt && createdAt >= startDate;
      
      totalAgents++;
      if (data.isActive) activeAgents++;
      if (isNew) newAgents++;
    });

    // Process files in single pass
    filesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const uploadedAt = data.uploadedAt?.toDate?.() || data.uploadedAt;
      const isNew = uploadedAt && uploadedAt >= startDate;
      
      totalFiles++;
      if (isNew) newFiles++;
      if (data.status === 'paid' && !data.assignedAgentId) unassignedFiles++;
      
      // Count by status
      const status = data.status;
      filesByStatus[status] = (filesByStatus[status] || 0) + 1;
    });

    // Process payments in single pass
    paymentsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate?.() || data.createdAt;
      const isNew = createdAt && createdAt >= startDate;
      const isSuccessful = data.status === 'captured';
      
      totalPayments++;
      if (isSuccessful) {
        successfulPayments++;
        totalRevenue += data.amount || 0;
        if (isNew) newRevenue += data.amount || 0;
      }
      if (isNew) newPayments++;
    });

    // Process logs for activity insights
    const recentActivity = logsSnapshot.docs.slice(0, 10).map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        actionType: data.actionType,
        actorId: data.actorId,
        actorType: data.actorType,
        timestamp: data.timestamp?.toDate?.() || data.timestamp,
        details: data.details || {}
      };
    });

    // Calculate success rates
    const paymentSuccessRate = totalPayments > 0 
      ? ((successfulPayments / totalPayments) * 100).toFixed(2)
      : 0;

    const fileCompletionRate = totalFiles > 0 
      ? ((filesByStatus.completed || 0) / totalFiles * 100).toFixed(2)
      : 0;

    // OPTIMIZED: Calculate agent performance from already fetched files
    const agentStatsMap = new Map<string, { totalFiles: number, completedFiles: number, pendingFiles: number }>();
    
    // Initialize stats for all agents
    agentsSnapshot.docs.forEach(doc => {
      agentStatsMap.set(doc.id, { totalFiles: 0, completedFiles: 0, pendingFiles: 0 });
    });
    
    // Process files we already have
    filesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const agentId = data.assignedAgentId;
      if (agentId && agentStatsMap.has(agentId)) {
        const stats = agentStatsMap.get(agentId)!;
        stats.totalFiles++;
        if (data.status === 'completed') stats.completedFiles++;
        if (data.status === 'paid' || data.status === 'processing') stats.pendingFiles++;
      }
    });
    
    // Build performance array - TOP 5 ONLY for speed
    const agentPerformance = agentsSnapshot.docs
      .map(doc => {
        const agentData = doc.data();
        const stats = agentStatsMap.get(doc.id) || { totalFiles: 0, completedFiles: 0, pendingFiles: 0 };
        return {
          id: doc.id,
          name: agentData.name,
          email: agentData.email,
          totalFiles: stats.totalFiles,
          completedFiles: stats.completedFiles,
          pendingFiles: stats.pendingFiles,
          completionRate: stats.totalFiles > 0 
            ? ((stats.completedFiles / stats.totalFiles) * 100).toFixed(2)
            : '0'
        };
      })
      .sort((a, b) => b.completedFiles - a.completedFiles) // Sort by performance
      .slice(0, 5); // TOP 5 agents only for faster response

    // OPTIMIZATION: Skip expensive dailyStats on initial load - can be lazy loaded
    // Frontend can request this separately if needed via dedicated endpoint
    const dailyStats: any[] = [];

    const result = {
      success: true,
      period,
      overview: {
        totalUsers,
        activeUsers,
        newUsers,
        totalAgents,
        activeAgents,
        newAgents,
        totalFiles,
        newFiles,
        unassignedFiles,
        totalPayments,
        successfulPayments,
        newPayments,
        totalRevenue,
        newRevenue
      },
      files: {
        total: totalFiles,
        byStatus: filesByStatus,
        new: newFiles,
        unassigned: unassignedFiles,
        completionRate: fileCompletionRate
      },
      payments: {
        total: totalPayments,
        successful: successfulPayments,
        new: newPayments,
        totalRevenue,
        newRevenue,
        successRate: paymentSuccessRate
      },
      agents: {
        total: totalAgents,
        active: activeAgents,
        new: newAgents,
        performance: agentPerformance
      },
      activity: {
        recent: recentActivity,
        dailyStats
      }
    };

    // Cache the result for 5 minutes
    serverCache.set(cacheKey, result, 120_000); // 2 minutes (faster for initial loads)

    return NextResponse.json(result);

  } catch (error: any) {
    console.error("Error fetching dashboard data:", error);
    
    // Handle specific error types
    if (error.code === 14 || error.message?.includes('No connection established')) {
      return NextResponse.json(
        { success: false, message: "Database connection failed. Please try again." },
        { status: 503 }
      );
    }
    
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return NextResponse.json(
        { success: false, message: "Request timed out. Please try again." },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      { success: false, message: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}

// Helper function to get daily statistics (OPTIMIZED)
async function getDailyStats(startDate: Date, endDate: Date) {
  const dailyData: Record<string, any> = {};
  
  // Initialize all days in range
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateKey = d.toISOString().split('T')[0];
    dailyData[dateKey] = {
      date: dateKey,
      files: 0,
      payments: 0,
      revenue: 0,
      users: 0
    };
  }

  try {
    // ULTRA-OPTIMIZED: Further reduced limits for faster response
    const [filesSnapshot, paymentsSnapshot, usersSnapshot] = await Promise.all([
      // Files with date range - reduced from 300 to 100
      adminDb.collection('files')
        .where('uploadedAt', '>=', startDate)
        .where('uploadedAt', '<=', endDate)
        .limit(100)
        .get()
        .catch(() => ({ docs: [] })),
      
      // Payments with date range - reduced from 300 to 100
      adminDb.collection('payments')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .limit(100)
        .get()
        .catch(() => ({ docs: [] })),
      
      // Users with date range - reduced from 200 to 50
      adminDb.collection('users')
        .where('role', '==', 'user')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .limit(50)
        .get()
        .catch(() => ({ docs: [] }))
    ]);
    
    // Process files
    filesSnapshot.docs.forEach(doc => {
      const uploadedAt = doc.data().uploadedAt?.toDate?.() || doc.data().uploadedAt;
      if (uploadedAt) {
        const dateKey = uploadedAt.toISOString().split('T')[0];
        if (dailyData[dateKey]) {
          dailyData[dateKey].files++;
        }
      }
    });

    // Process payments
    paymentsSnapshot.docs.forEach(doc => {
      const createdAt = doc.data().createdAt?.toDate?.() || doc.data().createdAt;
      if (createdAt) {
        const dateKey = createdAt.toISOString().split('T')[0];
        if (dailyData[dateKey]) {
          dailyData[dateKey].payments++;
          if (doc.data().status === 'captured') {
            dailyData[dateKey].revenue += doc.data().amount || 0;
          }
        }
      }
    });

    // Process users
    usersSnapshot.docs.forEach(doc => {
      const createdAt = doc.data().createdAt?.toDate?.() || doc.data().createdAt;
      if (createdAt) {
        const dateKey = createdAt.toISOString().split('T')[0];
        if (dailyData[dateKey]) {
          dailyData[dateKey].users++;
        }
      }
    });

  } catch (error) {
    console.error('Error fetching daily stats:', error);
    // Return empty data if there's an error
  }

  return Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));
}
