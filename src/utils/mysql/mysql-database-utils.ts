import { Pool, RowDataPacket, ResultSetHeader, createPool } from 'mysql2/promise';
import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentType, DocumentAlertType } from '@shared/types'; // Assuming DocumentType is available
import { v4 as uuidv4 } from 'uuid'; // Needed for generating UUIDs if not done by DB
import path from 'path'; // Import path

// --- Logging Helpers ---
function logInfo(message: string, data?: any): void {
  console.log(`[MYSQL DB ADAPTER] INFO ${new Date().toISOString()} - ${message}`, data ?? '');
}
function logError(message: string, error?: Error | any, context?: any): void {
  const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  console.error(`[MYSQL DB ADAPTER] ERROR ${new Date().toISOString()} - ${message}`, { error: errorDetails, context: context ?? {} });
}

// --- MySQL Connection Pool ---
let pool: Pool | null = null;

// --- Type Mapping Helpers ---
// Maps DB row from assumed `Document` table to `MedicalDocument` shared type
function mapDocumentRow(row: any): MedicalDocument {
    // Safely parse JSON content, providing defaults
    let content = { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] };
    try {
        if (row.contentJson) content = { ...content, ...JSON.parse(row.contentJson) };
    } catch (e) { logError('Failed to parse contentJson', e, { contentJson: row.contentJson?.substring(0,100) }); }
    
    let alerts: any[] = [];
    try {
        if (row.alertsJson) alerts = JSON.parse(row.alertsJson);
        if (!Array.isArray(alerts)) alerts = [];
    } catch (e) { logError('Failed to parse alertsJson', e, { alertsJson: row.alertsJson?.substring(0,100) }); alerts = []; }

    return {
        // Use the UUID from the DB as both identifiers in the shared type
        silknoteDocumentUuid: row.silknoteDocumentUuid,
        clientFileId: row.silknoteDocumentUuid, 
        
        silknotePatientUuid: row.patientUuid, // This holds the SilknotePatientUuid
        originalName: row.originalName,
        storedPath: row.storedPath,
        status: row.status,
        category: row.category as DocumentType, 
        uploadDate: row.uploadDate instanceof Date ? row.uploadDate.toISOString() : row.uploadDate,
        type: row.mimeType, // Map mimeType from DB to type
        size: row.sizeBytes || 0, // Map sizeBytes from DB to size
        title: row.title || row.originalName, // Use title, fallback to originalName
        format: { mimeType: row.mimeType, extension: path.extname(row.originalName || '').slice(1) || '' }, // Use path.extname safely
        fileSize: row.sizeBytes || 0, // Map sizeBytes from DB to fileSize
        pageCount: row.pageCount, // Stored as Int?
        documentDate: row.documentDate, // Stored as DD/MM/YYYY string?
        processedAt: row.processedAt instanceof Date ? row.processedAt.toISOString() : row.processedAt,
        author: row.author,
        sourceSystem: row.sourceSystem,
        filename: row.originalName, // Use originalName as filename
        confidence: 0, 
        content: content, // Use parsed content
        alerts: alerts, // Use parsed alerts
        isIncorrectPatient: false, 
        detectedPatientInfo: undefined 
    };
}

// Maps DB row from assumed `PATIENT` table + documents to `PatientDetails`
function mapPatientRow(row: any, documents: MedicalDocument[]): PatientDetails {
     // Safely parse JSON content, providing defaults
    let vectorStore = null;
    try {
        if (row.vectorStoreJson) vectorStore = JSON.parse(row.vectorStoreJson);
    } catch (e) { logError('Failed to parse vectorStoreJson', e, { vectorStoreJson: row.vectorStoreJson?.substring(0,100) }); }

    let caseSummary = null;
     try {
        if (row.caseSummaryJson) caseSummary = JSON.parse(row.caseSummaryJson);
    } catch (e) { logError('Failed to parse caseSummaryJson', e, { caseSummaryJson: row.caseSummaryJson?.substring(0,100) }); }

    return {
        silknotePatientUuid: row.silknotePatientUuid, 
        silknoteUserUuid: row.userUuid,
        name: row.patientName || 'N/A',
        dateOfBirth: row.patientDob || 'N/A',
        gender: row.gender || 'unknown',
        vectorStore: vectorStore,
        caseSummary: caseSummary,
        summaryGenerationCount: row.summaryGenerationCount || 0,
        fileSet: documents || []
    };
}


// --- Adapter Implementation ---
export function createMySqlDatabaseAdapter(): DatabaseAdapter {
  let isInitialized = false;

  // Helper function to execute queries safely
  async function executeQuery<T extends RowDataPacket[] | RowDataPacket[][] | ResultSetHeader>(sql: string, params: any[]): Promise<T> {
      if (!pool) {
          throw new Error("MySQL Database pool is not initialized.");
      }
      try {
          // logInfo('Executing SQL:', { sql, params }); // Optional query logging
          const [results] = await pool.execute(sql, params);
          return results as T;
      } catch (error) {
          logError(`Query failed: ${sql}`, error as Error, { params });
          throw error; 
      }
  }

  // --- Standalone Queue/VSRX Methods ---
  async function getQueuedDocuments(limit: number = 10): Promise<string[]> {
    if (!isInitialized) throw new Error('Adapter not initialized');
    logInfo('Fetching queued document IDs', { limit });
    const sql = "SELECT silknoteDocumentUuid FROM Document WHERE status = 'queued' ORDER BY createdAt ASC LIMIT ?";
    try {
      const rows = await executeQuery<RowDataPacket[]>(sql, [limit]);
      return rows.map((row: RowDataPacket) => String(row['silknoteDocumentUuid']));
    } catch (error) {
      return [];
    }
  }

  async function setDocumentStatus(silknoteDocumentUuid: string, status: string): Promise<boolean> {
     if (!isInitialized) throw new Error('Adapter not initialized');
     if (!silknoteDocumentUuid || !status) return false;
     logInfo('Setting document status', { silknoteDocumentUuid, status });
     const sql = 'UPDATE Document SET status = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ?';
     try {
         const result = await executeQuery<ResultSetHeader>(sql, [status, silknoteDocumentUuid]);
         return result.affectedRows > 0;
     } catch (error) {
         return false;
     }
  }

  async function resetProcessingDocuments(): Promise<number> {
       if (!isInitialized) throw new Error('Adapter not initialized');
       logInfo('Resetting processing documents');
       const sql = "UPDATE Document SET status = 'queued', updatedAt = NOW() WHERE status = 'processing'";
       try {
           const result = await executeQuery<ResultSetHeader>(sql, []);
           logInfo(`Reset ${result.affectedRows} documents.`);
           return result.affectedRows;
       } catch (error) {
           return 0;
       }
   }

   async function forceReprocessPatientDocuments(silknotePatientUuid: string): Promise<number> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      if (!silknotePatientUuid) return 0;
      logInfo('Forcing reprocess for patient documents', { silknotePatientUuid });
      const sql = "UPDATE Document SET status = 'queued', updatedAt = NOW() WHERE patientUuid = ? AND status != 'queued'";
      try {
         const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid]);
         logInfo(`Queued ${result.affectedRows} documents for reprocessing for patient ${silknotePatientUuid}.`);
         return result.affectedRows;
      } catch (error) {
         return 0;
      }
   }

   async function forceReprocessDocument(silknoteDocumentUuid: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      return setDocumentStatus(silknoteDocumentUuid, 'queued'); // Now calls the standalone function
   }

  const adapter: DatabaseAdapter = {
    async initialize(): Promise<{success: boolean; errors: StorageError[]}> {
        if (isInitialized) return { success: true, errors: [] };
        logInfo('Initializing MySQL Adapter...');
        const errors: StorageError[] = [];
        try {
            const vsrxMode = process.env['VSRX_MODE'] === 'true';
            const connectionString = vsrxMode 
                ? process.env['VSRX_MYSQL_CONNECTION_STRING'] 
                : process.env['DATABASE_CONNECTION_STRING'];

            if (!connectionString) {
                const msg = vsrxMode 
                    ? 'VSRX_MODE=true but VSRX_MYSQL_CONNECTION_STRING is missing.' 
                    : 'DATABASE_CONNECTION_STRING is missing for MySQL mode.';
                throw new Error(msg);
            }
            
            pool = createPool(connectionString);
            const connection = await pool.getConnection();
            await connection.ping(); // Verify connection
            connection.release();
            logInfo('MySQL connection established successfully');
            isInitialized = true;
            return { success: true, errors };
        } catch (error: any) {
            logError('MySQL Init Error', error);
            errors.push({ code: 'MYSQL_INIT_ERROR', message: error.message });
            pool = null;
            isInitialized = false;
            return { success: false, errors };
        }
    },

    // --- Document Operations --- 
    // Assumes a `Document` table exists with columns matching `mapDocumentRow` expectations
    async saveDocument(document: MedicalDocument): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        // Use silknoteDocumentUuid if present, else clientFileId, else generate new
        const docUuid = document.silknoteDocumentUuid || document.clientFileId || uuidv4(); 
        // PatientId from shared type now holds the silknotePatientUuid
        const patientUuid = document.silknotePatientUuid; 
        logInfo('Saving document', { docUuid, patientUuid });

        const sql = `
            INSERT INTO Document 
              (silknoteDocumentUuid, patientUuid, originalName, storedPath, status, category, mimeType, sizeBytes, pageCount, documentDate, uploadDate, processedAt, title, author, sourceSystem, contentJson, alertsJson, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
              patientUuid=VALUES(patientUuid), originalName=VALUES(originalName), storedPath=VALUES(storedPath), status=VALUES(status), category=VALUES(category), mimeType=VALUES(mimeType), sizeBytes=VALUES(sizeBytes), pageCount=VALUES(pageCount), documentDate=VALUES(documentDate), uploadDate=VALUES(uploadDate), processedAt=VALUES(processedAt), title=VALUES(title), author=VALUES(author), sourceSystem=VALUES(sourceSystem), contentJson=VALUES(contentJson), alertsJson=VALUES(alertsJson), updatedAt=NOW()
        `;
        const params = [
            docUuid,
            patientUuid,
            document.originalName,
            document.storedPath,
            document.status,
            document.category,
            document.type, // Use document.type for mimeType column
            document.size, // Use document.size for sizeBytes column
            document.pageCount, // Store as number or null
            document.documentDate, 
            document.uploadDate ? new Date(document.uploadDate) : new Date(),
            document.processedAt ? new Date(document.processedAt) : null,
            document.title,
            document.author,
            document.sourceSystem,
            // Stringify content and alerts before saving
            document.content ? JSON.stringify(document.content) : null,
            document.alerts && Array.isArray(document.alerts) ? JSON.stringify(document.alerts) : null
        ];
        try {
            await executeQuery<ResultSetHeader>(sql, params);
            return true;
        } catch (error) {
            return false;
        }
    },

    async getDocument(silknoteDocumentUuid: string): Promise<MedicalDocument | null> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting document', { silknoteDocumentUuid });
        const sql = 'SELECT *, silknoteDocumentUuid as clientFileId FROM Document WHERE silknoteDocumentUuid = ?'; // Alias silknoteDocumentUuid
        try {
            const rows = await executeQuery<RowDataPacket[]>(sql, [silknoteDocumentUuid]);
            return rows.length > 0 ? mapDocumentRow(rows[0]) : null;
        } catch (error) {
            return null;
        }
    },

    async updateDocument(document: MedicalDocument): Promise<boolean> {
        return this.saveDocument(document); // Uses INSERT ... ON DUPLICATE KEY UPDATE
    },

    async deleteDocument(silknoteDocumentUuid: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Deleting document', { silknoteDocumentUuid });
        const sql = 'DELETE FROM Document WHERE silknoteDocumentUuid = ?';
        try {
            const result = await executeQuery<ResultSetHeader>(sql, [silknoteDocumentUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
    },

    // --- Patient Operations ---
    // Assumes a `PATIENT` table exists with columns matching `mapPatientRow` expectations
    async savePatient(patient: PatientDetails): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        // Use silknotePatientUuid exclusively
        const patientUuid = patient.silknotePatientUuid || uuidv4(); // Generate if missing
        // Use silknoteUserUuid for userUuid column
        const userUuid = patient.silknoteUserUuid; 
        logInfo('Saving patient', { patientUuid, userUuid });

        if (!userUuid) {
            logError('Cannot save patient: silknoteUserUuid is missing');
            return false;
        }
        // Ensure patient object has the ID we are saving
        patient.silknotePatientUuid = patientUuid;

        const sql = `
            INSERT INTO PATIENT
              (silknotePatientUuid, userUuid, patientName, patientDob, gender, vectorStoreJson, caseSummaryJson, summaryGenerationCount, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
              userUuid=VALUES(userUuid), patientName=VALUES(patientName), patientDob=VALUES(patientDob), gender=VALUES(gender), vectorStoreJson=VALUES(vectorStoreJson), caseSummaryJson=VALUES(caseSummaryJson), summaryGenerationCount=VALUES(summaryGenerationCount), updatedAt=NOW()
        `;
        const params = [
            patientUuid,
            userUuid,
            patient.name,
            patient.dateOfBirth,
            patient.gender,
            // Stringify vectorStore and caseSummary before saving
            patient.vectorStore ? JSON.stringify(patient.vectorStore) : null, 
            patient.caseSummary ? JSON.stringify(patient.caseSummary) : null, 
            patient.summaryGenerationCount || 0
        ];
        try {
            await executeQuery<ResultSetHeader>(sql, params);
            return true;
        } catch (error) {
            return false;
        }
    },

    async getPatient(silknotePatientUuid: string): Promise<PatientDetails | null> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting patient', { silknotePatientUuid });
        const patientSql = 'SELECT * FROM PATIENT WHERE silknotePatientUuid = ?'; // Removed alias
        try {
            const rows = await executeQuery<RowDataPacket[]>(patientSql, [silknotePatientUuid]);
            if (rows.length === 0) return null;
            
            const patientRecord = rows[0];
            const documents = await this.getDocumentsForPatient(silknotePatientUuid);
            
            return mapPatientRow(patientRecord, documents);
        } catch (error) {
            return null;
        }
    },

     async getAllPatients(): Promise<PatientDetails[]> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting all patients');
        const sql = 'SELECT silknotePatientUuid FROM PATIENT';
        try {
            const rows = await executeQuery<RowDataPacket[]>(sql, []);
            // Use bracket notation for row access
            const patientPromises = rows.map(row => this.getPatient(row['silknotePatientUuid'])); 
            const patients = await Promise.all(patientPromises);
            return patients.filter((p): p is PatientDetails => p !== null);
        } catch (error) {
            return [];
        }
     },

     async updatePatient(patientUpdate: Partial<PatientDetails>): Promise<boolean> {
        // Fetch the existing patient to merge, as savePatient performs INSERT/UPDATE
        if (!patientUpdate.silknotePatientUuid) {
             logError('Cannot update patient: silknotePatientUuid is missing');
             return false;
        }
        const existingPatient = await this.getPatient(patientUpdate.silknotePatientUuid);
        if (!existingPatient) {
            logError(`Cannot update patient: patient ${patientUpdate.silknotePatientUuid} not found`);
            return false;
        }
        
        // Merge updates onto existing patient data
        const patientToSave: PatientDetails = {
            ...existingPatient,
            ...patientUpdate,
            // Ensure fileSet remains an array if updated
            fileSet: patientUpdate.fileSet ? patientUpdate.fileSet : existingPatient.fileSet || []
        };

        // Now call savePatient which handles the upsert logic
        return this.savePatient(patientToSave); 
     },

     async deletePatient(silknotePatientUuid: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Deleting patient', { silknotePatientUuid });
         // Assumes ON DELETE CASCADE is set for Document table in MySQL
        const sql = 'DELETE FROM PATIENT WHERE silknotePatientUuid = ?';
        try {
            const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
     },

     // --- Relationship Operations ---
     async addDocumentToPatient(silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
         if (!isInitialized) throw new Error('Adapter not initialized');
        // Ensure patient exists (optional, FK constraint should handle)
        // const patientExists = await this.getPatient(patientUuid); 
        // if (!patientExists) return false;
        
        document.silknotePatientUuid = silknotePatientUuid; // Ensure the link is set via silknotePatientUuid field
        return this.saveDocument(document);
     },

     async getDocumentsForPatient(silknotePatientUuid: string): Promise<MedicalDocument[]> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting documents for patient', { silknotePatientUuid });
        const sql = 'SELECT * FROM Document WHERE patientUuid = ? ORDER BY createdAt ASC';
        try {
            const rows = await executeQuery<RowDataPacket[]>(sql, [silknotePatientUuid]);
            return rows.map(mapDocumentRow);
        } catch (error) {
            return [];
        }
     },
      
     // --- Optional VSRX/Queue Methods ---
     // Referencing standalone functions defined above
     getQueuedDocuments,
     setDocumentStatus,
     resetProcessingDocuments,
     forceReprocessPatientDocuments,
     forceReprocessDocument,

     // --- Missing Methods Implementation (Stubbed) ---
     async clearPatientCaseSummary(silknotePatientUuid: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('clearPatientCaseSummary called, not implemented for MySQL yet', { silknotePatientUuid });
        // TODO: Implement actual logic to clear case summary in MySQL
        // For now, returning a success to match interface, assuming it could be a no-op or future feature
        // Depending on requirements, this might involve setting a JSON field to null or deleting related records.
        // Example: const sql = 'UPDATE PATIENT SET caseSummaryJson = NULL, summaryGenerationCount = 0 WHERE silknotePatientUuid = ?';
        // await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid]);
        return Promise.resolve(false); // Or true if it's considered a success even if no-op
     },

     async acknowledgeDocumentAlert(silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('acknowledgeDocumentAlert called, not implemented for MySQL yet', { silknotePatientUuid, silknoteDocumentUuid, alertType });
        // TODO: Implement actual logic to acknowledge an alert in MySQL
        // This would likely involve fetching the document's alertsJson, modifying it, and saving it back.
        // 1. Fetch alertsJson from Document table for silknoteDocumentUuid
        // 2. Parse JSON, find the alert by type, set its 'acknowledged' flag to true
        // 3. Stringify the modified alerts back to JSON
        // 4. Update the Document table with the new alertsJson
        return Promise.resolve(false); // Or true, depending on desired behavior for non-implemented features
     }
  };
  return adapter;
} 