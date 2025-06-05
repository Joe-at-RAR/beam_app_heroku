import { BlobServiceClient, BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import { FileStorageAdapter, StorageError } from '../storage-interfaces';
import { RequestHandler } from 'express';
import { createLogger } from '../logger'; // Assuming logger is in utils
import config from '../../config'; // Added import for config
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid'; // For generating unique blob names
import path from 'path'; // For getting file extension

// Extend Express.Multer.File interface to include our custom properties
declare global {
    namespace Express {
        namespace Multer {
            interface File {
                etag?: string;
                blobName?: string;
                containerName?: string;
            }
        }
    }
}

// const AZURE_STORAGE_CONNECTION_STRING = config.azure.azureOpenAI.key; // This seems incorrect, should be storage connection string // Commented out as unused and incorrect

const logger = createLogger('AZURE_BLOB_ADAPTER');

// Use config for connection string and container name
// Corrected: const AZURE_STORAGE_CONNECTION_STRING = config.storage.connectionString; // Assuming it would be here
// Actual from existing config.ts: AZURE_STORAGE_CONNECTION_STRING is not directly on config.storage, but rather parsedEnv.AZURE_STORAGE_CONNECTION_STRING
// For now, let's assume it's already set in process.env as the config.ts logic makes it available to app but adapter read it directly.
// The adapter will now use config.storage.azureContainerName

export function createAzureBlobFileAdapter(): FileStorageAdapter {
    let containerClient: ContainerClient | null = null;

    /* ------------------------------------------------------------------
     * Helper: direct console logging wrapper
     * ------------------------------------------------------------------ */
    const clog = (...args: any[]) => {
        // Always output to stdout so that Heroku log drains pick it up even if
        // the Winston/derived logger is muted or configured differently.
        console.log('[AZURE_BLOB_ADAPTER]', ...args);
    };

    const initialize = async (): Promise<{ success: boolean; errors: StorageError[] }> => {
        clog('Initializing Azure Blob adapter…');
        const errors: StorageError[] = [];
        // AZURE_STORAGE_CONNECTION_STRING will still be read from process.env for now as per current adapter structure
        // but AZURE_STORAGE_CONTAINER_NAME will come from config
        const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING']; // Keep this direct read for now
        const containerName = config.storage.azureContainerName; // Use from config

        if (!connectionString) {
            errors.push({ code: 'AZURE_CONFIG_MISSING', message: 'Azure Storage connection string is not configured.' });
            logger.error('Azure Storage connection string is not configured.');
            clog('❌ Azure Storage connection string missing – adapter NOT initialised');
            return { success: false, errors };
        }
        try {
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            containerClient = blobServiceClient.getContainerClient(containerName);
            // Ensure container exists
            const createContainerResponse = await containerClient.createIfNotExists();
            if (createContainerResponse.succeeded || createContainerResponse._response.status === 409) { // 409 means it already exists
                logger.info(`Azure Blob container "${containerName}" is ready.`);
                clog(`✅ Azure Blob container "${containerName}" is ready (status ${createContainerResponse._response.status}).`);
                return { success: true, errors: [] };
            } else {
                errors.push({ code: 'AZURE_CONTAINER_ERROR', message: `Failed to create or access container ${containerName}. Status: ${createContainerResponse._response.status}` });
                logger.error(`Failed to create or access container ${containerName}. Status: ${createContainerResponse._response.status}`, createContainerResponse);
                clog(`❌ Failed to access container "${containerName}" – status ${createContainerResponse._response.status}`);
                return { success: false, errors };
            }
        } catch (error: any) {
            logger.error('Failed to initialize Azure Blob Storage adapter:', error);
            clog('❌ Azure Blob adapter initialisation error:', error?.message || error);
            errors.push({ code: 'AZURE_INIT_FAILED', message: error.message || 'Unknown error during Azure Blob initialization' });
            return { success: false, errors };
        }
    };

    const storeFile = async (fileBuffer: Buffer, filename: string): Promise<string> => {
        if (!containerClient) throw new Error('Azure Blob adapter not initialized.');
        const containerName = config.storage.azureContainerName; // Use from config
        logger.info(`Storing file "${filename}" in Azure Blob container "${containerName}".`);
        clog(`⬆️  Uploading "${filename}" to container "${containerName}"…`);
        const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(filename);
        try {
            await blockBlobClient.uploadData(fileBuffer);
            logger.info(`File "${filename}" uploaded successfully to Azure Blob.`);
            clog(`✅ Upload of "${filename}" complete.`);
            return filename; // Return the blob name (which is the filename here)
        } catch (error: any) {
            logger.error(`Failed to store file "${filename}" in Azure Blob:`, error);
            clog(`❌ Upload failed for "${filename}":`, error?.message || error);
            throw new Error(`Azure Blob storeFile failed: ${error.message}`);
        }
    };

    const getFileContent = async (fileRef: string): Promise<Buffer> => {
        console.log(`[PERF] Azure blob getFileContent START - ${new Date().toISOString()} - fileRef: ${fileRef}`);
        const startTime = Date.now();
        
        if (!containerClient) {
            logger.error('Azure Blob adapter not initialized. Cannot get file content.');
            throw new Error('Azure Blob adapter not initialized.');
        }
        logger.info(`[AZURE_BLOB_ADAPTER] ⬇️  Downloading "${fileRef}" from container "${containerClient.containerName}"…`);
        
        console.log(`[PERF] About to call Azure blob downloadToBuffer - ${new Date().toISOString()}`);
        const azureDownloadStart = Date.now();
        
        try {
            const blobClient = containerClient.getBlobClient(fileRef);
            const downloadResponse = await blobClient.downloadToBuffer();
            
            const azureDownloadDuration = Date.now() - azureDownloadStart;
            const totalDuration = Date.now() - startTime;
            
            logger.info(`[AZURE_BLOB_ADAPTER] ✅ Download of "${fileRef}" complete.`);
            console.log(`[PERF] Azure blob downloadToBuffer completed - ${new Date().toISOString()} - Azure Duration: ${azureDownloadDuration}ms, Total Duration: ${totalDuration}ms, Size: ${downloadResponse.length} bytes`);
            
            return downloadResponse;
        } catch (error: any) {
            const errorDuration = Date.now() - startTime;
            logger.error(`[AZURE_BLOB_ADAPTER] ❌ Failed to download "${fileRef}":`, error);
            console.log(`[PERF] Azure blob download FAILED - ${new Date().toISOString()} - Duration: ${errorDuration}ms - Error: ${error.message}`);
            throw new Error(`Failed to download file: ${error.message}`);
        }
    };

    const deleteFile = async (fileRef: string): Promise<boolean> => {
        if (!containerClient) throw new Error('Azure Blob adapter not initialized.');
        const containerName = config.storage.azureContainerName; // Use from config
        logger.info(`Deleting file "${fileRef}" from Azure Blob container "${containerName}".`);
        clog(`🗑️  Deleting "${fileRef}" from container "${containerName}"…`);
        const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(fileRef);
        try {
            await blockBlobClient.delete();
            logger.info(`File "${fileRef}" deleted successfully from Azure Blob.`);
            clog(`✅ Deletion of "${fileRef}" complete.`);
            return true;
        } catch (error: any) {
            logger.error(`Failed to delete file "${fileRef}" from Azure Blob:`, error);
            clog(`❌ Deletion failed for "${fileRef}":`, error?.message || error);
            // Depending on desired behavior, you might return false or throw
            // For now, let's rethrow to indicate failure clearly
            throw new Error(`Azure Blob deleteFile failed: ${error.message}`);
        }
    };

    // This function might be more relevant for local file systems or specific S3 patterns.
    // For Azure Blob, 'storeFile' typically places it directly where it needs to be.
    // If a temp/staging location within the blob container is used, this would need implementation.
    const finalizeUploadedFile = async (tempPath: string, finalName: string): Promise<string> => {
        if (!containerClient) throw new Error('Azure Blob adapter not initialized.');
        // const containerName = config.storage.azureContainerName; // Not directly needed for client.getContainerClient here
        logger.info(`Finalizing uploaded file from "${tempPath}" to "${finalName}" in Azure Blob.`);
        // Assuming tempPath is also a blob name in the same container.
        // If tempPath refers to a local file, this logic is different.
        // For now, let's assume it's a rename/copy within the container if needed.
        // A common pattern is to upload directly to the finalName.
        // If it's a copy and delete:
        clog(`🔄 finalizeUploadedFile tempPath="${tempPath}" → finalName="${finalName}"`);

        // Multer Azure storage sets file.path to `${containerName}/${blobName}`. Strip container prefix if present.
        const normalisedTempBlobName = tempPath.startsWith(`${containerClient.containerName}/`)
            ? tempPath.substring(containerClient.containerName.length + 1)
            : tempPath;

        const sourceBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(normalisedTempBlobName);
        const destBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(finalName);
        clog(`Source blob resolved as "${normalisedTempBlobName}"`);
        try {
            const properties = await sourceBlobClient.getProperties();
            if (!properties.contentLength) {
                throw new Error(`Source blob ${normalisedTempBlobName} not found or is empty.`);
            }
            const copyPoller = await destBlobClient.beginCopyFromURL(sourceBlobClient.url);
            await copyPoller.pollUntilDone();
            await sourceBlobClient.delete(); // Delete the temporary blob
            logger.info(`File finalized from "${tempPath}" to "${finalName}" in Azure Blob.`);
            clog(`✅ Finalised blob. New name="${finalName}" (old was "${normalisedTempBlobName}")`);
            return finalName;
        } catch (error: any) {
            logger.error(`Failed to finalize file from "${tempPath}" to "${finalName}" in Azure Blob:`, error);
            clog(`❌ finalizeUploadedFile error:`, error?.message || error);
            throw new Error(`Azure Blob finalizeUploadedFile failed: ${error && error.message ? error.message : 'unknown'}`);
        }
    };

    // Custom Multer storage engine for Azure Blob Storage
    class AzureBlobMulterStorage implements multer.StorageEngine {
        private containerClient: ContainerClient;

        constructor(containerClient: ContainerClient) {
            this.containerClient = containerClient;
        }

        _handleFile(_req: Express.Request, file: Express.Multer.File, cb: (error?: any, info?: Partial<Express.Multer.File>) => void): void {
            if (!this.containerClient) {
                return cb(new Error('Azure Blob adapter not initialized or container client not available.'));
            }

            const extension = path.extname(file.originalname);
            const blobName = `${uuidv4()}${extension}`;
            const blockBlobClient: BlockBlobClient = this.containerClient.getBlockBlobClient(blobName);

            logger.info(`Starting direct stream upload of ${file.originalname} as ${blobName} to Azure container ${this.containerClient.containerName}`);

            blockBlobClient.uploadStream(file.stream)
                .then(response => {
                    logger.info(`Successfully streamed ${blobName} to Azure. ETag: ${response.etag}`);
                    cb(null, {
                        filename: blobName, 
                        path: `${this.containerClient.containerName}/${blobName}`, 
                        etag: response.etag,
                        blobName: blobName, 
                        containerName: this.containerClient.containerName 
                    });
                })
                .catch(error => {
                    logger.error(`Error streaming ${blobName} to Azure:`, error);
                    // Attempt to clean up if partial upload happened - this is complex with streams.
                    // blockBlobClient.deleteIfExists().catch(delError => logger.error(`Cleanup error for ${blobName}:`, delError));
                    cb(error);
                });
        }

        _removeFile(_req: Express.Request, file: Express.Multer.File & { blobName?: string; containerName?: string }, cb: (error: Error | null) => void): void {
            if (file.blobName && file.containerName) {
                logger.info(`Attempting to remove blob ${file.blobName} from container ${file.containerName} due to error/rollback.`);
                const blockBlobClient: BlockBlobClient = this.containerClient.getBlockBlobClient(file.blobName);
                blockBlobClient.deleteIfExists()
                    .then(() => {
                        logger.info(`Successfully deleted ${file.blobName} during cleanup.`);
                        cb(null);
                    })
                    .catch(error => {
                        logger.error(`Error deleting ${file.blobName} during cleanup:`, error);
                        cb(error);
                    });
            } else {
                cb(null); // No specific blob to remove or info missing
            }
        }
    }

    // Multer middleware for Azure Blob.
    // Uses a custom storage engine to stream directly to Azure Blob Storage.
    const createPdfUploadMiddleware = (_tempDir: string): RequestHandler => {
        if (!containerClient) {
            // This check is important. Middleware might be created before initialize() is called or if it failed.
            // Throw an error or return a middleware that sends an error response.
            const msg = 'Azure Blob adapter not initialized. Cannot create upload middleware.';
            logger.error(msg);
            return (_req, _res, next) => next(new Error(msg));
        }

        const storage = new AzureBlobMulterStorage(containerClient);
        
        const upload = multer({
            storage: storage, // Use our custom Azure storage engine
            limits: {
                fileSize: config.processing.maxFileSize, // Use from config
            },
            fileFilter: (_req, file, cb) => {
                if (file.mimetype === 'application/pdf') {
                    cb(null, true);
                } else {
                    logger.warn(`Attempted upload of non-PDF file: ${file.originalname} (${file.mimetype})`);
                    cb(new Error('Only PDF files are allowed.'));
                }
            },
        });

        return upload.array('file', config.processing.maxFiles); 
    };

    // Optional: Implement if needed, requires PDF parsing library
    const getPdfPageCount = async (fileRef: string): Promise<number> => {
        if (!containerClient) {
            logger.error('Azure Blob adapter not initialized. Cannot get PDF page count.');
            throw new Error('Azure Blob adapter not initialized.');
        }
        logger.info(`Getting PDF page count for Azure blob: ${fileRef}`);
        try {
            // Use the getFileContent method from the same adapter scope
            const pdfBuffer = await getFileContent(fileRef);
            const { PDFDocument } = await import('pdf-lib'); // Dynamic import
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            const count = pdfDoc.getPageCount();
            logger.info(`PDF page count for ${fileRef} is ${count}`);
            return count;
        } catch (error: any) {  
            logger.error(`Failed to get PDF page count for Azure blob ${fileRef}:`, error);
            // Depending on desired behavior, either re-throw or return a default (e.g., 0)
            // Returning 0 to match LocalFileAdapter behavior on error
            return 0; 
        }
    };

    return {
        initialize,
        storeFile,
        getFileContent,
        deleteFile,
        finalizeUploadedFile,
        createPdfUploadMiddleware,
        getPdfPageCount, // Include if you implement it
    };
} 