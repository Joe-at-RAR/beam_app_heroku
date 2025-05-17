import { Router } from 'express';
import { documentService } from '../services/documentService';

const router: Router = Router();

/**
 * Endpoint to request reprocessing of a document
 * This is called by the client when a document processing seems stalled
 */
router.post('/:documentId/reprocess', async (req, res) => {
  const { documentId } = req.params;
  
  console.log(`[DOCUMENT REPROCESS] Reprocess request received for document: ${documentId}`);
  
  try {
    // Get the document
    const document = await documentService.getDocumentById(documentId);
    
    if (!document) {
      console.log(`[DOCUMENT REPROCESS] Document not found: ${documentId}`);
      return res.status(404).json({ 
        success: false, 
        message: 'Document not found' 
      });
    }
    
    // Log the current status of the document
    console.log(`[DOCUMENT REPROCESS] Document status before reprocessing: ${document.status}, category: ${document.category}`);
    
    // For now, just send a success response
    // In a real implementation, you would trigger reprocessing here
    console.log(`[DOCUMENT REPROCESS] Document reprocessing request acknowledged: ${documentId}`);
    
    return res.status(200).json({
      success: true,
      message: `Document reprocessing request acknowledged for ${documentId}`
    });
    
  } catch (error) {
    console.log(`[DOCUMENT REPROCESS] Error reprocessing document ${documentId}:`, error);
    return res.status(500).json({ 
      success: false, 
      message: `Error reprocessing document: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

export default router;
