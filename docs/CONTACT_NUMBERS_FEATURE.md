# Contact Numbers Feature for Processing Files

## Overview
Implemented a feature that allows admins to add contact phone numbers in the alerts section. These numbers are automatically displayed to users when their files have a "processing" status, making it easy for users to contact support during file processing.

## Feature Flow
1. **Admin** adds/manages contact numbers in the Alerts section
2. **System** stores contact numbers in Firestore
3. **User** sees these numbers below their files when status is "processing"
4. **User** can click to call directly from the phone numbers

## Implementation Details

### 1. Backend - Admin Side

#### API Endpoint
**File: `apps/admin-app/src/app/api/admin/contact-numbers/route.ts`** (NEW)

- **GET** `/api/admin/contact-numbers` - Fetch contact numbers
  - Returns: `{ contactNumbers: string[], isActive: boolean }`
  - No auth required for GET (public info)

- **POST** `/api/admin/contact-numbers` - Update contact numbers
  - Requires: Admin authentication
  - Body: `{ contactNumbers: string[], isActive: boolean }`
  - Validates phone number format
  - Returns: Updated contact numbers and status

#### Data Storage
- **Collection**: `settings`
- **Document ID**: `contact-settings`
- **Fields**:
  - `contactNumbers`: Array of phone number strings
  - `isActive`: Boolean - whether to show numbers to users
  - `updatedAt`: Timestamp
  - `updatedBy`: "admin"

### 2. Backend - User Side

#### API Endpoint
**File: `apps/user-app/src/app/api/contact-numbers/route.ts`** (NEW)

- **GET** `/api/contact-numbers` - Fetch active contact numbers (public endpoint)
  - No authentication required
  - Only returns numbers if `isActive` is true
  - Returns: `{ success: true, contactNumbers: string[], isActive: boolean }`

### 3. Frontend - Admin Side

#### Alerts Page
**File: `apps/admin-app/src/app/admin/alerts/page.tsx`** (MODIFIED)

Added a "Contact Numbers" section with:

**Features:**
- ✅ Add phone numbers with validation
- ✅ Remove phone numbers
- ✅ Toggle active/inactive status with switch
- ✅ Save button to persist changes
- ✅ Phone icon indicator
- ✅ Real-time UI updates

**UI Components:**
1. **Header Section**
   - Title: "Contact Numbers"
   - Description explaining purpose
   - Toggle switch for showing/hiding to users

2. **Add Number Input**
   - Text input for phone number
   - Validation: Allows +, digits, spaces, (), -
   - "Add" button
   - Enter key support

3. **Numbers List**
   - Shows all added numbers with phone icon
   - Remove button for each number
   - Empty state message when no numbers

4. **Save Button**
   - Saves all changes to backend
   - Shows "Saving..." state
   - Success/error alerts

**Phone Number Validation:**
```javascript
const phoneRegex = /^[+\d\s()-]+$/;
```
- Allows: digits, +, spaces, (), -
- Example valid formats:
  - +1 234 567 8900
  - (123) 456-7890
  - +91 98765 43210

### 4. Frontend - User Side

#### Files Page
**File: `apps/user-app/src/app/files/page.tsx`** (MODIFIED)

**Added Features:**
- Fetches contact numbers on page load
- Shows contact box for files with "processing" status
- Contact numbers appear below file details, above action buttons

**Contact Numbers Display:**
- **Design**: Green-themed box (matches processing theme)
- **Icon**: Phone icon
- **Title**: "📞 Contact Numbers for Support:"
- **Numbers**: Clickable links that open phone dialer
  - Format: `tel:` links for direct calling
  - Hover effect with underline
- **Help Text**: "Your file is being processed. Feel free to call for any queries."

**Conditional Rendering:**
```javascript
{file.status === "processing" && contactNumbers.length > 0 && (
  // Contact numbers box
)}
```

Only shows when:
1. File status is "processing"
2. Contact numbers exist
3. Feature is active (from API)

## Visual Design

### Admin Side (Alerts Page)
```
┌─────────────────────────────────────────────┐
│ Contact Numbers          [Show to Users: 🟢] │
│ These numbers will be shown to users when   │
│ their files are in processing status        │
├─────────────────────────────────────────────┤
│ [Enter phone number...        ] [Add]       │
├─────────────────────────────────────────────┤
│ 📞 +1 234 567 8900            [Remove]      │
│ 📞 +91 98765 43210            [Remove]      │
├─────────────────────────────────────────────┤
│          [Save Contact Numbers]             │
└─────────────────────────────────────────────┘
```

### User Side (Files Page - Processing File)
```
┌─────────────────────────────────────────────┐
│ 📄 document.pdf          [Processing]       │
├─────────────────────────────────────────────┤
│ 📞 Contact Numbers for Support:             │
│   +1 234 567 8900  (clickable)              │
│   +91 98765 43210  (clickable)              │
│                                              │
│   Your file is being processed. Feel free   │
│   to call for any queries.                  │
├─────────────────────────────────────────────┤
│ [View] [Edit] [Delete]                      │
└─────────────────────────────────────────────┘
```

## Usage Instructions

### For Admins:
1. Go to **Admin Portal** → **Alerts** section
2. Scroll to **"Contact Numbers"** section
3. Enter phone numbers and click **"Add"**
4. Toggle **"Show to Users"** switch to ON (green)
5. Click **"Save Contact Numbers"** button
6. ✅ Numbers are now visible to users with processing files!

### For Users:
1. Upload a file and complete payment
2. Wait for admin to assign file to agent
3. When agent marks file as "Processing"
4. **Contact numbers automatically appear** below your file
5. Click on any number to call directly

## Benefits

✅ **Instant Support Access**: Users can immediately contact support when files are processing  
✅ **Reduced Support Tickets**: Direct phone contact reduces email/chat tickets  
✅ **Centralized Management**: Admin manages all contact numbers in one place  
✅ **Easy Updates**: Change numbers anytime without code deployment  
✅ **Professional**: Shows users you're available and responsive  
✅ **Mobile Friendly**: Clickable tel: links work on all devices  
✅ **Conditional Display**: Only shows when relevant (processing status)  
✅ **Toggle Control**: Admin can enable/disable feature anytime  

## Technical Architecture

### Database Schema
```javascript
// Firestore: settings/contact-settings
{
  contactNumbers: [
    "+1 234 567 8900",
    "+91 98765 43210"
  ],
  isActive: true,
  updatedAt: Timestamp,
  updatedBy: "admin"
}
```

### API Flow
```
Admin Side:
1. Admin adds numbers in UI
2. POST /api/admin/contact-numbers
3. Firestore saves to settings/contact-settings
4. Success response

User Side:
1. User loads files page
2. GET /api/contact-numbers
3. Firestore reads settings/contact-settings
4. Returns numbers if isActive = true
5. UI displays for processing files
```

## Files Created
1. ✅ `apps/admin-app/src/app/api/admin/contact-numbers/route.ts`
2. ✅ `apps/user-app/src/app/api/contact-numbers/route.ts`

## Files Modified
1. ✅ `apps/admin-app/src/app/admin/alerts/page.tsx`
2. ✅ `apps/user-app/src/app/files/page.tsx`

## Testing Steps

### Admin Testing:
1. Login to admin portal
2. Navigate to Alerts section
3. Add a test phone number (e.g., "+1 234 567 8900")
4. Click Add → Verify it appears in list
5. Toggle "Show to Users" switch
6. Click "Save Contact Numbers"
7. Verify success message

### User Testing:
1. Login as user
2. Upload a file and complete payment
3. As admin, assign file to an agent
4. As agent, mark file as "Processing"
5. As user, refresh files page
6. Verify contact numbers appear below processing file
7. Click on a number → Verify it opens phone dialer
8. Check files with other statuses → No numbers should show

### Negative Testing:
1. Disable "Show to Users" toggle
2. Save changes
3. User should NOT see numbers even for processing files
4. Re-enable and verify they appear again

## Security Considerations
- ✅ POST endpoint requires admin authentication
- ✅ GET endpoint is public (contact info should be publicly accessible)
- ✅ Phone number validation prevents injection
- ✅ Only shows when feature is active
- ✅ Uses Firestore security rules for write protection

## Future Enhancements
- 📋 Add description/label for each number (e.g., "Sales", "Support")
- 📋 Add business hours indicator
- 📋 Add WhatsApp/Telegram links alongside phone numbers
- 📋 Track call statistics (how many users clicked)
- 📋 Different numbers for different file types/categories
- 📋 Email addresses alongside phone numbers
- 📋 Multiple contact methods (SMS, Call, WhatsApp)

## Troubleshooting

### Numbers not showing for users:
1. Check if "Show to Users" toggle is ON in admin
2. Verify file status is "processing"
3. Check browser console for API errors
4. Verify Firestore document exists: `settings/contact-settings`

### Can't save numbers:
1. Verify admin is logged in
2. Check admin-token cookie exists
3. Verify Firestore permissions
4. Check browser console for errors

### Invalid phone number error:
- Ensure number only contains: digits, +, spaces, (), -
- Remove any letters or special characters
- Examples: "+1 234 567 8900" or "(123) 456-7890"

## Related Features
- Alert Management System
- File Status Management
- Agent Assignment System

