import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";
import { serverCache, makeKey } from "@/lib/server-cache";

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

    // Check cache first
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

    // OPTIMIZED: Use targeted queries with proper limits instead of fetching all data
    const [
      usersSnapshot,
      agentsSnapshot,
      adminsSnapshot,
      filesSnapshot,
      paymentsSnapshot,
      logsSnapshot
    ] = await Promise.all([
      // Users only (with limit)
      withRetry(() => adminDb.collection('users')
        .where('role', '==', 'user')
        .limit(1000)
        .get()
      ).catch(() => ({ docs: [], size: 0 })),
      
      // Agents only (with limit)
      withRetry(() => adminDb.collection('agents')
        .limit(100)
        .get()
      ).catch(() => ({ docs: [], size: 0 })),
      
      // Admins only (with limit)
      withRetry(() => adminDb.collection('admins')
        .limit(50)
        .get()
      ).catch(() => ({ docs: [], size: 0 })),
      
      // Files with limit
      withRetry(() => adminDb.collection('files')
        .orderBy('uploadedAt', 'desc')
        .limit(1000)
        .get()
      ).catch(() => ({ docs: [], size: 0 })),
      
      // Payments with limit
      withRetry(() => adminDb.collection('payments')
        .orderBy('createdAt', 'desc')
        .limit(1000)
        .get()
      ).catch(() => ({ docs: [], size: 0 })),
      
      // Recent logs (already limited)
      withRetry(() => adminDb.collection('logs')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get()
      ).catch(() => ({ docs: [], size: 0 }))
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

    // OPTIMIZATION: Batch fetch agent performance data
    const agentPerformance = await Promise.all(
      agentsSnapshot.docs.map(async (agentDoc) => {
        const agentData = agentDoc.data();
        const agentId = agentDoc.id;
        
        const agentFilesSnapshot = await withRetry(() => 
          adminDb.collection('files')
            .where('assignedAgentId', '==', agentId)
            .get()
        );

        const completedFiles = agentFilesSnapshot.docs.filter(doc => 
          doc.data().status === 'completed'
        ).length;

        const pendingFiles = agentFilesSnapshot.docs.filter(doc => 
          doc.data().status === 'paid' || doc.data().status === 'processing'
        ).length;

        return {
          id: agentId,
          name: agentData.name,
          email: agentData.email,
          totalFiles: agentFilesSnapshot.size,
          completedFiles,
          pendingFiles,
          completionRate: agentFilesSnapshot.size > 0 
            ? ((completedFiles / agentFilesSnapshot.size) * 100).toFixed(2)
            : 0
        };
      })
    );

    // Get daily statistics for charts
    const dailyStats = await getDailyStats(startDate, endDate).catch(() => []);

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

    // Cache the result for 2 minutes
    serverCache.set(cacheKey, result, 120_000); // 2 minutes

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
    // OPTIMIZED: Use limited queries with date filters
    const [filesSnapshot, paymentsSnapshot, usersSnapshot] = await Promise.all([
      // Files with date range limit
      withRetry(() => adminDb.collection('files')
        .where('uploadedAt', '>=', startDate)
        .where('uploadedAt', '<=', endDate)
        .limit(1000)
        .get()
      ).catch(() => ({ docs: [] })),
      
      // Payments with date range limit
      withRetry(() => adminDb.collection('payments')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .limit(1000)
        .get()
      ).catch(() => ({ docs: [] })),
      
      // Users with date range limit
      withRetry(() => adminDb.collection('users')
        .where('role', '==', 'user')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .limit(500)
        .get()
      ).catch(() => ({ docs: [] }))
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
