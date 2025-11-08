import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminAuth } from "@/lib/admin-auth";

const SETTINGS_DOC_ID = "app_settings";

// GET - Get app settings
export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settingsDoc = await adminDb.collection("settings").doc(SETTINGS_DOC_ID).get();
    
    if (!settingsDoc.exists) {
      // Return default settings
      return NextResponse.json({
        success: true,
        settings: {
          defaultEditTimerMinutes: 10, // Default 10 minutes
        }
      });
    }

    const settings = settingsDoc.data();
    return NextResponse.json({
      success: true,
      settings: {
        defaultEditTimerMinutes: settings?.defaultEditTimerMinutes || 10,
      }
    });
  } catch (error: any) {
    console.error("Error fetching settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// POST - Update app settings
export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { defaultEditTimerMinutes } = body;

    if (defaultEditTimerMinutes === undefined) {
      return NextResponse.json(
        { error: "defaultEditTimerMinutes is required" },
        { status: 400 }
      );
    }

    if (defaultEditTimerMinutes < 1 || defaultEditTimerMinutes > 1440) {
      return NextResponse.json(
        { error: "Timer must be between 1 and 1440 minutes (24 hours)" },
        { status: 400 }
      );
    }

    await adminDb.collection("settings").doc(SETTINGS_DOC_ID).set({
      defaultEditTimerMinutes,
      updatedAt: new Date(),
      updatedBy: admin.adminId || "admin",
    }, { merge: true });

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
      settings: {
        defaultEditTimerMinutes,
      }
    });
  } catch (error: any) {
    console.error("Error updating settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}





