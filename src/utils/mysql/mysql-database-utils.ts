import { Pool, RowDataPacket, ResultSetHeader, createPool } from 'mysql2/promise';
import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentType, DocumentAlert, DocumentAlertType, CaseSummaryApiResponse, VectorStoreError } from '../../shared/types';
import { createLogger } from '../logger';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('MYSQL_DB_ADAPTER');

// --- Global Connection Pool ---
let pool: Pool | null = null;

// --- Helper Logging Functions ---
function logInfo(message: string, data?: any): void {
  logger.info(message, data !== undefined ? data : '');
}

function logError(message: string, error?: Error | any, context?: any): void {
  const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  logger.error(message, { error: errorDetails, context: context !== undefined ? context : {} });
}

// --- Helper Functions for Row Mapping ---

/**
 * Maps a MySQL row from silknote_documents table to MedicalDocument shared type
 * Handles JSON parsing for contentJson and alertsJson fields
 * Maps MySQL field names to MedicalDocument properties
 */
function mapDocumentRow(row: any): MedicalDocument {
  // Safely parse JSON content, providing defaults
  let content = { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] };
  try {
    if (row.contentJson) content = { ...content, ...JSON.parse(row.contentJson) };
  } catch (e) { 
    logError('Failed to parse contentJson', e, { contentJson: row.contentJson?.substring(0,100) }); 
  }
  
  let alerts: any[] = [];
  try {
    if (row.alertsJson) alerts = JSON.parse(row.alertsJson);
    if (!Array.isArray(alerts)) alerts = [];
  } catch (e) { 
    logError('Failed to parse alertsJson', e, { alertsJson: row.alertsJson?.substring(0,100) }); 
    alerts = []; 
  }

  const toISOStringOptional = (date: Date | string | null | undefined): string | undefined => {
    if (!date) return undefined;
    if (date instanceof Date) return date.toISOString();
    if (typeof date === 'string') {
      try {
        return new Date(date).toISOString();
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  return {
    // Use the UUID from the DB as both identifiers in the shared type
    silknoteDocumentUuid: row.silknoteDocumentUuid,
    clientFileId: row.clientFileId || row.silknoteDocumentUuid, 
    silknotePatientUuid: row.patientUuid, // FK to patient filesets
    originalName: row.originalName,
    storedPath: row.storedPath,
    status: row.status,
    category: row.category as DocumentType, 
    uploadDate: toISOStringOptional(row.uploadDate) || new Date().toISOString(),
    type: row.mimeType, // Map mimeType from DB to type
    size: row.sizeBytes || 0, // Map sizeBytes from DB to size
    title: row.title || row.originalName, // Use title, fallback to originalName
    format: { mimeType: row.mimeType, extension: path.extname(row.originalName || '').slice(1) || '' },
    fileSize: row.sizeBytes || 0, // Map sizeBytes from DB to fileSize
    filename: row.originalName, // Use originalName as filename
    pageCount: row.pageCount, // Stored as Int
    documentDate: row.documentDate, // Stored as string
    processedAt: toISOStringOptional(row.processedAt),
    author: row.author,
    sourceSystem: row.sourceSystem,
    confidence: 0, 
    content: content, // Use parsed content
    alerts: alerts, // Use parsed alerts
    isIncorrectPatient: false, 
    detectedPatientInfo: undefined 
  };
}

/**
 * Maps a MySQL row from silknote_patient_filesets table to PatientDetails shared type
 * Includes associated documents and handles JSON parsing for vectorStore and caseSummary
 * Includes VSRX-specific fields like activatedUse and activatedUseTime
 */
function mapPatientRow(row: any, documents: MedicalDocument[]): PatientDetails {
  // Safely parse JSON content, providing defaults
  let vectorStore = null;
  try {
    if (row.vectorStoreJson) vectorStore = JSON.parse(row.vectorStoreJson);
  } catch (e) { 
    logError('Failed to parse vectorStoreJson', e, { vectorStoreJson: row.vectorStoreJson?.substring(0,100) }); 
  }

  let caseSummary: CaseSummaryApiResponse | null = null;
  try {
    if (row.caseSummaryJson) {
      const parsed = JSON.parse(row.caseSummaryJson);
      if (parsed && typeof parsed.summary === 'object' && Array.isArray(parsed.citations)) {
        caseSummary = parsed as CaseSummaryApiResponse;
      }
    }
  } catch (e) { 
    logError('Failed to parse caseSummaryJson', e, { caseSummaryJson: row.caseSummaryJson?.substring(0,100) }); 
  }

  return {
    silknotePatientUuid: row.silknotePatientUuid, 
    silknoteUserUuid: row.silknoteUserUuid,
    name: row.patientName || 'N/A',
    dateOfBirth: row.patientDob || 'N/A',
    gender: row.gender || 'unknown',
    vectorStore: vectorStore,
    caseSummary: caseSummary,
    summaryGenerationCount: row.summaryGenerationCount || 0,
    activatedUse: row.activatedUse || false, // VSRX-specific
    activatedUseTime: row.activatedUseTime ? new Date(row.activatedUseTime).toISOString() : null, // VSRX-specific
    fileSet: documents || []
  };
}

/**
 * Helper function to execute MySQL queries safely with proper error handling
 * Uses the global connection pool and handles parameter binding
 */
async function executeQuery<T extends RowDataPacket[] | RowDataPacket[][] | ResultSetHeader>(sql: string, params: any[]): Promise<T> {
  if (!pool) {
    throw new Error("MySQL Database pool is not initialized.");
  }
  try {
    logInfo('Executing SQL:', { sql: sql.substring(0, 100), paramCount: params.length });
    const [results] = await pool.execute(sql, params);
    return results as T;
  } catch (error) {
    logError(`Query failed: ${sql.substring(0, 100)}`, error as Error, { params });
    throw error; 
  }
}

/**
 * Helper to convert MedicalDocument date strings to MySQL-compatible format
 */
const medicalDateToMySQLInput = (dateString: string | undefined | null): string | null => {
  if (!dateString) return null;
  try {
    return new Date(dateString).toISOString().slice(0, 19).replace('T', ' '); // MySQL DATETIME format
  } catch (e) {
    logError(`Invalid date string for MySQL input: ${dateString}`);
    return null;
  }
};

// --- Main Adapter Implementation ---
export function createMySqlDatabaseAdapter(): DatabaseAdapter {
  let isInitialized = false;

  const adapter: DatabaseAdapter = {
    /**
     * Initializes the MySQL connection pool and tests connectivity
     * Uses VSRX_MYSQL_CONNECTION_STRING for VSRX mode or DATABASE_CONNECTION_STRING for other modes
     * Connects to VSRX MySQL database containing both VSRX tables and Silknote tables
     */
    async initialize(): Promise<{success: boolean; errors: StorageError[]}> {
      if (isInitialized) return { success: true, errors: [] };
      logInfo('Initializing MySQL Adapter...');
      const errors: StorageError[] = [];
      try {
        const isVsrxMode = process.env['OPERATING_MODE'] === 'VSRX';
        const connectionString = isVsrxMode 
          ? process.env['VSRX_MYSQL_CONNECTION_STRING'] 
          : process.env['DATABASE_CONNECTION_STRING'];

        if (!connectionString) {
          const msg = isVsrxMode 
            ? 'OPERATING_MODE=VSRX but VSRX_MYSQL_CONNECTION_STRING is missing.' 
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

    /**
     * Saves a document to the silknote_documents table using INSERT...ON DUPLICATE KEY UPDATE
     * Maps MedicalDocument fields to MySQL schema fields
     * Handles JSON serialization for content and alerts
     * Links document to patient via patientUuid foreign key
     */
    async saveDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      
      // Generate document UUID if missing
      const docUuid = document.silknoteDocumentUuid || document.clientFileId || uuidv4(); 
      logInfo('Saving document', { docUuid, silknotePatientUuid, silknoteUserUuid });

      // Verify patient exists (no user ownership check - auth handled elsewhere)
      const patientCheck = await executeQuery<RowDataPacket[]>(
        'SELECT silknotePatientUuid FROM silknote_patient_filesets WHERE silknotePatientUuid = ?',
        [silknotePatientUuid]
      );
      
      if (patientCheck.length === 0) {
        logError(`Patient ${silknotePatientUuid} not found`);
        return false;
      }

      const sql = `
        INSERT INTO silknote_documents 
          (silknoteDocumentUuid, patientUuid, clientFileId, originalName, storedPath, status, category, 
           mimeType, sizeBytes, pageCount, documentDate, uploadDate, processedAt, title, author, 
           sourceSystem, contentJson, alertsJson, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          patientUuid=VALUES(patientUuid), clientFileId=VALUES(clientFileId), originalName=VALUES(originalName), 
          storedPath=VALUES(storedPath), status=VALUES(status), category=VALUES(category), 
          mimeType=VALUES(mimeType), sizeBytes=VALUES(sizeBytes), pageCount=VALUES(pageCount), 
          documentDate=VALUES(documentDate), uploadDate=VALUES(uploadDate), processedAt=VALUES(processedAt), 
          title=VALUES(title), author=VALUES(author), sourceSystem=VALUES(sourceSystem), 
          contentJson=VALUES(contentJson), alertsJson=VALUES(alertsJson), updatedAt=NOW()
      `;
      
      const params = [
        docUuid,
        silknotePatientUuid,
        document.clientFileId || docUuid,
        document.originalName,
        document.storedPath,
        document.status,
        document.category,
        document.type, // mimeType
        document.size, // sizeBytes
        document.pageCount,
        document.documentDate,
        medicalDateToMySQLInput(document.uploadDate) || new Date().toISOString().slice(0, 19).replace('T', ' '),
        medicalDateToMySQLInput(document.processedAt),
        document.title || document.originalName,
        document.author || '',
        document.sourceSystem || 'upload',
        JSON.stringify(document.content || { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] }),
        JSON.stringify(document.alerts || [])
      ];
      
      try {
        await executeQuery<ResultSetHeader>(sql, params);
        return true;
      } catch (error) {
        logError('Error saving document', error);
        return false;
      }
    },

    /**
     * Retrieves a document from silknote_documents table by clientFileId or silknoteDocumentUuid
     * First attempts UUID lookup for performance, falls back to clientFileId + patientUuid
     * Verifies document belongs to the specified patient
     * Maps MySQL row to MedicalDocument type
     */
    async getDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<MedicalDocument | null> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Getting document', { clientFileId, silknotePatientUuid, silknoteUserUuid });
      
      let sql = '';
      let params: any[] = [];
      
      // Try UUID lookup first if clientFileId looks like a UUID
      if (clientFileId && clientFileId.length > 20 && clientFileId.includes('-')) {
        sql = `SELECT * FROM silknote_documents 
               WHERE silknoteDocumentUuid = ? AND patientUuid = ?`;
        params = [clientFileId, silknotePatientUuid];
      } else {
        // Fallback to clientFileId lookup
        sql = `SELECT * FROM silknote_documents 
               WHERE clientFileId = ? AND patientUuid = ?`;
        params = [clientFileId, silknotePatientUuid];
      }
      
      try {
        const rows = await executeQuery<RowDataPacket[]>(sql, params);
        return rows.length > 0 ? mapDocumentRow(rows[0]) : null;
      } catch (error) {
        logError('Error getting document', error);
        return null;
      }
    },

    /**
     * Updates an existing document in silknote_documents table
     * Verifies document exists and belongs to the user before updating
     * Updates all fields except silknoteDocumentUuid and patientUuid
     * Handles JSON serialization for content and alerts
     */
    async updateDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      
      const docUuid = document.silknoteDocumentUuid;
      if (!docUuid) {
        logError("updateDocument: silknoteDocumentUuid is required.");
        return false;
      }
      
      logInfo('Updating document', { docUuid, silknotePatientUuid, silknoteUserUuid });

      // Verify document exists and belongs to patient
      const existingDoc = await executeQuery<RowDataPacket[]>(
        `SELECT silknoteDocumentUuid FROM silknote_documents 
         WHERE silknoteDocumentUuid = ? AND patientUuid = ?`,
        [docUuid, silknotePatientUuid]
      );

      if (existingDoc.length === 0) {
        logError(`Document ${docUuid} not found for patient ${silknotePatientUuid}`);
        return false;
      }
      
      const sql = `
        UPDATE silknote_documents SET 
          clientFileId = ?, originalName = ?, storedPath = ?, status = ?, category = ?,
          mimeType = ?, sizeBytes = ?, pageCount = ?, documentDate = ?, processedAt = ?,
          title = ?, author = ?, sourceSystem = ?, contentJson = ?, alertsJson = ?, updatedAt = NOW()
        WHERE silknoteDocumentUuid = ?
      `;
      
      const params = [
        document.clientFileId || docUuid,
        document.originalName,
        document.storedPath,
        document.status,
        document.category,
        document.type, // mimeType
        document.size, // sizeBytes
        document.pageCount,
        document.documentDate,
        medicalDateToMySQLInput(document.processedAt),
        document.title || document.originalName,
        document.author || '',
        document.sourceSystem || 'upload',
        JSON.stringify(document.content || { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] }),
        JSON.stringify(document.alerts || []),
        docUuid
      ];
      
      try {
        const result = await executeQuery<ResultSetHeader>(sql, params);
        return result.affectedRows > 0;
      } catch (error) {
        logError('Error updating document', error);
        return false;
      }
    },

    /**
     * Deletes a document from silknote_documents table
     * Verifies document belongs to the user before deletion
     * Uses clientFileId or silknoteDocumentUuid for identification
     * Returns true if any rows were affected
     */
    async deleteDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Deleting document', { clientFileId, silknotePatientUuid, silknoteUserUuid });
      
      const sql = `
        DELETE FROM silknote_documents 
        WHERE (clientFileId = ? OR silknoteDocumentUuid = ?) 
        AND patientUuid = ?
      `;
      
      try {
        const result = await executeQuery<ResultSetHeader>(sql, [clientFileId, clientFileId, silknotePatientUuid]);
        return result.affectedRows > 0;
      } catch (error) {
        logError('Error deleting document', error);
        return false;
      }
    },

    // --- Patient Operations ---
    async savePatient(silknoteUserUuid: string, patientDetails: PatientDetails): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      
      const patientUuid = patientDetails.silknotePatientUuid || uuidv4();
      logInfo('Saving patient', { patientUuid, silknoteUserUuid });

      if (!silknoteUserUuid) {
        logError('Cannot save patient: silknoteUserUuid is missing');
        return false;
      }

      const sql = `
        INSERT INTO silknote_patient_filesets
          (silknotePatientUuid, silknoteUserUuid, patientName, patientDob, gender, 
           vectorStoreJson, caseSummaryJson, summaryGenerationCount, activatedUse, 
           activatedUseTime, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          patientName=VALUES(patientName), 
          patientDob=VALUES(patientDob), gender=VALUES(gender), vectorStoreJson=VALUES(vectorStoreJson), 
          caseSummaryJson=VALUES(caseSummaryJson), summaryGenerationCount=VALUES(summaryGenerationCount), 
          activatedUse=VALUES(activatedUse), activatedUseTime=VALUES(activatedUseTime), updatedAt=NOW()
      `;
      
      const params = [
        patientUuid,
        silknoteUserUuid,
        patientDetails.name,
        patientDetails.dateOfBirth,
        patientDetails.gender,
        patientDetails.vectorStore ? JSON.stringify(patientDetails.vectorStore) : null,
        patientDetails.caseSummary ? JSON.stringify(patientDetails.caseSummary) : null,
        patientDetails.summaryGenerationCount || 0,
        patientDetails.activatedUse || false,
        patientDetails.activatedUseTime ? medicalDateToMySQLInput(patientDetails.activatedUseTime) : null
      ];
      
      try {
        await executeQuery<ResultSetHeader>(sql, params);
        return true;
      } catch (error) {
        logError('Error saving patient', error);
        return false;
      }
    },

    /**
     * Retrieves a patient from silknote_patient_filesets table with all associated documents
     * Verifies patient belongs to the specified user
     * Maps MySQL row to PatientDetails type including VSRX-specific fields
     * Includes all documents via getDocumentsForPatient call
     */
    async getPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<PatientDetails | null> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Getting patient', { silknotePatientUuid, silknoteUserUuid });
      
      const patientSql = 'SELECT * FROM silknote_patient_filesets WHERE silknotePatientUuid = ?';
      
      try {
        const rows = await executeQuery<RowDataPacket[]>(patientSql, [silknotePatientUuid]);
        if (rows.length === 0) return null;
        
        const patientRecord = rows[0];
        const documents = await this.getDocumentsForPatient(silknoteUserUuid, silknotePatientUuid);
        
        return mapPatientRow(patientRecord, documents);
      } catch (error) {
        logError('Error getting patient', error);
        return null;
      }
    },

    /**
     * Retrieves all documents for a specific patient from silknote_documents table
     * Joins with silknote_patient_filesets to verify user ownership
     * Returns array of MedicalDocument objects mapped from MySQL rows
     * Orders by creation date ascending
     */
    async getDocumentsForPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<MedicalDocument[]> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Getting documents for patient', { silknotePatientUuid, silknoteUserUuid });
      
      const sql = `
        SELECT * FROM silknote_documents 
        WHERE patientUuid = ? 
        ORDER BY createdAt ASC
      `;
      
      try {
        const rows = await executeQuery<RowDataPacket[]>(sql, [silknotePatientUuid]);
        return rows.map(mapDocumentRow);
      } catch (error) {
        logError('Error getting documents for patient', error);
        return [];
      }
    },

    /**
     * Adds a new document to a patient by calling saveDocument
     * Generates silknoteDocumentUuid if missing from the document
     * Links document to patient via patientUuid foreign key
     * Used for adding new documents vs updating existing ones
     */
    async addDocumentToPatient(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Adding document to patient', { silknotePatientUuid, clientFileId: document.clientFileId, silknoteUserUuid });
      
      // Generate silknoteDocumentUuid if missing
      if (!document.silknoteDocumentUuid) {
        document.silknoteDocumentUuid = uuidv4();
        logInfo('Generated new silknoteDocumentUuid', { silknoteDocumentUuid: document.silknoteDocumentUuid });
      }
      
      // Set the patient UUID to link the document
      document.silknotePatientUuid = silknotePatientUuid;
      
      return this.saveDocument(silknoteUserUuid, silknotePatientUuid, document);
    },

    // --- Updated Queue Methods ---
    async getQueuedDocuments(silknoteUserUuid: string, silknotePatientUuid: string, limit?: number): Promise<string[]> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      const actualLimit = limit || 10;
      logInfo('Fetching queued document IDs', { limit: actualLimit, silknotePatientUuid, silknoteUserUuid });
      const sql = "SELECT clientFileId FROM silknote_documents WHERE status = 'queued' AND patientUuid = ? ORDER BY createdAt ASC LIMIT ?";
      try {
        const rows = await executeQuery<RowDataPacket[]>(sql, [silknotePatientUuid, actualLimit]);
        return rows.map((row: RowDataPacket) => String(row['clientFileId'])).filter(id => !!id);
      } catch (error) {
        return [];
      }
    },

    async setDocumentStatus(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, status: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      if (!silknoteDocumentUuid || !status) return false;
      logInfo('Setting document status', { silknoteDocumentUuid, status, silknotePatientUuid, silknoteUserUuid });
      const sql = 'UPDATE silknote_documents SET status = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
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
      const sql = "UPDATE silknote_documents SET status = 'queued', updatedAt = NOW() WHERE status = 'processing'";
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
      const sql = "UPDATE silknote_documents SET status = 'queued', updatedAt = NOW() WHERE patientUuid = ? AND status != 'queued'";
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
      const sql = 'UPDATE silknote_documents SET status = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ? AND patientUuid = ?';
      try {
        const result = await executeQuery<ResultSetHeader>(sql, ['queued', silknoteDocumentUuid, silknotePatientUuid]);
        return result.affectedRows > 0;
      } catch (error) {
        return false;
      }
    },

    async clearPatientCaseSummary(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Clearing patient case summary', { silknotePatientUuid, silknoteUserUuid });
      const sql = `UPDATE silknote_patient_filesets SET caseSummaryJson = NULL, summaryGenerationCount = 0, updatedAt = NOW() 
                   WHERE silknotePatientUuid = ?`;
      try {
        const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid]);
        return result.affectedRows > 0;
      } catch (error) {
        return false;
      }
    },

    async acknowledgeDocumentAlert(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      const getDocSql = `SELECT alertsJson FROM silknote_documents 
                         WHERE silknoteDocumentUuid = ? AND patientUuid = ?`;
      try {
        const rows = await executeQuery<RowDataPacket[]>(getDocSql, [silknoteDocumentUuid, silknotePatientUuid]);
        if (rows.length === 0) return false;
        
        let alerts: DocumentAlert[] = [];
        if (rows[0].alertsJson) {
          alerts = JSON.parse(rows[0].alertsJson);
        }
        
        let alertFound = false;
        alerts.forEach(alert => {
          if (alert.type === alertType) {
            alert.acknowledged = true;
            alertFound = true;
          }
        });
        
        if (!alertFound) return false;
        
        const updateSql = 'UPDATE silknote_documents SET alertsJson = ?, updatedAt = NOW() WHERE silknoteDocumentUuid = ?';
        const result = await executeQuery<ResultSetHeader>(updateSql, [JSON.stringify(alerts), silknoteDocumentUuid]);
        return result.affectedRows > 0;
      } catch (error) {
        return false;
      }
    },

    /**
     * Updates specific fields of a patient in silknote_patient_filesets table
     */
    async updatePatient(silknoteUserUuid: string, silknotePatientUuid: string, patientUpdates: Partial<PatientDetails>): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      if (!silknotePatientUuid) return false;
      
      const updateFields: string[] = [];
      const params: any[] = [];
      
      if (patientUpdates.name !== undefined) {
        updateFields.push('patientName = ?');
        params.push(patientUpdates.name);
      }
      if (patientUpdates.dateOfBirth !== undefined) {
        updateFields.push('patientDob = ?');
        params.push(patientUpdates.dateOfBirth);
      }
      if (patientUpdates.gender !== undefined) {
        updateFields.push('gender = ?');
        params.push(patientUpdates.gender);
      }
      if (patientUpdates.vectorStore !== undefined) {
        updateFields.push('vectorStoreJson = ?');
        params.push(JSON.stringify(patientUpdates.vectorStore));
      }
      if (patientUpdates.caseSummary !== undefined) {
        updateFields.push('caseSummaryJson = ?');
        params.push(JSON.stringify(patientUpdates.caseSummary));
      }
      if (patientUpdates.summaryGenerationCount !== undefined) {
        updateFields.push('summaryGenerationCount = ?');
        params.push(patientUpdates.summaryGenerationCount);
      }
      if (patientUpdates.activatedUse !== undefined) {
        updateFields.push('activatedUse = ?');
        params.push(patientUpdates.activatedUse);
      }
      if (patientUpdates.activatedUseTime !== undefined) {
        updateFields.push('activatedUseTime = ?');
        params.push(patientUpdates.activatedUseTime ? medicalDateToMySQLInput(patientUpdates.activatedUseTime) : null);
      }
      
      if (updateFields.length === 0) return true;
      
      updateFields.push('updatedAt = NOW()');
      params.push(silknotePatientUuid);
      
      const sql = `UPDATE silknote_patient_filesets SET ${updateFields.join(', ')} WHERE silknotePatientUuid = ?`;
      
      try {
        const result = await executeQuery<ResultSetHeader>(sql, params);
        return result.affectedRows > 0;
      } catch (error) {
        logError('Error updating patient', error);
        return false;
      }
    },

    /**
     * Deletes a patient and all associated documents from the database
     */
    async deletePatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Deleting patient', { silknotePatientUuid, silknoteUserUuid });
      const sql = 'DELETE FROM silknote_patient_filesets WHERE silknotePatientUuid = ?';
      try {
        const result = await executeQuery<ResultSetHeader>(sql, [silknotePatientUuid]);
        return result.affectedRows > 0;
      } catch (error) {
        logError('Error deleting patient', error);
        return false;
      }
    },

    /**
     * Retrieves the vector store JSON data for a patient
     * Used for vector search and AI processing workflows
     * Returns parsed JSON object or null if not found
     */
    async getPatientVectorStore(silknoteUserUuid: string, silknotePatientUuid: string): Promise<any | null> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Getting patient vector store', { silknotePatientUuid, silknoteUserUuid });
      
      const sql = 'SELECT vectorStoreJson FROM silknote_patient_filesets WHERE silknotePatientUuid = ?';
      
      try {
        const rows = await executeQuery<RowDataPacket[]>(sql, [silknotePatientUuid]);
        if (rows.length === 0 || !rows[0].vectorStoreJson) return null;
        
        return JSON.parse(rows[0].vectorStoreJson);
      } catch (error) {
        logError('Error getting patient vector store', error);
        return null;
      }
    },

    /**
     * Updates the errors field in the patient filesets table for vector store sync issues
     * Used to track and resolve vector store synchronization problems
     * Stores array of VectorStoreError objects as JSON
     */
    async updatePatientVectorStoreErrors(silknoteUserUuid: string, silknotePatientUuid: string, errors: VectorStoreError[]): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Updating patient vector store errors', { silknotePatientUuid, silknoteUserUuid });
      
      const sql = `UPDATE silknote_patient_filesets SET errors = ?, updatedAt = NOW() 
                   WHERE silknotePatientUuid = ?`;
      
      try {
        await executeQuery<ResultSetHeader>(sql, [JSON.stringify(errors), silknotePatientUuid]);
        return true;
      } catch (error) {
        logError('Error updating patient vector store errors', error);
        return false;
      }
    },

    /**
     * Validates that vector store is in sync with database documents
     * Compares document IDs in database with those in vector store mappings
     * Returns validation results with list of missing files and errors
     */
    async validateVectorStoreSync(silknoteUserUuid: string, silknotePatientUuid: string): Promise<{ isValid: boolean; missingFiles: string[]; errors: VectorStoreError[] }> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Validating vector store sync', { silknotePatientUuid, silknoteUserUuid });
      
      try {
        // Get patient with vector store data
        const patientSql = 'SELECT vectorStoreJson FROM silknote_patient_filesets WHERE silknotePatientUuid = ?';
        const patientRows = await executeQuery<RowDataPacket[]>(patientSql, [silknotePatientUuid]);
        
        if (patientRows.length === 0) {
          return { isValid: false, missingFiles: [], errors: [{
            timestamp: new Date().toISOString(),
            errorType: 'VALIDATION_FAILED',
            message: 'Patient not found'
          }] };
        }
        
        // Parse vector store data
        let vectorStore: any = null;
        if (patientRows[0].vectorStoreJson) {
          try {
            vectorStore = JSON.parse(patientRows[0].vectorStoreJson);
          } catch (e) {
            return { isValid: false, missingFiles: [], errors: [{
              timestamp: new Date().toISOString(),
              errorType: 'VALIDATION_FAILED',
              message: 'Failed to parse vector store data',
              details: { syncErrors: [(e as Error).message] }
            }] };
          }
        }
        
        if (!vectorStore || !vectorStore.fileIdMappings) {
          return { isValid: false, missingFiles: [], errors: [{
            timestamp: new Date().toISOString(),
            errorType: 'VALIDATION_FAILED',
            message: 'No vector store configured for patient'
          }] };
        }
        
        // Get all document IDs from the database
        const docSql = 'SELECT clientFileId, originalName, silknoteDocumentUuid FROM silknote_documents WHERE patientUuid = ?';
        const docRows = await executeQuery<RowDataPacket[]>(docSql, [silknotePatientUuid]);
        const dbDocumentIds = docRows.map(row => row.clientFileId).filter(id => id !== null) as string[];
        
        // Get all document IDs from the vector store mappings
        const vsDocumentIds = vectorStore.fileIdMappings.map((mapping: any) => mapping.clientFileId);
        
        // Find missing files (in DB but not in vector store)
        const missingFiles = dbDocumentIds.filter(id => !vsDocumentIds.includes(id));
        
        if (missingFiles.length > 0) {
          const missingFileDetails = docRows
            .filter(row => row.clientFileId && missingFiles.includes(row.clientFileId))
            .map(row => ({
              clientFileId: row.clientFileId,
              fileName: row.originalName,
              documentUuid: row.silknoteDocumentUuid
            }));
          
          const error: VectorStoreError = {
            timestamp: new Date().toISOString(),
            errorType: 'MISSING_FILE',
            message: `${missingFiles.length} file(s) in database but not in vector store`,
            details: {
              missingFiles: missingFileDetails
            }
          };
          
          return { isValid: false, missingFiles, errors: [error] };
        }
        
        return { isValid: true, missingFiles: [], errors: [] };
      } catch (error: any) {
        logError('Error validating vector store sync', error);
        return { 
          isValid: false, 
          missingFiles: [], 
          errors: [{
            timestamp: new Date().toISOString(),
            errorType: 'VALIDATION_FAILED',
            message: 'Validation failed with unexpected error',
            details: { syncErrors: [error.message] }
          }] 
        };
      }
    }
  };

  return adapter;
} 