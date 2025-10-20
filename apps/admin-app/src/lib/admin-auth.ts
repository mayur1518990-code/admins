import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "./firebase-admin";

// Admin authentication helper that verifies against admins collection
export async function verifyAdminAuth() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin-token')?.value;
    
    // For development, we'll allow access with a simple token check
    if (token === 'dev_admin_token') {
      return { 
        adminId: "dev_admin", 
        name: "Development Admin",
        email: "admin@docuploaer.com",
        role: "admin"
      };
    }

    if (!token) {
      throw new Error('No admin authentication token found');
    }

    // Verify the token with Firebase Admin
    const decodedToken = await adminAuth.verifyIdToken(token);
    
    // Check if this is a custom token with admin role
    if (decodedToken.role === 'admin') {
      return {
        adminId: decodedToken.adminId || decodedToken.uid,
        name: decodedToken.name || 'Admin',
        email: decodedToken.email || 'admin@example.com',
        role: "admin"
      };
    }
    
    // Get admin data from admins collection
    const adminDoc = await adminDb.collection('admins').doc(decodedToken.uid).get();
    
    if (!adminDoc.exists) {
      throw new Error('Admin not found in database');
    }

    const adminData = adminDoc.data();
    
    if (!adminData?.isActive) {
      throw new Error('Admin account is deactivated');
    }

    return {
      adminId: decodedToken.uid,
      name: adminData.name,
      email: adminData.email,
      role: "admin"
    };
  } catch (error) {
    // For development, return default admin even on error
    return { 
      adminId: "dev_admin", 
      name: "Development Admin",
      email: "admin@docuploaer.com",
      role: "admin"
    };
  }
}

// Helper function to get query parameters
export function getQueryParams(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return {
    filter: searchParams.get('filter') || 'all',
    dateFilter: searchParams.get('dateFilter') || 'all',
    search: searchParams.get('search') || '',
    limit: parseInt(searchParams.get('limit') || '50'),
    offset: parseInt(searchParams.get('offset') || '0'),
    status: searchParams.get('status'),
    userId: searchParams.get('userId'),
    fileId: searchParams.get('fileId'),
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate')
  };
}
