import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps, cert } from "firebase-admin/app";

// Initialize Firebase Admin
if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  } catch (error) {
    console.error("Firebase admin initialization error:", error);
  }
}

const db = getFirestore();

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
    const adminToken = request.cookies.get("admin-token")?.value;
    
    if (!adminToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { message, type, isActive } = body;

    if (!message || !type) {
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

    const docRef = await db.collection("alerts").add(alertData);

    return NextResponse.json({
      success: true,
      id: docRef.id,
      alert: { id: docRef.id, ...alertData },
    });
  } catch (error) {
    console.error("Error creating alert:", error);
    return NextResponse.json(
      { error: "Failed to create alert" },
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting alert:", error);
    return NextResponse.json(
      { error: "Failed to delete alert" },
      { status: 500 }
    );
  }
}

