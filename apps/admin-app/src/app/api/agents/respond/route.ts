import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase-admin";
import { cookies } from "next/headers";
import { serverCache } from "@/lib/server-cache";

// Helper function to verify agent authentication
async function verifyAgentAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get('agent-token')?.value;
  
  if (!token) {
    throw new Error("No authentication token found");
  }

  // In a real implementation, you would verify the JWT token here
  return { agentId: "agent_123", name: "Agent Name" }; // Placeholder
}

export async function POST(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();

    // Parse form data
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const message = formData.get('message') as string;
    const responseFile = formData.get('responseFile') as File;

    if (!fileId || !message) {
      return NextResponse.json(
        { success: false, message: "File ID and message are required" },
        { status: 400 }
      );
    }

    // Verify the file exists and is assigned to this agent
    const fileDoc = await adminDb.collection('files').doc(fileId).get();
    
    if (!fileDoc.exists) {
      return NextResponse.json(
        { success: false, message: "File not found" },
        { status: 404 }
      );
    }

    const fileData = fileDoc.data()!;
    
    if (fileData.assignedAgentId !== agent.agentId) {
      return NextResponse.json(
        { success: false, message: "File not assigned to you" },
        { status: 403 }
      );
    }

    if (fileData.status !== 'paid' && fileData.status !== 'processing') {
      return NextResponse.json(
        { success: false, message: "File is not in a valid state for response" },
        { status: 400 }
      );
    }

    let responseFileURL = null;

    // Handle file upload if provided
    if (responseFile && responseFile.size > 0) {
      // Validate file type
      const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];

      if (!allowedTypes.includes(responseFile.type)) {
        return NextResponse.json(
          { success: false, message: "Invalid file type. Allowed: PDF, images, Word docs" },
          { status: 400 }
        );
      }

      // Validate file size (20MB limit)
      const maxSize = 20 * 1024 * 1024; // 20MB
      if (responseFile.size > maxSize) {
        return NextResponse.json(
          { success: false, message: "File size exceeds 20MB limit" },
          { status: 400 }
        );
      }

      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const fileExtension = responseFile.name.split('.').pop();
      const fileName = `response_${timestamp}_${randomString}.${fileExtension}`;
      const filePath = `agent-responses/${agent.agentId}/${fileName}`;

      // Upload to Firebase Storage
      const bucket = adminStorage.bucket();
      const file = bucket.file(filePath);

      const buffer = Buffer.from(await responseFile.arrayBuffer());
      await file.save(buffer, {
        metadata: {
          contentType: responseFile.type,
          metadata: {
            originalName: responseFile.name,
            uploadedBy: agent.agentId,
            fileId: fileId
          }
        }
      });

      // Make file publicly accessible
      await file.makePublic();
      responseFileURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    }

    // Update file with response
    const updateData = {
      status: 'completed',
      responseMessage: message,
      responseFileURL,
      respondedAt: new Date(),
      updatedAt: new Date()
    };

    // Create reply record
    const replyData = {
      fileId,
      agentId: agent.agentId,
      message,
      responseFileURL,
      createdAt: new Date(),
      isRead: false
    };

    // OPTIMIZATION: Parallel database operations
    const [, , userDoc] = await Promise.all([
      adminDb.collection('files').doc(fileId).update(updateData),
      adminDb.collection('replies').add(replyData),
      adminDb.collection('users').doc(fileData.userId).get(),
      adminDb.collection('logs').add({
        actionType: 'agent_response',
        actorId: agent.agentId,
        actorType: 'agent',
        fileId,
        userId: fileData.userId,
        details: {
          message,
          hasFile: !!responseFileURL,
          responseFileURL
        },
        timestamp: new Date()
      })
    ]);

    const userData = userDoc.data();

    // Invalidate caches
    serverCache.deleteByPrefix('agents-files:');
    serverCache.deleteByPrefix('agent-files:');
    serverCache.deleteByPrefix('agent-dashboard:');

    // TODO: Send notification to user
    // This is where you would integrate with your notification service
    // Example: Send email/SMS to userData.email or userData.phone
    // Placeholder for notification integration

    return NextResponse.json({
      success: true,
      message: "Response submitted successfully",
      data: {
        fileId,
        responseMessage: message,
        responseFileURL,
        respondedAt: updateData.respondedAt
      }
    });

  } catch (error: any) {
    console.error("Error submitting agent response:", error);
    
    if (error.message.includes("authentication")) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to submit response" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json(
        { success: false, message: "File ID is required" },
        { status: 400 }
      );
    }

    // Get replies for the file
    const repliesSnapshot = await adminDb.collection('replies')
      .where('fileId', '==', fileId)
      .where('agentId', '==', agent.agentId)
      .orderBy('createdAt', 'desc')
      .get();

    const replies = repliesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        message: data.message,
        responseFileURL: data.responseFileURL,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        isRead: data.isRead
      };
    });

    return NextResponse.json({
      success: true,
      replies
    });

  } catch (error: any) {
    console.error("Error fetching replies:", error);
    
    if (error.message.includes("authentication")) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Failed to fetch replies" },
      { status: 500 }
    );
  }
}
