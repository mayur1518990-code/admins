import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { serverCache, makeKey } from "@/lib/server-cache";
import { verifyAdminAuth } from "@/lib/admin-auth";

// GET - Get all transactions/payments
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const userId = searchParams.get('userId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20'); // ULTRA-OPTIMIZED: Reduced from 30 to 20
    const fileId = searchParams.get('fileId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search') || '';

    // Enhanced cache key with all parameters including search
    const fresh = searchParams.get('fresh') === '1';
    const cacheKey = makeKey('transactions', [
      status || 'all', 
      userId || 'all', 
      fileId || 'all',
      startDate || 'all',
      endDate || 'all',
      search || 'all',
      page, 
      limit
    ]);
    const cached = fresh ? undefined : serverCache.get<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Build query with limits to prevent huge data fetches
    let query: any = adminDb.collection('payments');
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    
    if (fileId) {
      query = query.where('fileId', '==', fileId);
    }

    // Date filtering
    if (startDate) {
      query = query.where('createdAt', '>=', new Date(startDate));
    }
    
    if (endDate) {
      query = query.where('createdAt', '<=', new Date(endDate));
    }

    // CRITICAL: Add limit to prevent huge queries
    query = query.orderBy('createdAt', 'desc').limit(Math.min(limit * 2, 50)); // ULTRA-OPTIMIZED: Reduced from 100 to 50

    const snapshot = await query.get();
    
    // OPTIMIZED: Batch fetch users and files with limits to prevent huge queries
    const userIds = new Set<string>();
    const fileIds = new Set<string>();
    
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data();
      if (data.userId) userIds.add(data.userId);
      if (data.fileId) fileIds.add(data.fileId);
    });

    // ULTRA-OPTIMIZED: Use Firestore 'in' queries (batch 10 at a time) instead of individual fetches
    const [usersMap, filesMap] = await Promise.all([
      // Batch fetch users using 'in' queries (10 IDs per query)
      (async () => {
        const map = new Map<string, any>();
        if (userIds.size === 0) return map;
        
        const userIdArray = Array.from(userIds);
        const batchSize = 10; // Firestore 'in' limit
        const batches = [];
        
        for (let i = 0; i < userIdArray.length; i += batchSize) {
          const batch = userIdArray.slice(i, i + batchSize);
          // Try both 'user' (singular) and 'users' (plural) collections
          batches.push(
            Promise.all([
              adminDb.collection('user')
                .where('__name__', 'in', batch)
                .get()
                .then(snapshot => {
                  snapshot.docs.forEach(doc => {
                    map.set(doc.id, doc.data());
                  });
                })
                .catch(() => {}), // Ignore errors
              adminDb.collection('users')
                .where('__name__', 'in', batch)
                .get()
                .then(snapshot => {
                  snapshot.docs.forEach(doc => {
                    // Only set if not already set from 'user' collection
                    if (!map.has(doc.id)) {
                      map.set(doc.id, doc.data());
                    }
                  });
                })
                .catch(() => {}) // Ignore errors
            ])
          );
        }
        
        await Promise.all(batches);
        return map;
      })(),
      
      // Batch fetch files using 'in' queries (10 IDs per query)
      (async () => {
        const map = new Map<string, any>();
        if (fileIds.size === 0) return map;
        
        const fileIdArray = Array.from(fileIds);
        const batchSize = 10; // Firestore 'in' limit
        const batches = [];
        
        for (let i = 0; i < fileIdArray.length; i += batchSize) {
          const batch = fileIdArray.slice(i, i + batchSize);
          batches.push(
            adminDb.collection('files')
              .where('__name__', 'in', batch)
              .get()
              .then(snapshot => {
                snapshot.docs.forEach(doc => {
                  map.set(doc.id, doc.data());
                });
              })
              .catch(() => {}) // Ignore errors
          );
        }
        
        await Promise.all(batches);
        return map;
      })()
    ]);

    // Map transactions with batched data
    let transactions = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      const userData = usersMap.get(data.userId);
      const fileData = filesMap.get(data.fileId);

      return {
        id: doc.id,
        userId: data.userId,
        fileId: data.fileId,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        razorpayOrderId: data.razorpayOrderId,
        razorpayPaymentId: data.razorpayPaymentId,
        paymentMethod: data.paymentMethod,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        metadata: data.metadata || {},
        // Additional data
        user: userData ? {
          id: data.userId,
          name: userData.name || 'Unknown',
          email: userData.email || null,
          phone: userData.phone || userData.phoneNumber || userData.contactNumber || null
        } : null,
        file: fileData ? {
          originalName: fileData.originalName,
          status: fileData.status
        } : null
      };
    });

    // Note: keep all transactions; do not hide orphans/pending without payment id

    // Apply server-side search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      transactions = transactions.filter((t: any) => {
        return (
          t.user?.name?.toLowerCase().includes(searchLower) ||
          t.user?.email?.toLowerCase().includes(searchLower) ||
          t.user?.phone?.toLowerCase().includes(searchLower) ||
          t.file?.originalName?.toLowerCase().includes(searchLower) ||
          t.razorpayPaymentId?.toLowerCase().includes(searchLower) ||
          t.razorpayOrderId?.toLowerCase().includes(searchLower)
        );
      });
    }

    // Deduplicate transactions by fileId (primary). If missing, fallback to orderId, then doc id.
    // Prefer rows that have linked file/user data; then prefer better status; then latest update.
    const statusRank: Record<string, number> = { captured: 4, refunded: 3, failed: 2, pending: 1 } as any;
    const dedupedMap = new Map<string, any>();
    for (const t of transactions) {
      const key = t.fileId || t.razorpayOrderId || t.id;
      const current = dedupedMap.get(key);
      if (!current) {
        dedupedMap.set(key, t);
        continue;
      }
      const currentRank = statusRank[(current.status || 'pending').toLowerCase()] || 0;
      const newRank = statusRank[(t.status || 'pending').toLowerCase()] || 0;
      const currentTime = new Date(current.updatedAt || current.createdAt || 0).getTime();
      const newTime = new Date(t.updatedAt || t.createdAt || 0).getTime();
      const currentHasLinks = (current.file ? 1 : 0) + (current.user ? 1 : 0);
      const newHasLinks = (t.file ? 1 : 0) + (t.user ? 1 : 0);
      // Prefer linked rows; then better status; then newer time
      if (
        newHasLinks > currentHasLinks ||
        (newHasLinks === currentHasLinks && newRank > currentRank) ||
        (newHasLinks === currentHasLinks && newRank === currentRank && newTime > currentTime)
      ) {
        dedupedMap.set(key, t);
      }
    }
    const deduped = Array.from(dedupedMap.values());

    // Final cleanup: hide rows without a linked file; allow missing user details
    const cleaned = deduped.filter(t => !!t.file);

    // Apply pagination after dedupe
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedTransactions = cleaned.slice(startIndex, endIndex);

    // Calculate summary statistics
    const totalAmount = cleaned.reduce((sum, t) => sum + t.amount, 0);
    const successfulPayments = cleaned.filter(t => t.status === 'captured').length;
    const failedPayments = cleaned.filter(t => t.status === 'failed').length;
    const pendingPayments = cleaned.filter(t => t.status === 'pending').length;

    const payload = {
      success: true,
      transactions: paginatedTransactions,
      summary: {
        totalTransactions: successfulPayments, // Only count successful transactions
        totalAmount,
        successfulPayments,
        failedPayments,
        pendingPayments,
        successRate: deduped.length > 0 ? ((successfulPayments / deduped.length) * 100).toFixed(2) : 0
      },
      // Also include stats for backward compatibility with frontend
      stats: {
        totalTransactions: successfulPayments, // Only count successful transactions
        successfulTransactions: successfulPayments,
        failedTransactions: failedPayments,
        totalRevenue: totalAmount,
        averageTransactionValue: successfulPayments > 0 ? totalAmount / successfulPayments : 0,
        successRate: cleaned.length > 0 ? (successfulPayments / cleaned.length) * 100 : 0
      },
      pagination: {
        total: cleaned.length,
        limit: limit,
        page: page,
        hasMore: endIndex < cleaned.length
      }
    };
    
    if (!fresh) {
      serverCache.set(cacheKey, payload, 60_000); // 1 minute cache (balance between speed and freshness)
    }
    return NextResponse.json(payload);

  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

// POST - Update transaction status (for refunds, etc.)
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { transactionId, status, reason, refundAmount } = await request.json();

    if (!transactionId || !status) {
      return NextResponse.json(
        { success: false, message: "Transaction ID and status are required" },
        { status: 400 }
      );
    }

    // Verify transaction exists
    const transactionDoc = await adminDb.collection('payments').doc(transactionId).get();
    
    if (!transactionDoc.exists) {
      return NextResponse.json(
        { success: false, message: "Transaction not found" },
        { status: 404 }
      );
    }

    const transactionData = transactionDoc.data()!;

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      'captured': ['refunded'],
      'pending': ['captured', 'failed'],
      'failed': ['captured'] // Retry payment
    };

    if (!validTransitions[transactionData.status]?.includes(status)) {
      return NextResponse.json(
        { 
          success: false, 
          message: `Invalid status transition from ${transactionData.status} to ${status}` 
        },
        { status: 400 }
      );
    }

    const updateData: any = {
      status,
      updatedAt: new Date(),
      updatedBy: admin.adminId
    };

    if (reason) {
      updateData.reason = reason;
    }

    if (status === 'refunded' && refundAmount) {
      updateData.refundAmount = refundAmount;
      updateData.refundedAt = new Date();
    }

    // Use batch for multiple updates
    const batch = adminDb.batch();
    
    // Update transaction
    const transactionRef = adminDb.collection('payments').doc(transactionId);
    batch.update(transactionRef, updateData);

    // If refunding, update file status
    if (status === 'refunded') {
      const fileRef = adminDb.collection('files').doc(transactionData.fileId);
      batch.update(fileRef, {
        status: 'refunded',
        refundedAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Log the action
    const logRef = adminDb.collection('logs').doc();
    batch.set(logRef, {
      actionType: 'transaction_update',
      actorId: admin.adminId,
      actorType: 'admin',
      transactionId,
      details: {
        previousStatus: transactionData.status,
        newStatus: status,
        reason,
        refundAmount
      },
      timestamp: new Date()
    });

    await batch.commit();

    // If marking as captured, remove duplicate pending entries for same file/order
    if (status === 'captured') {
      try {
        const sameFilePending = await adminDb.collection('payments')
          .where('fileId', '==', transactionData.fileId)
          .where('status', '==', 'pending')
          .get();

        const sameOrderPending = transactionData.razorpayOrderId
          ? await adminDb.collection('payments')
              .where('razorpayOrderId', '==', transactionData.razorpayOrderId)
              .where('status', '==', 'pending')
              .get()
          : ({ empty: true, docs: [] } as any);

        const toDelete = new Set<string>();
        sameFilePending.docs.forEach(doc => { if (doc.id !== transactionId) toDelete.add(doc.id); });
        sameOrderPending.docs.forEach((doc: any) => { if (doc.id !== transactionId) toDelete.add(doc.id); });

        if (toDelete.size > 0) {
          const ids = Array.from(toDelete);
          for (let i = 0; i < ids.length; i += 500) {
            const batchDel = adminDb.batch();
            ids.slice(i, i + 500).forEach(id => batchDel.delete(adminDb.collection('payments').doc(id)));
            await batchDel.commit();
          }
        }
      } catch (cleanupErr) {
        // Silent fail - cleanup is non-critical
      }
    }

    // Invalidate server cache for all transactions list variants
    serverCache.deleteByPrefix(makeKey('transactions'));

    return NextResponse.json({
      success: true,
      message: "Transaction updated successfully"
    });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Failed to update transaction" },
      { status: 500 }
    );
  }
}

// DELETE - Delete one or many transactions
export async function DELETE(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { transactionId, transactionIds } = await request.json();

    const idsToDelete: string[] = Array.isArray(transactionIds)
      ? transactionIds.filter(Boolean)
      : (transactionId ? [transactionId] : []);

    if (!idsToDelete.length) {
      return NextResponse.json({ success: false, error: 'Transaction ID(s) are required' }, { status: 400 });
    }

    let deletedCount = 0;
    const chunks: string[][] = [];
    for (let i = 0; i < idsToDelete.length; i += 500) {
      chunks.push(idsToDelete.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      const batch = adminDb.batch();
      const docs = await Promise.all(chunk.map(id => adminDb.collection('payments').doc(id).get()));
      docs.forEach((doc, idx) => {
        if (doc.exists) {
          batch.delete(doc.ref);
          deletedCount += 1;
        }
      });
      await batch.commit();
    }

    serverCache.deleteByPrefix('admin:transactions');

    return NextResponse.json({
      success: true,
      message: deletedCount === 1 ? 'Transaction deleted successfully' : `Deleted ${deletedCount} transactions`,
      deletedCount
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: 'Failed to delete transactions' },
      { status: 500 }
    );
  }
}
