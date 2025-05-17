import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import multer from 'multer';
import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { FileStorageAdapter, StorageError } from '../storage-interfaces';
import config from '../../config'; // Import the config object

// --- Logging Helpers ---
function logInfo(message: string, data?: any): void {
 // console.log(`[LOCAL FILE ADAPTER] INFO ${new Date().toISOString()} - ${message}`, data ?? '');
}
function logError(message: string, error?: Error | any, context?: any): void {
  const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  console.error(`[LOCAL FILE ADAPTER] ERROR ${new Date().toISOString()} - ${message}`, { error: errorDetails, context: context ?? {} });
}

// --- Adapter Implementation ---
export function createLocalFileAdapter(): FileStorageAdapter {
  let outputDir: string = ''; // Set during initialization
  let tempDir: string = '';   // Set during initialization

  return {
    async initialize(basePath?: string): Promise<{ success: boolean; errors: StorageError[] }> {
      logInfo('Initializing Local File Adapter...');
      if (!basePath) {
          const msg = 'Base path (tempDir) is required for Local File Adapter initialization.';
          logError(msg);
          return { success: false, errors: [{ code: 'INIT_NO_BASEPATH', message: msg }] };
      }
      tempDir = basePath; // Expecting tempDir to be passed here
      // Derive outputDir relative to tempDir or use a config value
      outputDir = path.resolve(tempDir, '..', 'data', 'documents'); // Assumes temp is inside server/
      
      try {
        // Ensure both temp and output directories exist
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(outputDir, { recursive: true });
        logInfo(`Initialized directories: Temp=${tempDir}, Output=${outputDir}`);
        return { success: true, errors: [] };
      } catch (error: any) {
        logError('Failed to create directories during initialization', error);
        return { success: false, errors: [{ code: 'DIR_CREATE_ERROR', message: error.message }] };
      }
    },

    async storeFile(fileBuffer: Buffer, filename: string): Promise<string> {
      if (!outputDir) throw new Error('Local File Adapter not initialized (outputDir missing).');
      const finalPath = path.join(outputDir, filename);
      logInfo(`Storing file locally: ${finalPath}`);
      try {
        await fs.writeFile(finalPath, fileBuffer);
        return finalPath;
      } catch (error: any) {
        logError(`Failed to store file ${filename} locally`, error);
        throw new Error(`Failed to store file locally: ${error.message}`);
      }
    },

    async getFileContent(fileRef: string): Promise<Buffer> {
       // In local mode, fileRef is usually the full path
       if (!fsSync.existsSync(fileRef)) {
         throw new Error(`File not found at path: ${fileRef}`);
       }
       logInfo(`Getting local file content: ${fileRef}`);
       try {
          return await fs.readFile(fileRef);
       } catch (error: any) {
          logError(`Failed to read local file ${fileRef}`, error);
          throw new Error(`Failed to read file: ${error.message}`);
       }
    },

    async deleteFile(fileRef: string): Promise<boolean> {
      logInfo(`Deleting local file: ${fileRef}`);
      try {
        if (fsSync.existsSync(fileRef)) { // Check if file exists before deleting
            await fs.unlink(fileRef);
            return true;
        } else {
            logInfo(`File not found for deletion: ${fileRef}`);
            return false; // Or true if not finding is considered success
        }
      } catch (error: any) {
        logError(`Failed to delete local file ${fileRef}`, error);
        return false;
      }
    },

    async finalizeUploadedFile(tempPath: string, finalName: string): Promise<string> {
      if (!outputDir) throw new Error('Local File Adapter not initialized (outputDir missing).');
      const finalPath = path.join(outputDir, finalName);
      logInfo(`Moving temp file ${tempPath} to ${finalPath}`);
      try {
        await fs.rename(tempPath, finalPath);
        return finalPath;
      } catch (error: any) {
        logError(`Failed to finalize uploaded file ${finalName}`, error);
        // Attempt to clean up temp file if move fails
        try { await fs.unlink(tempPath); } catch (cleanupError) { /* Ignore cleanup error */ }
        throw new Error(`Failed to finalize file: ${error.message}`);
      }
    },

    createPdfUploadMiddleware(tempUploadDir: string): RequestHandler {
      if (!tempUploadDir) {
         logError('Temp directory must be provided for Multer configuration');
         // Return a handler that immediately errors out
         return (_req, res, next) => next(new Error('File upload middleware not configured'));
      }
      logInfo(`Configuring Multer for temp directory: ${tempUploadDir}`);
      const storage = multer.diskStorage({
        destination: function (_req, _file, cb) {
          // Ensure temp dir exists just in case
          fsSync.mkdirSync(tempUploadDir, { recursive: true }); 
          cb(null, tempUploadDir);
        },
        filename: function (_req, file, cb) {
          // Generate unique temporary filename but keep extension
          const uniqueSuffix = uuidv4();
          const extension = path.extname(file.originalname);
          cb(null, `${uniqueSuffix}${extension}`); 
        }
      });

      const upload = multer({
        storage: storage,
        limits: { 
             fileSize: config.processing.maxFileSize // Use config value
        },
        fileFilter: (_req, file, cb) => {
          // Validate file type based on config
          if (config.processing.allowedTypes.includes(file.mimetype)) {
            cb(null, true);
          } else {
            logError(`Invalid file type uploaded: ${file.mimetype}`, undefined, { filename: file.originalname });
            cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${config.processing.allowedTypes.join(', ')}`));
          }
        }
      });

      // Change middleware to expect field name 'file' instead of 'pdf'
      // This needs to match what the frontend (DocumentUploadDialogue) sends
      return upload.array('file', config.processing.maxFiles); 
    },

    async getPdfPageCount(filePath: string): Promise<number> {
      logInfo(`Getting local PDF page count: ${filePath}`);
      try {
        const pdfBytes = await fs.readFile(filePath);
        // Dynamically import pdf-lib only when needed
        const pdfLib = await import('pdf-lib'); 
        const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes);
        return pdfDoc.getPageCount();
      } catch (error: any) {
        logError(`Failed to get PDF page count for local file ${filePath}`, error);
        return 0; // Return 0 pages on error
      }
    }
  };
} 