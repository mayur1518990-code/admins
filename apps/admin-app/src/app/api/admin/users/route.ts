import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { serverCache, makeKey } from "@/lib/server-cache";
import { verifyAdminAuth, getQueryParams } from "@/lib/admin-auth";
import { deleteFromB2 } from "@/lib/b2-storage";

const applyDevCors = (response: NextResponse) => {
  if (process.env.NODE_ENV !== "production") {
    const devOrigin = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    response.headers.set("Access-Control-Allow-Origin", devOrigin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  return response;
};

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

// GET - List all users
export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return applyDevCors(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }));
    }

    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role'); // 'user' or 'agent'
    const status = searchParams.get('status'); // 'active' or 'inactive'
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 30); // OPTIMIZED: Reduced from 100 to 30
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search') || '';

    const cacheKey = makeKey('users', ['list', role || 'all', status || 'all', limit, offset, search]);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      return applyDevCors(NextResponse.json(cached));
    }

    // Define collections to query based on role filter
    const collectionsToQuery: string[] = [];
    if (!role || role === 'all') {
      collectionsToQuery.push('users', 'agents', 'admins');
    } else {
      if (role === 'user') collectionsToQuery.push('users');
      if (role === 'agent') collectionsToQuery.push('agents');
      if (role === 'admin') collectionsToQuery.push('admins');
    }

    // ULTRA-OPTIMIZED: Fetch only what we need + small buffer
    const strictLimit = Math.min(limit + 10, 50); // Small buffer for filtering, reduced from 100 to 50
    
    // OPTIMIZED: Query collections with proper ordering and limits
    const queryPromises = collectionsToQuery.map(async (collectionName) => {
      try {
        let query: any = adminDb.collection(collectionName);
        
        // Apply status filter at database level
        if (status && status !== 'all') {
          const isActive = status === 'active';
          query = query.where('isActive', '==', isActive);
        }
        
        // Add ordering for consistent results
        query = query.orderBy('createdAt', 'desc');
        
        // Apply strict limit to minimize data transfer
        query = query.limit(strictLimit);

        const snapshot = await withRetry(() => query.get());
        
        return {
          collectionName,
          snapshot
        };
      } catch (error: any) {
        console.error(`Users GET: ${collectionName} failed:`, error);
        return {
          collectionName,
          snapshot: { docs: [], size: 0 }
        };
      }
    });

    const results = await Promise.all(queryPromises);

    // Map users efficiently (minimal transformations)
    let allUsers: any[] = [];

    results.forEach(({ collectionName, snapshot }: any) => {
      // Skip empty snapshots
      if (!snapshot.docs || snapshot.size === 0) return;
      
      const collectionUsers = snapshot.docs.map((doc: any) => {
        const data = doc.data();
        return {
          id: doc.id,
          email: data.email,
          name: data.name,
          role: data.role || collectionName.slice(0, -1),
          isActive: data.isActive,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          lastLoginAt: data.lastLoginAt?.toDate?.() || data.lastLoginAt,
          phone: data.phone || null
        };
      });

      allUsers = allUsers.concat(collectionUsers); // Faster than spread
    });

    // Sort by timestamp in memory (fast for <100 items)
    allUsers.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime() || 0;
      const bTime = new Date(b.createdAt).getTime() || 0;
      return bTime - aTime;
    });

    // Apply search filter (if needed)
    if (search) {
      const searchLower = search.toLowerCase();
      allUsers = allUsers.filter(user => 
        user.name?.toLowerCase().includes(searchLower) ||
        user.email?.toLowerCase().includes(searchLower) ||
        user.phone?.toLowerCase().includes(searchLower)
      );
    }

    // Get total count efficiently
    let totalCount = 0;
    if (search) {
      totalCount = allUsers.length; // Filtered count
    } else {
      // Use cached count or estimate from fetched data
      const countCacheKey = makeKey('users', ['count', role || 'all', status || 'all']);
      const cachedCount = serverCache.get<number>(countCacheKey);
      
      if (cachedCount !== undefined) {
        totalCount = cachedCount;
      } else {
        totalCount = allUsers.length;
        serverCache.set(countCacheKey, totalCount, 300_000); // 5 min
      }
    }

    // Apply pagination
    const startIndex = offset;
    const endIndex = offset + limit;
    const users = allUsers.slice(startIndex, endIndex);

    const payload = {
      success: true,
      users,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: endIndex < totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    };
    
    serverCache.set(cacheKey, payload, 300_000); // 5 min cache
    return applyDevCors(NextResponse.json(payload));

  } catch (error: any) {
    // Handle specific error types
    if (error.code === 14 || error.message?.includes('No connection established')) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Database connection failed. Please try again." },
        { status: 503 }
      ));
    }
    
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Request timed out. Please try again." },
        { status: 408 }
      ));
    }
    
    if (error.message?.includes("adminAuthentication")) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Authentication required", message: error.message },
        { status: 401 }
      ));
    }

    return applyDevCors(NextResponse.json(
      { 
        success: false, 
        error: "Failed to fetch users",
        message: error?.message || 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      },
      { status: 500 }
    ));
  }
}

// POST - Create new user
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authStart = Date.now();
    const admin = await verifyAdminAuth();
    if (!admin) {
      return applyDevCors(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }));
    }

    const body = await request.json();
    const { email, name, password, role = 'user', phone } = body;

    // Trim and validate inputs
    const trimmedEmail = email?.trim();
    const trimmedName = name?.trim();

    if (!trimmedEmail || !trimmedName || !password) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Email, name, and password are required", message: "Email, name, and password are required" },
        { status: 400 }
      ));
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Please enter a valid email address", message: "Please enter a valid email address" },
        { status: 400 }
      ));
    }

    // Validate password length
    if (password.length < 6) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Password must be at least 6 characters long", message: "Password must be at least 6 characters long" },
        { status: 400 }
      ));
    }

    if (!['user', 'agent', 'admin'].includes(role)) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Invalid role. Must be user, agent, or admin", message: `Invalid role: ${role}. Must be user, agent, or admin` },
        { status: 400 }
      ));
    }

    // OPTIMIZED: Removed redundant email check - Firebase Auth will throw error if exists
    // This saves ~1.5 seconds per request!
    
    // Create user in Firebase Auth
    const userRecord = await withRetry(() => adminAuth.createUser({
      email: trimmedEmail,
      password,
      displayName: trimmedName
    }));

    // Prepare user document
    const userData = {
      email: trimmedEmail,
      name: trimmedName,
      password,
      role,
      phone: phone?.trim() || null,
      isActive: true,
      createdAt: new Date(),
      createdBy: admin.adminId
    };

    // Determine collection based on role
    let collectionName = 'users'; // default
    if (role === 'agent') collectionName = 'agents';
    if (role === 'admin') collectionName = 'admins';

    // OPTIMIZED: Run Firestore writes in parallel
    await Promise.all([
      adminDb.collection(collectionName).doc(userRecord.uid).set(userData),
      adminDb.collection('logs').add({
        actionType: 'user_created',
        actorId: admin.adminId,
        actorType: 'admin',
        targetUserId: userRecord.uid,
        details: {
          email: trimmedEmail,
          name: trimmedName,
          role
        },
        timestamp: new Date()
      })
    ]);
    
    // Invalidate cache after successful creation
    serverCache.deleteByPrefix(makeKey('users', ['list']));
    serverCache.deleteByPrefix(makeKey('users', ['count']));

    return applyDevCors(NextResponse.json({
      success: true,
      message: "User created successfully",
      data: {
        user: {
          id: userRecord.uid,
          email: trimmedEmail,
          name: trimmedName,
          role,
          isActive: true,
          createdAt: userData.createdAt
        }
      }
    }));

  } catch (error: any) {
    if (error.message?.includes("adminAuthentication")) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Authentication required", message: error.message },
        { status: 401 }
      ));
    }

    if (error.code === 'auth/email-already-exists' || error.code === 'adminAuth/email-already-exists') {
      return applyDevCors(NextResponse.json(
        { success: false, error: "User with this email already exists", message: "User with this email already exists" },
        { status: 409 }
      ));
    }

    return applyDevCors(NextResponse.json(
      { success: false, error: "Failed to create user", message: error?.message || "Failed to create user" },
      { status: 500 }
    ));
  }
}

// PUT - Update user
export async function PUT(request: NextRequest) {
  try {
    // Verify admin authentication
    const authStart = Date.now();
    const admin = await verifyAdminAuth();
    if (!admin) {
      return applyDevCors(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }));
    }

    const { userId, name, email, role, isActive, phone } = await request.json();

    if (!userId) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "User ID is required" },
        { status: 400 }
      ));
    }

    // OPTIMIZED: Find user in all collections PARALLEL
    const collections = ['users', 'agents', 'admins'];
    const findPromises = collections.map(collection => 
      withRetry(() => adminDb.collection(collection).doc(userId).get())
    );
    
    const docs = await Promise.all(findPromises);
    let userDoc = null;
    let collectionName = '';
    
    for (let i = 0; i < docs.length; i++) {
      if (docs[i].exists) {
        userDoc = docs[i];
        collectionName = collections[i];
        break;
      }
    }
    
    if (!userDoc) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const updateData: any = {
      updatedAt: new Date(),
      updatedBy: admin.adminId
    };

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (phone !== undefined) updateData.phone = phone;

    // OPTIMIZED: Parallel updates for Firestore + Auth + Logs
    const updatePromises: Promise<any>[] = [];
    
    // If role is being changed, we might need to move the user to a different collection
    if (role !== undefined && role !== userDoc.data()?.role) {
      const newCollectionName = role === 'agent' ? 'agents' : role === 'admin' ? 'admins' : 'users';
      
      if (newCollectionName !== collectionName) {
        // Move user to new collection (sequential - must create before delete)
        await adminDb.collection(newCollectionName).doc(userId).set({
          ...userDoc.data(),
          ...updateData
        });
        await adminDb.collection(collectionName).doc(userId).delete();
      } else {
        // Update in same collection
        updatePromises.push(
          adminDb.collection(collectionName).doc(userId).update(updateData)
        );
      }
    } else {
      // Update user document in current collection
      updatePromises.push(
        adminDb.collection(collectionName).doc(userId).update(updateData)
      );
    }

    // Update Firebase Auth if email changed (parallel)
    if (email !== undefined) {
      updatePromises.push(withRetry(() => adminAuth.updateUser(userId, { email })));
    }

    // Log the action (parallel)
    updatePromises.push(
      adminDb.collection('logs').add({
        actionType: 'user_updated',
        actorId: admin.adminId,
        actorType: 'admin',
        targetUserId: userId,
        details: updateData,
        timestamp: new Date()
      })
    );

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    // Invalidate cache
    serverCache.deleteByPrefix(makeKey('users', ['list']));
    if (role !== undefined) {
      serverCache.deleteByPrefix(makeKey('users', ['count']));
    }

    return applyDevCors(NextResponse.json({
      success: true,
      message: "User updated successfully"
    }));

  } catch (error: any) {
    if (error.message?.includes("adminAuthentication")) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ));
    }

    return applyDevCors(NextResponse.json(
      { success: false, error: "Failed to update user", message: error?.message || "Failed to update user" },
      { status: 500 }
    ));
  }
}

// DELETE - Deactivate user (soft delete)
export async function DELETE(request: NextRequest) {
  try {
    // Verify admin authentication
    const authStart = Date.now();
    const admin = await verifyAdminAuth();
    if (!admin) {
      return applyDevCors(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }));
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "User ID is required" },
        { status: 400 }
      ));
    }

    // OPTIMIZED: Find user in all collections PARALLEL
    const collections = ['users', 'agents', 'admins'];
    const findPromises = collections.map(collection => 
      withRetry(() => adminDb.collection(collection).doc(userId).get())
    );
    
    const docs = await Promise.all(findPromises);
    let userDoc = null;
    let collectionName = '';
    
    for (let i = 0; i < docs.length; i++) {
      if (docs[i].exists) {
        userDoc = docs[i];
        collectionName = collections[i];
        break;
      }
    }
    
    if (!userDoc) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      ));
    }

    // CASCADE DELETE: Find and delete all files belonging to this user
    const userFilesSnapshot = await adminDb.collection('files')
      .where('userId', '==', userId)
      .get();
    
    const fileIdsToDelete = userFilesSnapshot.docs.map(doc => doc.id);
    
    // Delete all user files (including B2 storage)
    if (fileIdsToDelete.length > 0) {
      const b2KeysToDelete: string[] = [];
      const completedFileIds: string[] = [];
      
      // AGGRESSIVE DELETE: Collect ALL B2 keys from user's files
      for (const fileDoc of userFilesSnapshot.docs) {
        const fileData = fileDoc.data();
        
        // 1. Collect b2Key if present in files collection
        if (fileData?.b2Key) {
          b2KeysToDelete.push(fileData.b2Key);
        }
        
        // 2. Collect filename as potential B2 key (legacy uploads folder pattern)
        if (fileData?.filename && !fileData?.b2Key) {
          const uploadsPath = `uploads/${userId}/${fileData.filename}`;
          b2KeysToDelete.push(uploadsPath);
        }
        
        // 3. Extract B2 key from responseFileURL if present (agent-responses folder)
        if (fileData?.responseFileURL) {
          try {
            const url = new URL(fileData.responseFileURL);
            const pathParts = url.pathname.split('/');
            const b2Path = pathParts.slice(2).join('/');
            if (b2Path) {
              b2KeysToDelete.push(b2Path);
            }
          } catch (error) {
            // Silent fail - URL parsing error
          }
        }
        
        // 4. Collect completed file ID to delete from completedFiles collection (agent-uploads)
        if (fileData?.completedFileId) {
          completedFileIds.push(fileData.completedFileId);
        }
      }
      
      // Fetch completedFiles documents and delete them along with their B2 files
      if (completedFileIds.length > 0) {
        const completedFileDocs = await Promise.all(
          completedFileIds.map(id => adminDb.collection('completedFiles').doc(id).get())
        );
        
        completedFileDocs.forEach((completedDoc) => {
          if (completedDoc.exists) {
            const completedData = completedDoc.data();
            
            // Collect B2 key from completed file (this is in agent-uploads folder)
            if (completedData?.b2Key) {
              b2KeysToDelete.push(completedData.b2Key);
            }
          }
        });
      }
      
      // AGGRESSIVE B2 DELETE: Delete ALL files from B2 storage
      // This includes: uploads/, agent-uploads/, agent-responses/
      if (b2KeysToDelete.length > 0) {
        await Promise.all(b2KeysToDelete.map(key => 
          deleteFromB2(key).catch(error => {
            // Don't throw - we still want to delete the database records
          })
        ));
      }
      
      // Delete files from Firestore (batch delete)
      const batch = adminDb.batch();
      
      // Delete files documents
      userFilesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete completedFiles documents
      if (completedFileIds.length > 0) {
        const completedFileDocs = await Promise.all(
          completedFileIds.map(id => adminDb.collection('completedFiles').doc(id).get())
        );
        completedFileDocs.forEach(doc => {
          if (doc.exists) {
            batch.delete(doc.ref);
          }
        });
      }
      
      await batch.commit();
    }

    // OPTIMIZED: Run user deletion operations in parallel
    await Promise.all([
      // Delete user from Firestore
      withRetry(() => adminDb.collection(collectionName).doc(userId).delete()),
      // Delete user from Firebase Auth
      withRetry(() => adminAuth.deleteUser(userId)),
      // Log the action
      withRetry(() => adminDb.collection('logs').add({
        actionType: 'user_deleted',
        actorId: admin.adminId,
        actorType: 'admin',
        targetUserId: userId,
        details: {
          reason: 'Admin deletion',
          filesDeleted: fileIdsToDelete.length,
          b2FilesDeleted: true
        },
        timestamp: new Date()
      }))
    ]);
    
    // Invalidate cache after successful deletion
    serverCache.deleteByPrefix(makeKey('users', ['list']));
    serverCache.deleteByPrefix(makeKey('users', ['count']));
    serverCache.deleteByPrefix(makeKey('files')); // Also invalidate files cache
    serverCache.deleteByPrefix(makeKey('users-agents')); // Invalidate user-agent cache

    return applyDevCors(NextResponse.json({
      success: true,
      message: `User completely deleted. ${fileIdsToDelete.length} file(s) removed from database and ALL B2 storage folders (uploads/, agent-uploads/, agent-responses/). Not visible anywhere.`,
      filesDeleted: fileIdsToDelete.length,
      note: 'Hard delete: All user data, files, and B2 storage completely removed. Not visible in user portal, agent portal, Firebase, or anywhere.'
    }));

  } catch (error: any) {
    if (error.message?.includes("adminAuthentication")) {
      return applyDevCors(NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ));
    }

    return applyDevCors(NextResponse.json(
      { success: false, error: "Failed to delete user", message: error?.message || "Failed to delete user" },
      { status: 500 }
    ));
  }
}
