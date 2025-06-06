# VSRX-VitalSign Synchronization System

## Overview

This document outlines the comprehensive plan for implementing a synchronization system between VSRX (Electronic Health Record using MySQL) and VitalSign (Document Processing System using PostgreSQL with Azure storage).

## System Architecture

### Current State
- **Silknote**: Svelte 5 + PostgreSQL + VitalSign integration (working)
- **VSRX**: jQuery + MySQL + needs VitalSign integration
- **VitalSign**: Express.js server with Azure Blob Storage and Vector Store

### Integration Requirements
- VSRX has existing patient files stored locally with paths in MySQL
- VitalSign needs to sync these files to Azure Blob Storage
- Maintain consistency between VSRX MySQL and VitalSign PostgreSQL
- Support periodic automated synchronization

## Database Schema Extensions

### VSRX MySQL Tables (Existing)
```sql
-- Patient table (existing)
Patient {
  id: UUID,
  name: string,
  // ... other patient fields
}

-- Files table (existing)  
Files {
  id: UUID,
  path: string,
  patientId: UUID,
  deleted: boolean,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### VitalSign PostgreSQL Extensions
```sql
-- Add VSRXReference to SilknoteDocument
ALTER TABLE silknote_documents 
ADD COLUMN vsrxReference STRING?;

-- Add syncLog to SilknotePatientFileset
ALTER TABLE silknote_patient_filesets 
ADD COLUMN syncLog TEXT?; -- JSON string for sync history
```

## Sync Process Flow

### 1. Periodic Sync Endpoint
**Endpoint**: `POST /api/sync/vsrx`

**Process**:
1. Query VitalSign DB for all `SilknotePatientFileset` where `activatedUse = true`
2. For each patient fileset:
   - Query VSRX MySQL for all `Files` where `patientId = patient.vsrxPatientId` and `deleted = false`
   - Query VitalSign for all `SilknoteDocument` for this patient fileset
   - Compare and identify:
     - **New files**: VSRX `Files.id` not in `SilknoteDocument.vsrxReference`
     - **Deleted files**: `SilknoteDocument.vsrxReference` not in VSRX `Files.id` OR `Files.deleted = true`

### 2. File Addition Process
- Read file from VSRX local storage using `Files.path`
- Send to existing VitalSign process endpoint
- Monitor processing status
- Update `SilknoteDocument.vsrxReference = Files.id`
- Log operation in `syncLog`

### 3. File Deletion Process
**New Endpoint**: `DELETE /api/documents/:documentId`

**Process**:
- Remove file from Azure Blob Storage
- Remove from Vector Store
- Delete `SilknoteDocument` record
- Validate vector store file count matches database
- Log operation in `syncLog`

## Endpoints Implementation

### 1. Sync Endpoint
```typescript
POST /api/sync/vsrx
- Authenticates VSRX system
- Performs full sync for all active patients
- Returns sync summary and any errors
```

### 2. Patient-Specific Sync
```typescript
POST /api/sync/vsrx/patient/:patientId
- Syncs files for specific patient
- Useful for targeted resync after errors
```

### 3. Document Deletion
```typescript
DELETE /api/documents/:documentId
- Removes document from all systems
- Validates consistency after deletion
```

### 4. Sync Status
```typescript
GET /api/sync/status/:patientId
- Returns last sync status and any errors
- Shows file count consistency information
```

## Error Handling & Logging

### SyncLog Structure
```json
{
  "lastSyncAttempt": "2024-01-15T10:30:00Z",
  "lastSuccessfulSync": "2024-01-15T10:30:00Z",
  "syncHistory": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "operation": "full_sync",
      "status": "success",
      "filesAdded": 3,
      "filesDeleted": 1,
      "errors": []
    },
    {
      "timestamp": "2024-01-15T09:30:00Z", 
      "operation": "full_sync",
      "status": "partial_failure",
      "filesAdded": 2,
      "filesDeleted": 0,
      "errors": [
        {
          "fileId": "uuid-123",
          "error": "File not found at path",
          "timestamp": "2024-01-15T09:32:00Z"
        }
      ]
    }
  ]
}
```

## Edge Cases & Handling

### 1. Network Failures During Sync
**Problem**: Partial sync could leave inconsistent state
**Solution**: 
- Implement transaction-like behavior
- Use sync status tracking to resume from failure point
- Rollback mechanism for partial failures

### 2. File Processing Failures  
**Problem**: File exists in VSRX but fails VitalSign processing
**Solution**:
- Retry mechanism with exponential backoff
- Mark files with processing errors in syncLog
- Manual intervention endpoint for failed files

### 3. Concurrent Modifications
**Problem**: Files added/removed during sync process
**Solution**:
- Use timestamps to detect concurrent changes
- Lock mechanism during sync (advisory locks)
- Queue concurrent changes for next sync cycle

### 4. Large File Sets
**Problem**: Memory and performance issues with many files
**Solution**:
- Batch processing (configurable batch size)
- Streaming file operations
- Memory monitoring and cleanup

### 5. File Path Changes
**Problem**: VSRX changes file paths between syncs
**Solution**:
- Store file hash/checksum for identity verification
- Handle path changes as file moves, not delete/add
- Detect and log path changes

### 6. Duplicate File Detection
**Problem**: Same file uploaded multiple times
**Solution**:
- File content hashing for deduplication
- Reference counting for shared files
- User notification for duplicates

### 7. Vector Store Inconsistencies
**Problem**: Vector store and database out of sync
**Solution**:
- Periodic consistency checks
- Rebuild vector store capability
- Validation after each operation

### 8. File Grouping Limitations
**Problem**: Automated sync doesn't allow user-driven file grouping
**Solution**:
- Default grouping by document type/date
- Post-sync manual grouping interface
- Configurable grouping rules

### 9. Orphaned Files
**Problem**: Files in blob storage but not in database
**Solution**:
- Periodic orphan detection
- Cleanup jobs for orphaned blobs
- Reconciliation reports

### 10. File Corruption
**Problem**: Files become corrupted during transfer/storage
**Solution**:
- Checksum verification
- Backup and recovery procedures
- Error notification and reprocessing

## Security Considerations

### Authentication
- VSRX system authentication for sync endpoints
- API key or certificate-based authentication
- Rate limiting on sync endpoints

### Data Privacy
- Encrypt files in transit and at rest
- Audit logging for all sync operations
- Compliance with healthcare data regulations

## Monitoring & Alerting

### Key Metrics
- Sync success/failure rates
- File processing times
- Storage usage trends
- Error frequencies by type

### Alerts
- Sync failures exceeding threshold
- Large file processing delays
- Storage capacity warnings
- Consistency check failures

## Implementation Phases

### Phase 1: Core Sync Infrastructure
1. Database schema updates
2. Basic sync endpoint implementation
3. Error logging system
4. Unit tests

### Phase 2: File Operations
1. Document deletion endpoint
2. Batch processing optimization
3. File validation and checksums
4. Integration tests

### Phase 3: Monitoring & Management
1. jQuery admin interface
2. Sync status dashboard
3. Manual intervention tools
4. Performance monitoring

### Phase 4: Production Hardening
1. Comprehensive error handling
2. Performance optimization
3. Security hardening
4. Documentation and training

## Testing Strategy

### Unit Tests
- Individual sync operations
- Error handling scenarios
- Database operations
- File processing

### Integration Tests
- End-to-end sync workflows
- VSRX-VitalSign integration
- Error recovery scenarios
- Performance under load

### Acceptance Tests
- Real-world file sets
- Extended sync scenarios
- User interface validation
- System reliability testing

## Configuration

### Environment Variables
```env
VSRX_MYSQL_CONNECTION_STRING=mysql://...
SYNC_BATCH_SIZE=50
SYNC_RETRY_ATTEMPTS=3
SYNC_RETRY_DELAY_MS=5000
ENABLE_AUTO_SYNC=true
AUTO_SYNC_INTERVAL_MINUTES=30
```

### Configurable Parameters
- Batch sizes for processing
- Retry policies
- Sync intervals
- File size limits
- Error thresholds

This plan provides a comprehensive foundation for implementing the VSRX-VitalSign synchronization system while addressing the key challenges and edge cases identified in the requirements. 