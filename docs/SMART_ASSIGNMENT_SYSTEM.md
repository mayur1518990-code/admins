# Smart Assignment System

## Overview

The Smart Assignment System distributes files fairly among agents based on their **completed** and **pending** work. This ensures no agent gets overloaded with too much work while others have less.

## ⚠️ CRITICAL: Automatic Assignment DISABLED

**All automatic assignment triggers have been completely disabled:**
- ❌ Payment completion does NOT auto-assign files
- ❌ File status changes do NOT trigger assignment
- ❌ Page refresh does NOT trigger assignment
- ❌ Background monitoring is disabled

**✅ You MUST use "Smart Auto Assign" button** to assign files after payment.

## How It Works

### Assignment Algorithm

The system considers two key metrics for each agent:
1. **Completed Files** - Total files the agent has finished
2. **Pending Files** - Current files assigned but not yet completed (paid, assigned, or processing status)

**Priority Formula:**
- Agents with **less total workload** (completed + pending) get priority
- If total is equal, agents with **less pending files** get priority
- If pending is equal, agents with **less completed files** get priority

### Fair Distribution

When assigning multiple files:
1. The system starts with the agent who has the least total workload
2. After each assignment, the agent's pending count increases
3. The system re-sorts agents to find who now has the least workload
4. This ensures files are distributed evenly, preventing bulk assignments to any single agent

### Example

**Scenario:** 2 agents, 6 files to assign

**Initial State:**
- Agent A: 4 completed, 2 pending (total: 6)
- Agent B: 10 completed, 8 pending (total: 18)

**Assignment Process:**
1. File 1 → Agent A (now 4 completed, 3 pending)
2. File 2 → Agent A (now 4 completed, 4 pending)
3. File 3 → Agent A (now 4 completed, 5 pending)
4. File 4 → Agent A (now 4 completed, 6 pending)
5. File 5 → Agent A (now 4 completed, 7 pending)
6. File 6 → Agent A (now 4 completed, 8 pending)

**Final State:**
- Agent A: 4 completed, 8 pending (total: 12)
- Agent B: 10 completed, 8 pending (total: 18)

Agent A gets more files because their total workload was much lower. As new agents are added, they will get priority until their workload balances out.

## How to Use

### Smart Auto Assign Button

**Location:** File Management page (Admin Panel)

**What it does:**
- Finds all unassigned paid files
- Assigns them fairly based on agent workload
- Shows a summary of the distribution

**Steps:**
1. Go to Admin Panel → File Management
2. Click "Smart Auto Assign" button
3. System analyzes all agents' completed and pending files
4. Assigns all unassigned paid files fairly
5. Shows summary: Agent name, pending count, completed count, total workload

### Manual Assignment

You can still manually assign files to specific agents:
1. Select files using checkboxes
2. Click "Assign Selected" button
3. Choose an agent from the dropdown
4. Files will be assigned to that agent

### Single File Smart Assign

For individual files:
1. Find an unassigned file
2. Click "Smart Assign" button next to the file
3. System assigns it to the agent with the least workload

## Changes from Previous System

### Removed Features

1. **Background Auto-Assignment** - Prevented automatic bulk assignments
2. **Auto-Monitoring Toggle** - Removed automatic assignment on page refresh
3. **Round Robin Assignment** - Replaced with smart workload-based assignment

### Why These Changes?

**Problem:** The old system would sometimes assign all new files to one agent, causing unfair distribution.

**Solution:** The new system:
- Considers both completed AND pending work
- Prevents bulk assignments by re-evaluating after each file
- Gives priority to agents with less overall work done
- Ensures new agents get work until they catch up

## API Endpoints

### Smart Auto-Assign
**Endpoint:** `POST /api/admin/auto-assign`

**Request:**
```json
{
  "fileIds": ["file1", "file2", "file3"],
  "assignmentType": "smart_balanced"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully assigned 3 file(s) using smart distribution",
  "totalAssigned": 3,
  "assignments": [
    {
      "fileId": "file1",
      "agentId": "agent1",
      "agentName": "John Doe",
      "newPending": 3,
      "newTotal": 15
    }
  ],
  "distributionSummary": [
    {
      "agentName": "John Doe",
      "completedFiles": 12,
      "pendingFiles": 3,
      "totalWorkload": 15
    }
  ]
}
```

### Get Assignment Stats
**Endpoint:** `GET /api/admin/auto-assign`

**Response:**
```json
{
  "success": true,
  "data": {
    "agentWorkloads": [
      {
        "agentId": "agent1",
        "agentName": "John Doe",
        "completedFiles": 12,
        "pendingFiles": 3,
        "totalWorkload": 15,
        "isActive": true
      }
    ],
    "unassignedFiles": 5,
    "totalAgents": 3,
    "activeAgents": 3,
    "distributionSummary": {
      "mostLoaded": {...},
      "leastLoaded": {...}
    }
  }
}
```

## Disabled Endpoints

These endpoints are disabled to prevent conflicts:

1. **Background Assignment:** `/api/admin/background-assignment` (GET, POST)
   - Returns 403 error
   - Message: Use Smart Auto Assign instead

2. **Monitor Assignments:** `/api/admin/monitor-assignments` (GET, POST)
   - Returns 403 error
   - Message: Prevents automatic assignment triggers

## Agent Performance View

In the **Agents** section, you can see:
- **Performance** column showing:
  - Completed files / Total files
  - Pending files count

This helps you understand each agent's workload before manual assignments.

## Best Practices

1. **Use Smart Auto Assign** for bulk assignments to ensure fair distribution
2. **Check agent workloads** in the Agents section before manual assignments
3. **Avoid manual bulk assignments** to a single agent - use Smart Auto Assign instead
4. **New agents** will automatically get priority until their workload balances
5. **Monitor the distribution summary** after each smart assignment

## Troubleshooting

**Q: Files assigned unevenly?**
- Check if agents are active (inactive agents don't get assignments)
- Verify the agent's completed and pending counts in the Agents section
- The system is working correctly if agents with less total work get more files

**Q: Want to manually assign to a specific agent?**
- Use "Assign Selected" for manual override
- Or use the dropdown next to individual files

**Q: Background assignment not working?**
- Background assignment is intentionally disabled
- Use "Smart Auto Assign" button instead for controlled distribution

## Technical Details

**File Statuses:**
- `paid` - File is paid but not assigned
- `assigned` - File is assigned to an agent
- `processing` - Agent is currently working on the file
- `completed` - Agent has finished the file

**Workload Calculation:**
- Completed: Files with status `completed`
- Pending: Files with status `paid`, `assigned`, or `processing`
- Total: Completed + Pending

**Batch Processing:**
- Assignments are batched (up to 500 per batch) for efficiency
- Multiple batches are committed in parallel for speed

## Summary

The Smart Assignment System ensures:
- ✅ Fair distribution based on actual workload
- ✅ No bulk assignments to any single agent
- ✅ New agents get priority until they catch up
- ✅ Transparent distribution summary
- ✅ Manual override option when needed
- ✅ No automatic triggers on page refresh


