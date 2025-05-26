# Beam Server API Documentation

## Overview

The Beam Server provides a RESTful API for managing medical documents, patient records, case summaries, and vector search capabilities. 

### Identification System

The API uses a dual-identification system for security:

1. **User Identification**: Via `x-silknote-user-uuid` header (required for most endpoints)
2. **Patient Identification**: Via URL parameters (required for patient-specific operations)

This ensures:
- Users can only access their own data
- Operations are performed on the correct patient records
- Complete audit trail of who accessed what
- No default or fallback values are ever used

## Authentication

### User Authentication

Most endpoints require authentication via the `x-silknote-user-uuid` header:

```
x-silknote-user-uuid: <uuid-format-user-id>
```

The user UUID must be in standard UUID format (e.g., `123e4567-e89b-12d3-a456-426614174000`).

### Patient Context

For patient-specific operations, the patient UUID is included in the URL path:

```
/api/patients/{silknotePatientUuid}/files
/api/case-summary/generate/{silknotePatientUuid}
```

### Example Request

```bash
GET /api/patients/456e7890-e89b-12d3-a456-426614174000/files
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

For document operations that require both headers:

```bash
GET /api/documents/pdf-1234567890
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
  x-silknote-patient-uuid: 456e7890-e89b-12d3-a456-426614174000
```

In this example:
- User `123e4567-e89b-12d3-a456-426614174000` is requesting
- Files for patient `456e7890-e89b-12d3-a456-426614174000`
- Server verifies the user has access to this patient before returning data

## Base URL

```
http://localhost:3001/api
```

## Authentication Requirements

| Requirement | Description | Format | Example |
|------------|-------------|---------|---------|
| **User ID** | Identifies the requesting user | Header: `x-silknote-user-uuid` | `x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000` |
| **Patient ID (URL)** | Identifies the target patient via URL | URL Parameter | `/api/patients/{silknotePatientUuid}/files` |
| **Patient ID (Header)** | Identifies the target patient via header | Header: `x-silknote-patient-uuid` | `x-silknote-patient-uuid: 456e7890-e89b-12d3-a456-426614174000` |

Note: Patient UUID can be passed either as a URL parameter OR as a header, depending on the endpoint.

### Authentication Types by Endpoint

| Authentication Type | Description | Example Endpoints |
|-------------------|-------------|-------------------|
| **No Auth** | Public endpoints | `/health`, `/api/users` (POST) |
| **User Only** | Requires user ID header | `/api/patients` (GET all) |
| **User + Patient (URL)** | Requires user ID header + patient ID in URL | `/api/patients/{id}/files` |
| **User + Patient (Headers)** | Requires both user ID and patient ID headers | `/api/documents/{id}` |
| **Administrative** | Special endpoints with body parameters | `/api/documents/reprocess` |

---

## API Endpoints

### System Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/health` | No | Health check |

### Patient Management

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| GET | `/api/patients` | User | - | List all patients for authenticated user |
| GET | `/api/patients/{patientId}` | User + Patient | `patientId` (URL) | Get specific patient details |
| POST | `/api/patients` | User | Body: `name`, `dateOfBirth` | Create new patient |
| PUT | `/api/patients/{patientId}` | User + Patient | `patientId` (URL), Body: patient data | Update patient |
| DELETE | `/api/patients/{patientId}` | User + Patient | `patientId` (URL) | Delete patient |

### File Management

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| POST | `/api/patients/{patientId}/upload` | User + Patient | `patientId` (URL), Form: `files[]`, `clientFileId` | Upload files (max 500) |
| GET | `/api/patients/{patientId}/files` | User + Patient | `patientId` (URL) | List all files |
| DELETE | `/api/patients/{patientId}/files/{fileId}` | User + Patient | `patientId` (URL), `fileId` (URL) | Delete specific file |
| POST | `/api/patients/{patientId}/process` | User + Patient | `patientId` (URL), Body: `fileIds[]` | Process documents |

### Document Operations

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| GET | `/api/documents/{documentId}` | User + Patient (Headers) | `documentId` (URL), Headers: `x-silknote-user-uuid`, `x-silknote-patient-uuid` | Download PDF |
| GET | `/api/documents/{documentId}/metadata` | User + Patient (Headers) | `documentId` (URL), Headers: `x-silknote-user-uuid`, `x-silknote-patient-uuid` | Get document metadata |
| GET | `/api/documents/{documentId}/details` | User + Patient (Headers) | `documentId` (URL), Headers: `x-silknote-user-uuid`, `x-silknote-patient-uuid` | Get detailed document info |
| DELETE | `/api/documents/{documentId}` | User + Patient (Headers) | `documentId` (URL), Headers: `x-silknote-user-uuid`, `x-silknote-patient-uuid` | Delete document |
| POST | `/api/documents/reprocess` | No* | Body: `silknoteUserUuid`, `silknotePatientUuid`, `silknoteDocumentUuid` | Force reprocess |

*Administrative endpoint - should be protected by other means in production

### Case Summary

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| GET | `/api/case-summary/retrieve/{patientId}` | User + Patient (URL) | `patientId` (URL) | Retrieve existing summary |
| GET | `/api/case-summary/generate/{patientId}` | User + Patient (URL) | `patientId` (URL) | Generate new summary (async) |
| POST | `/api/case-summary/{patientId}` | User + Patient (URL) | `patientId` (URL), Body: summary data | Save summary |

### Vector Search

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| POST | `/api/vector-search/{patientId}/query` | User + Patient (URL) | `patientId` (URL), Body: `query`, `maxResults` | Basic search |
| POST | `/api/vector-search/{patientId}/query-full` | User + Patient (URL) | `patientId` (URL), Body: `query`, `includeExactQuotes`, `outputFormat` | Full search |

### Document Alerts

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| POST | `/api/alerts/acknowledge` | User | Body: `patientId`, `documentId`, `alertType` | Acknowledge a document alert |

### User Management

| Method | Endpoint | Auth Required | Parameters | Description |
|--------|----------|---------------|------------|-------------|
| GET | `/api/users/{userId}` | User | `userId` (URL) | Get user info |
| POST | `/api/users` | No | Body: `email`, `name` | Create user account |

---

## Request/Response Examples

### Example: Upload Files

**Request:**
```http
POST /api/patients/456e7890-e89b-12d3-a456-426614174000/upload
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
  Content-Type: multipart/form-data

Form Data:
  files[]: (binary)
  clientFileId: pdf-1234567890
```

**Response:**
```json
{
  "success": true,
  "message": "Files uploaded successfully",
  "uploadedFiles": [{
    "clientFileId": "pdf-1234567890",
    "originalName": "medical-report.pdf",
    "status": "uploaded"
  }]
}
```

### Example: Document Download with Both Headers

**Request:**
```http
GET /api/documents/pdf-1234567890
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
  x-silknote-patient-uuid: 456e7890-e89b-12d3-a456-426614174000
```

**Response:** Binary PDF data

### Example: Generate Case Summary

**Request:**
```http
GET /api/case-summary/generate/456e7890-e89b-12d3-a456-426614174000
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

**Response (202 Accepted):**
```json
{
  "patientId": "456e7890-e89b-12d3-a456-426614174000",
  "status": "pending",
  "message": "Case summary generation has started.",
  "timestamp": "2024-01-01T00:00:00Z",
  "jobId": "job-uuid"
}
```

---

## WebSocket Events

| Event | Description | Payload |
|-------|-------------|---------|
| `fileStatus` | File processing updates | `{ fileId, status, progress }` |
| `caseSummaryStatus` | Summary generation progress | `{ patientId, jobId, status, message }` |
| `caseSummaryComplete` | Summary ready | `{ patientId, jobId, status, data }` |
| `caseSummaryError` | Summary generation failed | `{ patientId, jobId, status, error }` |
| `fileDeleted` | File deletion confirmed | `{ patientId, fileId }` |
| `fileUploaded` | File upload confirmed | `{ patientId, fileId }` |

**Room Subscription:**
```javascript
socket.emit('join', `patient-${patientUuid}`);
```

---

## Error Responses

| Status Code | Error Type | Example Response |
|------------|------------|------------------|
| 400 | Bad Request | `{ "error": "Invalid request", "message": "Missing required field" }` |
| 401 | Unauthorized | `{ "error": "Authentication required", "message": "Missing x-silknote-user-uuid header" }` |
| 403 | Forbidden | `{ "error": "Forbidden", "message": "User does not have access to this patient" }` |
| 404 | Not Found | `{ "error": "Not found", "message": "Patient not found" }` |
| 429 | Rate Limited | `{ "error": "Too many requests", "message": "Rate limit exceeded" }` |
| 500 | Server Error | `{ "error": "Internal Server Error", "message": "An unexpected error occurred" }` |

---

## Limits & Constraints

| Constraint | Value | Description |
|-----------|-------|-------------|
| **Rate Limit** | 10 req/sec | Per IP address |
| **Max File Size** | 10 MB | Per file |
| **Max Files/Upload** | 500 | Per request |
| **Supported Formats** | PDF, JPG, PNG, etc. | See full list below |

### Supported File Formats
- **Documents**: PDF
- **Images**: JPG, JPEG, PNG, GIF, BMP, TIFF, TIF

---

## CORS Configuration

The server supports CORS for configured origins. Allowed headers include:
- `Content-Type`
- `Authorization`
- `X-Request-ID`
- `X-Debug-Info`
- `X-Client-Timestamp`
- `x-silknote-user-uuid`
- `x-silknote-patient-uuid`

---

## Notes

1. **Patient ID Format**: All patient IDs must be valid UUIDs
2. **User ID Format**: All user IDs must be valid UUIDs
3. **No Defaults**: Server never uses default or fallback values
4. **HTTPS Required**: Use HTTPS in production environments
5. **Administrative Protection**: Admin endpoints should be protected by IP restrictions or API keys in production
6. **Header Requirements**: Document operations require BOTH user and patient UUIDs in headers for proper database context