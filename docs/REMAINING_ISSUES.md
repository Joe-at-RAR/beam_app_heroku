# Remaining Issues with Default User Fallbacks

## ✅ Background Processing in FileService - FIXED

The `FileProcessor` class in `src/services/fileService.ts` previously used 'default-user' in two places:

1. **Line 88**: `const patients = await patientService.getPatients('default-user');`
2. **Line 218**: `const patient = await patientService.getPatientById(silknotePatientUuid, 'default-user');`

### The Problem (Now Fixed)

The FileProcessor was a background service that processed files asynchronously. When processing a queued file, it needed to:
1. Find which patient owns the file
2. Update the file's status
3. Process the file

Previously, it searched through ALL patients using 'default-user' to find the file, which was:
- Inefficient (O(n) search through all patients)
- Violated the no-fallback policy
- Didn't maintain proper user context

### Solution Implemented

The file processing queue has been redesigned to include user context:

1. **Updated the queue structure** to store file ID, user UUID, and patient UUID:
   ```typescript
   interface QueuedFile {
     fileId: string;
     silknoteUserUuid: string;
     silknotePatientUuid: string;
   }
   ```

2. **Updated `addToQueue` method** to accept user context:
   ```typescript
   public addToQueue(fileId: string, silknoteUserUuid: string, silknotePatientUuid: string)
   ```

3. **Updated all callers** to provide user context when queuing files

4. **Removed the patient search** in `processQueuedFile` and now uses the stored context directly

### Changes Made

- `FileProcessor.processingQueue` changed from `string[]` to `QueuedFile[]`
- Added `queuedFilesMap` for efficient lookup
- `addToQueue` now requires all three parameters
- `processQueuedFile` uses stored context instead of searching all patients
- `createFileMetadata` now requires `silknoteUserUuid` parameter
- `processUnprocessedFiles` now requires `silknoteUserUuid` parameter
- All calls to these functions have been updated

### Result

The system now properly maintains user context throughout the file processing pipeline, eliminating the need for default values and improving both security and efficiency.

### Alternative Approach

If the above is too complex, consider:
- Making file processing synchronous during upload (not recommended for performance)
- Using a proper job queue system (like Bull or BullMQ) that can store job metadata including user context
- Storing user/patient context in the file metadata itself

### Impact

This is a background service that doesn't directly affect API security, but it does violate the architectural principle of "no default values". The service will continue to work but should be refactored for consistency and proper multi-tenancy support. 