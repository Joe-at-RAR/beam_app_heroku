# Authentication Strategy

## Overview

The Beam Server uses a dual-identification system to ensure proper data isolation and access control:
1. **User Identification**: Via `x-silknote-user-uuid` header
2. **Patient Identification**: Via URL parameters (when applicable)

This ensures that:
- Users can only access their own data
- Operations are performed on the correct patient records
- No fallback or default values are used

## Required Identifiers

### User Identification (Header)
For authenticated endpoints, include:
```
x-silknote-user-uuid: <uuid-format-user-id>
```

Example:
```
x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

### Patient Identification (URL Parameter)
For patient-specific operations, the patient UUID is included in the URL:
```
/api/patients/{silknotePatientUuid}/files
/api/case-summary/generate/{silknotePatientUuid}
/api/vector-search/{silknotePatientUuid}/query
```

Example:
```
GET /api/patients/456e7890-e89b-12d3-a456-426614174000/files
Headers: x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

## Why Both Are Required

1. **User Context**: The `x-silknote-user-uuid` header identifies WHO is making the request
2. **Resource Context**: The patient UUID in the URL identifies WHAT resource is being accessed
3. **Access Control**: The server verifies that the user has access to the specified patient
4. **No Defaults**: The server never assumes or uses default values for either identifier

## Authentication Flow

1. **Request Received**: Server receives API request
2. **Path Check**: Server checks if the endpoint requires authentication
3. **Header Validation**: For protected endpoints, validates `x-silknote-user-uuid` header
4. **UUID Format Check**: Ensures the user ID is in valid UUID format
5. **Patient UUID Validation**: If URL contains patient UUID, validates format
6. **Access Verification**: Confirms user has access to the specified patient
7. **Request Processing**: If all validations pass, processes the request

## Example Requests

### List All Patients (User ID only)
```bash
GET /api/patients
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

### Get Specific Patient Files (Both IDs required)
```bash
GET /api/patients/456e7890-e89b-12d3-a456-426614174000/files
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

### Generate Case Summary (Both IDs required)
```bash
GET /api/case-summary/generate/456e7890-e89b-12d3-a456-426614174000
Headers:
  x-silknote-user-uuid: 123e4567-e89b-12d3-a456-426614174000
```

## Endpoints Requiring Both Identifiers

### Patient-Specific Operations
- `GET /api/patients/:silknotePatientUuid` - Get specific patient
- `PUT /api/patients/:silknotePatientUuid` - Update patient
- `DELETE /api/patients/:silknotePatientUuid` - Delete patient

### File Operations
- `POST /api/patients/:silknotePatientUuid/upload` - Upload files
- `GET /api/patients/:silknotePatientUuid/files` - List files
- `DELETE /api/patients/:silknotePatientUuid/files/:fileId` - Delete file
- `POST /api/patients/:silknotePatientUuid/process` - Process documents

### Case Summary
- `GET /api/case-summary/retrieve/:silknotePatientUuid` - Retrieve summary
- `GET /api/case-summary/generate/:silknotePatientUuid` - Generate summary
- `POST /api/case-summary/:silknotePatientUuid` - Save summary

### Vector Search
- `POST /api/vector-search/:silknotePatientUuid/query` - Search documents
- `POST /api/vector-search/:silknotePatientUuid/query-full` - Full search

### Alerts
- `GET /api/alerts/:silknotePatientUuid` - Get patient alerts
- `POST /api/alerts/:silknotePatientUuid` - Create alert

## Endpoints Requiring Only User ID

- `GET /api/patients` - List all patients for user
- `POST /api/patients` - Create new patient
- `GET /api/users/:silknoteUserUuid` - Get user info

## Public Endpoints (No Authentication Required)

### System
- `GET /health` - Health check

### Administrative
- `POST /api/documents/reprocess` - Force document reprocessing
  - Requires both `silknoteUserUuid` and `silknotePatientUuid` in request body
  - Should be protected by other means in production

### User Registration
- `POST /api/users` - Create new user account

## Error Responses

### Missing User Authentication
```json
{
  "error": "Authentication required",
  "message": "Missing x-silknote-user-uuid header"
}
```
Status: 401 Unauthorized

### Invalid UUID Format
```json
{
  "error": "Invalid authentication",
  "message": "Invalid x-silknote-user-uuid format"
}
```
Status: 401 Unauthorized

### Invalid Patient UUID
```json
{
  "error": "Invalid request",
  "message": "Invalid patient UUID format"
}
```
Status: 400 Bad Request

### Unauthorized Patient Access
```json
{
  "error": "Forbidden",
  "message": "User does not have access to this patient"
}
```
Status: 403 Forbidden

## Security Considerations

1. **Dual Validation**: Both user and patient UUIDs are validated
2. **Access Control**: Server verifies user has access to requested patient
3. **No Fallbacks**: The server never uses default values for either identifier
4. **Explicit Requirements**: Every function requiring context must have it passed explicitly
5. **URL Parameter Security**: Patient UUIDs in URLs are validated against user permissions

## Implementation Details

The authentication system:
1. Validates `x-silknote-user-uuid` header via middleware
2. Extracts patient UUID from URL parameters
3. Verifies user has access to the specified patient
4. Passes both identifiers to service functions
5. Returns appropriate error codes for different failure scenarios

## Best Practices

1. **Always Include User ID**: Include `x-silknote-user-uuid` header for all authenticated requests
2. **Validate Patient Access**: Ensure users can only access their own patients
3. **Handle All Error Types**: Implement handling for 401, 403, and 400 errors
4. **Use HTTPS**: Always use HTTPS in production to protect both headers and URLs
5. **Log Access Attempts**: Monitor unauthorized access attempts

## Future Considerations

For production environments:
1. Implement JWT tokens that encode both user and allowed patient access
2. Add role-based access control (RBAC)
3. Implement patient sharing mechanisms
4. Add audit logging for all dual-identifier operations
5. Consider moving patient ID to headers for consistency 