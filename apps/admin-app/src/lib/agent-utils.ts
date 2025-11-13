import { adminDb } from './firebase-admin';
import { serverCache, makeKey } from './server-cache';

/**
 * Normalize agent ID to handle different ID formats
 * This function tries to find the correct agent ID format
 */
export async function normalizeAgentId(agentId: string): Promise<string> {
  try {
    // First, try to find the agent by the provided ID
    const agentDoc = await adminDb.collection('agents').doc(agentId).get();
    if (agentDoc.exists) {
      return agentId;
    }

    // If not found, try to find by email or name
    const agentsSnapshot = await adminDb.collection('agents')
      .where('email', '==', agentId)
      .get();
    
    if (!agentsSnapshot.empty) {
      return agentsSnapshot.docs[0].id;
    }

    // Try to find by name
    const agentsByNameSnapshot = await adminDb.collection('agents')
      .where('name', '==', agentId)
      .get();
    
    if (!agentsByNameSnapshot.empty) {
      return agentsByNameSnapshot.docs[0].id;
    }

    // Return original ID if nothing found
    return agentId;
  } catch (error) {
    console.error('Error normalizing agent ID:', error);
    return agentId;
  }
}

/**
 * Get all possible agent IDs for a given agent
 * OPTIMIZED: Cache agent data to avoid repeated queries
 */
export async function getAllAgentIds(agentId: string): Promise<string[]> {
  try {
    // Check cache first (agent data rarely changes)
    const cacheKey = makeKey('agent-ids', [agentId]);
    const cached = serverCache.get<string[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const agentIds: string[] = [agentId];
    
    // Get agent document (single query instead of multiple)
    const agentDoc = await adminDb.collection('agents').doc(agentId).get();
    if (agentDoc.exists) {
      const agentData = agentDoc.data();
      
      // Add email as potential ID
      if (agentData?.email) {
        agentIds.push(agentData.email);
      }
      
      // Add name as potential ID
      if (agentData?.name) {
        agentIds.push(agentData.name);
      }
    }

    const uniqueIds = [...new Set(agentIds)]; // Remove duplicates
    
    // Cache for 10 minutes (agent data rarely changes)
    serverCache.set(cacheKey, uniqueIds, 10 * 60 * 1000);
    
    return uniqueIds;
  } catch (error) {
    console.error('Error getting all agent IDs:', error);
    return [agentId];
  }
}

/**
 * Find files assigned to an agent using multiple possible ID formats
 * OPTIMIZED: Use Firestore 'in' operator to reduce queries from 6-10 to 2 queries max
 * Firestore 'in' operator supports up to 10 values, which is perfect for our use case
 */
export async function findAgentFiles(agentId: string) {
  try {
    const allAgentIds = await getAllAgentIds(agentId);
    
    // OPTIMIZATION: Use 'in' operator instead of multiple parallel queries
    // This reduces from 6-10 queries to just 2 queries (one per field)
    // Firestore 'in' operator supports up to 10 values, perfect for our case
    
    const allFiles: any[] = [];
    
    // If we have <= 10 agent IDs, use 'in' operator (single query per field)
    if (allAgentIds.length <= 10) {
      const [assignedSnapshot, agentIdSnapshot] = await Promise.all([
        adminDb.collection('files')
          .where('assignedAgentId', 'in', allAgentIds)
          .get()
          .catch(() => ({ docs: [] })),
        adminDb.collection('files')
          .where('agentId', 'in', allAgentIds)
          .get()
          .catch(() => ({ docs: [] }))
      ]);
      
      // Collect files from assignedAgentId query
      assignedSnapshot.docs.forEach(doc => {
        allFiles.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      // Collect files from agentId query
      agentIdSnapshot.docs.forEach(doc => {
        allFiles.push({
          id: doc.id,
          ...doc.data()
        });
      });
    } else {
      // Fallback: If somehow we have > 10 IDs, split into chunks
      // This should rarely happen, but handle it gracefully
      const chunks: string[][] = [];
      for (let i = 0; i < allAgentIds.length; i += 10) {
        chunks.push(allAgentIds.slice(i, i + 10));
      }
      
      const assignedPromises = chunks.map(chunk =>
        adminDb.collection('files')
          .where('assignedAgentId', 'in', chunk)
          .get()
          .catch(() => ({ docs: [] }))
      );
      
      const agentIdPromises = chunks.map(chunk =>
        adminDb.collection('files')
          .where('agentId', 'in', chunk)
          .get()
          .catch(() => ({ docs: [] }))
      );
      
      const [assignedResults, agentIdResults] = await Promise.all([
        Promise.all(assignedPromises),
        Promise.all(agentIdPromises)
      ]);
      
      assignedResults.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          allFiles.push({
            id: doc.id,
            ...doc.data()
          });
        });
      });
      
      agentIdResults.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          allFiles.push({
            id: doc.id,
            ...doc.data()
          });
        });
      });
    }
    
    // Remove duplicates based on file ID
    const uniqueFiles = allFiles.filter((file, index, self) => 
      index === self.findIndex(f => f.id === file.id)
    );
    
    return uniqueFiles;
  } catch (error) {
    console.error('Error finding agent files:', error);
    return [];
  }
}

