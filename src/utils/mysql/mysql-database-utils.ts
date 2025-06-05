import { Pool, RowDataPacket, ResultSetHeader, createPool } from 'mysql2/promise';
import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentType, DocumentAlertType } from '../../shared/types'; // Assuming DocumentType is available
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
    async saveDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        // Use silknoteDocumentUuid if present, else clientFileId, else generate new
        const docUuid = document.silknoteDocumentUuid || document.clientFileId || uuidv4(); 
        logInfo('Saving document', { docUuid, silknotePatientUuid, silknoteUserUuid });

        const sql = `
            INSERT INTO Document 
              (silknoteDocumentUuid, patientUuid, originalName, storedPath, status, category, mimeType, sizeBytes, pageCount, documentDate, uploadDate, processedAt, title, author, sourceSystem, contentJson, alertsJson, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
              patientUuid=VALUES(patientUuid), originalName=VALUES(originalName), storedPath=VALUES(storedPath), status=VALUES(status), category=VALUES(category), mimeType=VALUES(mimeType), sizeBytes=VALUES(sizeBytes), pageCount=VALUES(pageCount), documentDate=VALUES(documentDate), uploadDate=VALUES(uploadDate), processedAt=VALUES(processedAt), title=VALUES(title), author=VALUES(author), sourceSystem=VALUES(sourceSystem), contentJson=VALUES(contentJson), alertsJson=VALUES(alertsJson), updatedAt=NOW()
        `;
        const params = [
            docUuid,
            silknotePatientUuid,
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

    async getDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<MedicalDocument | null> {
        console.log(`[PERF] MySQL getDocument START - ${new Date().toISOString()} - clientFileId: ${clientFileId}`);
        const startTime = Date.now();
        
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting document', { clientFileId, silknotePatientUuid, silknoteUserUuid });
        const sql = 'SELECT *, silknoteDocumentUuid as clientFileId FROM Document WHERE silknoteDocumentUuid = ? AND patientUuid = ?'; 
        
        console.log(`[PERF] About to execute MySQL query - ${new Date().toISOString()}`);
        const queryStart = Date.now();
        
        try {
            const rows = await executeQuery<RowDataPacket[]>(sql, [clientFileId, silknotePatientUuid]);
            
            const queryDuration = Date.now() - queryStart;
            const totalDuration = Date.now() - startTime;
            const result = rows.length > 0 ? mapDocumentRow(rows[0]) : null;
            
            console.log(`[PERF] MySQL query completed - ${new Date().toISOString()} - Query Duration: ${queryDuration}ms, Total Duration: ${totalDuration}ms, Found: ${result ? 'YES' : 'NO'}`);
            
            return result;
        } catch (error) {
            const errorDuration = Date.now() - startTime;
            console.log(`[PERF] MySQL query FAILED - ${new Date().toISOString()} - Duration: ${errorDuration}ms - Error: ${error}`);
            return null;
        }
    },

    async updateDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
        return this.saveDocument(silknoteUserUuid, silknotePatientUuid, document); // Uses INSERT ... ON DUPLICATE KEY UPDATE
    },

    async deleteDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Deleting document', { clientFileId, silknotePatientUuid, silknoteUserUuid });
        const sql = 'DELETE FROM Document WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
        try {
            const result = await executeQuery<ResultSetHeader>(sql, [clientFileId, silknotePatientUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
    },

    // --- Patient Operations ---
    async savePatient(silknoteUserUuid: string, patientDetails: PatientDetails): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        // Use silknotePatientUuid exclusively
        const patientUuid = patientDetails.silknotePatientUuid || uuidv4(); // Generate if missing
        logInfo('Saving patient', { patientUuid, silknoteUserUuid });

        if (!silknoteUserUuid) {
            logError('Cannot save patient: silknoteUserUuid is missing');
            return false;
        }
        // Ensure patient object has the ID we are saving
        patientDetails.silknotePatientUuid = patientUuid;

        const sql = `
            INSERT INTO PATIENT
              (silknotePatientUuid, userUuid, patientName, patientDob, gender, vectorStoreJson, caseSummaryJson, summaryGenerationCount, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
              userUuid=VALUES(userUuid), patientName=VALUES(patientName), patientDob=VALUES(patientDob), gender=VALUES(gender), vectorStoreJson=VALUES(vectorStoreJson), caseSummaryJson=VALUES(caseSummaryJson), summaryGenerationCount=VALUES(summaryGenerationCount), updatedAt=NOW()
        `;
        const params = [
            patientUuid,
            silknoteUserUuid,
            patientDetails.name,
            patientDetails.dateOfBirth,
            patientDetails.gender,
            // Stringify vectorStore and caseSummary before saving
            patientDetails.vectorStore ? JSON.stringify(patientDetails.vectorStore) : null, 
            patientDetails.caseSummary ? JSON.stringify(patientDetails.caseSummary) : null, 
            patientDetails.summaryGenerationCount || 0
        ];
        try {
            await executeQuery<ResultSetHeader>(sql, params);
            return true;
        } catch (error) {
            return false;
        }
    },

    async getPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<PatientDetails | null> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting patient', { silknotePatientUuid, silknoteUserUuid });
        const patientSql = 'SELECT * FROM PATIENT WHERE silknotePatientUuid = ? AND userUuid = ?'; 
        try {
            const rows = await executeQuery<RowDataPacket[]>(patientSql, [silknotePatientUuid, silknoteUserUuid]);
            if (rows.length === 0) return null;
            
            const patientRecord = rows[0];
            const documents = await this.getDocumentsForPatient(silknoteUserUuid, silknotePatientUuid);
            
            return mapPatientRow(patientRecord, documents);
        } catch (error) {
            return null;
        }
    },

     async getAllPatients(silknoteUserUuid: string): Promise<PatientDetails[]> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting all patients', { silknoteUserUuid });
        const sql = 'SELECT silknotePatientUuid FROM PATIENT WHERE userUuid = ?';
        try {
            const rows = await executeQuery<RowDataPacket[]>(sql, [silknoteUserUuid]);
            // Use bracket notation for row access
            const patientPromises = rows.map(row => this.getPatient(silknoteUserUuid, row['silknotePatientUuid'])); 
            const patients = await Promise.all(patientPromises);
            return patients.filter((p: PatientDetails | null): p is PatientDetails => p !== null);
        } catch (error) {
            return [];
        }
     },

     async updatePatient(silknoteUserUuid: string, silknotePatientUuid: string, patientUpdates: Partial<PatientDetails>): Promise<boolean> {
        // Fetch the existing patient to merge, as savePatient performs INSERT/UPDATE
        if (!silknotePatientUuid) {
             logError('Cannot update patient: silknotePatientUuid is missing');
             return false;
        }
        const existingPatient = await this.getPatient(silknoteUserUuid, silknotePatientUuid);
        if (!existingPatient) {
            logError(`Cannot update patient: patient ${silknotePatientUuid} not found`);
            return false;
        }
        
        // Merge updates onto existing patient data
        const patientToSave: PatientDetails = {
            ...existingPatient,
            ...patientUpdates,
            // Ensure fileSet remains an array if updated
            fileSet: patientUpdates.fileSet ? patientUpdates.fileSet : existingPatient.fileSet || []
        };

        // Now call savePatient which handles the upsert logic
        return this.savePatient(silknoteUserUuid, patientToSave); 
     },

     async deletePatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Deleting patient', { silknotePatientUuid, silknoteUserUuid });
         // Assumes ON DELETE CASCADE is set for Document table in MySQL
        const sql = 'DELETE FROM PATIENT WHERE silknotePatientUuid = ? AND userUuid = ?';
        try {
            const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid, silknoteUserUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
     },

     // --- Relationship Operations ---
     async addDocumentToPatient(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
         if (!isInitialized) throw new Error('Adapter not initialized');
        // Ensure the link is set via silknotePatientUuid field
        document.silknotePatientUuid = silknotePatientUuid; 
        return this.saveDocument(silknoteUserUuid, silknotePatientUuid, document);
     },

     async getDocumentsForPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<MedicalDocument[]> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Getting documents for patient', { silknotePatientUuid, silknoteUserUuid });
        const sql = 'SELECT * FROM Document WHERE patientUuid = ? ORDER BY createdAt ASC';
        try {
            const rows = await executeQuery<RowDataPacket[]>(sql, [silknotePatientUuid]);
            return rows.map(mapDocumentRow);
        } catch (error) {
            return [];
        }
     },
      
     // --- Updated Queue Methods ---
     async getQueuedDocuments(silknoteUserUuid: string, silknotePatientUuid: string, limit?: number): Promise<string[]> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        const actualLimit = limit || 10;
        logInfo('Fetching queued document IDs', { limit: actualLimit, silknotePatientUuid, silknoteUserUuid });
        const sql = "SELECT silknoteDocumentUuid FROM Document WHERE status = 'queued' AND patientUuid = ? ORDER BY createdAt ASC LIMIT ?";
        try {
          const rows = await executeQuery<RowDataPacket[]>(sql, [silknotePatientUuid, actualLimit]);
          return rows.map((row: RowDataPacket) => String(row['silknoteDocumentUuid']));
        } catch (error) {
          return [];
        }
     },

     async setDocumentStatus(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, status: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        if (!silknoteDocumentUuid || !status) return false;
        logInfo('Setting document status', { silknoteDocumentUuid, status, silknotePatientUuid, silknoteUserUuid });
        const sql = 'UPDATE Document SET status = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
        try {
            const result = await executeQuery<ResultSetHeader>(sql, [status, silknoteDocumentUuid, silknotePatientUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
     },

     async resetProcessingDocuments(): Promise<number> {
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
       },

       async forceReprocessPatientDocuments(silknoteUserUuid: string, silknotePatientUuid: string): Promise<number> {
          if (!isInitialized) throw new Error('Adapter not initialized');
          if (!silknotePatientUuid) return 0;
          logInfo('Forcing reprocess for patient documents', { silknotePatientUuid, silknoteUserUuid });
          const sql = "UPDATE Document SET status = 'queued', updatedAt = NOW() WHERE patientUuid = ? AND status != 'queued'";
          try {
             const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid]);
             logInfo(`Queued ${result.affectedRows} documents for reprocessing for patient ${silknotePatientUuid}.`);
             return result.affectedRows;
          } catch (error) {
             return 0;
          }
       },

       async forceReprocessDocument(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string): Promise<boolean> {
          if (!isInitialized) throw new Error('Adapter not initialized');
          // Directly update the document status
          if (!silknoteDocumentUuid) return false;
          logInfo('Setting document status to queued', { silknoteDocumentUuid, silknotePatientUuid, silknoteUserUuid });
          const sql = 'UPDATE Document SET status = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
          try {
              const result = await executeQuery<ResultSetHeader>(sql, ['queued', silknoteDocumentUuid, silknotePatientUuid]);
              return result.affectedRows > 0;
          } catch (error) {
              return false;
          }
       },

     // --- Missing Methods Implementation ---
     async clearPatientCaseSummary(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Clearing patient case summary', { silknotePatientUuid, silknoteUserUuid });
        const sql = 'UPDATE PATIENT SET caseSummaryJson = NULL, summaryGenerationCount = 0 WHERE silknotePatientUuid = ? AND userUuid = ?';
        try {
            const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid, silknoteUserUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
     },

     async acknowledgeDocumentAlert(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean> {
        if (!isInitialized) throw new Error('Adapter not initialized');
        logInfo('Acknowledging document alert', { silknotePatientUuid, silknoteDocumentUuid, alertType, silknoteUserUuid });
        
        // Fetch the document's current alerts
        const getDocSql = 'SELECT alertsJson FROM Document WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
        try {
            const rows = await executeQuery<RowDataPacket[]>(getDocSql, [silknoteDocumentUuid, silknotePatientUuid]);
            if (rows.length === 0) return false;
            
            let alerts: any[] = [];
            try {
                if (rows[0]['alertsJson']) {
                    alerts = JSON.parse(rows[0]['alertsJson']);
                }
            } catch (e) {
                logError('Failed to parse alertsJson during acknowledge', e);
                return false;
            }
            
            // Find and acknowledge the alert
            let alertFound = false;
            alerts.forEach(alert => {
                if (alert.type === alertType) {
                    alert.acknowledged = true;
                    alertFound = true;
                }
            });
            
            if (!alertFound) return false;
            
            // Update the document with modified alerts
            const updateSql = 'UPDATE Document SET alertsJson = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
            const result = await executeQuery<ResultSetHeader>(updateSql, [JSON.stringify(alerts), silknoteDocumentUuid, silknotePatientUuid]);
            return result.affectedRows > 0;
        } catch (error) {
            return false;
        }
     }
  };
  return adapter;
} 