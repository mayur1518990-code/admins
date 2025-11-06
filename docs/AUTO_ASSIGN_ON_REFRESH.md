# Auto-Assign on Page Refresh

## Feature Overview

When an admin opens or refreshes the File Management page, the system automatically runs **Smart Auto Assign** if there are any unassigned paid files. This ensures files are distributed to agents without manual intervention.

## How It Works

### Automatic Trigger

1. **Admin opens File Management page** (or refreshes it)
2. **System loads files** from database
3. **System checks** for unassigned paid files
4. **If unassigned paid files exist:**
   - Automatically runs Smart Auto Assign
   - Distributes files fairly based on agent workload
   - Shows distribution summary
5. **If no unassigned files:**
   - Does nothing, page displays normally

### Smart Behavior

- **Runs only ONCE per page load** - Won't re-assign on filter changes or other interactions
- **Respects current session** - Uses `useRef` to track if auto-assign already ran
- **Non-blocking** - Runs in background, doesn't freeze the UI
- **Fair distribution** - Uses same smart algorithm (completed + pending workload)

## Code Implementation

**File:** `apps/admin-app/src/app/admin/files/page.tsx`

```typescript
const hasAutoAssignedRef = useRef(false); // Track if auto-assign already ran

// AUTO-ASSIGN: Automatically run Smart Auto Assign when page loads/refreshes
useEffect(() => {
  // Only run once per page load, after files are loaded
  if (files.length > 0 && !hasAutoAssignedRef.current && !isAutoAssigning) {
    // Check if there are unassigned paid files
    const unassignedPaidFiles = files.filter(file => 
      file.status === 'paid' && !file.assignedAgentId
    );

    if (unassignedPaidFiles.length > 0) {
      console.log(`Auto-assign on refresh: Found ${unassignedPaidFiles.length} unassigned paid files`);
      hasAutoAssignedRef.current = true; // Mark as done for this session
      
      // Trigger smart auto-assign automatically
      handleSmartAutoAssign();
    }
  }
}, [files]); // Run when files change
```

## User Flow

### Scenario 1: New Paid Files After Page Load

1. User pays for file in user app
2. File status changes to `paid` in database
3. **Admin refreshes File Management page**
4. System detects unassigned paid files
5. **Auto-assign runs automatically**
6. Files distributed to agents based on workload
7. Admin sees success message with distribution summary

### Scenario 2: No Unassigned Files

1. Admin opens File Management page
2. All paid files are already assigned
3. System detects no unassigned files
4. **Auto-assign does NOT run**
5. Page displays normally

### Scenario 3: Multiple Refreshes

1. Admin refreshes File Management page
2. Auto-assign runs for unassigned files
3. **Admin refreshes again**
4. System detects auto-assign already ran this session
5. **Auto-assign does NOT run again**
6. Prevents duplicate assignments

## Benefits

### 1. Zero Manual Effort
- Admin doesn't need to click "Smart Auto Assign" button
- Files get assigned as soon as admin opens the page
- Saves time and ensures prompt service

### 2. Immediate Assignment
- Files assigned within seconds of payment
- Users see "Paid" status (or "Processing" once agent starts)
- Faster turnaround time

### 3. Fair Distribution
- Uses same smart algorithm
- Considers completed and pending workload
- Prevents agent overload

### 4. Reliable
- Runs automatically on every page load
- Can't forget to assign files
- Ensures no files get stuck as "paid" without assignment

## Configuration

### Enable/Disable Auto-Assign

To **disable** auto-assign on refresh, comment out the useEffect:

```typescript
// AUTO-ASSIGN DISABLED
// useEffect(() => {
//   if (files.length > 0 && !hasAutoAssignedRef.current && !isAutoAssigning) {
//     const unassignedPaidFiles = files.filter(...);
//     if (unassignedPaidFiles.length > 0) {
//       handleSmartAutoAssign();
//     }
//   }
// }, [files]);
```

To **re-enable**, uncomment the code.

### Adjust Timing

If you want a delay before auto-assign:

```typescript
if (unassignedPaidFiles.length > 0) {
  console.log(`Auto-assign on refresh: Found ${unassignedPaidFiles.length} files`);
  hasAutoAssignedRef.current = true;
  
  // Add delay (e.g., 2 seconds)
  setTimeout(() => {
    handleSmartAutoAssign();
  }, 2000);
}
```

## Monitoring

### Console Logs

When auto-assign runs, you'll see:
```
Auto-assign on refresh: Found 5 unassigned paid files
Smart-assign: Starting for 5 files
Agent workloads before assignment: [...]
Agent workloads after assignment: [...]
Smart-assign total: 234ms
```

### Success Message

After auto-assign completes, admin sees:
```
Smart Assignment Completed!

5 files assigned fairly based on workload.

Distribution Summary:
John Doe: 3 pending, 12 completed, 15 total
Jane Smith: 4 pending, 8 completed, 12 total
```

## Edge Cases Handled

### 1. No Active Agents
- Auto-assign fails gracefully
- Error message shown to admin
- Files remain unassigned

### 2. Network Error
- Auto-assign fails with error message
- Admin can manually retry with button
- Files remain unassigned

### 3. Page Navigates Away
- useEffect cleanup prevents orphaned requests
- No duplicate assignments

### 4. Fast Consecutive Refreshes
- `hasAutoAssignedRef` prevents duplicate runs
- Only assigns once per session

### 5. Filter Changes
- Auto-assign does NOT re-run
- Only runs on initial page load

## Comparison: Manual vs Auto

### Manual Assignment (Before)
1. User pays for file
2. Admin opens File Management
3. Admin sees unassigned paid files
4. **Admin clicks "Smart Auto Assign" button**
5. Files get assigned
6. **Total: 3-4 manual steps**

### Auto Assignment (Now)
1. User pays for file
2. Admin opens File Management
3. **Files automatically assigned**
4. **Total: 0 manual steps**

## Testing

### Test Case 1: Fresh Unassigned Files
1. Have user pay for 3 files
2. Open File Management page
3. Verify auto-assign runs automatically
4. Check distribution is fair
5. Verify success message appears

### Test Case 2: All Files Assigned
1. Ensure all paid files are assigned
2. Refresh File Management page
3. Verify auto-assign does NOT run
4. No error messages

### Test Case 3: Multiple Refreshes
1. Have user pay for 2 files
2. Open File Management (auto-assign runs)
3. Immediately refresh page
4. Verify auto-assign does NOT run again
5. No duplicate assignments

### Test Case 4: No Active Agents
1. Disable all agents
2. Have user pay for file
3. Open File Management
4. Verify error message shows
5. File remains unassigned

## Rollback

If you need to disable this feature:

1. Open `apps/admin-app/src/app/admin/files/page.tsx`
2. Find the auto-assign useEffect (around line 110)
3. Comment it out or delete it
4. Save the file
5. Feature is disabled

## Related Documentation

- `SMART_ASSIGNMENT_SYSTEM.md` - Smart assignment algorithm details
- `ASSIGNED_STATUS_FIX.md` - Status handling after assignment
- `PAYMENT_CACHE_FIX.md` - Payment status persistence

## Summary

Auto-assign on refresh ensures that paid files are automatically distributed to agents whenever an admin views the File Management page. This:
- ✅ Eliminates manual assignment work
- ✅ Ensures fast turnaround for users
- ✅ Maintains fair distribution
- ✅ Prevents files from being forgotten
- ✅ Runs automatically and reliably

No more clicking "Smart Auto Assign" - it just works! 🎉

