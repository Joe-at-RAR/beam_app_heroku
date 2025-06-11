# VSRX Sync Operational Best Practices

## Overview

This document provides operational guidance for running and maintaining the VSRX to SilknoteDocAnalysis file sync process. For architecture details, see [file_diagram.md](./file_diagram.md). For setup instructions, see [README.md](./README.md).

## Sync Schedule Recommendations

### Production Environment
- **Frequency**: Every 10-15 minutes during business hours
- **Off-hours**: Every 30 minutes (reduced frequency)
- **Maintenance Window**: Daily at 2 AM for cleanup tasks

### Staging/Test Environment
- **Frequency**: Every 5 minutes for rapid testing
- **Manual Triggers**: Enable for debugging

### Example Cron Configuration
```bash
# Business hours (8 AM - 6 PM, Monday-Friday)
*/10 8-18 * * 1-5 cd /path/to/sync && node vsrx-sync.js >> sync.log 2>&1

# Off hours and weekends
*/30 0-7,19-23 * * * cd /path/to/sync && node vsrx-sync.js >> sync.log 2>&1
*/30 * * * 0,6 cd /path/to/sync && node vsrx-sync.js >> sync.log 2>&1

# Daily cleanup
0 2 * * * cd /path/to/sync && node cleanup.js >> cleanup.log 2>&1
```

## Performance Optimization

### Database Optimization
```sql
-- Add indexes for better performance
CREATE INDEX idx_vsrx_reference ON silknote_documents(VSRXReference);
CREATE INDEX idx_patient_uuid ON silknote_documents(patientUuid);
CREATE INDEX idx_activated_use ON silknote_patient_filesets(activatedUse);
CREATE INDEX idx_file_uuid ON ax_notes_attachments(file_uuid);
```

### Batch Processing
```javascript
// Optimal batch sizes based on testing
const BATCH_CONFIG = {
  filesPerBatch: 50,          // Process 50 files at a time
  patientsPerRun: 100,        // Limit patients per sync run
  maxParallelUploads: 5,      // Concurrent uploads to API
  maxFileSize: 50 * 1024 * 1024  // 50MB file size limit
};
```

### Connection Pooling
```javascript
// MySQL connection pool configuration
const poolConfig = {
  host: process.env.MYSQL_HOST,
  connectionLimit: 10,
  queueLimit: 20,
  waitForConnections: true,
  connectTimeout: 60000,
  acquireTimeout: 60000,
  timeout: 60000
};
```

## Monitoring Strategy

### Key Metrics Dashboard
1. **Sync Health**
   - Last successful sync timestamp
   - Files processed per hour
   - Average sync duration
   - Error rate (errors/total files)

2. **Resource Usage**
   - MySQL connection pool usage
   - Memory consumption
   - API response times
   - Network bandwidth

3. **Business Metrics**
   - Active patients synced
   - Total documents processed
   - Storage growth rate

### Alert Configuration
```json
{
  "alerts": {
    "syncStalled": {
      "condition": "no successful sync in 2 hours",
      "severity": "critical",
      "notification": ["email", "sms"]
    },
    "highErrorRate": {
      "condition": "error rate > 5%",
      "severity": "warning",
      "notification": ["email"]
    },
    "slowPerformance": {
      "condition": "average sync time > 5 minutes",
      "severity": "warning",
      "notification": ["email"]
    }
  }
}
```

## Error Recovery Procedures

### Common Issues and Solutions

1. **API Timeout Errors**
   ```javascript
   // Implement exponential backoff
   async function retryWithBackoff(fn, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await sleep(Math.pow(2, i) * 1000);
       }
     }
   }
   ```

2. **Large File Handling**
   - Pre-check file sizes before processing
   - Stream large files instead of loading into memory
   - Consider compression for network transfer

3. **Database Connection Issues**
   - Implement connection retry logic
   - Use connection pooling
   - Monitor connection pool exhaustion

### Manual Intervention Procedures

1. **Stuck Sync Process**
   ```bash
   # Check for running processes
   ps aux | grep vsrx-sync
   
   # Kill stuck process
   kill -9 <PID>
   
   # Clear sync lock
   mysql -e "DELETE FROM sync_locks WHERE process = 'vsrx-sync'"
   
   # Restart sync
   node vsrx-sync.js
   ```

2. **Cleanup Orphaned Records**
   ```sql
   -- Find documents without patient filesets
   SELECT sd.* FROM silknote_documents sd
   LEFT JOIN silknote_patient_filesets spf 
   ON sd.patientUuid = spf.silknotePatientUuid
   WHERE spf.silknotePatientUuid IS NULL;
   ```

## Security Best Practices

### API Key Management
- Store API keys in environment variables
- Rotate keys quarterly
- Use separate keys for dev/staging/prod
- Monitor API key usage

### File Path Validation
```javascript
// Always validate file paths
function isValidPath(filePath) {
  const resolved = path.resolve(VSRX_FILE_BASE_PATH, filePath);
  return resolved.startsWith(path.resolve(VSRX_FILE_BASE_PATH));
}
```

### Audit Logging
- Log all file operations
- Include user context where available
- Retain logs for compliance period
- Encrypt sensitive log data

## Maintenance Tasks

### Daily
- Review error logs
- Check sync performance metrics
- Verify storage usage

### Weekly
- Analyze sync patterns
- Review and resolve persistent errors
- Update monitoring thresholds


### Quarterly
- API key rotation
- Dependency updates
- Load testing
- Disaster recovery drill

## Troubleshooting Guide

### Diagnostic Commands
```bash
# Check last sync time
mysql -e "SELECT MAX(updatedAt) FROM silknote_documents"

# Count pending files
mysql -e "SELECT COUNT(*) FROM ax_notes_attachments a 
LEFT JOIN silknote_documents d ON a.file_uuid = d.VSRXReference 
WHERE d.VSRXReference IS NULL"

# View recent errors
mysql -e "SELECT silknotePatientUuid, errors FROM silknote_patient_filesets 
WHERE JSON_LENGTH(errors) > 0 ORDER BY updatedAt DESC LIMIT 10"
```

### Performance Analysis
```bash
# Analyze slow queries
mysqldumpslow -s t sync.log

# Monitor real-time performance
mytop -u vsrx_user -p

# Check API response times
curl -w "@curl-format.txt" -o /dev/null -s "$VITALSIGN_PROCESS_ENDPOINT/health"
``` 