# VSRX Database Schema

## Complete Database Schema with Silknote Integration

### Table: `staff`
```
staff {
  staff_id - primary identifier  
  silknoteUserUuid - STRING, UNIQUE, UUID format
  // Other staff fields (not specified in conversation)
}
```

### Table: `candidates` (Patient Records)
```
candidates {
  candidate_id - primary identifier (patient identifier)
  staff_id - FK references staff.staff_id
  silknotePatientUuid - STRING, UUID format
  // Other patient information fields (not specified in conversation)
}
```

### Table: `assessments`
```
assessments {
  assessment_id - primary identifier, used as FK to link other tables
  candidate_id - FK references candidates.candidate_id
  // Other assessment fields (not specified in conversation)
}
```

### Table: `ax_notes_attachments`
```
ax_notes_attachments {
  id - INT, PRIMARY KEY, LENGTH 11, NOT NULL
  assessment_id - INT, LENGTH 11
  user_id - INT, LENGTH 11
  datestamp - DATETIME
  file - LONGTEXT (sample value: 'notes/samplefilename.pdf')
  description - VARCHAR, LENGTH 255
  file_uuid - VARCHAR, LENGTH 36 (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
}
```

### Table: `silknote_patient_filesets`
```
silknote_patient_filesets {
  silknotePatientUuid - STRING, PRIMARY KEY, UNIQUE, UUID
  silknoteUserUuid - STRING
  activatedUse - BOOLEAN, DEFAULT false
  activatedUseTime - DATETIME, NULL
  patientName - STRING, NULL
  patientDob - STRING, NULL (format: DD/MM/YYYY)
  gender - STRING, NULL (e.g., "Male", "Female", "Neutral", "Other")
  vectorStoreJson - TEXT, NULL (stringified PatientVectorStore)
  caseSummaryJson - TEXT, NULL (stringified caseSummary)
  summaryGenerationCount - INT, NULL, DEFAULT 0
  createdAt - DATETIME, DEFAULT now()
  updatedAt - DATETIME, auto-update
  errors - JSON, NULL
}
```

### Table: `silknote_documents`
```
silknote_documents {
  silknoteDocumentUuid - STRING, PRIMARY KEY, UNIQUE, UUID
  patientUuid - STRING, FK references silknote_patient_filesets.silknotePatientUuid (CASCADE DELETE)
  originalName - STRING, NOT NULL
  clientFileId - STRING, NULL
  storedPath - STRING, NULL
  status - STRING, NOT NULL
  category - STRING, NOT NULL (encrypted)
  mimeType - STRING, NOT NULL
  sizeBytes - INT, NULL
  pageCount - INT, NULL
  documentDate - STRING, NULL
  uploadDate - DATETIME, DEFAULT now()
  processedAt - DATETIME, NULL
  title - STRING, NULL (encrypted)
  author - STRING, NULL (encrypted)
  sourceSystem - STRING, NULL (e.g., 'VSRX_SYNC', 'USER_UPLOAD')
  contentJson - TEXT, NULL (encrypted)
  alertsJson - TEXT, NULL (encrypted)
  createdAt - DATETIME, DEFAULT now()
  updatedAt - DATETIME, auto-update
  VSRXReference - STRING, NULL (stores VSRX file_uuid for synced documents)
}
```

## Key Relationships

- `staff.silknoteUserUuid` → `silknote_patient_filesets.silknoteUserUuid` (logical relationship, NO FK constraint)
- `staff.staff_id` → `candidates.staff_id` (FK constraint)
- `candidates.candidate_id` → `assessments.candidate_id` (FK constraint)
- `silknote_patient_filesets.silknotePatientUuid` → `silknote_documents.patientUuid` (FK constraint with CASCADE DELETE)
- Files in `ax_notes_attachments` are primarily associated with assessments
- Each assessment is exclusively associated to one patient ID
- If patient is rebooked, new patient ID is generated in backend

## File Storage

- **VSRX Files**: Uploaded directly to `notes/` folder
- **File Path Format**: `notes/samplefilename.pdf`
- **Supported Formats for Sync**: .pdf, .doc, .docx, .rtf, .msg
- **Reference Method**: Files referenced by UUID or filename
- **Note**: Image files (.png, .jpg, .bmp) and Excel files (.xlsx) are not supported 