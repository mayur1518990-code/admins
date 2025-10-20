import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    // Clear the admin token cookie
    const cookieStore = await cookies();
    cookieStore.delete('admin-token');

    return NextResponse.json({
      success: true,
      message: 'Admin logged out successfully'
    });

  } catch (error: any) {
    console.error('Admin logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to logout' },
      { status: 500 }
    );
  }
}

