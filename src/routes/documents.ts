import { Router, Request, Response } from "express"
import fs from 'fs'
import path from 'path'
import { documentService } from '../services/documentService'
import { storageService } from "../utils/storage";
import { asyncHandler } from "../utils/errorHandlers";
import { createLogger } from '../utils/logger';

const logger = createLogger('DOCUMENTS_ROUTE')
const router:Router = Router()

// Get detailed document information including extraction data - THIS MUST COME FIRST
router.get('/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Decode the ID to correctly handle spaces and other encoded characters
    const decodedId = decodeURIComponent(id);
    console.log(`[DOCUMENTS ROUTES] Fetching document details: ${decodedId}`);
    
    // Validate the document ID
    if (!decodedId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }
    
    // Retrieve the basic document metadata
    const documentBasic = await documentService.getDocumentById(decodedId);
    
    if (!documentBasic) {
      console.log('Document not found for details view:', decodedId);
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Load the full content from patients.json
    const content = await documentService.getDocumentContent(decodedId);
    
    // Log content details for debugging
    if (!content) {
      console.log(`No content found for document: ${decodedId}`);
    } else {
      console.log(`Found content for document: ${decodedId}`);
      console.log(`Has analysis result: ${Boolean(content.analysisResult)}`);
      console.log(`Extracted schemas: ${content.extractedSchemas?.length || 0}`);
      console.log(`Enriched schemas: ${content.enrichedSchemas?.length || 0}`);
    }
    
    // If we found the content in patients.json, use it
    // Otherwise, keep what's in the basic document
    const fullDocument = {
      ...documentBasic,
      content: content || documentBasic.content
    };
    
    return res.json(fullDocument);
  } catch (error) {
    console.log('Error fetching document details:', error);
    return res.status(500).json({ error: 'Failed to retrieve document details' });
  }
});

// Regular document route - COMES AFTER the details route
router.get('/:documentId', async (req, res) => {
    console.log(`[DOCUMENTS ROUTES] Fetching document: ${req.params.documentId}`)
  const { documentId } = req.params
  // Decode the documentId to correctly handle spaces and other encoded characters
  const decodedDocumentId = decodeURIComponent(documentId)
  
  const documentRecord = await documentService.getDocumentById(decodedDocumentId)
  if (!documentRecord) {
    console.log('Document not found for id:', decodedDocumentId)
    return res.status(404).send('Document not found')
  }
  
  const filePath = documentRecord.storedPath
  if (!filePath || !fs.existsSync(filePath)) {
    console.log('Stored file not found at:', filePath)
    return res.status(404).send('Stored file not found')
  }
  
  try {
    const stat = fs.statSync(filePath)
    console.log(`Streaming file [${path.basename(filePath)}] with size ${stat.size} bytes`)
  } catch (err) {
    console.log('Error accessing file stats for path:', filePath, err)
    return res.status(500).send('Error accessing file information');
  }
  
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`)
  
  const stream = fs.createReadStream(filePath)
  stream.on('error', (err) => {
    console.log('Error streaming file:', filePath, err)
    if (!res.headersSent) {
        res.status(500).send('Error streaming file');
    }
  })
  stream.pipe(res);
  return;
})

// DELETE /:documentId - Delete a document reference
router.delete('/:documentId', asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    logger.info(`Received request to delete document ${documentId}`);

    try {
        const success = await storageService.deleteDocument(documentId);
        if (success) {
            logger.info(`Successfully deleted document reference ${documentId}`);
            // Use 204 No Content for successful deletion with no body
            return res.status(204).send(); 
        } else {
            // This could mean document not found or DB error
            logger.warn(`Failed to delete document reference ${documentId} (not found or DB error)`);
            return res.status(404).json({ error: 'Document not found or could not be deleted.' });
        }
    } catch (error) {
        logger.error(`Error deleting document ${documentId}`, error as Error);
        return res.status(500).json({ error: 'Internal server error during document deletion.' });
    }
}));

export default router
