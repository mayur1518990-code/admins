import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

const SETTINGS_DOC_ID = "contact-settings";

// GET - Fetch contact numbers
export async function GET(request: NextRequest) {
  try {
    const settingsDoc = await adminDb.collection("settings").doc(SETTINGS_DOC_ID).get();
    
    if (!settingsDoc.exists) {
      return NextResponse.json({ 
        contactNumbers: [],
        isActive: true 
      });
    }

    const data = settingsDoc.data();
    return NextResponse.json({ 
      contactNumbers: data?.contactNumbers || [],
      isActive: data?.isActive ?? true
    });
  } catch (error) {
    console.error("Error fetching contact numbers:", error);
    return NextResponse.json(
      { error: "Failed to fetch contact numbers" },
      { status: 500 }
    );
  }
}

// POST - Update contact numbers
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
    const { contactNumbers, isActive } = body;

    if (!Array.isArray(contactNumbers)) {
      return NextResponse.json(
        { error: "contactNumbers must be an array" },
        { status: 400 }
      );
    }

    // Validate phone numbers
    const validNumbers = contactNumbers.filter(num => 
      typeof num === 'string' && num.trim().length > 0
    );

    const settingsData = {
      contactNumbers: validNumbers,
      isActive: isActive ?? true,
      updatedAt: new Date(),
      updatedBy: "admin",
    };

    await adminDb.collection("settings").doc(SETTINGS_DOC_ID).set(settingsData, { merge: true });

    return NextResponse.json({
      success: true,
      contactNumbers: validNumbers,
      isActive: settingsData.isActive
    });
  } catch (error) {
    console.error("Error updating contact numbers:", error);
    return NextResponse.json(
      { error: "Failed to update contact numbers" },
      { status: 500 }
    );
  }
}

