# File Age Filter & B2 Storage Deletion - Complete ✅

## Overview
Implemented a time-based filtering system for file management with automatic B2 storage cleanup (including agent-uploads folder).

## ✅ Features Implemented

### 1. **Time-Based File Filtering**
- Added filter options to show files older than:
  - 7 days
  - 15 days
  - 30 days
- Visual indicator showing active filter and file count
- Filter persists across page refreshes (cached)

**Location**: `apps/admin-app/src/app/admin/files/page.tsx`

#### UI Components Added:
- **Filter Buttons**: Orange-themed buttons for age selection
- **Active Filter Badge**: Shows "Showing files older than X days (Y files)"
- **Quick Select Button**: "Select All Old Files" button when age filter is active
- Integrates seamlessly with existing status filters

### 2. **API Backend Support**
**Location**: `apps/admin-app/src/app/api/admin/files/route.ts`

#### Changes:
- Added `daysOld` query parameter to GET endpoint
- Filters files server-side based on upload date
- Calculation:
  ```typescript
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);
  // Returns files where uploadedAt < cutoffDate
  ```
- Updated cache keys to include days filter

### 3. **Enhanced B2 Storage Deletion**
**Location**: `apps/admin-app/src/app/api/admin/files/route.ts` (DELETE method)

#### Critical Fix:
The DELETE endpoint now properly deletes files from B2 storage, including the **agent-uploads** folder:

**What Was Fixed:**
1. ✅ Checks for `b2Key` in files collection
2. ✅ Checks for `completedFileId` in files collection
3. ✅ Fetches completedFiles documents (where agent uploads are stored)
4. ✅ Extracts B2 keys from completedFiles (format: `agent-uploads/{agentId}/{fileId}/{filename}`)
5. ✅ Deletes all collected B2 files from storage
6. ✅ Deletes both files and completedFiles database records

**Before:**
- Only deleted `b2Key` from files collection (rarely present)
- Agent uploads in `agent-uploads/` folder were NOT deleted

**After:**
- Deletes files from files collection B2 keys
- **Deletes files from agent-uploads folder** via completedFiles collection
- Comprehensive cleanup of all related storage

#### Deletion Flow:
```
1. Admin selects files to delete (e.g., files > 15 days old)
2. System fetches file documents
3. Collects b2Keys from files collection (if any)
4. Fetches completedFiles documents (contains agent uploads)
5. Collects b2Keys from completedFiles (agent-uploads/{agentId}/{fileId}/...)
6. Deletes ALL collected files from B2 storage
7. Deletes files from Firestore (files + completedFiles)
8. Logs deletion action
```

### 4. **Improved User Experience**

#### Enhanced Confirmation Messages:
**Single File Delete:**
```
Are you sure you want to DELETE "filename.pdf" permanently?

This will:
• Remove file from database
• Delete file from B2 storage (if present)
• Delete completed file records

This action CANNOT be undone!
```

**Bulk Delete:**
```
Delete 5 selected file(s) older than 15 days?

This will:
• Remove files from database
• Delete files from B2 storage (agent-uploads folder)
• Delete completed files records

This action CANNOT be undone!
```

#### Visual Indicators:
- Active age filter shows count in orange badge
- "Select All Old Files" button for quick bulk selection
- Updated button tooltips mention B2 storage cleanup

### 5. **Cache Management**
- Cache keys now include `daysFilter` parameter
- Forces fresh data when filter changes
- Maintains 2-minute cache for performance
- Invalidates cache after deletions

## 🎯 Use Cases

### Scenario 1: Delete Files Older Than 15 Days
1. Click "Older than 15 days" filter
2. System shows only files uploaded more than 15 days ago
3. Click "Select All Old Files" button
4. Click "Delete Selected" button
5. Confirm deletion
6. ✅ Files removed from database
7. ✅ Files deleted from B2 (including agent-uploads folder)
8. ✅ Completed files records cleaned up

### Scenario 2: Review and Selectively Delete Old Files
1. Click "Older than 7 days" filter
2. Review displayed files
3. Manually select specific files using checkboxes
4. Click "Delete Selected"
5. System cleans up selected files from all storage locations

## 📂 File Structure in B2

The system now properly deletes from these B2 paths:

```
B2 Bucket: docuploader
├── agent-uploads/               ← NOW PROPERLY DELETED
│   ├── {agentId}/
│   │   ├── {fileId}/
│   │   │   └── completed_{timestamp}_{random}.{ext}
│
├── agent-responses/             ← Already being deleted
│   └── {agentId}/
│       └── response_{timestamp}_{random}.{ext}
```

## 🔍 Technical Details

### State Management
```typescript
const [daysFilter, setDaysFilter] = useState<"all" | "7" | "15" | "30">("all");
```

### API Request
```typescript
const params = new URLSearchParams();
if (daysFilter !== 'all') params.append('daysOld', daysFilter);
```

### B2 Deletion Logic
```typescript
// Collect from files collection
if (data?.b2Key) {
  b2KeysToDelete.push(data.b2Key);
}

// Collect from completedFiles collection
if (data?.completedFileId) {
  const completedDoc = await adminDb.collection('completedFiles').doc(data.completedFileId).get();
  if (completedDoc.exists && completedDoc.data()?.b2Key) {
    b2KeysToDelete.push(completedDoc.data().b2Key); // agent-uploads path
  }
}

// Delete all collected B2 files
await Promise.all(b2KeysToDelete.map(key => deleteFromB2(key)));
```

## ✅ Testing Checklist

Before deploying, verify:

1. ✅ Age filter shows correct files (older than X days)
2. ✅ Count badge displays accurate file count
3. ✅ "Select All Old Files" button works when filter active
4. ✅ Delete single file removes from B2 storage
5. ✅ Bulk delete removes all files from B2 storage
6. ✅ agent-uploads folder files are deleted
7. ✅ completedFiles documents are removed
8. ✅ Confirmation messages display correctly
9. ✅ Cache updates after filter changes
10. ✅ No linter errors

## 🚀 Benefits

1. **Storage Cost Reduction**: Easy cleanup of old files reduces B2 storage costs
2. **Data Hygiene**: Remove outdated files systematically
3. **Complete Cleanup**: No orphaned files in B2 storage
4. **User-Friendly**: Simple filter UI with bulk operations
5. **Safe Operations**: Clear confirmation messages with detailed actions
6. **Performance**: Server-side filtering for efficiency

## 📝 Files Modified

1. `apps/admin-app/src/app/admin/files/page.tsx`
   - Added daysFilter state
   - Updated UI with filter buttons
   - Added visual indicators
   - Enhanced confirmation messages
   - Updated cache keys

2. `apps/admin-app/src/app/api/admin/files/route.ts`
   - Added daysOld query parameter
   - Implemented date filtering logic
   - **Enhanced DELETE to handle completedFiles collection**
   - **Added B2 deletion for agent-uploads folder**
   - Improved logging

## 🔐 Security & Safety

- ✅ Admin authentication required
- ✅ Explicit confirmation for all deletions
- ✅ Detailed action descriptions
- ✅ Audit logging of all deletions
- ✅ Graceful error handling (doesn't fail if B2 file missing)

## 💡 Future Enhancements

Consider adding:
- Custom date range picker
- Schedule automatic deletion of files > X days
- Archive files instead of delete
- Export old files before deletion
- Deletion history/undo within time window

---

**Status**: ✅ Complete and Production Ready
**Date**: November 5, 2025
**All TODOs Completed**: 4/4

