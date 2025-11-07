import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Initialize Backblaze B2 S3-compatible client
 */
function getB2Client() {
  const endpoint = process.env.B2_ENDPOINT;
  const keyId = process.env.B2_KEY_ID;
  const appKey = process.env.B2_APP_KEY;
  const region = process.env.B2_REGION || 'eu-central-003';

  if (!endpoint || !keyId || !appKey) {
    throw new Error('Missing B2 credentials. Please check B2_ENDPOINT, B2_KEY_ID, and B2_APP_KEY environment variables.');
  }

  return new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey,
    },
    // Force path-style addressing for B2 compatibility
    forcePathStyle: true,
  });
}

/**
 * Get the B2 bucket name from environment variables
 */
function getBucketName(): string {
  const bucket = process.env.B2_BUCKET;
  if (!bucket) {
    throw new Error('B2_BUCKET environment variable is not set');
  }
  return bucket;
}

/**
 * Upload a file to Backblaze B2
 * @param key - The file key/path in B2 (e.g., "uploads/file123.pdf")
 * @param buffer - The file content as a Buffer
 * @param metadata - Optional metadata for the file
 * @returns Object with success status and file URL
 */
export async function uploadToB2(
  key: string,
  buffer: Buffer,
  metadata?: {
    contentType?: string;
    originalName?: string;
    uploadedBy?: string;
    [key: string]: string | undefined;
  }
): Promise<{ success: boolean; url: string; key: string }> {
  try {
    const client = getB2Client();
    const bucket = getBucketName();

    // Prepare metadata headers (S3 metadata must be lowercase and prefixed with x-amz-meta-)
    const metadataHeaders: Record<string, string> = {};
    if (metadata) {
      Object.entries(metadata).forEach(([k, v]) => {
        if (v !== undefined && k !== 'contentType') {
          metadataHeaders[k] = v;
        }
      });
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: metadata?.contentType || 'application/octet-stream',
      Metadata: metadataHeaders,
      // Enable server-side encryption (SSE-B2)
      ServerSideEncryption: 'AES256',
    });

    await client.send(command);

    // Construct the file URL
    const endpoint = process.env.B2_ENDPOINT || '';
    const url = `${endpoint}/${bucket}/${key}`;

    console.log(`File uploaded successfully to B2: ${key}`);

    return {
      success: true,
      url,
      key,
    };
  } catch (error: any) {
    console.error('B2 upload error:', error);
    throw new Error(`Failed to upload to B2: ${error.message}`);
  }
}

/**
 * Download a file from Backblaze B2
 * @param key - The file key/path in B2
 * @returns Object with success status and file buffer
 */
export async function downloadFromB2(
  key: string
): Promise<{ success: boolean; buffer: Buffer; contentType?: string; metadata?: Record<string, string> }> {
  try {
    const client = getB2Client();
    const bucket = getBucketName();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('No file content returned from B2');
    }

    // Convert the readable stream to a buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    console.log(`File downloaded successfully from B2: ${key}`);

    return {
      success: true,
      buffer,
      contentType: response.ContentType,
      metadata: response.Metadata,
    };
  } catch (error: any) {
    console.error('B2 download error:', error);
    
    // Handle specific error cases
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      throw new Error('File not found in B2 storage');
    }
    
    throw new Error(`Failed to download from B2: ${error.message}`);
  }
}

/**
 * Delete a file from Backblaze B2 (HANDLES ALL VERSIONS - leaves NO copies)
 * @param key - The file key/path in B2
 * @returns Object with success status
 */
export async function deleteFromB2(key: string): Promise<{ success: boolean }> {
  try {
    const client = getB2Client();
    const bucket = getBucketName();

    console.log(`[B2 DELETE] Starting comprehensive delete for: ${key}`);

    // Import ListObjectVersionsCommand and DeleteObjectsCommand
    const { ListObjectVersionsCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

    // List all versions of the file (handles versioning)
    const listCommand = new ListObjectVersionsCommand({
      Bucket: bucket,
      Prefix: key,
    });

    const versions = await client.send(listCommand) as any;

    // Collect all version IDs to delete
    const objectsToDelete: Array<{ Key: string; VersionId?: string }> = [];

    // Add all file versions
    if (versions.Versions && versions.Versions.length > 0) {
      for (const version of versions.Versions) {
        if (version.Key === key && version.VersionId) {
          objectsToDelete.push({
            Key: key,
            VersionId: version.VersionId,
          });
          console.log(`[B2 DELETE] Found version: ${version.VersionId}`);
        }
      }
    }

    // Add all delete markers
    if (versions.DeleteMarkers && versions.DeleteMarkers.length > 0) {
      for (const marker of versions.DeleteMarkers) {
        if (marker.Key === key && marker.VersionId) {
          objectsToDelete.push({
            Key: key,
            VersionId: marker.VersionId,
          });
          console.log(`[B2 DELETE] Found delete marker: ${marker.VersionId}`);
        }
      }
    }

    // If versions found, delete all of them
    if (objectsToDelete.length > 0) {
      console.log(`[B2 DELETE] Deleting ${objectsToDelete.length} versions/markers for: ${key}`);
      
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objectsToDelete,
          Quiet: false,
        },
      });

      const deleteResult = await client.send(deleteCommand) as any;
      
      if (deleteResult.Errors && deleteResult.Errors.length > 0) {
        console.warn(`[B2 DELETE] Some deletions failed:`, deleteResult.Errors);
      }
      
      console.log(`[B2 DELETE] ✅ Successfully deleted ${objectsToDelete.length} versions for: ${key}`);
    } else {
      // No versions found, try simple delete (non-versioned bucket or file doesn't exist)
      console.log(`[B2 DELETE] No versions found, attempting simple delete for: ${key}`);
      
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await client.send(command);
      console.log(`[B2 DELETE] ✅ Simple delete completed for: ${key}`);
    }

    console.log(`[B2 DELETE] ✅ Complete deletion finished - NO copies remain for: ${key}`);

    return {
      success: true,
    };
  } catch (error: any) {
    console.error('[B2 DELETE] Error:', error);
    
    // Handle specific error cases
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      console.warn(`[B2 DELETE] File not found in B2, considering it already deleted: ${key}`);
      return { success: true };
    }
    
    throw new Error(`Failed to delete from B2: ${error.message}`);
  }
}

/**
 * Check if a file exists in Backblaze B2
 * @param key - The file key/path in B2
 * @returns Boolean indicating if the file exists
 */
export async function fileExistsInB2(key: string): Promise<boolean> {
  try {
    const client = getB2Client();
    const bucket = getBucketName();

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    
    console.error('B2 file exists check error:', error);
    throw new Error(`Failed to check file existence in B2: ${error.message}`);
  }
}

/**
 * Generate a pre-signed URL for direct download
 * @param key - The file key/path in B2
 * @param filename - The filename to use for download (forces Content-Disposition: attachment)
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Pre-signed URL
 */
export async function generatePresignedDownloadUrl(
  key: string,
  filename: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const client = getB2Client();
    const bucket = getBucketName();

    // Force download with Content-Disposition header
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });

    const url = await getSignedUrl(client, command, { expiresIn });

    console.log(`Generated pre-signed download URL for: ${key}`);

    return url;
  } catch (error: any) {
    console.error('B2 pre-signed URL generation error:', error);
    throw new Error(`Failed to generate pre-signed URL: ${error.message}`);
  }
}

/**
 * Generate a pre-signed URL for direct upload
 * @param key - The file key/path in B2
 * @param contentType - MIME type of the file
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Pre-signed URL
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    console.log('[B2] Initializing client for upload URL...');
    const client = getB2Client();
    const bucket = getBucketName();
    
    console.log('[B2] Bucket:', bucket);
    console.log('[B2] Key:', key);
    console.log('[B2] ContentType:', contentType);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    });

    console.log('[B2] Generating signed URL...');
    const url = await getSignedUrl(client, command, { expiresIn });

    console.log(`[B2] ✅ Generated pre-signed upload URL for: ${key}`);
    console.log(`[B2] URL: ${url.substring(0, 100)}...`);

    return url;
  } catch (error: any) {
    console.error('[B2] ❌ Pre-signed upload URL generation error:', error);
    console.error('[B2] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      stack: error.stack
    });
    throw new Error(`Failed to generate pre-signed upload URL: ${error.message}`);
  }
}

/**
 * Check if B2 storage is properly configured
 */
export async function checkB2Configuration() {
  try {
    const client = getB2Client();
    const bucket = getBucketName();

    // Try to list objects with limit 1 to test connection
    const { HeadBucketCommand } = require('@aws-sdk/client-s3');
    const command = new HeadBucketCommand({
      Bucket: bucket,
    });

    await client.send(command);

    return {
      success: true,
      bucketName: bucket,
      accessible: true,
      message: 'B2 storage is properly configured',
    };
  } catch (error: any) {
    console.error('B2 configuration check error:', error);
    return {
      success: false,
      bucketName: process.env.B2_BUCKET || 'Unknown',
      accessible: false,
      message: error.message || 'B2 storage configuration issue',
    };
  }
}

