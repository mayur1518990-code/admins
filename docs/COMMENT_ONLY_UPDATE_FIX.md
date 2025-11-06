# Comment-Only Update Feature Fix

## Problem
The "Replace File" button in the file edit section was only enabled when a user selected a new file to upload. This meant users **couldn't update or add comments** without uploading a new file, which was inconvenient when they only wanted to send a message to the agent.

## Solution
Implemented a comment-only update feature that allows users to add or update comments without requiring a file upload.

## Changes Made

### 1. New API Endpoint
**File: `apps/user-app/src/app/api/files/update-comment/route.ts`** (NEW)

Created a dedicated endpoint for updating file comments without file replacement:
- **Route**: `POST /api/files/update-comment`
- **Parameters**: 
  - `userId`: User ID for authentication
  - `fileId`: File ID to update
  - `comment`: The comment text
- **Validation**:
  - Checks user ownership
  - Prevents updates on completed files
  - Requires non-empty comment
- **Updates**:
  - `userComment`: The comment text
  - `userCommentUpdatedAt`: Timestamp
  - `updatedAt`: File update timestamp

### 2. Frontend Updates
**File: `apps/user-app/src/app/files/edit/[id]/page.tsx`**

#### Modified `handleUpload` Function
The function now handles **two scenarios**:

1. **Comment-Only Update** (no file selected):
   - Calls `/api/files/update-comment` endpoint
   - Sends JSON with userId, fileId, and comment
   - Updates comment without touching the file

2. **File Replacement** (with optional comment):
   - Calls `/api/files/replace` endpoint (existing)
   - Uploads new file and optionally updates comment
   - Replaces the old file in storage

#### Updated Button Logic
```typescript
// OLD: Button only enabled when file is selected
disabled={!selectedFile || isUploading}

// NEW: Button enabled when file OR comment is present
disabled={(!selectedFile && !comment.trim()) || isUploading}
```

#### Dynamic Button Text
The button now shows different text based on the action:
- **"Replace File"** - When a file is selected
- **"Update Comment"** - When only comment is present
- **"Uploading..."** - When uploading a file
- **"Updating..."** - When updating comment only

#### Updated Info Box
Added clarifications in the info section:
- ✅ "You can add/update comments without uploading a new file"
- ✅ "Comments are visible to the assigned agent"
- ✅ "You can only edit files that haven't been completed yet"

## How It Works

### User Flow - Comment Only
1. User clicks "Edit" button on a file
2. User types a comment in the text area (no file selected)
3. Button shows "Update Comment" and is enabled
4. User clicks the button
5. Comment is saved to database
6. Agent sees the comment in their dashboard

### User Flow - File + Comment
1. User clicks "Edit" button on a file
2. User selects a new file AND types a comment
3. Button shows "Replace File" and is enabled
4. User clicks the button
5. File is replaced and comment is saved
6. Agent sees the new file and comment

### User Flow - File Only
1. User clicks "Edit" button on a file
2. User selects a new file (no comment)
3. Button shows "Replace File" and is enabled
4. User clicks the button
5. File is replaced (existing behavior)

## Benefits
✅ **More Flexible**: Users can communicate with agents without uploading files  
✅ **Better UX**: Button is now enabled for multiple scenarios  
✅ **Clear Feedback**: Dynamic button text shows what action will be performed  
✅ **Efficient**: Comment-only updates don't trigger file storage operations  
✅ **Agent Communication**: Agents immediately see user comments in their dashboard  

## Technical Details

### API Response - Comment Update
```json
{
  "success": true,
  "message": "Comment updated successfully",
  "file": {
    "id": "file123",
    "userComment": "Updated comment text",
    "userCommentUpdatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Button State Logic
```typescript
// Button is enabled when:
- (selectedFile exists) OR (comment has text)
// AND
- isUploading is false
```

## Security
- ✅ Verifies user ownership before updating
- ✅ Prevents updates on completed files
- ✅ Validates comment is non-empty
- ✅ Uses authenticated API routes

## Files Modified
1. **NEW**: `apps/user-app/src/app/api/files/update-comment/route.ts`
2. **MODIFIED**: `apps/user-app/src/app/files/edit/[id]/page.tsx`

## Testing Steps
1. Login as a user
2. Upload a file
3. Click "Edit" on the file
4. **Test 1**: Add a comment only (no file) → Button should show "Update Comment" and work
5. **Test 2**: Select a file only (no comment) → Button should show "Replace File" and work
6. **Test 3**: Add both comment and file → Button should show "Replace File" and work
7. Login as agent and verify comment appears in dashboard

## Related Features
- User message display in agent dashboard (see `USER_MESSAGE_TO_AGENT_FEATURE.md`)
- File replacement feature (existing)

