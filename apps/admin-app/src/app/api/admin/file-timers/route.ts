import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";
import { serverCache, makeKey } from "@/lib/server-cache";

// GET - Get timer for a specific file
export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required" },
        { status: 400 }
      );
    }

    const fileDoc = await adminDb.collection("files").doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    const fileData = fileDoc.data();
    const timerMinutes = fileData?.editTimerMinutes || null;
    const timerStartedAt = fileData?.editTimerStartedAt || null;

    return NextResponse.json({
      success: true,
      timerMinutes,
      timerStartedAt,
    });
  } catch (error: any) {
    console.error("Error fetching file timer:", error);
    return NextResponse.json(
      { error: "Failed to fetch file timer" },
      { status: 500 }
    );
  }
}

// POST - Set timer for a file
export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { fileId, timerMinutes } = body;

    if (!fileId || !timerMinutes) {
      return NextResponse.json(
        { error: "File ID and timer minutes are required" },
        { status: 400 }
      );
    }

    if (timerMinutes < 1 || timerMinutes > 1440) {
      return NextResponse.json(
        { error: "Timer must be between 1 and 1440 minutes (24 hours)" },
        { status: 400 }
      );
    }

    const fileDoc = await adminDb.collection("files").doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Set timer and start time
    await adminDb.collection("files").doc(fileId).update({
      editTimerMinutes: timerMinutes,
      editTimerStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Clear caches
    const fileData = fileDoc.data();
    if (fileData?.userId) {
      serverCache.delete(makeKey("user_files", [fileData.userId]));
    }
    serverCache.delete(makeKey("files", ["list"]));

    return NextResponse.json({
      success: true,
      message: `Timer set to ${timerMinutes} minutes`,
    });
  } catch (error: any) {
    console.error("Error setting file timer:", error);
    return NextResponse.json(
      { error: "Failed to set file timer" },
      { status: 500 }
    );
  }
}

// DELETE - Remove timer from a file
export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required" },
        { status: 400 }
      );
    }

    await adminDb.collection("files").doc(fileId).update({
      editTimerMinutes: null,
      editTimerStartedAt: null,
      updatedAt: new Date().toISOString(),
    });

    // Clear caches
    const fileDoc = await adminDb.collection("files").doc(fileId).get();
    const fileData = fileDoc.data();
    if (fileData?.userId) {
      serverCache.delete(makeKey("user_files", [fileData.userId]));
    }
    serverCache.delete(makeKey("files", ["list"]));

    return NextResponse.json({
      success: true,
      message: "Timer removed",
    });
  } catch (error: any) {
    console.error("Error removing file timer:", error);
    return NextResponse.json(
      { error: "Failed to remove timer" },
      { status: 500 }
    );
  }
}





