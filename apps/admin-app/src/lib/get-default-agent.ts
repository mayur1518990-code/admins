import { adminDb } from './firebase-admin';

/**
 * Get the first active agent from the database
 * This is used for development when we need to map to a real agent
 */
export async function getDefaultAgent() {
  try {
    const agentsSnapshot = await adminDb.collection('agents')
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!agentsSnapshot.empty) {
      const agentDoc = agentsSnapshot.docs[0];
      const agentData = agentDoc.data();
      
      return {
        agentId: agentDoc.id,
        name: agentData.name || 'Unknown Agent',
        email: agentData.email || 'unknown@example.com',
        role: 'agent'
      };
    }

    // Fallback to hardcoded values if no agents found
    return {
      agentId: "bim290LXmEf6N7IuTzKU7bv5XcG2",
      name: "Sunny Atul Dhore", 
      email: "dhoresunny5648@gmail.com",
      role: "agent"
    };
  } catch (error) {
    console.error('Error getting default agent:', error);
    // Fallback to hardcoded values
    return {
      agentId: "bim290LXmEf6N7IuTzKU7bv5XcG2",
      name: "Sunny Atul Dhore",
      email: "dhoresunny5648@gmail.com", 
      role: "agent"
    };
  }
}

