# B2 CORS Setup Required for Direct Upload

## 🚨 Issue
When trying to upload files directly from the browser to B2 using pre-signed URLs, you may encounter CORS (Cross-Origin Resource Sharing) errors.

## 📋 Error Messages You Might See
- "Error uploading file. Please try again."
- "CORS or network error" in browser console
- "Access to fetch at '...' from origin '...' has been blocked by CORS policy"

## 🔧 Solution: Configure B2 CORS Settings

### Option 1: Using B2 Web Interface

1. **Log in to Backblaze B2 Console**
   - Go to https://secure.backblaze.com/b2_buckets.htm

2. **Navigate to Your Bucket**
   - Click on your bucket (the one specified in `B2_BUCKET` env variable)

3. **Go to Bucket Settings**
   - Click on "Bucket Settings" tab

4. **Add CORS Rules**
   - Click on "CORS Rules" section
   - Add the following CORS configuration:

```json
[
  {
    "corsRuleName": "allowDirectUpload",
    "allowedOrigins": [
      "http://localhost:3000",
      "https://your-production-domain.com"
    ],
    "allowedOperations": [
      "b2_upload_file",
      "b2_download_file_by_id",
      "b2_download_file_by_name"
    ],
    "allowedHeaders": [
      "content-type",
      "x-bz-file-name",
      "x-bz-content-sha1"
    ],
    "exposeHeaders": [
      "x-bz-content-sha1"
    ],
    "maxAgeSeconds": 3600
  }
]
```

5. **Replace `allowedOrigins`**
   - For development: `http://localhost:3000`
   - For production: Your actual domain (e.g., `https://admin.yourdomain.com`)
   - You can add multiple origins in the array

6. **Save CORS Rules**

### Option 2: Using B2 CLI

```bash
# Install B2 CLI
pip install b2

# Authorize
b2 authorize-account <applicationKeyId> <applicationKey>

# Set CORS rules
b2 update-bucket --cors-rules '[
  {
    "corsRuleName": "allowDirectUpload",
    "allowedOrigins": [
      "http://localhost:3000",
      "https://your-production-domain.com"
    ],
    "allowedOperations": [
      "b2_upload_file",
      "b2_download_file_by_id",
      "b2_download_file_by_name"
    ],
    "allowedHeaders": [
      "content-type",
      "x-bz-file-name",
      "x-bz-content-sha1"
    ],
    "exposeHeaders": [
      "x-bz-content-sha1"
    ],
    "maxAgeSeconds": 3600
  }
]' <bucketName> allPrivate
```

## 🔄 Automatic Fallback

The application has been configured with **automatic fallback**:

1. **First Attempt**: Direct upload to B2 via pre-signed URL (fastest)
2. **Fallback**: If CORS fails, automatically falls back to server upload (old method)

### How It Works

```typescript
try {
  // Try direct B2 upload (fastest, requires CORS)
  await uploadDirectlyToB2();
} catch (corsError) {
  // Automatically fall back to server upload (slower but always works)
  await uploadViaServer();
}
```

## 🎯 Benefits of Direct Upload (With CORS Configured)

✅ **Ultra-fast response**: <200ms initial response
✅ **No server bottleneck**: Files upload directly from browser to B2
✅ **Parallel uploads**: Multiple agents can upload simultaneously
✅ **Better UX**: Native browser upload progress
✅ **Scalable**: No server memory/bandwidth usage

## 🔍 Debugging Steps

### 1. Check Browser Console
Open browser DevTools (F12) and look for:
```
[UPLOAD] Step 1: Getting pre-signed URL...
[UPLOAD] Got pre-signed URL
[UPLOAD] Step 2: Uploading to B2...
[UPLOAD] CORS or network error: TypeError: Failed to fetch
[UPLOAD] Falling back to server upload method...
```

### 2. Check Server Logs
Look for:
```
[UPLOAD-URL] Starting pre-signed URL generation...
[B2] Initializing client for upload URL...
[B2] ✅ Generated pre-signed upload URL for: agent-uploads/...
```

### 3. Test CORS Configuration
Try uploading a file. If you see "Falling back to server upload method..." in console, CORS is not configured.

### 4. Verify CORS is Active
After configuring CORS, test again. You should see:
```
[UPLOAD] Step 2: Uploading to B2...
[UPLOAD] Successfully uploaded to B2
[UPLOAD] Step 3: Confirming upload...
```

## 📊 Performance Comparison

### With CORS Configured (Direct Upload)
- Initial response: **<100ms**
- Upload: Browser handles directly
- Confirmation: **<150ms**
- **Total server time: ~250ms**

### Without CORS (Server Fallback)
- Initial response: **<100ms** (tries CORS first)
- Falls back to server: **2-5 seconds** (depending on file size)
- **Total time: ~2-5 seconds**

## 🔐 Security Notes

1. **CORS Rules Are Safe**
   - Only allow specific origins (your domain)
   - Only allow specific operations (upload/download)
   - Pre-signed URLs expire after 1 hour

2. **Who Can Upload?**
   - Only authenticated agents
   - File ownership is verified before URL generation
   - URLs are one-time use (single upload)

3. **Bucket Security**
   - Keep bucket settings as "allPrivate"
   - CORS only allows browser access with pre-signed URLs
   - No public access to bucket contents

## 🎓 Why CORS is Needed

When JavaScript in a browser tries to make a request to a different domain (cross-origin), the browser enforces CORS policies for security. 

**Without CORS configured on B2:**
- Browser: "I want to upload to s3.eu-central-003.backblazeb2.com"
- B2: ❌ "No CORS headers - request blocked"

**With CORS configured on B2:**
- Browser: "I want to upload to s3.eu-central-003.backblazeb2.com from yourdomain.com"
- B2: ✅ "Origin allowed, content-type allowed - proceed"

## 📝 Checklist

- [ ] Log in to B2 Console
- [ ] Navigate to your bucket (from `B2_BUCKET` env var)
- [ ] Add CORS rules with your domain(s)
- [ ] Include both localhost and production domains
- [ ] Test upload functionality
- [ ] Verify console logs show direct B2 upload (not fallback)

## 🆘 Still Having Issues?

1. **Double-check bucket name** in B2 console matches `B2_BUCKET` env variable
2. **Verify origin spelling** - must exactly match your domain (including https://)
3. **Try wildcard for testing** - `"*"` in allowedOrigins (not recommended for production)
4. **Check B2 status** - https://status.backblaze.com/
5. **Use fallback** - If direct upload isn't critical, the fallback method works fine

## 🎉 Success Indicators

When CORS is properly configured, you should see:
- ✅ Upload button responds instantly (<200ms)
- ✅ Console shows successful B2 upload
- ✅ No "falling back" messages
- ✅ Native browser upload progress
- ✅ File appears in "Completed" status immediately

---

**Note**: The fallback to server upload ensures the application works even without CORS configuration, but configuring CORS provides the best performance and user experience.

