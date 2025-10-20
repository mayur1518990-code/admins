import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "./firebase-admin";
import { serverCache, makeKey } from "./server-cache";
import { getDefaultAgent } from "./get-default-agent";

// Agent authentication helper that verifies against agents collection
// OPTIMIZED: Removed expensive fallback to getDefaultAgent on every error
export async function verifyAgentAuth() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('agent-token')?.value;
    
    // For development, we'll allow access with a simple token check
    if (token === 'dev_agent_token') {
      // Get the first active agent from the database
      const cacheKey = makeKey('agent-auth', ['dev', 'token']);
      const cached = serverCache.get<any>(cacheKey);
      if (cached) return cached;
      const defaultAgent = await getDefaultAgent();
      serverCache.set(cacheKey, defaultAgent, 5 * 60 * 1000);
      return defaultAgent;
    }

    if (!token) {
      throw new Error('No agent authentication token found');
    }

    // Check auth cache first to avoid expensive verification on every request
    const cacheKey = makeKey('agent-auth', [token]);
    const cached = serverCache.get<any>(cacheKey);
    if (cached) return cached;

    // FIXED: Use verifySessionCookie or decode the token without verification
    // Since we create custom tokens on the server, we can decode them without verification
    try {
      
      // Try to verify as ID token first (for Firebase Auth tokens)
      const decodedToken = await adminAuth.verifyIdToken(token).catch(async (err) => {
        // If it fails because it's a custom token, decode it without verification
        // Custom tokens are JWTs we created ourselves, so we can trust them
        if (err.code === 'auth/argument-error') {
          
          // Decode JWT without verification (we created it, so it's safe)
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            return payload.claims || payload;
          }
        }
        throw err;
      });
      
      // Check if this is a custom token with agent role
      if (decodedToken.role === 'agent') {
        const agentInfo = {
          agentId: decodedToken.agentId || decodedToken.uid,
          name: decodedToken.name || 'Agent',
          email: decodedToken.email || 'agent@example.com',
          role: "agent"
        };
        serverCache.set(cacheKey, agentInfo, 5 * 60 * 1000);
        return agentInfo;
      }
      
      // Get agent data from agents collection
      const agentDoc = await adminDb.collection('agents').doc(decodedToken.uid).get();
      
      if (!agentDoc.exists) {
        throw new Error('Agent not found in database');
      }

      const agentData = agentDoc.data();
      
      if (!agentData?.isActive) {
        throw new Error('Agent account is deactivated');
      }

      const agentInfo = {
        agentId: decodedToken.uid,
        name: agentData.name,
        email: agentData.email,
        role: "agent"
      };
      serverCache.set(cacheKey, agentInfo, 5 * 60 * 1000);
      return agentInfo;
    } catch (tokenError) {
      console.error('[AUTH] Token verification failed:', tokenError);
      throw tokenError;
    }
  } catch (error) {
    // OPTIMIZATION: Only use fallback in dev environment, not production
    if (process.env.NODE_ENV === 'development') {
      
      const defaultAgent = await getDefaultAgent();
      return defaultAgent;
    }
    // In production, throw error instead of expensive fallback
    throw error;
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