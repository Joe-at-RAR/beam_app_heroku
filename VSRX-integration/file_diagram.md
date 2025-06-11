# File Relationships Between VSRX and SilknoteDocAnalysis

## Overview

This diagram illustrates how files are tracked and related within the VSRX MySQL database, where both VSRX tables and SilknoteDocAnalysis tables coexist.

> **Note**: For division of responsibilities between VSRX and SilknoteDocAnalysis, see the [Division of Responsibilities](./README.md#division-of-responsibilities) section in the README.

## Entity Relationship Diagram

```mermaid
erDiagram
    %% All tables exist in the same VSRX MySQL Database
    
    %% Original VSRX Tables
    ax_notes_attachments {
        int id PK "Primary Key"
        int assessment_id FK "Links to assessments"
        int user_id FK "Links to User"
        datetime datestamp
        longtext file "Path like 'notes/file.pdf'"
        varchar description
        varchar file_uuid "36 char UUID (new field)"
        boolean deleted "Soft delete flag"
    }
    
    assessments {
        int assessment_id PK
        int candidate_id FK "Links to candidates"
    }
    
    candidates {
        int candidate_id PK
        int user_id FK
        string silknotePatientUuid "New field added for integration"
    }
    
    User {
        int user_id PK
        string silknoteUserUuid "New field added for integration"
    }
    
    %% SilknoteDocAnalysis Tables (added to VSRX MySQL)
    silknote_patient_filesets {
        string silknotePatientUuid PK "UUID"
        string silknoteUserUuid FK
        boolean activatedUse "Sync only if true"
        json errors "Sync error log"
        datetime createdAt
        datetime updatedAt
    }
    
    silknote_documents {
        string silknoteDocumentUuid PK "UUID"
        string patientUuid FK
        string VSRXReference "Stores VSRX file_uuid"
        string originalName
        string storedPath "Azure blob path"
        string status
        string sourceSystem "e.g. VSRX_SYNC"
        datetime uploadDate
        datetime processedAt
    }
    
    %% Relationships within the same database
    ax_notes_attachments ||--o{ assessments : "has"
    assessments ||--|| candidates : "belongs to"
    candidates }o--|| User : "owned by"
    candidates ||--o| silknote_patient_filesets : "linked via silknotePatientUuid"
    User ||--o| silknote_patient_filesets : "linked via silknoteUserUuid"
    silknote_patient_filesets ||--o{ silknote_documents : "contains"
    ax_notes_attachments ||--o| silknote_documents : "file_uuid matches VSRXReference"
```

## Sync Process Flow

```mermaid
flowchart TB
    subgraph VSRXControl["VSRX Controlled Components"]
        subgraph MySQL["VSRX MySQL Database"]
            subgraph VSRX["VSRX Tables"]
                F1[ax_notes_attachments]
            end
            
            subgraph SilknoteDoc["SilknoteDocAnalysis Tables"]
                D1[silknote_documents]
                PF[silknote_patient_filesets]
            end
        end
        
        subgraph FileSystem["VSRX File System"]
            F2[Local Files<br/>/path/to/notes/]
        end
        
        subgraph Sync["Sync Process<br/>(vsrx-sync.ts)"]
            S1{Check VSRXReference}
            S2[New File Detected]
            S3[Deleted File Detected]
        end
    end
    
    subgraph SilknoteServer["SilknoteDocAnalysis Server"]
        subgraph API["REST API Endpoints"]
            P[POST /api/process]
            D[DELETE /api/documents/delete]
        end
        
        subgraph Cloud["Azure Storage<br/>(Hosted by VSRX)"]
            D2[Blob Storage]
            D3[Vector Store]
        end
    end
    
    F1 -->|file path| F2
    F1 -->|file_uuid| S1
    PF -->|silknote_patient_filesets.activatedUse=true| S1
    
    S1 -->|Not in silknote_documents| S2
    S1 -->|Deleted in VSRX| S3
    
    S2 -->|Read file| F2
    S2 -->|POST file| P
    P -->|Store| D2
    P -->|Index| D3
    P -->|Update| D1
    
    S3 -->|DELETE request| D
    D -->|Remove from| D2
    D -->|Remove from| D3
    D -->|Delete| D1
```

## Key Relationships (All within VSRX MySQL Database)

### 1. Patient Linking
- `candidates.silknotePatientUuid` → `silknote_patient_filesets.silknotePatientUuid`
- Only patients with `silknote_patient_filesets.activatedUse = true` are synced

### 2. User Linking
- `User.silknoteUserUuid` → `silknote_patient_filesets.silknoteUserUuid`

### 3. File Reference
- `ax_notes_attachments.file_uuid` → `silknote_documents.VSRXReference`
- This is the primary key for tracking which files have been processed

### 4. File Storage
- **Original Files**: Stored on VSRX filesystem at path specified in `ax_notes_attachments.file`
- **Processed Files**: Uploaded to Azure Blob Storage via SilknoteDocAnalysis API, path stored in `silknote_documents.storedPath`

## Sync Logic

```mermaid
stateDiagram-v2
    [*] --> CheckActivated: Query Patient Filesets
    
    CheckActivated --> GetVSRXFiles: silknote_patient_filesets.activatedUse = true
    CheckActivated --> [*]: silknote_patient_filesets.activatedUse = false
    
    GetVSRXFiles --> CompareFiles: Load VSRX & Silknote files
    
    CompareFiles --> AddFile: File has no VSRXReference
    CompareFiles --> DeleteFile: VSRXReference exists but<br/>VSRX file deleted
    CompareFiles --> Skip: Files match
    
    AddFile --> UpdateReference: Process & Upload
    DeleteFile --> RemoveReferences: Delete from Storage
    
    UpdateReference --> LogResult: Set VSRXReference
    RemoveReferences --> LogResult: Clear from all stores
    Skip --> LogResult: No action needed
    
    LogResult --> [*]: Update errors JSON
```

## Webcomponent Integration

```mermaid
flowchart LR
    subgraph VSRX["VSRX jQuery Page"]
        JP[jQuery Page Code]
        WC[SilknoteDocAnalysis<br/>Webcomponent]
        
        JP -->|Props| WC
        
        Props["Props Passed:<br/>silknotePatientUuid<br/>silknoteUserUuid<br/>activationCost: 25<br/>companyName: 'VitalSignRx'"]
        
        Props --> WC
    end
    
    subgraph Server["SilknoteDocAnalysis Server"]
        WC -->|API Calls| API[REST Endpoints]
        API --> DB[(silknote_* tables)]
        API --> AZ[Azure Storage]
    end
```

## Data Flow Example

### Adding a New File:
1. **VSRX**: User uploads file → creates record in `ax_notes_attachments`
2. **VSRX Sync**: Detects file with `file_uuid` not in any `silknote_documents.VSRXReference`
3. **VSRX Sync**: Reads file from VSRX filesystem
4. **VSRX Sync**: POSTs file to SilknoteDocAnalysis `/api/process` endpoint
5. **SilknoteDocAnalysis**: Stores file in Azure Blob Storage
6. **SilknoteDocAnalysis**: Indexes in Vector Store
7. **SilknoteDocAnalysis**: Creates `silknote_documents` record with `VSRXReference = file_uuid`

### Deleting a File:
1. **VSRX**: Marks `ax_notes_attachments.deleted = true`
2. **VSRX Sync**: Finds `silknote_documents` with matching `VSRXReference`
3. **VSRX Sync**: Sends DELETE request to `/api/documents/delete`
4. **SilknoteDocAnalysis**: Removes from Azure Blob Storage
5. **SilknoteDocAnalysis**: Removes from Vector Store
6. **SilknoteDocAnalysis**: Deletes `silknote_documents` record 