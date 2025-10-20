import { adminStorage } from './firebase-admin';

/**
 * Get the correct Firebase Storage bucket
 * Handles cases where the bucket might not exist
 */
export async function getStorageBucket() {
  try {
    // Try to get the default bucket first
    const defaultBucket = adminStorage.bucket();
    await defaultBucket.getMetadata(); // Test if bucket exists
    return defaultBucket;
  } catch (error) {
    console.log('Default bucket not accessible, trying project bucket...');
    
    try {
      // Try with project ID bucket
      const projectId = process.env.FIREBASE_PROJECT_ID;
      if (projectId) {
        const projectBucket = adminStorage.bucket(`${projectId}.appspot.com`);
        await projectBucket.getMetadata(); // Test if bucket exists
        return projectBucket;
      }
    } catch (error) {
      console.log('Project bucket not accessible, trying custom bucket...');
    }
    
    try {
      // Try with custom bucket name
      const customBucketName = process.env.FIREBASE_STORAGE_BUCKET;
      if (customBucketName) {
        const customBucket = adminStorage.bucket(customBucketName);
        await customBucket.getMetadata(); // Test if bucket exists
        return customBucket;
      }
    } catch (error) {
      console.log('Custom bucket not accessible');
    }
    
    throw new Error('No accessible Firebase Storage bucket found. Please create a bucket in Firebase Console.');
  }
}

/**
 * Check if Firebase Storage is properly configured
 */
export async function checkStorageConfiguration() {
  try {
    const bucket = await getStorageBucket();
    const [metadata] = await bucket.getMetadata();
    
    return {
      success: true,
      bucketName: bucket.name,
      accessible: true,
      message: 'Storage is properly configured'
    };
  } catch (error: any) {
    return {
      success: false,
      bucketName: 'Unknown',
      accessible: false,
      message: error.message || 'Storage configuration issue'
    };
  }
}

/**
 * Upload file to Firebase Storage with error handling
 */
export async function uploadToStorage(filePath: string, buffer: Buffer, metadata: any) {
  try {
    const bucket = await getStorageBucket();
    const file = bucket.file(filePath);
    
    await file.save(buffer, { metadata });
    return { success: true, file };
  } catch (error: any) {
    console.error('Storage upload error:', error);
    throw new Error(`Failed to upload to storage: ${error.message}`);
  }
}

/**
 * Download file from Firebase Storage with error handling
 */
export async function downloadFromStorage(filePath: string) {
  try {
    const bucket = await getStorageBucket();
    const file = bucket.file(filePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error('File not found in storage');
    }
    
    return { success: true, file };
  } catch (error: any) {
    console.error('Storage download error:', error);
    throw new Error(`Failed to download from storage: ${error.message}`);
  }
}
