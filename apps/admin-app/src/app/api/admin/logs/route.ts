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

    const cacheKey = makeKey('logs', ['list']);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const logsSnapshot = await adminDb.collection('logs').get();
    
    // Filter logs by criteria
    let logs = logsSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const aTime = a.timestamp?.toDate?.() || new Date(0);
        const bTime = b.timestamp?.toDate?.() || new Date(0);
        return bTime.getTime() - aTime.getTime();
      });

    // Apply action filter
    if (action !== 'all') {
      logs = logs.filter(log => log.action === action);
    }

    // Apply date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      logs = logs.filter(log => {
        const logDate = log.timestamp?.toDate?.() || new Date(0);
        return logDate >= fromDate;
      });
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      logs = logs.filter(log => {
        const logDate = log.timestamp?.toDate?.() || new Date(0);
        return logDate <= toDate;
      });
    }

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