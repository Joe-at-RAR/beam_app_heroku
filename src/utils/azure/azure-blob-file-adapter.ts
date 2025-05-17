import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { FileStorageAdapter, StorageError } from '../storage-interfaces';
import { RequestHandler } from 'express';
import { createLogger } from '../logger'; // Assuming logger is in utils
import config from '../../config'; // Added import for config

const logger = createLogger('AZURE_BLOB_ADAPTER');

// Use config for connection string and container name
const AZURE_STORAGE_CONNECTION_STRING = config.azure.azureOpenAI.key; // This seems incorrect, should be storage connection string
// Corrected: const AZURE_STORAGE_CONNECTION_STRING = config.storage.connectionString; // Assuming it would be here
// Actual from existing config.ts: AZURE_STORAGE_CONNECTION_STRING is not directly on config.storage, but rather parsedEnv.AZURE_STORAGE_CONNECTION_STRING
// For now, let's assume it's already set in process.env as the config.ts logic makes it available to app but adapter read it directly.
// The adapter will now use config.storage.azureContainerName

export function createAzureBlobFileAdapter(): FileStorageAdapter {
    let containerClient: ContainerClient | null = null;

    const initialize = async (): Promise<{ success: boolean; errors: StorageError[] }> => {
        const errors: StorageError[] = [];
        // AZURE_STORAGE_CONNECTION_STRING will still be read from process.env for now as per current adapter structure
        // but AZURE_STORAGE_CONTAINER_NAME will come from config
        const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING']; // Keep this direct read for now
        const containerName = config.storage.azureContainerName; // Use from config

        if (!connectionString) {
            errors.push({ code: 'AZURE_CONFIG_MISSING', message: 'Azure Storage connection string is not configured.' });
            logger.error('Azure Storage connection string is not configured.');
            return { success: false, errors };
        }
        try {
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            containerClient = blobServiceClient.getContainerClient(containerName);
            // Ensure container exists
            const createContainerResponse = await containerClient.createIfNotExists();
            if (createContainerResponse.succeeded || createContainerResponse._response.status === 409) { // 409 means it already exists
                logger.info(`Azure Blob container "${containerName}" is ready.`);
                return { success: true, errors: [] };
            } else {
                errors.push({ code: 'AZURE_CONTAINER_ERROR', message: `Failed to create or access container ${containerName}. Status: ${createContainerResponse._response.status}` });
                logger.error(`Failed to create or access container ${containerName}. Status: ${createContainerResponse._response.status}`, createContainerResponse);
                return { success: false, errors };
            }
        } catch (error: any) {
            logger.error('Failed to initialize Azure Blob Storage adapter:', error);
            errors.push({ code: 'AZURE_INIT_FAILED', message: error.message || 'Unknown error during Azure Blob initialization' });
            return { success: false, errors };
        }
    };

    const storeFile = async (fileBuffer: Buffer, filename: string): Promise<string> => {
        if (!containerClient) throw new Error('Azure Blob adapter not initialized.');
        const containerName = config.storage.azureContainerName; // Use from config
        logger.info(`Storing file "${filename}" in Azure Blob container "${containerName}".`);
        const blockBlobClient = containerClient.getBlockBlobClient(filename);
        try {
            await blockBlobClient.uploadData(fileBuffer);
            logger.info(`File "${filename}" uploaded successfully to Azure Blob.`);
            return filename; // Return the blob name (which is the filename here)
        } catch (error: any) {
            logger.error(`Failed to store file "${filename}" in Azure Blob:`, error);
            throw new Error(`Azure Blob storeFile failed: ${error.message}`);
        }
    };

    const getFileContent = async (fileRef: string): Promise<Buffer> => {
        if (!containerClient) throw new Error('Azure Blob adapter not initialized.');
        const containerName = config.storage.azureContainerName; // Use from config
        logger.info(`Getting file content for "${fileRef}" from Azure Blob container "${containerName}".`);
        const blockBlobClient = containerClient.getBlockBlobClient(fileRef);
        try {
            const downloadBlockBlobResponse = await blockBlobClient.downloadToBuffer();
            logger.info(`File "${fileRef}" content retrieved successfully from Azure Blob.`);
            return downloadBlockBlobResponse;
        } catch (error: any) {
            logger.error(`Failed to get file content for "${fileRef}" from Azure Blob:`, error);
            if (error.statusCode === 404) {
                throw new Error(`File not found in Azure Blob: ${fileRef}`);
            }
            throw new Error(`Azure Blob getFileContent failed: ${error.message}`);
        }
    };

    const deleteFile = async (fileRef: string): Promise<boolean> => {
        if (!containerClient) throw new Error('Azure Blob adapter not initialized.');
        const containerName = config.storage.azureContainerName; // Use from config
        logger.info(`Deleting file "${fileRef}" from Azure Blob container "${containerName}".`);
        const blockBlobClient = containerClient.getBlockBlobClient(fileRef);
        try {
            await blockBlobClient.delete();
            logger.info(`File "${fileRef}" deleted successfully from Azure Blob.`);
            return true;
        } catch (error: any) {
            logger.error(`Failed to delete file "${fileRef}" from Azure Blob:`, error);
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
        const sourceBlobClient = containerClient.getBlockBlobClient(tempPath);
        const destBlobClient = containerClient.getBlockBlobClient(finalName);
        try {
            const properties = await sourceBlobClient.getProperties();
            if (!properties.contentLength) {
                throw new Error(`Source blob ${tempPath} not found or is empty.`);
            }
            const copyPoller = await destBlobClient.beginCopyFromURL(sourceBlobClient.url);
            await copyPoller.pollUntilDone();
            await sourceBlobClient.delete(); // Delete the temporary blob
            logger.info(`File finalized from "${tempPath}" to "${finalName}" in Azure Blob.`);
            return finalName;
        } catch (error: any) {
            logger.error(`Failed to finalize file from "${tempPath}" to "${finalName}" in Azure Blob:`, error);
            throw new Error(`Azure Blob finalizeUploadedFile failed: ${error.message}`);
        }
    };

    // Multer middleware for Azure Blob would typically upload directly or use a streaming approach.
    // This is a complex part if you want to avoid saving to local disk first.
    // For a simpler version, you might use multer's memoryStorage or diskStorage
    // and then call 'storeFile' with the buffer/filePath.
    // Returning a placeholder that does nothing for now.
    const createPdfUploadMiddleware = (tempDir: string): RequestHandler => {
        logger.warn('createPdfUploadMiddleware for Azure Blob is not fully implemented and uses a placeholder. Files should be handled via API logic after standard multer parsing (e.g. memoryStorage).');
        return (req, res, next) => {
            // In a real scenario, this middleware might stream uploads to Azure
            // or use multer.memoryStorage() and then the route handler calls storeFile.
            // For now, just pass through.
            next();
        };
    };

    // Optional: Implement if needed, requires PDF parsing library
    const getPdfPageCount = async (fileRefOrPath: string): Promise<number> => {
        logger.warn('getPdfPageCount for Azure Blob is not implemented.');
        // This would involve fetching the PDF from Azure Blob (using getFileContent)
        // and then using a library like pdf-lib or pdfjs-dist to parse it and get page count.
        // For now, returning a placeholder.
        // Example:
        // const pdfBuffer = await getFileContent(fileRefOrPath);
        // const pdfDoc = await PDFDocument.load(pdfBuffer);
        // return pdfDoc.getPageCount();
        throw new Error('getPdfPageCount not implemented for AzureBlobFileAdapter');
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