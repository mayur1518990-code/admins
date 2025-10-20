import { adminDb } from './firebase-admin';

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
 * This helps debug assignment issues
 */
export async function getAllAgentIds(agentId: string): Promise<string[]> {
  try {
    const agentIds: string[] = [agentId];
    
    // Get agent document
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

    return [...new Set(agentIds)]; // Remove duplicates
  } catch (error) {
    console.error('Error getting all agent IDs:', error);
    return [agentId];
  }
}

/**
 * Find files assigned to an agent using multiple possible ID formats
 * OPTIMIZED: Parallel queries instead of sequential loop
 */
export async function findAgentFiles(agentId: string) {
  const startTime = Date.now();
  
  try {
    const idsStart = Date.now();
    const allAgentIds = await getAllAgentIds(agentId);
    console.log(`[AGENT-UTILS] Searching for files with agent IDs:`, allAgentIds);
    
    // OPTIMIZATION: Parallel queries instead of sequential loop
    // Before: 6-10 sequential queries (2 per ID, 3-5 IDs)
    // After: 2 parallel batches (one for each field type)
    const queryStart = Date.now();
    
    // Query all IDs in parallel for assignedAgentId field
    const assignedAgentPromises = allAgentIds.map(id =>
      adminDb.collection('files')
        .where('assignedAgentId', '==', id)
        .get()
        .catch(() => ({ docs: [] }))
    );
    
    // Query all IDs in parallel for agentId field
    const agentIdPromises = allAgentIds.map(id =>
      adminDb.collection('files')
        .where('agentId', '==', id)
        .get()
        .catch(() => ({ docs: [] }))
    );
    
    // Execute all queries in parallel
    const [assignedResults, agentIdResults] = await Promise.all([
      Promise.all(assignedAgentPromises),
      Promise.all(agentIdPromises)
    ]);
    
    // Collect all files
    const mappingStart = Date.now();
    const allFiles: any[] = [];
    
    assignedResults.forEach((snapshot, index) => {
      snapshot.docs.forEach(doc => {
        allFiles.push({
          id: doc.id,
          ...doc.data(),
          foundBy: 'assignedAgentId',
          foundWithId: allAgentIds[index]
        });
      });
    });
    
    agentIdResults.forEach((snapshot, index) => {
      snapshot.docs.forEach(doc => {
        allFiles.push({
          id: doc.id,
          ...doc.data(),
          foundBy: 'agentId',
          foundWithId: allAgentIds[index]
        });
      });
    });
    
    // Remove duplicates based on file ID
    const uniqueFiles = allFiles.filter((file, index, self) => 
      index === self.findIndex(f => f.id === file.id)
    );
    
    
    console.log(`[AGENT-UTILS] Found ${uniqueFiles.length} unique files for agent ${agentId}`);
    
    return uniqueFiles;
  } catch (error) {
    console.error('Error finding agent files:', error);
    return [];
  }
}

