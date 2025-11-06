# Alert System Documentation

## Overview
A complete alert/announcement system has been implemented that allows administrators to create and manage alerts that will be displayed on the user app's home page and upload page.

## Features

### Admin Side
- **New "Alerts" Section** in the admin panel (accessible via sidebar)
- Create alerts with:
  - Custom message text
  - Alert type (Info, Warning, Success, Error)
  - Active/Inactive status toggle
- Manage existing alerts:
  - View all alerts with their status
  - Toggle active/inactive status
  - Delete alerts
- Real-time preview of how alerts will appear to users

### User Side
- Alerts displayed at the top of:
  - Home page (`apps/user-app/src/app/page.tsx`)
  - Upload page (`apps/user-app/src/app/upload/page.tsx`)
- Features:
  - **Fixed below navbar** - Alert stays below the navigation bar, always visible even when scrolling
  - **Horizontal scrolling animation** - Text scrolls from right to left across entire screen
  - **Pause on hover** - Animation pauses when user hovers over the alert
  - Color-coded by type (Info: blue, Warning: yellow, Success: green, Error: red)
  - Dismissible by users (client-side only)
  - Auto-refresh every 5 minutes
  - Responsive design for mobile and desktop
  - Positioned at `top-12 sm:top-14 md:top-16` to match navbar height
  - Z-index 40 (below navbar which is z-50)
  - 15-second full-screen scroll duration

## Files Created/Modified

### New Files
1. **`shared/models/Alert.ts`** - Alert data model and interfaces
2. **`apps/admin-app/src/app/admin/alerts/page.tsx`** - Admin alerts management page
3. **`apps/admin-app/src/app/api/admin/alerts/route.ts`** - Admin API endpoints (GET, POST, PATCH, DELETE)
4. **`apps/user-app/src/app/api/alerts/route.ts`** - User-facing API endpoint (GET active alerts)

### Modified Files
1. **`apps/admin-app/src/components/AdminSidebar.tsx`** - Added "Alerts" navigation item
2. **`apps/user-app/src/app/page.tsx`** - Added alert banner display with scrolling
3. **`apps/user-app/src/app/upload/page.tsx`** - Added alert banner display with scrolling
4. **`apps/user-app/src/styles/globals.css`** - Added scrolling animation CSS

## Database Structure

Alerts are stored in Firestore under the `alerts` collection with the following structure:

```typescript
{
  message: string,          // Alert message text
  type: 'info' | 'warning' | 'success' | 'error',
  isActive: boolean,        // Whether the alert is currently displayed
  createdAt: Date,
  updatedAt: Date,
  createdBy: string         // Admin identifier
}
```

## API Endpoints

### Admin Endpoints (`/api/admin/alerts`)
- **GET** - Fetch all alerts (ordered by creation date, newest first)
- **POST** - Create new alert (requires admin token)
- **PATCH** - Update alert status (requires admin token)
- **DELETE** - Delete alert (requires admin token, pass `id` as query param)

### User Endpoint (`/api/alerts`)
- **GET** - Fetch only active alerts (public access, no authentication required)

**Note**: Queries are optimized to avoid requiring Firestore indexes by fetching all documents and filtering/sorting in memory.

## How to Use

### For Admins
1. Navigate to **Admin Portal** → **Alerts** (🔔 icon in sidebar)
2. Fill in the "Create New Alert" form:
   - Enter your message in the text area
   - Select alert type (Info, Warning, Success, or Error)
   - Set status (Active/Inactive)
3. Click "Create Alert"
4. Manage alerts in the list below:
   - Click ⏸️/▶️ to toggle active/inactive
   - Click 🗑️ to delete

### For Users
- Alerts automatically appear at the top of the home and upload pages
- Click the × button to dismiss an alert (dismissed alerts won't reappear until page refresh)
- Alerts refresh automatically every 5 minutes

## Alert Types

| Type | Icon | Color | Use Case |
|------|------|-------|----------|
| Info | ℹ️ | Blue | General information, announcements |
| Warning | ⚠️ | Yellow | Important notices, upcoming changes |
| Success | ✅ | Green | Positive updates, new features |
| Error | ❌ | Red | Critical alerts, system issues |

## Security

- Only authenticated admins can create/modify/delete alerts
- User endpoint only returns active alerts
- Firebase Admin SDK used for secure database operations
- Admin authentication verified via cookie token

## Future Enhancements (Optional)

- [ ] Alert scheduling (start/end dates)
- [ ] Target specific user groups
- [ ] Rich text formatting in messages
- [ ] Alert analytics (views, dismissals)
- [ ] Email notifications integration
- [ ] Alert templates

## Testing

1. **Admin Side**: Log in to admin panel → Navigate to Alerts → Create a test alert
2. **User Side**: Visit home page or upload page → Verify alert appears
3. **Dismiss**: Click × on alert → Verify it disappears
4. **Toggle**: In admin panel, deactivate the alert → Verify it no longer appears to users

## Environment Variables Required

Ensure these are set in your `.env.local` files:

### User App (`apps/user-app/.env.local`)
```bash
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="your_private_key"
```

### Admin App (`apps/admin-app/.env.local`)
```bash
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="your_private_key"
```

## Notes

- Dismissed alerts are stored in client-side state only (not persisted)
- Alerts refresh on page load and every 5 minutes
- Mobile-responsive design ensures alerts display properly on all devices
- No limit on number of active alerts, but recommend keeping 1-3 for best UX
- Queries are optimized to not require Firestore composite indexes

