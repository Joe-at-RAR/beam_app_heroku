# Beam Server – Storage & Request Flow

## 1. Runtime paths (all modes)

```mermaid
flowchart TD
    subgraph Client_Side
        Frontend["VSRX jQuery Front-End\n<web-component>"]
    end

    subgraph SilknoteDocumentAnalysis_Server_Hosted_on_Azure
        API["Express / Nest REST API\n /api/process & /api/documents/delete"]
        StorageSvc["StorageService (storage.ts)"]
        subgraph Adapters
            FileAdapter["File Adapter\n(Azure Blob – all modes)"]
            DBAdapter["DB Adapter\n• Local (dev)\n• MySQL (VSRX)\n• Prisma/Postgres (Silknote)"]
        end
    end

    subgraph Automation
        SyncScript["vsrx-sync.ts (cron/CLI)"]
    end

    subgraph Azure_Infra
        Blob["Azure Blob Storage"]
        DB["Database (MySQL | Postgres)"]
    end

    %% --- traffic links ---
    Frontend -- "HTTPS REST /api/*\nOR WebSocket /ws" --> API
    SyncScript -- "HTTPS POST /api/process\nHTTPS DELETE /api/documents/delete" --> API
    API --> StorageSvc
    StorageSvc --> FileAdapter
    StorageSvc --> DBAdapter
    FileAdapter -- Azure SDK --> Blob
    DBAdapter -- SQL / Prisma --> DB
```

Key points:
* **Azure Blob is the *only* file store** for both VSRX and Silknote runtime modes; Local FS writes are disabled in production.
* The **`StorageService`** selects its adapters at start-up based on `OPERATING_MODE` but _always_ returns Blob URLs or streams.

---

## 2. Detailed request: list & fetch patient documents

```mermaid
sequenceDiagram
    autonumber
    participant FE as "jQuery Front-End"
    participant API as "HTTP API"
    participant StorageSvc as "StorageService"
    participant DBAdapter
    participant FileAdapter
    participant DB as "SQL DB"
    participant Blob as "Azure Blob"

    FE->>API: GET /patients/:id/documents
    API->>StorageSvc: getDocumentsForPatient(u, p)
    StorageSvc->>DBAdapter: getDocumentsForPatient(u, p)
    DBAdapter->>DB: SELECT …
    DB-->>DBAdapter: rows
    DBAdapter-->>StorageSvc: MedicalDocument[]
    StorageSvc-->>API: docs (with Blob refs)
    API-->>FE: JSON

    Note over FE,API: When user clicks download
    FE->>API: GET /documents/:docId/download
    API->>StorageSvc: getFileContent(blobRef)
    StorageSvc->>FileAdapter: getFileContent(blobRef)
    FileAdapter->>Blob: HTTPS GET
    Blob-->>FileAdapter: file bytes
    FileAdapter-->>StorageSvc: stream
    StorageSvc-->>API: stream
    API-->>FE: PDF bytes
```

---

## 3. Off-line VSRX → Silknote sync (`vsrx-sync.ts`)

`VSRX-integration/vsrx-sync.ts` runs **inside the VSRX environment** (cron / CLI) and bridges on-prem files into the cloud system:

```mermaid
sequenceDiagram
    autonumber
    participant SyncScript as "vsrx-sync.ts"
    participant VSRXFS as "On-prem VSRX File System"
    participant Convert as "LibreOffice / Mammoth / HTML-PDF"
    participant AnalysisAPI as "SilknoteDocAnalysis /api/process"
    participant AzureBlob as "Azure Blob Storage"
    participant SilknoteDB as "Silknote DB"

    SyncScript->>VSRXFS: fs.readFile(basePath + file)
    alt Needs conversion (.doc/x, .rtf, .msg)
        SyncScript->>Convert: convertToPDF(buffer)
        Convert-->>SyncScript: pdfBuffer
    end
    SyncScript->>AnalysisAPI: POST multipart(formData)
    AnalysisAPI-->>AzureBlob: upload pdfBuffer
    AnalysisAPI-->>SilknoteDB: INSERT document row (status=queued)
    AnalysisAPI-->>SyncScript: {documentUuid}
    SyncScript->>SilknoteDB: UPDATE document.VSRXReference
```

Highlights:
* **Local path validation**: `isPathSafe()` ensures every `fullPath` stays within `VSRX_FILE_BASE_PATH`.
* **Reads only** – There is _no_ write-back to the VSRX filesystem. Once uploaded, the PDF lives in Azure Blob.
* **Conversion pipeline**:
  * `.doc/.docx/.rtf` → LibreOffice or Mammoth → PDF.
  * `.msg` (Outlook email) → HTML template → html-pdf → PDF.
* **Deletion path**: If a file is removed on VSRX the script calls `DELETE /api/documents/delete`, which cascades to DB & Blob.

---

## 4. Security note – UUID brute-force

Patient identifiers are random UUID-v4 (≈ 122-bit). The server has **two separate rate limiters**:

### HTTP Request Rate Limiter
```typescript
// src/index.ts lines 128-130
const rateLimiter = new RateLimiterMemory({
  points: 10,    // Number of requests  
  duration: 1    // Per second
});
```

This limits **HTTP requests to 10 per second per IP address**. For brute-forcing patient UUIDs via API calls:

```
2^122 possible UUIDs / 10 requests·sec⁻¹ ≈ 1.3×10^35 seconds ≈ 4.2×10^27 years
```

### LLM Token Rate Limiter  
The **400,000 tokens/minute** limit in `centralRateLimiter.ts` applies only to **internal LLM API calls** (document analysis, case summaries, etc.), not HTTP endpoints used for UUID enumeration.

**Conclusion**: Even at the HTTP rate limit of 10 req/sec, brute-forcing a patient UUID would take over **4 billion trillion trillion years**—computationally impossible. 