import fs from 'fs';
import path from 'path';
import config from '../config';
import { MedicalDocument, DocumentType } from '../shared/types';
import { RequestHandler } from 'express';
import { StorageError, FileStorageAdapter, DatabaseAdapter } from './storage-interfaces';
import { createLocalFileAdapter } from './local/local-file-adapter';
import { createLocalDatabaseAdapter } from './local/local-database-adapter';
import { createMySqlDatabaseAdapter } from './mysql/mysql-database-utils';
import { createPrismaAdapter } from './prisma/prisma-database-utils';
import { createAzureBlobFileAdapter } from './azure/azure-blob-file-adapter';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';

const logger = createLogger('STORAGE_SERVICE');

/** Helper Logging Functions **/
function logInfo(message: string, data?: any): void {
  logger.info(message, data !== undefined ? data : '');
}

// function logDebug(message: string, data?: any): void { // Commented out as unused
//   logger.appDebug(message, data);
// }

function logError(message: string, error?: Error | any, context?: any): void {
  const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  logger.error(message, { error: errorDetails, context: context !== undefined ? context : {} });
}

export type StorageType = 'LOCAL' | 'POSTGRES_PRISMA' | 'MYSQL';
export type FileStorageType = 'LOCAL' | 'BLOB';

export type OperatingMode = 'LOCAL' | 'VSRX' | 'SILKNOTE';

// Unified storage service
export class StorageService {
  private tempDir: string;
  private outputDir: string;
  private databaseType: StorageType;
  private fileStorageType: FileStorageType;
  private initialized: boolean = false;
  private allowedBasePaths: string[] = []; // Store allowed paths for VSRX
  private operatingMode: OperatingMode;
  private isVsrx: boolean;

  public fileAdapter: FileStorageAdapter; // Make public for direct access if needed
  public dbAdapter: DatabaseAdapter; // Make public for direct access if needed

  constructor() {
    this.tempDir = config.processing.tempDir;
    this.outputDir = config.processing.outputDir;
    this.databaseType = (process.env['DATABASE_TYPE'] as StorageType) || 'LOCAL';
    this.fileStorageType = (process.env['FILE_STORAGE_TYPE'] as FileStorageType) || 'LOCAL';
    this.operatingMode = (process.env['OPERATING_MODE'] as OperatingMode) || 'LOCAL';
    this.isVsrx = process.env['VSRX_MODE'] === 'true';

    // Load and normalize allowed paths for VSRX
    if (process.env['VSRX_MODE'] === 'true') {
      const pathsEnv = process.env['ALLOWED_FILE_BASE_PATHS'];
      if (!pathsEnv) {
        logError('VSRX_MODE is true, but ALLOWED_FILE_BASE_PATHS environment variable is not set. File access will fail.');
      } else {
        this.allowedBasePaths = pathsEnv.split(';') // Use semicolon as separator
          .map(p => p.trim())
          .filter(p => p.length > 0)
          .map(p => path.resolve(p)); // Resolve to absolute paths for comparison
        logInfo('VSRX Allowed Base Paths:', this.allowedBasePaths);
        if (this.allowedBasePaths.length === 0) {
          logError('ALLOWED_FILE_BASE_PATHS is set but resulted in no valid paths.');
        }
      }
    }

    // Initialize adapters based on OPERATING_MODE
    logInfo(`Selected Operating Mode: ${this.operatingMode}`);
    switch (this.operatingMode) {
      case 'SILKNOTE':
        logInfo('Using Prisma DB Adapter and Azure Blob File Adapter');
        this.dbAdapter = createPrismaAdapter();
        this.fileAdapter = createAzureBlobFileAdapter();
        break;
      case 'VSRX':
        logInfo('Using MySQL DB Adapter and Local File Adapter (for VSRX path handling)');
        this.dbAdapter = createMySqlDatabaseAdapter();
        this.fileAdapter = createLocalFileAdapter();
        break;
      case 'LOCAL':
      default:
        logInfo('Using Local DB Adapter (JSON) and Local File Adapter');
        this.dbAdapter = createLocalDatabaseAdapter();
        this.fileAdapter = createLocalFileAdapter();
        break;
    }

    logInfo('StorageService constructed', {
      tempDir: this.tempDir,
      outputDir: this.outputDir,
      databaseType: this.databaseType,
      fileStorageType: this.fileStorageType,
      vsrxMode: process.env['VSRX_MODE'] === 'true'
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<{ success: boolean; errors: StorageError[] }> {
    const errors: StorageError[] = [];
    logInfo('Initializing storage service...');
    this.initialized = false;

    try {
      // Initialize file adapter (relevant even in VSRX for temp dir handling)
      logInfo(`Initializing ${this.fileStorageType} file storage related components (temp dir etc)`);
      // Use tempDir for file adapter init, outputDir might be irrelevant for blob/vsrx
      const fileResult = await this.fileAdapter.initialize(this.tempDir);
      if (!fileResult.success) {
        errors.push(...fileResult.errors);
      }

      // Initialize database adapter
      logInfo(`Initializing ${this.databaseType} database`);
      const dbResult = await this.dbAdapter.initialize();
      if (!dbResult.success) {
        errors.push(...dbResult.errors);
      }

      const success = errors.length === 0;
      this.initialized = success;

      logInfo('Storage service initialization complete', {
        success,
        storageErrors: errors
      });

      return { success, errors };
    } catch (error) {
      logError('Unexpected error during storage initialization', error as Error);
      errors.push({
        code: 'STORAGE_INIT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during storage initialization'
      });
      this.initialized = false;
      return { success: false, errors };
    }
  }

  // --- Path Validation Function (VSRX specific) ---
  private async isValidVSRXPath(filePath: string): Promise<boolean> {
    if (process.env['VSRX_MODE'] !== 'true') {
      return true; // Validation only applies in VSRX mode
    }
    if (this.allowedBasePaths.length === 0) {
      logError(`Path validation failed for "${filePath}": No allowed base paths configured.`);
      return false;
    }
    if (!filePath) {
      logError('Path validation failed: File path is empty.');
      return false;
    }

    let absoluteFilePath: string = ''; // Define variable here
    try {
      absoluteFilePath = path.resolve(filePath); // Assign resolved path

      // Check if the path is within allowed directories
      const isAllowed = this.allowedBasePaths.some(basePath => {
        const relative = path.relative(basePath, absoluteFilePath);
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
      });

      if (!isAllowed) {
        logError(`Path validation failed: "${absoluteFilePath}" is not within allowed base paths: [${this.allowedBasePaths.join(', ')}]`);
        return false;
      }

      // Check readability
      await fs.promises.access(absoluteFilePath, fs.promises.constants.R_OK);
      logInfo(`Path validation successful for "${absoluteFilePath}"`);
      return true;

    } catch (error: any) {
      // Use absoluteFilePath in error messages if available
      const pathToCheck = absoluteFilePath || filePath;
      if (error.code === 'ENOENT') {
        logError(`Path validation failed: File not found at "${pathToCheck}"`);
      } else if (error.code === 'EACCES') {
        logError(`Path validation failed: Permission denied for "${pathToCheck}"`);
      } else {
        logError(`Path validation failed for "${filePath}" with unexpected error:`, error);
      }
      return false;
    }
  }

  // --- Modified File Operations for VSRX ---

  async getFileContent(fileRef: string, options: { isVSRXPath?: boolean } = {}): Promise<Buffer> {
    const startTime = Date.now();
    console.log(`[PERF] storageService.getFileContent START - ${new Date().toISOString()} - fileRef: ${fileRef}`);
    
    if (!this.initialized) throw new Error('Storage service not initialized');
    
    if (process.env['VSRX_MODE'] === 'true' && options.isVSRXPath) {
      // **VSRX PATH VALIDATION**
      const isValid = await this.isValidVSRXPath(fileRef);
      if (!isValid) {
        throw new Error(`Access denied or invalid file path provided: ${fileRef}`);
      }
      const absoluteFilePath = path.resolve(fileRef); // Resolve path again for reading
      logInfo(`VSRX Mode: Reading validated path "${absoluteFilePath}"`);
      try {
        console.log(`[PERF] About to read file directly (VSRX mode) - ${new Date().toISOString()}`);
        const fsReadStart = Date.now();
        
        // Attempt reading directly using fs after validation
        const result = await fs.promises.readFile(absoluteFilePath);
        
        const fsReadDuration = Date.now() - fsReadStart;
        const totalDuration = Date.now() - startTime;
        console.log(`[PERF] Direct file read completed (VSRX) - ${new Date().toISOString()} - FS Read Duration: ${fsReadDuration}ms, Total Duration: ${totalDuration}ms`);
        
        return result;
      } catch (readError) {
        logError(`VSRX: Error reading validated path "${absoluteFilePath}"`, readError as Error);
        throw new Error(`Failed to read file from validated path: ${absoluteFilePath}`);
      }
    } else {
      // Non-VSRX mode or non-VSRX path call - use the configured fileAdapter as usual
      console.log(`[PERF] About to call fileAdapter.getFileContent - ${new Date().toISOString()}`);
      const fileAdapterStart = Date.now();
      
      const result = await this.fileAdapter.getFileContent(fileRef);
      
      const fileAdapterDuration = Date.now() - fileAdapterStart;
      const totalDuration = Date.now() - startTime;
      console.log(`[PERF] fileAdapter.getFileContent completed - ${new Date().toISOString()} - File Adapter Duration: ${fileAdapterDuration}ms, Total Duration: ${totalDuration}ms`);
      
      return result;
    }
  }

  // No file storage in VSRX mode
  async storeFile(fileBuffer: Buffer, filename: string): Promise<string> {
    if (process.env['VSRX_MODE'] === 'true') {
      logInfo("VSRX Mode: storeFile called, but file storage is managed externally. Returning filename.");
      return filename;
    }
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.fileAdapter.storeFile(fileBuffer, filename);
  }

  // Only deletes DB reference in VSRX mode (handled by deleteDocument)
  async deleteFile(fileRef: string, options: { isVSRXPath?: boolean } = {}): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    if (process.env['VSRX_MODE'] === 'true' && options.isVSRXPath) {
      logError("VSRX Mode: deleteFile should not be called directly for VSRX paths. Use deleteDocument.", new Error("Incorrect function call for VSRX"));
      return false; // Indicate failure or inappropriate call
    }
    return this.fileAdapter.deleteFile(fileRef);
  }

  // Finalize upload not applicable in VSRX mode
  async finalizeUploadedFile(tempPath: string, clientFileId: string): Promise<string> {
    if (process.env['VSRX_MODE'] === 'true') {
      logError("VSRX Mode: finalizeUploadedFile called inappropriately.", new Error("Incorrect function call for VSRX"));
      throw new Error("finalizeUploadedFile is not applicable in VSRX mode.");
    }
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.fileAdapter.finalizeUploadedFile(tempPath, clientFileId);
  }

  // PDF upload middleware not applicable in VSRX mode for adding docs
  createPdfUploadMiddleware(): RequestHandler {
    if (process.env['VSRX_MODE'] === 'true') {
      logError("VSRX Mode: createPdfUploadMiddleware called inappropriately.", new Error("Incorrect function call for VSRX"));
      return (_req, res, _next) => {
        res.status(405).json({ error: 'File uploads not supported in VSRX mode via this endpoint.' });
      };
    }
    return this.fileAdapter.createPdfUploadMiddleware(this.tempDir);
  }

  async getPdfPageCount(filePath: string): Promise<number> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    // In VSRX mode, filePath will be the absolute path from the DB
    if (this.isVsrx) { // Use internal flag
      logInfo(`VSRX: Getting page count for path ${filePath}`);
      const isValid = await this.isValidVSRXPath(filePath);
      if (!isValid) {
        logError(`Cannot get page count for invalid/inaccessible VSRX path: ${filePath}`);
        return 0;
      }
      const absoluteFilePath = path.resolve(filePath);
      try {
        const pdfBytes = await fs.promises.readFile(absoluteFilePath);
        const pdfLib = await import('pdf-lib');
        const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes);
        return pdfDoc.getPageCount();
      } catch (error) {
        logError(`Failed to get PDF page count for VSRX path ${absoluteFilePath}`, error as Error);
        return 0;
      }
    } else {
      // Non-VSRX: Delegate to adapter, check if function exists
      if (typeof this.fileAdapter.getPdfPageCount === 'function') {
        return this.fileAdapter.getPdfPageCount(filePath);
      } else {
        logError('getPdfPageCount is not implemented by the current file adapter.');
        return 0; // Return default or throw error
      }
    }
  }

  // --- VSRX Specific Document Addition ---
  async addDocumentReference(silknoteUserUuid: string, patientUUID: string, filePath: string, originalName: string, uploadDate?: Date, optionalMetadata: Partial<MedicalDocument> = {}): Promise<{ success: boolean; documentId?: string; error?: string }> {
    if (process.env['VSRX_MODE'] !== 'true') {
      return { success: false, error: "System not configured for VSRX mode." };
    }
    if (!this.initialized) {
      return { success: false, error: "Storage service not initialized." };
    }
    if (!silknoteUserUuid || !patientUUID || !filePath || !originalName) {
      return { success: false, error: "Missing required parameters: silknoteUserUuid, patientUUID, filePath, originalName." };
    }

    logInfo(`VSRX: Received request to add reference: User ${silknoteUserUuid}, Patient ${patientUUID}, Path ${filePath}`);

    // 1. Validate Path (using the internal method)
    const isValid = await this.isValidVSRXPath(filePath);
    if (!isValid) {
      return { success: false, error: `Invalid or inaccessible file path: ${filePath}` };
    }
    const absoluteFilePath = path.resolve(filePath); // Use resolved path

    // 2. Prepare Document Metadata
    const documentId = uuidv4();
    const documentData: MedicalDocument = {
      clientFileId: documentId,
      silknotePatientUuid: patientUUID,
      originalName: originalName,
      storedPath: absoluteFilePath, // Store validated, absolute path
      status: 'queued',
      category: optionalMetadata.category || DocumentType.UNKNOWN,
      uploadDate: (uploadDate || new Date()).toISOString(),
      type: 'application/pdf',
      size: optionalMetadata.size || 0,
      title: optionalMetadata.title || originalName,
      format: { mimeType: 'application/pdf', extension: path.extname(originalName).slice(1) || 'pdf' },
      fileSize: optionalMetadata.size || 0,
      filename: originalName,
      pageCount: optionalMetadata.pageCount,
      documentDate: optionalMetadata.documentDate,
      confidence: 0,
      content: { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] },
      alerts: [],
      detectedPatientInfo: optionalMetadata.detectedPatientInfo || undefined, // Allow undefined for detectedPatientInfo
      ...optionalMetadata
    };

    // 3. Add to Database via Adapter (which MUST be MySQL in VSRX)
    if (this.databaseType !== 'MYSQL') {
      logError('VSRX mode requires DATABASE_TYPE=MYSQL, but it is set to ', this.databaseType);
      return { success: false, error: 'Invalid database configuration for VSRX mode.' };
    }
    const saved = await this.dbAdapter.addDocumentToPatient(silknoteUserUuid, patientUUID, documentData);

    if (saved) {
      logInfo(`VSRX: Successfully added document reference ${documentId} for path ${absoluteFilePath}`);
      return { success: true, documentId: documentId };
    } else {
      logError(`VSRX: Failed to save document reference for path ${absoluteFilePath} to database.`);
      return { success: false, error: "Failed to save document reference to database." };
    }
  }

  // --- Recovery and Reprocessing (Delegate to DB Adapter) ---
  async resetProcessingDocuments(): Promise<number> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    if (typeof (this.dbAdapter as any).resetProcessingDocuments === 'function') {
      return (this.dbAdapter as any).resetProcessingDocuments();
    }
    logError('resetProcessingDocuments not supported by the current DB adapter.');
    return 0;
  }

  async forceReprocessPatientDocuments(silknoteUserUuid: string, silknotePatientUuid: string): Promise<number> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    if (typeof (this.dbAdapter as any).forceReprocessPatientDocuments === 'function') {
      return (this.dbAdapter as any).forceReprocessPatientDocuments(silknoteUserUuid, silknotePatientUuid);
    }
    logError('forceReprocessPatientDocuments not supported by the current DB adapter.');
    return 0;
  }

  async forceReprocessDocument(silknoteUserUuid: string, silknotePatientUuid: string, documentId: string): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    if (typeof (this.dbAdapter as any).forceReprocessDocument === 'function') {
      return (this.dbAdapter as any).forceReprocessDocument(silknoteUserUuid, silknotePatientUuid, documentId);
    }
    logError('forceReprocessDocument not supported by the current DB adapter.');
    return false;
  }

  // --- Standard DB Operations (Delegate) ---
  async saveDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.saveDocument(silknoteUserUuid, silknotePatientUuid, document);
  }
  async getDocument(silknoteUserUuid: string, silknotePatientUuid: string, documentId: string): Promise<MedicalDocument | null> {
    const startTime = Date.now();
    console.log(`[PERF] storageService.getDocument START - ${new Date().toISOString()} - documentId: ${documentId}`);
    
    if (!this.initialized) throw new Error('Storage service not initialized');
    
    let contextMessage = `documentId: ${documentId}`;
    if (silknotePatientUuid) {
      contextMessage += `, silknotePatientUuid: ${silknotePatientUuid}`;
    }

    if (this.operatingMode === 'SILKNOTE') {
      logInfo(`SILKNOTE Mode: storageService.getDocument called with ${contextMessage}`);
      // The Prisma adapter's getDocument implementation MUST now use both 
      // documentId (as clientFileId/storedPath) AND silknotePatientUuid for the lookup.
    } else {
      logInfo(`storageService.getDocument called with ${contextMessage}`);
    }
    
    console.log(`[PERF] About to call dbAdapter.getDocument - ${new Date().toISOString()}`);
    const dbAdapterStart = Date.now();
    
    // Pass both arguments to the adapter. The adapter will decide how to use them.
    const result = await this.dbAdapter.getDocument(silknoteUserUuid, silknotePatientUuid, documentId);
    
    const dbAdapterDuration = Date.now() - dbAdapterStart;
    const totalDuration = Date.now() - startTime;
    console.log(`[PERF] dbAdapter.getDocument completed - ${new Date().toISOString()} - DB Duration: ${dbAdapterDuration}ms, Total Duration: ${totalDuration}ms`);
    
    return result;
  }
  async updateDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.updateDocument(silknoteUserUuid, silknotePatientUuid, document);
  }
  async deleteDocument(silknoteUserUuid: string, silknotePatientUuid: string, documentId: string): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    // In VSRX, we only delete the DB reference
    logInfo(`Deleting document reference ${documentId} (VSRX mode implies no file deletion)`);
    return this.dbAdapter.deleteDocument(silknoteUserUuid, silknotePatientUuid, documentId);
  }
  async savePatient(silknoteUserUuid: string, patient: any): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.savePatient(silknoteUserUuid, patient);
  }
  async getPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<any | null> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.getPatient(silknoteUserUuid, silknotePatientUuid);
  }
  async getAllPatients(silknoteUserUuid: string): Promise<any[]> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.getAllPatients(silknoteUserUuid);
  }
  async updatePatient(silknoteUserUuid: string, silknotePatientUuid: string, patient: any): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.updatePatient(silknoteUserUuid, silknotePatientUuid, patient);
  }
  async deletePatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    logInfo(`Deleting patient ${silknotePatientUuid} and associated references (VSRX mode)`);
    return this.dbAdapter.deletePatient(silknoteUserUuid, silknotePatientUuid);
  }
  async addDocumentToPatient(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
    // This specific method might be less relevant if using addDocumentReference directly
    // If used, ensure it sets status correctly for VSRX
    if (process.env['VSRX_MODE'] === 'true') {
      logError("VSRX Mode: Use addDocumentReference instead of addDocumentToPatient.", new Error("Incorrect function call for VSRX"));
      return false;
    }
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.addDocumentToPatient(silknoteUserUuid, silknotePatientUuid, document);
  }
  async getDocumentsForPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<MedicalDocument[]> {
    if (!this.initialized) throw new Error('Storage service not initialized');
    return this.dbAdapter.getDocumentsForPatient(silknoteUserUuid, silknotePatientUuid);
  }
}

export const storageService = new StorageService();
