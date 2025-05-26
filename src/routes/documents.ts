import { Router, Request, Response } from "express"
import fs from 'fs'
import path from 'path'
import { documentService } from '../services/documentService'
import { storageService } from "../utils/storage";
import { asyncHandler } from "../utils/errorHandlers";
import { createLogger } from '../utils/logger';
import config from '../config';
import { getUserUuid } from '../middleware/auth';

const logger = createLogger('DOCUMENTS_ROUTE')
const router:Router = Router()

// Helper function to extract and validate patient UUID from headers
function getPatientUuid(req: Request): string | null {
  const patientUuid = req.headers['x-silknote-patient-uuid'] as string;
  if (!patientUuid) {
    return null;
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(patientUuid)) {
    return null;
  }
  
  return patientUuid;
}

// Get detailed document information including extraction data - THIS MUST COME FIRST
router.get('/:id/details', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  // Decode the ID to correctly handle spaces and other encoded characters
  const decodedId = decodeURIComponent(id);
  logger.info(`Fetching document details: ${decodedId}`);
  
  // Validate the document ID
  if (!decodedId) {
    return res.status(400).json({ error: 'Document ID is required' });
  }
  
  // Get user UUID from auth middleware
  const userUuid = getUserUuid(req);
  
  // Get patient UUID from header
  const patientUuid = getPatientUuid(req);
  if (!patientUuid) {
    return res.status(400).json({ 
      error: 'Missing or invalid x-silknote-patient-uuid header',
      message: 'Patient UUID must be provided in x-silknote-patient-uuid header' 
    });
  }
  
  // Retrieve the document with access validation
  const documentBasic = await documentService.getDocumentById(decodedId, patientUuid, userUuid);
  
  if (!documentBasic) {
    logger.warn(`Document not found or access denied: ${decodedId} for user ${userUuid} and patient ${patientUuid}`);
    return res.status(404).json({ error: 'Document not found' });
  }
  
  // Validate that the document belongs to the specified patient
  if (documentBasic.silknotePatientUuid !== patientUuid) {
    logger.warn(`Access denied: Document ${decodedId} belongs to patient ${documentBasic.silknotePatientUuid}, not ${patientUuid}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Load the full content
  const content = await documentService.getDocumentContent(decodedId, patientUuid, userUuid);
  
  // Log content details for debugging
  if (!content) {
    logger.debug(`No content found for document: ${decodedId}`);
  } else {
    logger.debug(`Found content for document: ${decodedId}`, {
      hasAnalysisResult: Boolean(content.analysisResult),
      extractedSchemas: content.extractedSchemas?.length || 0,
      enrichedSchemas: content.enrichedSchemas?.length || 0
    });
  }
  
  // If we found the content, use it
  // Otherwise, keep what's in the basic document
  const fullDocument = {
    ...documentBasic,
    content: content || documentBasic.content
  };
  
  return res.json(fullDocument);
}));

// Regular document route - COMES AFTER the details route
router.get('/:documentId', asyncHandler(async (req: Request, res: Response) => {
  const { documentId } = req.params;
  const decodedDocumentId = decodeURIComponent(documentId);
  
  logger.info(`Fetching document: ${decodedDocumentId}`);
  
  // Get user UUID from auth middleware
  const userUuid = getUserUuid(req);
  
  // Get patient UUID from header
  const patientUuid = getPatientUuid(req);
  if (!patientUuid) {
    return res.status(400).json({ 
      error: 'Missing or invalid x-silknote-patient-uuid header',
      message: 'Patient UUID must be provided in x-silknote-patient-uuid header' 
    });
  }
  
  // Get document with access validation
  const documentRecord = await documentService.getDocumentById(decodedDocumentId, patientUuid, userUuid);
  if (!documentRecord) {
    logger.warn(`Document not found or access denied: ${decodedDocumentId} for user ${userUuid} and patient ${patientUuid}`);
    return res.status(404).send('Document not found');
  }
  
  // Validate that the document belongs to the specified patient
  if (documentRecord.silknotePatientUuid !== patientUuid) {
    logger.warn(`Access denied: Document ${decodedDocumentId} belongs to patient ${documentRecord.silknotePatientUuid}, not ${patientUuid}`);
    return res.status(403).send('Access denied');
  }
  
  const filePath = documentRecord.storedPath;
  
  // --- If we are in SILKNOTE (Azure Blob) mode ---
  if (config.storage.type !== 'LOCAL') {
    try {
      const buffer = await storageService.getFileContent(filePath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${documentRecord.originalName || path.basename(filePath)}"`);
      return res.end(buffer);
    } catch (err) {
      logger.error('Error retrieving blob for path:', { filePath, error: err });
      return res.status(404).send('Stored file not found in blob storage');
    }
  }
  
  // --- LOCAL (VSRX) mode ---
  if (!filePath || !fs.existsSync(filePath)) {
    logger.error('Stored file not found at:', filePath);
    return res.status(404).send('Stored file not found');
  }
  
  try {
    const stat = fs.statSync(filePath);
    logger.debug(`Streaming file [${path.basename(filePath)}] with size ${stat.size} bytes`);
  } catch (err) {
    logger.error('Error accessing file stats for path:', { filePath, error: err });
    return res.status(500).send('Error accessing file information');
  }
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
  
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    logger.error('Error streaming file:', { filePath, error: err });
    if (!res.headersSent) {
      res.status(500).send('Error streaming file');
    }
  });
  stream.pipe(res);
  return;
}));

// DELETE /:documentId - Delete a document reference
router.delete('/:documentId', asyncHandler(async (req: Request, res: Response) => {
  const { documentId } = req.params;
  logger.info(`Received request to delete document ${documentId}`);
  
  // Get user UUID from auth middleware
  const userUuid = getUserUuid(req);
  
  // Get patient UUID from header
  const patientUuid = getPatientUuid(req);
  if (!patientUuid) {
    return res.status(400).json({ 
      error: 'Missing or invalid x-silknote-patient-uuid header',
      message: 'Patient UUID must be provided in x-silknote-patient-uuid header' 
    });
  }
  
  // First validate access by getting the document
  const documentRecord = await documentService.getDocumentById(documentId, patientUuid, userUuid);
  if (!documentRecord) {
    logger.warn(`Document ${documentId} not found or access denied for user ${userUuid} and patient ${patientUuid}`);
    return res.status(404).json({ error: 'Document not found.' });
  }
  
  // Validate that the document belongs to the specified patient
  if (documentRecord.silknotePatientUuid !== patientUuid) {
    logger.warn(`Access denied: Document ${documentId} belongs to patient ${documentRecord.silknotePatientUuid}, not ${patientUuid}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Now proceed with deletion
  const success = await storageService.deleteDocument(userUuid, patientUuid, documentId);
  if (success) {
    logger.info(`Successfully deleted document reference ${documentId}`);
    // Use 204 No Content for successful deletion with no body
    return res.status(204).send();
  } else {
    // This could mean document not found or DB error
    logger.warn(`Failed to delete document reference ${documentId} (DB error)`);
    return res.status(500).json({ error: 'Failed to delete document.' });
  }
}));

// GET /:documentId/metadata - Get document metadata
router.get('/:documentId/metadata', asyncHandler(async (req: Request, res: Response) => {
  const { documentId } = req.params;
  const decodedDocumentId = decodeURIComponent(documentId);
  
  logger.info(`Fetching document metadata: ${decodedDocumentId}`);
  
  // Get user UUID from auth middleware
  const userUuid = getUserUuid(req);
  
  // Get patient UUID from header
  const patientUuid = getPatientUuid(req);
  if (!patientUuid) {
    return res.status(400).json({ 
      error: 'Missing or invalid x-silknote-patient-uuid header',
      message: 'Patient UUID must be provided in x-silknote-patient-uuid header' 
    });
  }
  
  // Get document with access validation
  const document = await documentService.getDocumentById(decodedDocumentId, patientUuid, userUuid);
  if (!document) {
    logger.warn(`Document not found or access denied: ${decodedDocumentId} for user ${userUuid} and patient ${patientUuid}`);
    return res.status(404).json({ error: 'Document not found' });
  }
  
  // Validate that the document belongs to the specified patient
  if (document.silknotePatientUuid !== patientUuid) {
    logger.warn(`Access denied: Document ${decodedDocumentId} belongs to patient ${document.silknotePatientUuid}, not ${patientUuid}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Return metadata without content
  const { content, ...metadata } = document;
  return res.json(metadata);
}));

export default router
