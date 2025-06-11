# VSRX Sync Edge Cases and Implementation Decisions

## File Grouping Challenge

### The Problem
- **VSRX**: Stores individual files (e.g., IMG001.jpg, IMG002.jpg, IMG003.jpg)
- **Silknote**: Groups related images into PDFs during user upload
- **Sync Process**: Non-interactive, automated process

### Decision: No Automatic Grouping During Sync

**Rationale:**
1. **User Intent**: Grouping decisions require human judgment about which files belong together
2. **Data Integrity**: Preserve original file structure from VSRX
3. **Reversibility**: Individual files can be grouped later by users if needed
4. **Simplicity**: Reduces sync complexity and potential errors

### Implementation Approach

```javascript
// During sync, each VSRX file is processed individually
for (const vsrxFile of filesToAdd) {
  // Process as individual document
  await processDocuments({
    patientUuid: fileset.silknotePatientUuid,
    files: [file], // Single file array
    metadata: {
      vsrxReference: vsrxFile.id,
      originalPath: vsrxFile.path,
      sourceSystem: 'VSRX_SYNC',
      groupingStatus: 'ungrouped'
    }
  });
}
```

### Future Considerations
- Add UI in Silknote to allow manual grouping of synced files
- Track "sync source" metadata to differentiate synced vs user-uploaded files
- Consider ML-based grouping suggestions (but still require user confirmation)

## Handling Concurrent Access

### Scenario 1: File Modified During Sync
**Issue**: VSRX user uploads/deletes file while sync is running

**Solution**: 
- Use file timestamps and ETags where available
- Implement "eventual consistency" model
- Next sync cycle will catch changes

### Scenario 2: Multiple Sync Processes
**Issue**: Preventing duplicate sync runs

**Solution**:
```javascript
// Add sync lock mechanism
const syncLock = await acquireSyncLock('vsrx-sync');
if (!syncLock) {
  return json({ 
    success: false, 
    error: 'Sync already in progress' 
  });
}
```

## File Reference Mapping

### VSRXReference Field Usage
The `clientFileId` field in SilknoteDocument stores the VSRX file ID:

```typescript
interface SyncMapping {
  vsrxFileId: string;        // From VSRX Files.id
  silknoteDocumentUuid: string; // Generated UUID
  clientFileId: string;      // Stores vsrxFileId for reference
}
```

### Handling Deleted Files
When VSRX marks a file as deleted:
1. Check `Files.deleted === true`
2. Find corresponding SilknoteDocument by `clientFileId`
3. Delete from all storage locations:
   - Azure Blob Storage
   - Vector Store
   - Database record

## Error Recovery Strategies

### Partial Sync Failures

```json
{
  "syncStatus": {
    "lastCompleteSync": "2024-01-20T10:00:00Z",
    "partialSyncState": {
      "processedFilesets": ["uuid1", "uuid2"],
      "failedFilesets": ["uuid3"],
      "resumeFromFileset": "uuid3"
    }
  }
}
```

### File Processing Failures
1. **Corrupt Files**: Log error, skip file, continue sync
2. **Oversized Files**: Check size limits before processing
3. **Unsupported Formats**: Validate MIME types
4. **Network Timeouts**: Implement exponential backoff

## Special Considerations

### Patient Re-booking
Per VSRX behavior: "If patient is rebooked, new patient ID is generated"

**Implications**:
- Old patient ID files remain in Silknote
- New patient ID creates new fileset
- No automatic migration of files

**Solution**:
- Track patient ID history in metadata
- Provide manual migration tool if needed
- Clear documentation for VSRX users

### File Path Security

```javascript
// Validate file paths to prevent directory traversal
function validateFilePath(path: string): boolean {
  const normalizedPath = path.normalize();
  
  // Must start with 'notes/' prefix
  if (!normalizedPath.startsWith('notes/')) {
    return false;
  }
  
  // No parent directory references
  if (normalizedPath.includes('../')) {
    return false;
  }
  
  return true;
}
```

### Storage Optimization

**Deduplication Strategy**:
1. Calculate file hash before upload
2. Check if blob already exists
3. Reference existing blob if duplicate
4. Track reference count for cleanup

```javascript
const fileHash = await calculateFileHash(fileBuffer);
const existingBlob = await checkBlobExists(fileHash);

if (existingBlob) {
  // Reference existing blob instead of uploading
  await createDocumentReference(existingBlob);
} else {
  // Upload new blob
  await uploadToBlob(fileBuffer, fileHash);
}
```

## Monitoring and Alerts

### Key Metrics to Track
1. **Sync Duration**: Average time per patient fileset
2. **Error Rate**: Failures per 100 syncs
3. **File Processing Speed**: Files per minute
4. **Storage Growth**: GB added per sync cycle

### Alert Thresholds
```json
{
  "alerts": {
    "syncDuration": {
      "warning": 300,  // 5 minutes
      "critical": 600  // 10 minutes
    },
    "errorRate": {
      "warning": 0.05,  // 5%
      "critical": 0.10  // 10%
    },
    "consecutiveFailures": {
      "warning": 3,
      "critical": 5
    }
  }
}
```

## Database Consistency

### Transaction Boundaries
Each patient fileset should be processed in a transaction:

```javascript
await prisma.$transaction(async (tx) => {
  // All operations for one patient
  await tx.silknoteDocument.createMany({...});
  await tx.silknotePatientFileset.update({...});
});
```

### Orphaned Records
Periodic cleanup job to find:
- Documents without valid patient filesets
- Blobs without document references
- Vector store entries without documents

## Future Enhancements

### Phase 1 (Current)
- Basic sync functionality
- Error logging
- Manual trigger

### Phase 2
- Automated scheduling
- Performance optimization
- Batch processing improvements

### Phase 3
- Real-time sync via webhooks
- Bi-directional sync
- Advanced conflict resolution 