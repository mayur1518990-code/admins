import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAgentAuth } from '@/lib/agent-auth';
import { downloadFromB2 } from '@/lib/b2-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const startTime = Date.now();
  
  try {
    // Verify agent authentication
    const agent = await verifyAgentAuth();
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileId } = await params;

    // Get file information
    const queryStart = Date.now();
    const fileDoc = await adminDb.collection('files').doc(fileId).get();
    console.log(`File query: ${Date.now() - queryStart}ms`);
    if (!fileDoc.exists) {
      return NextResponse.json({
        success: false,
        error: 'File not found'
      }, { status: 404 });
    }

    const fileData = fileDoc.data();
    
    // Log file data for debugging
    console.log(`[DOWNLOAD] File ID: ${fileId}`);
    console.log(`[DOWNLOAD] File status: ${fileData?.status}`);
    console.log(`[DOWNLOAD] Has b2Key: ${!!fileData?.b2Key}`);
    console.log(`[DOWNLOAD] Has fileContent: ${!!fileData?.fileContent}`);
    console.log(`[DOWNLOAD] AssignedAgentId: ${fileData?.assignedAgentId}`);
    
    // Verify the file is assigned to this agent
    if (fileData?.assignedAgentId !== agent.agentId) {
      return NextResponse.json({
        success: false,
        error: 'File not assigned to you'
      }, { status: 403 });
    }

    // Check if file uses B2 storage (new, completed files, or existing uploads)
    // Priority: b2Key (completed files) -> filePath (user uploads) -> fileContent (legacy database)
    const b2Key = fileData!.b2Key || fileData!.filePath;
    
    if (b2Key) {
      // B2 storage path (for both completed files and user uploads)
      try {
        const downloadStart = Date.now();
        const downloadResult = await downloadFromB2(b2Key);
        console.log(`B2 download: ${Date.now() - downloadStart}ms`);
        
        // Set appropriate headers for file download
        const headers = new Headers();
        headers.set('Content-Type', downloadResult.contentType || fileData!.mimeType || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${fileData!.originalName}"`);
        headers.set('Content-Length', downloadResult.buffer.length.toString());
        console.log(`Download total: ${Date.now() - startTime}ms, size: ${downloadResult.buffer.length} bytes`);

        // Return the file content
        return new NextResponse(downloadResult.buffer as any, {
          status: 200,
          headers
        });

      } catch (error: any) {
        console.error('B2 download error:', error);
        return NextResponse.json({
          success: false,
          error: error.message || 'Failed to download file from storage'
        }, { status: 500 });
      }
    } else {
      // Legacy path: File content stored in database as base64
      const fileContent = fileData!.fileContent;
      
      if (!fileContent) {
        console.error(`[DOWNLOAD] File ${fileId} has no b2Key and no fileContent`);
        console.error(`[DOWNLOAD] File data keys:`, Object.keys(fileData || {}));
        return NextResponse.json({
          success: false,
          error: 'File content not found. This file may be a metadata-only record from before the storage migration. Please contact support.'
        }, { status: 404 });
      }

      try {
        // Handle data URL format (data:mimeType;base64,content) or pure base64
        let base64Content = fileContent;
        if (fileContent.startsWith('data:')) {
          // Extract base64 content from data URL
          const base64Index = fileContent.indexOf(',');
          if (base64Index !== -1) {
            base64Content = fileContent.substring(base64Index + 1);
          }
        }
        
        // Convert base64 content back to buffer
        const buffer = Buffer.from(base64Content, 'base64');
        
        // Set appropriate headers for file download
        const headers = new Headers();
        headers.set('Content-Type', fileData!.mimeType || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${fileData!.originalName}"`);
        headers.set('Content-Length', buffer.length.toString());
        console.log(`Download total (legacy): ${Date.now() - startTime}ms, size: ${buffer.length} bytes`);

        // Return the file content
        return new NextResponse(buffer, {
          status: 200,
          headers
        });

      } catch (error) {
        console.error('File processing error:', error);
        return NextResponse.json({
          success: false,
          error: 'Failed to process file content'
        }, { status: 500 });
      }
    }

  } catch (error: any) {
    console.error('Error downloading file:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to download file' },
      { status: 500 }
    );
  }
}
