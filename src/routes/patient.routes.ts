import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import cors from 'cors'

import config from '../config'
import { MedicalDocument, DocumentType, PatientDetails, DocumentAlertType } from '../shared/types'
import { documentService } from '../services/documentService'
import * as patientService from '../services/patientService'
import { io } from '../socket'

import { storageService } from '../utils/storage'
import { asyncHandler } from "../utils/errorHandlers";
import { createLogger } from '../utils/logger';

const router: Router = Router()

const logger = createLogger('PATIENT_ROUTES');

async function quickStore(
  file: Express.Multer.File,
  clientFileId: string,
  patient: PatientDetails // Make sure PatientDetails is imported or defined
): Promise<MedicalDocument> {
  // 1. move blob to its final name
  const storedPath = await storageService.finalizeUploadedFile(file.path, clientFileId);

  const silknoteDocumentUuid = uuidv4(); // Generate a new UUID for the DB record

  // 2. stub MedicalDocument – omit pageCount for now
  const doc: MedicalDocument = {
    silknoteDocumentUuid, // Assign the generated UUID as the primary DB identifier
    clientFileId,         // Keep clientFileId as a separate field (e.g., for blob name reference)
    silknotePatientUuid: patient.silknotePatientUuid,
    originalName: file.originalname,
    storedPath,           // This IS the clientFileId, which is the blob name
    status: 'stored',
    category: DocumentType.UNPROCESSED,
    uploadDate: new Date().toISOString(),
    type: 'application/pdf',
    size: file.size,
    title: file.originalname,
    format: { mimeType: 'application/pdf', extension: 'pdf' },
    fileSize: file.size,
    filename: path.basename(storedPath), // this will also be clientFileId
    pageCount: 0, // Placeholder
    content: { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] },
    confidence: 0
  };

  // 3. put stub in DB
  await patientService.addFileToPatient(patient.silknotePatientUuid, doc);

  // 4. socket "stored"
  emitToPatientRoom(patient.silknotePatientUuid, 'fileStatus', {
    clientFileId, // The ID client initially knew
    silknoteDocumentUuid, // The actual DB primary key
    silknotePatientUuid: patient.silknotePatientUuid,
    status: 'stored',
    stage: 'storage_complete'
  });

  return doc;
}

// CORS pre-flight for the upload route
router.options('/:silknotePatientUuid/process', cors());

// GET / - fetch all patients
router.get('/', async (req, res) => {
  try {
    const { silknoteUserUuid } = req.query
    console.log('Fetching patients with silknoteUserUuid:', silknoteUserUuid)
    
    let patients;
    if (silknoteUserUuid && typeof silknoteUserUuid === 'string') {
      // Use the dedicated service function when silknoteUserUuid is provided
      patients = await patientService.getPatientsByUserId(silknoteUserUuid);
      console.log(`Found ${patients.length} patients for silknoteUserUuid: ${silknoteUserUuid}`);
    } else {
      // Get all patients when no silknoteUserUuid filter is applied
      patients = await patientService.getPatients();
      console.log(`Found ${patients.length} patients (no silknoteUserUuid filter)`);
    }
    
    return res.json({ patients });
  } catch (error) {
    console.error('Error fetching patients:', error)
    return res.status(500).json({ error: 'Error fetching patients' })
  }
})

// GET /:silknotePatientUuid - fetch a single patient's details
router.get('/:silknotePatientUuid', async (req, res) => {
  const silknotePatientUuid = req.params.silknotePatientUuid
  try {
    const patient = await patientService.getPatientById(silknotePatientUuid)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    return res.json({ patient })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Error fetching patient details' })
  }
})

// GET /:silknotePatientUuid/files - fetch all files for a patient
router.get('/:silknotePatientUuid/files', async (req, res) => {
  try {
    const timestamp = new Date().toISOString()
    const { silknotePatientUuid } = req.params
    console.log(`[${timestamp}] Fetching files for patient:`, silknotePatientUuid)
    
    if (!silknotePatientUuid) {
      return res.status(400).json({ error: 'Patient ID is required' })
    }
    
    const patient = await patientService.getPatientById(silknotePatientUuid)
    
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' })
    }
    
    const files = await patientService.getFilesForPatient(silknotePatientUuid)
    
    if (!files || files.length === 0) {
      return res.json({
        files: [],
        timestamp,
        silknotePatientUuid,
        count: 0
      })
    }
    
    // Optimize the response for large datasets
    const optimizedFiles = files.map(file => {
      try {
        // Create a new object without modifying the original
        const { content, ...fileWithoutContent } = file;
        
        // Include only necessary content fields
        return {
          ...fileWithoutContent,
          content: {
            pageImages: Array.isArray(content?.pageImages) ? content.pageImages : [],
            hasAnalysisResult: !!(content?.analysisResult),
            hasExtractedSchemas: Array.isArray(content?.extractedSchemas) && content.extractedSchemas.length > 0,
            hasEnrichedSchemas: Array.isArray(content?.enrichedSchemas) && content.enrichedSchemas.length > 0
          }
        };
      } catch (mapError) {
        // Return a minimal version if mapping fails
        return {
          clientFileId: file?.clientFileId || 'unknown',
          silknotePatientUuid: file?.silknotePatientUuid || silknotePatientUuid,
          title: file?.title || 'Error processing file',
          status: 'error',
          category: file?.category || 'UNKNOWN',
          uploadDate: file?.uploadDate || new Date().toISOString(),
          content: { pageImages: [] }
        };
      }
    });
    
    return res.json({
      files: optimizedFiles,
      timestamp,
      silknotePatientUuid,
      count: files.length
    })
  } catch (error) {
    console.error('Error fetching files:', error)
    return res.status(500).json({ error: 'Failed to fetch patient files' })
  }
})

// GET /:silknotePatientUuid/files/:fileId - fetch a single file with full content
router.get('/:silknotePatientUuid/files/:fileId', async (req, res) => {
  const { silknotePatientUuid, fileId } = req.params
  
  try {
    if (!silknotePatientUuid || !fileId) {
      return res.status(400).json({ error: 'Patient ID and File ID are required' })
    }
    
    const patient = await patientService.getPatientById(silknotePatientUuid)
    
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' })
    }
    
    if (!patient.fileSet) {
      return res.status(404).json({ error: 'Patient has no files' })
    }
    
    const document = patient.fileSet.find(file => file.clientFileId === fileId)
    
    if (!document) {
      return res.status(404).json({ error: 'File not found' })
    }
    
    return res.json({ document })
  } catch (error) {
    console.error('Error fetching file:', error)
    return res.status(500).json({ error: 'Failed to fetch file' })
  }
})

// Helper function for sending events to rooms
function emitToPatientRoom(silknotePatientUuid: string, event: string, data: any) {
  const roomName = `patient-${silknotePatientUuid}`;
  io.to(roomName).emit(event, data);
}

// POST /:silknotePatientUuid/process - handle file upload with multer
router.post(
  '/:silknotePatientUuid/process',
  (req, res, next) => storageService.createPdfUploadMiddleware()(req, res, next),
  async (req, res) => {
    const silknotePatientUuid = req.params.silknotePatientUuid!;
    const files          = req.files as Express.Multer.File[];
    const rawClientIds   = req.body.clientFileId || [];

    if (!files?.length) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const patient = await patientService.getPatientById(silknotePatientUuid);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    /* ---------------- INITIAL FAST PASS ---------------- */
    const docsForAsync: MedicalDocument[] = [];

    for (let i = 0; i < files.length; i++) {
      const file         = files[i];
      const clientFileId = Array.isArray(rawClientIds) ? rawClientIds[i] : rawClientIds;

      if (!clientFileId) {
        console.error('[PROCESS] missing clientFileId for', file.originalname);
        emitToPatientRoom(silknotePatientUuid, 'fileStatus', {
          clientFileId: null,
          silknotePatientUuid,
          status: 'error',
          stage: 'client_id_missing',
          error: 'clientFileId missing for file'
        });
        continue;
      }

      try {
        const initialDoc = await quickStore(file, clientFileId, patient);
        docsForAsync.push(initialDoc);
      } catch (err: any) {
        console.error('[PROCESS] 🛑 Sync failure for', file.originalname, err);
        emitToPatientRoom(silknotePatientUuid, 'fileStatus', {
          clientFileId,
          silknotePatientUuid,
          status: 'error',
          stage: 'initial_storage_failed',
          error: err.message || 'unknown error'
        });
      }
    }

    /* -------------- RESPOND WITHIN ~2-3 s -------------- */
    res.status(202).json({
      success  : true,
      accepted : docsForAsync.length,
      message  : 'Files stored; processing will continue in background'
    });

    /* --------------- BACKGROUND HEAVY WORK -------------- */
    for (const doc of docsForAsync) {
      (async () => {
        try {
          // 1. page count
          const pageCount = await storageService.getPdfPageCount(doc.storedPath);
          if (pageCount) {
            doc.pageCount = pageCount;
            // Ensure patientService.updateFileForPatient exists and handles this update correctly
            await patientService.updateFileForPatient(silknotePatientUuid, doc);
          }

          // 2. queue full processing (vector / OpenAI)
          await documentService.queueDocument({
            filePath       : doc.storedPath,
            patientContext : patient,
            partialDoc     : doc
          });

        } catch (err: any) {
          console.error('[PROCESS-ASYNC] 🛑', doc.clientFileId, err);
          emitToPatientRoom(silknotePatientUuid, 'fileStatus', {
            clientFileId: doc.clientFileId,
            silknotePatientUuid,
            status: 'error',
            stage : 'async_processing_failed',
            error : err.message || 'unknown error'
          });
        }
      })(); // fire-and-forget
    }
    return; // Explicitly return after initiating background work
  }
);

// POST / - create a new patient
router.post('/', async (req, res) => {
  try {
    const { silknotePatientUuid, name, dateOfBirth, silknoteUserUuid } = req.body
    
    // Validate all required fields
    if (!silknotePatientUuid || !name || !dateOfBirth) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: {
          silknotePatientUuid: silknotePatientUuid ? undefined : 'Required',
          name: name ? undefined : 'Required',
          dateOfBirth: dateOfBirth ? undefined : 'Required'
        }
      })
    }
    
    // Validate silknoteUserUuid specifically
    if (!silknoteUserUuid) {
      return res.status(400).json({
        error: 'Missing required field: silknoteUserUuid',
        details: {
          silknoteUserUuid: 'Required - this associates the patient with a user'
        }
      })
    }
    
    const patientData: PatientDetails = {
      silknotePatientUuid, // Use silknotePatientUuid directly from request
      name,
      dateOfBirth,
      silknoteUserUuid,
      fileSet: [],
      gender: req.body.gender || 'unknown',
      vectorStore: null,
      caseSummary: null
    }
    
    console.log(`Creating patient with silknotePatientUuid: ${silknotePatientUuid}, silknoteUserUuid: ${silknoteUserUuid}`);
    const newPatient = await patientService.createPatient(patientData)
    return res.status(200).json({ patient: newPatient })
  } catch (error) {
    console.error('Error creating patient:', error)
    return res.status(500).json({ error: 'Error creating patient' })
  }
})

// DELETE /patients/:silknotePatientUuid - delete a patient and their files
router.delete('/:silknotePatientUuid', async (req, res) => {
  const { silknotePatientUuid } = req.params
  try {
    const patient = await patientService.getPatientById(silknotePatientUuid)
    if (!patient) return res.status(404).json({ error: 'Patient not found' })

    const patientDir = path.join(config.processing.outputDir, silknotePatientUuid)
    if (fs.existsSync(patientDir)) {
      try {
        await fs.promises.rm(patientDir, { recursive: true, force: true })
      } catch (err) {
        console.error(`Error deleting patient directory ${patientDir}:`, err)
      }
    }
    await patientService.deletePatient(silknotePatientUuid)
    return res.status(204).end()
  } catch (error) {
    console.error('Error deleting patient:', error)
    return res.status(500).json({ error: 'Error deleting patient' })
  }
})

// PATCH /patients/:silknotePatientUuid/documents/:documentId/patient-info - Update patient info for a document
router.patch('/:silknotePatientUuid/documents/:documentId/patient-info', async (req, res) => {
  try {
    const { silknotePatientUuid, documentId } = req.params
    const { patientName, dateOfBirth } = req.body

    if (!silknotePatientUuid || !documentId) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: {
          silknotePatientUuid: silknotePatientUuid ? undefined : 'Required',
          documentId: documentId ? undefined : 'Required'
        }
      })
    }

    if (!patientName && !dateOfBirth) {
      return res.status(400).json({ 
        error: 'At least one of patientName or dateOfBirth must be provided' 
      })
    }

    console.log(`[PATIENT ROUTES] Updating patient info for document ${documentId} in patient ${silknotePatientUuid}`)
    console.log(`[PATIENT ROUTES] New info: Name="${patientName}", DOB="${dateOfBirth}"`)

    // Get the patient
    const patient = await patientService.getPatientById(silknotePatientUuid)
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' })
    }

    // Find the document
    const documentIndex = patient.fileSet.findIndex(doc => doc.clientFileId === documentId)
    if (documentIndex === -1) {
      return res.status(404).json({ error: 'Document not found in patient file set' })
    }

    // Update document with correct patient info
    const document = patient.fileSet[documentIndex]
    
    // Create a copy of the document with updated information
    const updatedDocument = {
      ...document,
      // Clear the incorrect patient flag
      isIncorrectPatient: false,
      // Update detected patient info
      detectedPatientInfo: {
        name: patientName || document.detectedPatientInfo?.name,
        dateOfBirth: dateOfBirth || document.detectedPatientInfo?.dateOfBirth
      },
      // Update alerts to mark INCORRECT_PATIENT alerts as acknowledged
      alerts: (document.alerts || []).map(alert => {
        if (alert.type === DocumentAlertType.INCORRECT_PATIENT || 
            alert.type === DocumentAlertType.INCORRECT_PATIENT.toString()) {
          return {
            ...alert,
            acknowledged: true
          }
        }
        return alert
      })
    }

    // Update the document in the patient's file set
    patient.fileSet[documentIndex] = updatedDocument

    // Save the updated patient
    await patientService.updatePatient(patient)

    // Emit a socket event to notify clients
    const room = `patient-${silknotePatientUuid}`
    io.to(room).emit('documentUpdated', {
      clientFileId: documentId,
      silknotePatientUuid,
      updates: {
        isIncorrectPatient: false,
        detectedPatientInfo: updatedDocument.detectedPatientInfo,
        alerts: updatedDocument.alerts
      }
    })

    return res.status(200).json({ 
      success: true, 
      document: updatedDocument
    })
  } catch (error) {
    console.error('[PATIENT ROUTES] Error updating document patient info:', error)
    return res.status(500).json({ 
      error: 'Error updating document patient info',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Additionally, add a route to handle reprocessing a document
router.post('/documents/:documentId/reprocess', async (req, res) => {
  try {
    const { documentId } = req.params

    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' })
    }

    console.log(`[PATIENT ROUTES] Reprocessing document: ${documentId}`)

    // Find the document across all patients
    const document = await documentService.getDocumentById(documentId)
    if (!document) {
      return res.status(404).json({ error: 'Document not found' })
    }

    const silknotePatientUuid = document.silknotePatientUuid
    const patient = await patientService.getPatientById(silknotePatientUuid)
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found for document' })
    }

    // Get the stored file path
    const filePath = document.storedPath
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Document file not found on disk' })
    }

    // Update document status to processing
    const updatedDocument = {
      ...document,
      status: 'processing'
    }

    // Update in patient record
    await patientService.updateFileForPatient(silknotePatientUuid, updatedDocument)

    // Emit status update
    const room = `patient-${silknotePatientUuid}`
    io.to(room).emit('fileStatus', {
      clientFileId: documentId,
      silknotePatientUuid,
      status: 'processing',
      message: 'Reprocessing document'
    })

    // Queue the document for reprocessing using the file path
    await documentService.queueDocument({
      filePath,
      patientContext: patient,
      partialDoc: updatedDocument
    })

    return res.status(200).json({ 
      success: true, 
      message: 'Document queued for reprocessing' 
    })
  } catch (error) {
    console.error('[PATIENT ROUTES] Error reprocessing document:', error)
    return res.status(500).json({ 
      error: 'Error reprocessing document',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// DELETE /:patientId/case-summary - Clear the case summary for a patient
router.delete('/:patientId/case-summary', asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params;
    logger.info(`Received request to clear case summary for patient ${patientId}`);

    try {
        const success = await storageService.dbAdapter.clearPatientCaseSummary(patientId);
        if (success) {
            logger.info(`Successfully cleared case summary for patient ${patientId}`);
            return res.status(204).send(); // Success, no content
        } else {
            // This likely means patient not found, or DB error during update
            logger.warn(`Failed to clear case summary for patient ${patientId} (not found or DB error)`);
            return res.status(404).json({ error: 'Patient not found or case summary could not be cleared.' });
        }
    } catch (error) {
        logger.error(`Error clearing case summary for patient ${patientId}`, error as Error);
        return res.status(500).json({ error: 'Internal server error while clearing case summary.' });
    }
}));

export default router