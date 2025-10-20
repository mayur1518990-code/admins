import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    // Clear the agent token cookie
    const cookieStore = await cookies();
    cookieStore.delete('agent-token');

    return NextResponse.json({
      success: true,
      message: 'Agent logged out successfully'
    });

  } catch (error: any) {
    console.error('Agent logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to logout' },
      { status: 500 }
    );
  }
}

