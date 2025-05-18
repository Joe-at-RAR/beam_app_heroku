import { Router, Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandlers";
import { storageService } from "../utils/storage";
import { createLogger } from '../utils/logger';
import { DocumentAlertType } from '../shared/types'; // Import the enum/type

const logger = createLogger('DOCUMENT_ALERTS');
const router: Router = Router();

/**
 * POST /api/alerts/acknowledge
 * Acknowledges a specific alert for a document associated with a patient.
 */
router.post('/acknowledge', asyncHandler(async (req: Request, res: Response) => {
    const { patientId, documentId, alertType } = req.body;

    // Basic validation
    if (!patientId || !documentId || !alertType) {
        logger.warn('Acknowledge alert request missing required fields', req.body);
        return res.status(400).json({ error: 'Missing required fields: patientId, documentId, alertType' });
    }

    // Validate alertType against known types (optional but recommended)
    // This check depends on how DocumentAlertType is defined (e.g., enum, string literal union)
    if (!Object.values(DocumentAlertType).includes(alertType as DocumentAlertType)) {
        logger.warn('Invalid alertType provided', { alertType });
        return res.status(400).json({ error: `Invalid alertType. Must be one of: ${Object.values(DocumentAlertType).join(', ')}` });
    }

    logger.info(`Received request to acknowledge alert:`, { patientId, documentId, alertType });

    try {
        // Use the dbAdapter from storageService
        // Assuming the dbAdapter interface and implementation exist and are correctly typed
        const success = await storageService.dbAdapter.acknowledgeDocumentAlert(patientId, documentId, alertType as DocumentAlertType);

        if (success) {
            logger.info(`Successfully processed acknowledge request for alert type ${alertType}`, { patientId, documentId });
            return res.status(200).json({ success: true, message: 'Alert acknowledged successfully.' });
        } else {
            // Log reason for failure if possible (e.g., patient/doc not found, already acknowledged)
            logger.warn(`Failed to acknowledge alert type ${alertType} (see adapter logs for details)`, { patientId, documentId });
            // Return a generic error, or more specific based on adapter feedback if available
            return res.status(404).json({ success: false, error: 'Failed to acknowledge alert. Document or patient not found, or alert already acknowledged.' }); 
        }
    } catch (error) {
        logger.error('Error processing acknowledge alert request', error as Error, req.body);
        return res.status(500).json({ success: false, error: 'Internal server error while acknowledging alert.' });
    }
}));

export default router; 