import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { serverCache, makeKey } from '@/lib/server-cache';
import { verifyAdminAuth } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const action = searchParams.get('action') || 'all';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';

    const cacheKey = makeKey('logs', ['list', page, limit, action || 'all', dateFrom || '', dateTo || '', search]);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) return NextResponse.json(cached);

    // OPTIMIZED: Build query with database-level filters
    let query: FirebaseFirestore.Query = adminDb.collection('logs');
    
    // Apply action filter at database level (uses composite index)
    if (action !== 'all') {
      query = query.where('action', '==', action);
    }
    
    // Apply date range filter at database level
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      query = query.where('timestamp', '>=', fromDate);
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo);
      query = query.where('timestamp', '<=', toDate);
    }
    
    // CRITICAL: Order by timestamp and limit to prevent fetching ALL logs
    query = query.orderBy('timestamp', 'desc').limit(Math.min(limit * 2, 1000));
    
    const logsSnapshot = await query.get();
    
    // Map logs (no need to sort, already ordered by database)
    let logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      logs = logs.filter(log => 
        log.action?.toLowerCase().includes(searchLower) ||
        log.adminName?.toLowerCase().includes(searchLower) ||
        log.targetUserId?.toLowerCase().includes(searchLower) ||
        JSON.stringify(log.details || {}).toLowerCase().includes(searchLower)
      );
    }

    // Apply pagination
    const totalLogs = logs.length;
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedLogs = logs.slice(startIndex, endIndex);

    // Format logs for response
    const formattedLogs = paginatedLogs.map(log => ({
      id: log.id,
      action: log.action || 'unknown',
      adminId: log.adminId || 'system',
      adminName: log.adminName || 'System',
      targetUserId: log.targetUserId || null,
      details: log.details || {},
      timestamp: log.timestamp?.toDate?.() || new Date(),
      createdAt: log.timestamp?.toDate?.() || new Date()
    }));

    const payload = {
      success: true,
      logs: formattedLogs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalLogs,
        pages: Math.ceil(totalLogs / Number(limit))
      }
    };
    serverCache.set(cacheKey, payload, 60_000);
    return NextResponse.json(payload);

  } catch (error: any) {
    console.error('Error fetching logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { action, targetUserId, details } = await request.json();

    if (!action) {
      return NextResponse.json({ success: false, error: 'Action is required' }, { status: 400 });
    }

    // Create log entry
    const logData = {
      action,
      adminId: admin.adminId,
      adminName: admin.name,
      targetUserId: targetUserId || null,
      details: details || {},
      timestamp: new Date(),
      createdAt: new Date()
    };

    const docRef = await adminDb.collection('logs').add(logData);
    serverCache.deleteByPrefix(makeKey('logs'));

    return NextResponse.json({
      success: true,
      message: 'Log created successfully',
      data: {
        logId: docRef.id,
        log: {
          id: docRef.id,
          ...logData
        }
      }
    });

  } catch (error: any) {
    console.error('Error creating log:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create log' },
      { status: 500 }
    );
  }
}