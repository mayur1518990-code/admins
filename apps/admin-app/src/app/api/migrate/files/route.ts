import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAdminAuth } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dryRun') === 'true';

    console.log(`[MIGRATION] Starting file migration (dryRun: ${dryRun})`);

    // Get all files from the database
    const filesSnapshot = await adminDb.collection('files').get();
    const files = filesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as any));

    console.log(`[MIGRATION] Found ${files.length} files to check`);

    const results = {
      total: files.length,
      missingContent: 0,
      migrated: 0,
      errors: 0,
      details: [] as any[]
    };

    for (const file of files) {
      const fileInfo = {
        id: file.id,
        originalName: file.originalName,
        hasFileContent: !!file.fileContent,
        hasFilePath: !!file.filePath,
        status: file.status
      };

      if (!file.fileContent) {
        results.missingContent++;
        
        if (dryRun) {
          results.details.push({
            ...fileInfo,
            action: 'Would migrate - missing fileContent'
          });
        } else {
          try {
            // For existing files without fileContent, we need to mark them as needing re-upload
            // Since we can't recover the original file content, we'll add a flag
            await adminDb.collection('files').doc(file.id).update({
              needsReupload: true,
              migrationNote: 'File content missing - requires re-upload',
              migratedAt: new Date().toISOString()
            });

            results.migrated++;
            results.details.push({
              ...fileInfo,
              action: 'Marked for re-upload'
            });
          } catch (error) {
            results.errors++;
            results.details.push({
              ...fileInfo,
              action: 'Error during migration',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } else {
        results.details.push({
          ...fileInfo,
          action: 'No action needed - has fileContent'
        });
      }
    }

    console.log(`[MIGRATION] Migration completed:`, results);

    return NextResponse.json({
      success: true,
      message: dryRun ? 'Migration dry run completed' : 'Migration completed',
      results
    });

  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { success: false, error: 'Migration failed', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const admin = await verifyAdminAuth();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get migration status
    const filesSnapshot = await adminDb.collection('files').get();
    const files = filesSnapshot.docs.map(doc => ({
      id: doc.id,
      originalName: doc.data().originalName,
      hasFileContent: !!doc.data().fileContent,
      hasFilePath: !!doc.data().filePath,
      status: doc.data().status,
      needsReupload: !!doc.data().needsReupload
    }));

    const stats = {
      total: files.length,
      withFileContent: files.filter(f => f.hasFileContent).length,
      withoutFileContent: files.filter(f => !f.hasFileContent).length,
      needsReupload: files.filter(f => f.needsReupload).length,
      byStatus: {
        pending_payment: files.filter(f => f.status === 'pending_payment').length,
        paid: files.filter(f => f.status === 'paid').length,
        assigned: files.filter(f => f.status === 'assigned').length,
        processing: files.filter(f => f.status === 'processing').length,
        completed: files.filter(f => f.status === 'completed').length
      }
    };

    return NextResponse.json({
      success: true,
      stats,
      files: files.slice(0, 10) // Return first 10 files for preview
    });

  } catch (error: any) {
    console.error('Migration status error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get migration status', details: error.message },
      { status: 500 }
    );
  }
}
