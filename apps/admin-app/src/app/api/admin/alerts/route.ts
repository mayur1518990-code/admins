import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

const db = adminDb;

// GET - Fetch all alerts
export async function GET(request: NextRequest) {
  try {
    const alertsRef = db.collection("alerts");
    const snapshot = await alertsRef.get();
    
    const alerts = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
      }))
      .sort((a, b) => {
        // Sort by createdAt descending (newest first)
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}

// POST - Create new alert
export async function POST(request: NextRequest) {
  try {
    console.log('[Alerts API] POST - Starting alert creation...');
    
    const adminToken = request.cookies.get("admin-token")?.value;
    console.log('[Alerts API] Admin token present:', !!adminToken);
    
    if (!adminToken) {
      console.log('[Alerts API] No admin token, returning 401');
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    console.log('[Alerts API] Request body:', body);
    const { message, type, isActive } = body;

    if (!message || !type) {
      console.log('[Alerts API] Missing message or type, returning 400');
      return NextResponse.json(
        { error: "Message and type are required" },
        { status: 400 }
      );
    }

    const alertData = {
      message,
      type,
      isActive: isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "admin",
    };

    console.log('[Alerts API] Alert data prepared:', alertData);
    console.log('[Alerts API] Firestore db available:', !!db);
    
    const docRef = await db.collection("alerts").add(alertData);
    console.log('[Alerts API] Alert created successfully with ID:', docRef.id);

    // Clear user-app alert cache to force refresh (non-blocking)
    // Note: This is best-effort. The timestamp-based polling will detect changes anyway.
    if (typeof fetch !== 'undefined') {
      fetch(`${process.env.NEXT_PUBLIC_USER_APP_URL || 'http://localhost:3001'}/api/alerts`, {
        method: 'DELETE',
      }).catch(() => {
        // Ignore errors - cache clearing is best effort, polling will handle updates
      });
    }

    return NextResponse.json({
      success: true,
      id: docRef.id,
      alert: { id: docRef.id, ...alertData },
    });
  } catch (error: any) {
    console.error('[Alerts API] Error creating alert:', error);
    console.error('[Alerts API] Error message:', error?.message);
    console.error('[Alerts API] Error stack:', error?.stack);
    console.error('[Alerts API] Environment check:', {
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    });
    return NextResponse.json(
      { error: "Failed to create alert", details: error?.message },
      { status: 500 }
    );
  }
}

// PATCH - Update alert (toggle active status)
export async function PATCH(request: NextRequest) {
  try {
    const adminToken = request.cookies.get("admin-token")?.value;
    
    if (!adminToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { id, isActive } = body;

    if (!id || isActive === undefined) {
      return NextResponse.json(
        { error: "ID and isActive status are required" },
        { status: 400 }
      );
    }

    await db.collection("alerts").doc(id).update({
      isActive,
      updatedAt: new Date(),
    });

    // Clear user-app alert cache to force refresh (non-blocking)
    // Note: This is best-effort. The timestamp-based polling will detect changes anyway.
    if (typeof fetch !== 'undefined') {
      fetch(`${process.env.NEXT_PUBLIC_USER_APP_URL || 'http://localhost:3001'}/api/alerts`, {
        method: 'DELETE',
      }).catch(() => {
        // Ignore errors - cache clearing is best effort, polling will handle updates
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating alert:", error);
    return NextResponse.json(
      { error: "Failed to update alert" },
      { status: 500 }
    );
  }
}

// DELETE - Delete alert
export async function DELETE(request: NextRequest) {
  try {
    const adminToken = request.cookies.get("admin-token")?.value;
    
    if (!adminToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Alert ID is required" },
        { status: 400 }
      );
    }

    await db.collection("alerts").doc(id).delete();

    // Clear user-app alert cache to force refresh (non-blocking)
    // Note: This is best-effort. The timestamp-based polling will detect changes anyway.
    if (typeof fetch !== 'undefined') {
      fetch(`${process.env.NEXT_PUBLIC_USER_APP_URL || 'http://localhost:3001'}/api/alerts`, {
        method: 'DELETE',
      }).catch(() => {
        // Ignore errors - cache clearing is best effort, polling will handle updates
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting alert:", error);
    return NextResponse.json(
      { error: "Failed to delete alert" },
      { status: 500 }
    );
  }
}

