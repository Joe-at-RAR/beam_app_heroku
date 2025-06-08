import { PatientDetails, MedicalDocument } from '../shared/types';
import { io } from '../socket';
import { storageService } from '../utils/storage'; // Use storageService
import { AzureOpenAI } from 'openai';
import type { TextContentBlock } from 'openai/resources/beta/threads/messages';
import config from '../config';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid'; // Ensure UUID is imported
import * as vectorStore from './vectorStore'  // Add the vectorStore import here
import { removeFileFromVectorStore } from './vectorStore'; // Specific import
import { createLogger } from '../utils/logger'; // Import logger

const logger = createLogger('PATIENT_SERVICE'); // Create logger instance

// Remove file system dependencies for patients.json
// import fs from 'fs/promises';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { dirname } from 'path';

// NOTE FOR CURSOR: Path configuration for JSON is removed
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);
// const dataDir = path.resolve(__dirname, '..', '..', 'data');
// const patientsFilePath = path.join(dataDir, 'patients.json');

// Remove in-memory data store
// let patients: { [key: string]: PatientDetails } = {};

// Remove initializePatientsStore and persistPatients functions
// export async function initializePatientsStore() { ... }
// async function persistPatients() { ... }

// --- Refactored Functions using storageService.dbAdapter ---

export async function getPatients(silknoteUserUuid: string): Promise<PatientDetails[]> {
  console.log('[PATIENT SERVICE DB] Getting all patients');
  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');
    if (!silknoteUserUuid) throw new Error('silknoteUserUuid is required');
    return await storageService.dbAdapter.getAllPatients(silknoteUserUuid);
  } catch (error) {
    console.error('[PATIENT SERVICE DB] Error getting all patients:', error);
    return []; // Return empty array on error
  }
}

/**
 * Get patients filtered by silknoteUserUuid
 * @param silknoteUserUuid The user ID to filter by
 * @returns Array of patients belonging to the specified user
 */
export async function getPatientsByUserId(silknoteUserUuid: string): Promise<PatientDetails[]> {
  console.log(`[PATIENT SERVICE DB] Getting patients for user ID: ${silknoteUserUuid}`);
  if (!silknoteUserUuid) {
    return [];
  }
  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');
    return await storageService.dbAdapter.getAllPatients(silknoteUserUuid);
  } catch (error) {
    console.error(`[PATIENT SERVICE DB] Error getting patients for user ${silknoteUserUuid}:`, error);
    return [];
  }
}

export async function getPatientById(silknotePatientUuid: string, silknoteUserUuid?: string): Promise<PatientDetails | null> {
  logger.info(`Getting patient by ID: ${silknotePatientUuid}, User UUID: ${silknoteUserUuid}`);
  console.log(`[DEBUG] getPatientById called with:`, {
    silknotePatientUuid,
    silknoteUserUuid,
    silknoteUserUuidType: typeof silknoteUserUuid,
    silknoteUserUuidLength: silknoteUserUuid?.length
  });
  
  try {
    if (!storageService.isInitialized()) {
      console.error('[DEBUG] Storage service not initialized');
      throw new Error('Storage service not initialized');
    }
    
    if (!silknoteUserUuid) {
      console.error('[DEBUG] silknoteUserUuid is missing or falsy:', silknoteUserUuid);
      throw new Error('silknoteUserUuid is required');
    }
    
    console.log(`[DEBUG] Calling storageService.dbAdapter.getPatient with:`, {
      silknoteUserUuid,
      silknotePatientUuid
    });
    
    const patient = await storageService.dbAdapter.getPatient(silknoteUserUuid, silknotePatientUuid);

    if (!patient) {
      logger.warn(`Patient not found: ${silknotePatientUuid} for user: ${silknoteUserUuid}`);
      console.log(`[DEBUG] Patient not found in database for:`, {
        silknotePatientUuid,
        silknoteUserUuid
      });
      return null;
    }

    // Check for invalid stored case summary
    if (patient.caseSummary === null && (patient.summaryGenerationCount || 0) > 0) {
      logger.warn(`Patient ${silknotePatientUuid} has count > 0 but stored case summary is null or invalid. Clearing it.`);
      try {
        const cleared = await storageService.dbAdapter.clearPatientCaseSummary(silknoteUserUuid, silknotePatientUuid);
        if (cleared) {
          logger.info(`Successfully cleared invalid case summary for patient ${silknotePatientUuid}.`);
          // Reflect the cleared state in the returned object
          patient.caseSummary = null;
          patient.summaryGenerationCount = 0;
        } else {
          logger.error(`Failed to clear invalid case summary for patient ${silknotePatientUuid} in DB.`);
          // Proceed with null summary, but log the DB error
        }
      } catch (clearError) {
        logger.error(`Error calling clearPatientCaseSummary for patient ${silknotePatientUuid}`, clearError as Error);
        // Proceed with null summary
      }
    }

    logger.info(`Found patient: ${patient.silknotePatientUuid}, File count: ${patient.fileSet?.length || 0}`);
    return patient;
  } catch (error) {
    logger.error(`Error getting patient ${silknotePatientUuid}`, error as Error);
    return null; // Return null on error
  }
}

export async function createPatient(patientInput: Partial<PatientDetails>): Promise<PatientDetails> {
  console.log('[PATIENT SERVICE DB] Creating patient:', patientInput.name);
  if (!patientInput.silknotePatientUuid) {
    patientInput.silknotePatientUuid = uuidv4(); // Generate ID if not provided
    console.log(`[PATIENT SERVICE DB] Generated new patient ID: ${patientInput.silknotePatientUuid}`);
  }

  if (!patientInput.silknoteUserUuid) {
    throw new Error('silknoteUserUuid is required for creating a patient');
  }

  // Ensure essential fields have defaults if not provided
  const patientData: PatientDetails = {
    silknotePatientUuid: patientInput.silknotePatientUuid,
    name: patientInput.name || 'Unknown Patient',
    dateOfBirth: patientInput.dateOfBirth || new Date().toISOString().split('T')[0], // Default DOB if missing
    gender: patientInput.gender || 'unknown',
    silknoteUserUuid: patientInput.silknoteUserUuid,
    fileSet: patientInput.fileSet || [],
    vectorStore: patientInput.vectorStore ?? null,
    caseSummary: patientInput.caseSummary ?? null,
    summaryGenerationCount: patientInput.summaryGenerationCount || 0,
  };

  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');
    const success = await storageService.dbAdapter.savePatient(patientData.silknoteUserUuid, patientData);
    if (!success) {
      throw new Error('Failed to save patient to database');
    }
    // Refetch the patient to get the full object including potential DB defaults/timestamps
    const newPatient = await storageService.dbAdapter.getPatient(patientData.silknoteUserUuid, patientData.silknotePatientUuid);
    if (!newPatient) {
       throw new Error('Failed to retrieve newly created patient');
    }
    console.log('[PATIENT SERVICE DB] Patient created successfully:', newPatient.silknotePatientUuid);
    return newPatient;
  } catch (error) {
    console.error('[PATIENT SERVICE DB] Error creating patient:', error);
    throw error; // Re-throw error
  }
}

export async function updatePatient(patientUpdate: Partial<PatientDetails>): Promise<PatientDetails> {
  const silknotePatientUuid = patientUpdate.silknotePatientUuid; // Use silknotePatientUuid directly
  if (!silknotePatientUuid) {
    throw new Error('Patient ID (silknotePatientUuid) is required for update');
  }
  
  if (!patientUpdate.silknoteUserUuid) {
    throw new Error('silknoteUserUuid is required for updating a patient');
  }
  
  console.log(`[PATIENT SERVICE DB] Updating patient ${silknotePatientUuid}`);

  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');

    // Directly call updatePatient assuming the adapter handles the update logic
    const success = await storageService.dbAdapter.updatePatient(patientUpdate.silknoteUserUuid, silknotePatientUuid, patientUpdate);
    if (!success) {
      throw new Error(`Failed to update patient ${silknotePatientUuid} in database`);
    }
     // Refetch the patient to get the updated full object
    const updatedPatient = await storageService.dbAdapter.getPatient(patientUpdate.silknoteUserUuid, silknotePatientUuid);
     if (!updatedPatient) {
       throw new Error('Failed to retrieve updated patient');
     }
    console.log(`[PATIENT SERVICE DB] Patient ${silknotePatientUuid} updated successfully`);
    return updatedPatient;
  } catch (error) {
    console.error(`[PATIENT SERVICE DB] Error updating patient ${silknotePatientUuid}:`, error);
    throw error; // Re-throw error
  }
}

export async function getFilesForPatient(silknotePatientUuid: string, silknoteUserUuid: string): Promise<MedicalDocument[]> {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [PATIENT SERVICE DB] Getting files for patient: ${silknotePatientUuid}`);
  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');
    if (!silknoteUserUuid) throw new Error('silknoteUserUuid is required');
    
    const files = await storageService.dbAdapter.getDocumentsForPatient(silknoteUserUuid, silknotePatientUuid);
    console.log(`[${timestamp}] [PATIENT SERVICE DB] Found ${files.length} files for patient ${silknotePatientUuid}`);
    return files;
  } catch (error) {
    console.error(`[${timestamp}] [PATIENT SERVICE DB] Error getting files for patient ${silknotePatientUuid}:`, error);
    return []; // Return empty array on error
  }
}

/**
 * Adds a file reference to a patient's record in the database.
 * Assumes the file itself is already stored elsewhere (e.g., local VSRX path).
 * @param silknotePatientUuid ID of the patient
 * @param medicalDocument Document metadata with storedPath set to the actual file location.
 * @param silknoteUserUuid User UUID (required)
 * @returns The added medical document metadata.
 */
export async function addFileToPatient(silknotePatientUuid: string, medicalDocument: MedicalDocument, silknoteUserUuid: string): Promise<MedicalDocument> {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [PATIENT SERVICE DB] Adding file reference to patient:`, {
    silknotePatientUuid,
    clientFileId: medicalDocument.clientFileId,
    silknoteDocumentUuid: medicalDocument.silknoteDocumentUuid,
    fileName: medicalDocument.originalName,
    storedPath: medicalDocument.storedPath
  });

  if (!silknotePatientUuid || !medicalDocument || !medicalDocument.clientFileId || !medicalDocument.storedPath || !medicalDocument.silknoteDocumentUuid) {
    throw new Error('Missing required parameters: silknotePatientUuid, silknoteDocumentUuid, clientFileId, and storedPath are required.');
  }

  if (!silknoteUserUuid) {
    throw new Error('silknoteUserUuid is required');
  }

  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');

    const patientExists = await storageService.dbAdapter.getPatient(silknoteUserUuid, silknotePatientUuid);
    if (!patientExists) {
        console.warn(`[PATIENT SERVICE DB] Patient ${silknotePatientUuid} not found. Document will not be added without a valid patient.`);
        throw new Error(`Patient ${silknotePatientUuid} not found.`);
    }

    medicalDocument.status = medicalDocument.status || 'stored';

    const success = await storageService.dbAdapter.addDocumentToPatient(silknoteUserUuid, silknotePatientUuid, medicalDocument);
    if (!success) {
      throw new Error(`Failed to add document ${medicalDocument.clientFileId} (UUID: ${medicalDocument.silknoteDocumentUuid}) reference to patient ${silknotePatientUuid}`);
    }

    console.log(`[${timestamp}] [PATIENT SERVICE DB] Successfully initiated save for file reference:`, {
      silknotePatientUuid,
      clientFileId: medicalDocument.clientFileId,
      silknoteDocumentUuid: medicalDocument.silknoteDocumentUuid
    });

    const addedDoc = await storageService.dbAdapter.getDocument(silknoteUserUuid, silknotePatientUuid, medicalDocument.clientFileId!);
    if (!addedDoc) {
       console.warn(`[PATIENT SERVICE DB] Could not refetch added document using clientFileId: ${medicalDocument.clientFileId} (silknoteDocumentUuid: ${medicalDocument.silknoteDocumentUuid})`);
       return medicalDocument;
    }

    if (io) {
      const roomName = `patient-${silknotePatientUuid}`;
      const msgId = `fa-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      console.log(`[PATIENT SERVICE] === WEBSOCKET EVENT === About to emit fileAdded event [${msgId}] to room ${roomName}`);
      const fileAddedEvent = { ...addedDoc };
      io.to(roomName).emit('fileAdded', fileAddedEvent);
      console.log(`[PATIENT SERVICE] === WEBSOCKET EVENT === fileAdded event [${msgId}] emitted successfully for ${addedDoc.clientFileId} (${addedDoc.originalName})`);
    }

    return addedDoc;
  } catch (error) {
    console.error(`[${timestamp}] [PATIENT SERVICE DB] Error adding file reference for patient ${silknotePatientUuid}:`, error);
    throw error;
  }
}

export async function deleteFileFromPatient(silknotePatientUuid: string, clientFileId: string, silknoteUserUuid: string): Promise<void> {
  console.log(`[PATIENT SERVICE DB] Deleting file reference ${clientFileId} for patient ${silknotePatientUuid}`);
  if (!silknotePatientUuid || !clientFileId) {
    throw new Error('Missing required parameters: silknotePatientUuid and clientFileId are required.');
  }
  
  if (!silknoteUserUuid) {
    throw new Error('silknoteUserUuid is required');
  }
  
  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');

    // Attempt to remove from vector store first
    try {
      const vsDeletionSuccess = await removeFileFromVectorStore(silknotePatientUuid, clientFileId, silknoteUserUuid);
      if (vsDeletionSuccess) {
        console.log(`[PATIENT SERVICE] Successfully removed ${clientFileId} from vector store for patient ${silknotePatientUuid}.`);
      } else {
        // Log a warning but proceed with DB deletion, as the file might not have been in VS or an error occurred
        console.warn(`[PATIENT SERVICE] Could not remove ${clientFileId} from vector store for patient ${silknotePatientUuid}, or it was not present. Proceeding with DB deletion.`);
      }
    } catch (vsError) {
      console.error(`[PATIENT SERVICE] Error during vector store deletion for ${clientFileId}, patient ${silknotePatientUuid}. Proceeding with DB deletion. Error:`, vsError);
      // Log and continue with DB deletion
    }

    // Then delete from the main database (removes fileSet entry)
    const dbDeletionSuccess = await storageService.dbAdapter.deleteDocument(silknoteUserUuid, silknotePatientUuid, clientFileId); 
    if (!dbDeletionSuccess) {
      console.warn(`[PATIENT SERVICE DB] Failed to delete document ${clientFileId} from database or it didn't exist.`);
    } else {
      console.log(`[PATIENT SERVICE DB] Successfully deleted document reference ${clientFileId} from database.`);
    }

    // The physical file deletion is handled by fileService.deleteFile, called from the route handler.
    // This service only manages the patient's record and vector store linkage.

    // Emit websocket event
    const roomName = `patient-${silknotePatientUuid}`;
    console.log(`[PATIENT SERVICE] Emitting fileDeleted event for file: ${clientFileId} to room ${roomName}`);
    if (io) {
        io.to(roomName).emit('fileDeleted', { clientFileId, silknotePatientUuid, message: 'File processing complete, removed from records.' });
    } else {
        console.warn("[PATIENT SERVICE] Socket.io instance (io) is not available. Cannot emit 'fileDeleted' event.");
    }

  } catch (error) {
    console.error(`[PATIENT SERVICE DB] Error deleting file ${clientFileId} for patient ${silknotePatientUuid}:`, error);
    // It's important to re-throw so the route handler can catch it and send a 500 status
    throw error; 
  }
}

// This function seems redundant if getPatientById returns the full detail including files. Consider removing.
// export async function getPatientEnrichedData(silknotePatientUuid: string): Promise<any[]> {
//   console.warn("[PATIENT SERVICE DB] getPatientEnrichedData is likely redundant. Use getPatientById.");
//   const patient = await getPatientById(silknotePatientUuid);
//   return patient ? patient.fileSet : [];
// }

export async function deletePatient(silknotePatientUuid: string, silknoteUserUuid: string): Promise<void> {
   console.log(`[PATIENT SERVICE DB] Deleting patient ${silknotePatientUuid}`);
  if (!silknotePatientUuid) {
    throw new Error('Missing required parameter: silknotePatientUuid is required.');
  }
  
  if (!silknoteUserUuid) {
    throw new Error('silknoteUserUuid is required');
  }
  
  try {
    if (!storageService.isInitialized()) throw new Error('Storage service not initialized');
    
    // The dbAdapter.deletePatient should handle deleting associated documents if cascaded in DB
    const success = await storageService.dbAdapter.deletePatient(silknoteUserUuid, silknotePatientUuid);
    if (!success) {
      console.warn(`[PATIENT SERVICE DB] Failed to delete patient ${silknotePatientUuid} from database or patient not found.`);
    } else {
        console.log(`[PATIENT SERVICE DB] Successfully deleted patient ${silknotePatientUuid}`);
    }

    // Emit event (keep this)
    io.emit('patientDeleted', { silknotePatientUuid });
  } catch (error) {
     console.error(`[PATIENT SERVICE DB] Error deleting patient ${silknotePatientUuid}:`, error);
     throw error; // Re-throw
  }
}

/**
 * Updates a file entry in the database.
 * Replaces the existing document metadata with the provided updatedFile object.
 */
export async function updateFileForPatient(
  silknotePatientUuid: string, // Keep silknotePatientUuid for context/logging, even if clientFileId is unique
  updatedFile: MedicalDocument,
  silknoteUserUuid: string
): Promise<void> {
   console.log(`[PATIENT SERVICE DB] Updating file ${updatedFile.clientFileId} for patient ${silknotePatientUuid}`);
   if (!silknotePatientUuid || !updatedFile || !updatedFile.clientFileId) {
     throw new Error('Missing required parameters: silknotePatientUuid and updatedFile with clientFileId are required.');
   }
   
   if (!silknoteUserUuid) {
     throw new Error('silknoteUserUuid is required');
   }
   
   // Ensure silknotePatientUuid is set on the updated file object
   updatedFile.silknotePatientUuid = silknotePatientUuid;
   try {
     if (!storageService.isInitialized()) throw new Error('Storage service not initialized');
     
     // Use the dbAdapter's updateDocument method
     const success = await storageService.dbAdapter.updateDocument(silknoteUserUuid, silknotePatientUuid, updatedFile);
     if (!success) {
       throw new Error(`Failed to update document ${updatedFile.clientFileId} in database.`);
     }
     console.log(`[PATIENT SERVICE DB] Successfully updated document ${updatedFile.clientFileId}`);
     // Optionally emit a fileUpdated event via WebSocket
     // io.to(`patient-${silknotePatientUuid}`).emit('fileUpdated', updatedFile);
   } catch (error) {
     console.error(`[PATIENT SERVICE DB] Error updating file ${updatedFile.clientFileId}:`, error);
     throw error; // Re-throw
   }
}


// --- Vector Store Querying Logic ---
// NOTE: This function should ideally be moved out of patientService.ts
// It relates to querying/searching, not patient data management.
// Leaving it here for now to minimize disruption, but recommend moving it.

/**
 * Stream search results with Server-Sent Events
 */
export async function streamSearchQuery(
  silknotePatientUuid: string,
  query: string,
  res: Response,
  silknoteUserUuid: string,
  options: {
    includeExactQuotes?: boolean;
    outputFormat?: string;
  } = {}
): Promise<void> {
  console.log(`[PATIENT SERVICE - streamSearchQuery] Starting for patient ${silknotePatientUuid}`);
  if (!silknotePatientUuid || !query) {
    throw new Error('Missing required parameters for streamSearchQuery');
  }

  // Get patient data using the refactored getPatientById
  const patient = await getPatientById(silknotePatientUuid, silknoteUserUuid);
  if (!patient?.vectorStore?.assistantId) {
    // Use a more specific error message
    const errorMsg = !patient
      ? `Patient with ID ${silknotePatientUuid} not found.`
      : 'No vector store or assistant configured for this patient.';
    console.error(`[PATIENT SERVICE - streamSearchQuery] Error: ${errorMsg}`);
    // Send SSE error before throwing to ensure client is notified
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
    res.end(); // End the response after sending the error
    throw new Error(errorMsg); // Throw after sending SSE error
  }

  const { outputFormat = 'text' } = options;

  // --- OpenAI Logic (Remains mostly the same, uses patient data fetched above) ---
  const openai = new AzureOpenAI({
    apiKey: config.azure.azureOpenAI.key,
    endpoint: config.azure.azureOpenAI.endpoint,
    apiVersion: '2024-05-01-preview',
  });

  let systemMessage = '';
  if (outputFormat === 'json') {
    systemMessage = `
      For each citation, include the reference inline using the format 【citation_index:position†filename】.
      Example: "The patient was diagnosed with hypertension【1:0†medical_report.pdf】."
    `;
  }

  const thread = await openai.beta.threads.create();
  console.log(`[PATIENT SERVICE - streamSearchQuery] Created thread ${thread.id}`);

  if (systemMessage) {
    await openai.beta.threads.messages.create(thread.id, { role: 'user', content: systemMessage });
  }

  await openai.beta.threads.messages.create(thread.id, { role: 'user', content: query });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: patient.vectorStore.assistantId,
  });
  console.log(`[PATIENT SERVICE - streamSearchQuery] Started run ${run.id} on thread ${thread.id}`);

  let attempts = 0;
  const maxAttempts = 60; // 60 seconds timeout
  const pollIntervalMs = 1000;

  const pollInterval = setInterval(async () => {
    // Check if response is already finished or headers sent (client disconnected)
     if (res.writableEnded) {
        console.log(`[PATIENT SERVICE - streamSearchQuery] Response ended or client disconnected. Clearing interval for run ${run.id}`);
        clearInterval(pollInterval);
        return;
      }

    try {
      attempts++;
       if (attempts > maxAttempts) {
          console.log(`[PATIENT SERVICE - streamSearchQuery] Query timed out after ${maxAttempts} seconds for run ${run.id}.`);
          clearInterval(pollInterval);
          res.write(`data: ${JSON.stringify({ type: 'error', error: `Query timed out after ${maxAttempts} seconds` })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); // Send done event even on timeout
          res.end();
          return;
        }


      const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

      if (runStatus.status === 'completed') {
        console.log(`[PATIENT SERVICE - streamSearchQuery] Run ${run.id} completed.`);
        clearInterval(pollInterval);

        const messages = await openai.beta.threads.messages.list(thread.id, { order: 'asc' }); // Get messages in chronological order
        const lastAssistantMessage = messages.data.filter(m => m.role === 'assistant').pop(); // Get the last assistant message

        if (lastAssistantMessage) {
          const textContent = lastAssistantMessage.content.find((c): c is TextContentBlock => c.type === 'text');

          if (textContent?.text) {
            console.log(`[PATIENT SERVICE - streamSearchQuery] Processing assistant response (length: ${textContent.text.value.length})`);
            const originalText = textContent.text.value;
            const citationRegex = /【(\d+):(\d+)†([^】]+)】/g;
            const extractedCitations: Array<{ /* ... citation fields ... */ originalMarker: string; documentName: string; pageNumber: number; position: number; startPosition: number; endPosition: number; length: number; }> = []; // Define fields properly
            let match;

            while ((match = citationRegex.exec(originalText)) !== null) {
              const [fullMatch, pageNumber, position, documentName] = match;
               extractedCitations.push({
                  originalMarker: fullMatch,
                  documentName: documentName,
                  pageNumber: parseInt(pageNumber, 10) || 1,
                  position: parseInt(position, 10) || 0,
                  startPosition: match.index,
                  endPosition: match.index + fullMatch.length,
                  length: fullMatch.length
                });
            }
             extractedCitations.sort((a, b) => a.startPosition - b.startPosition);
             console.log(`[PATIENT SERVICE - streamSearchQuery] Extracted ${extractedCitations.length} citations`);

            // Stream content chunks
            const chunks = originalText.match(/.{1,300}(?:\s|$)/g) || [originalText]; // Ensure non-empty text is sent
             console.log(`[PATIENT SERVICE - streamSearchQuery] Splitting response into ${chunks.length} chunks`);
            for (const chunk of chunks) {
              if (res.writableEnded) break; // Stop if client disconnected
              // Ensure chunk is not undefined or null before stringifying
              if (chunk) {
                res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
              }
              await new Promise(resolve => setTimeout(resolve, 10)); // Small delay between chunks
            }

             if (res.writableEnded) { // Check again after loop
                console.log(`[PATIENT SERVICE - streamSearchQuery] Client disconnected during content streaming for run ${run.id}.`);
                return;
             }

            // Send processing complete signal before sending citations
            res.write(`data: ${JSON.stringify({ type: 'processing_complete' })}\n\n`);
            console.log('[PATIENT SERVICE - streamSearchQuery] Content streaming complete, sending citation information');

            // Send extracted citations
            for (let i = 0; i < extractedCitations.length; i++) {
               if (res.writableEnded) break; // Stop if client disconnected
              const citation = extractedCitations[i];
              // Explicitly type 'doc' in the find method
              const document = patient.fileSet.find((doc: MedicalDocument) =>
                doc.clientFileId === citation.documentName.split('.')[0] || doc.originalName === citation.documentName
              );
              const citationData = {
                type: 'citation',
                documentId: document?.clientFileId || citation.documentName, // Use clientFileId if found
                documentName: citation.documentName,
                pageNumber: citation.pageNumber,
                pageImage: null, // Placeholder, page image generation needs separate logic
                excerpt: citation.originalMarker, // Use the marker itself as excerpt?
                quote: citation.originalMarker, // Use the marker as quote?
                position: citation.position,
                citationIndex: i + 1
              };
              res.write(`data: ${JSON.stringify(citationData)}\n\n`);
              await new Promise(resolve => setTimeout(resolve, 5)); // Very small delay
            }
             if (res.writableEnded) { // Check again after loop
                console.log(`[PATIENT SERVICE - streamSearchQuery] Client disconnected during citation streaming for run ${run.id}.`);
                return;
             }
          } else {
             console.log(`[PATIENT SERVICE - streamSearchQuery] Run ${run.id} completed, but no text content found in the last assistant message.`);
          }
        } else {
           console.log(`[PATIENT SERVICE - streamSearchQuery] Run ${run.id} completed, but no assistant message found.`);
        }

        // Send final 'all_complete' and 'done' signals
         console.log(`[PATIENT SERVICE - streamSearchQuery] Sending all_complete and done signals for run ${run.id}.`);
        res.write(`data: ${JSON.stringify({ type: 'all_complete' })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 50)); // Short delay before final done
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();

      } else if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
        const errorReason = runStatus.last_error?.message || `Assistant run ${runStatus.status}`;
        console.log(`[PATIENT SERVICE - streamSearchQuery] Run ${run.id} ${runStatus.status}: ${errorReason}`);
        clearInterval(pollInterval);
        res.write(`data: ${JSON.stringify({ type: 'error', error: errorReason })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); // Send done event even on failure
        res.end();
      } else {
        // Still in progress or queued, wait for next poll
        // console.log(`[PATIENT SERVICE - streamSearchQuery] Run ${run.id} status: ${runStatus.status}. Waiting...`);
      }
    } catch (error) {
      console.error(`[PATIENT SERVICE - streamSearchQuery] Error during polling/processing for run ${run.id}:`, error);
      clearInterval(pollInterval);
      // Avoid writing to response if headers already sent or response ended
       if (!res.headersSent && !res.writableEnded) {
          try {
              res.write(`data: ${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'Unknown streaming error' })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); // Send done event on error
              res.end();
          } catch (writeError) {
              console.error(`[PATIENT SERVICE - streamSearchQuery] Error writing error to response for run ${run.id}:`, writeError);
          }
       } else {
          console.log(`[PATIENT SERVICE - streamSearchQuery] Response already ended/headers sent for run ${run.id}, cannot send error.`);
       }
    }
  }, pollIntervalMs);

  // Handle client disconnect during polling
  res.on('close', () => {
    console.log(`[PATIENT SERVICE - streamSearchQuery] Client disconnected for run ${run.id}. Clearing interval.`);
    clearInterval(pollInterval);
    // Optionally cancel the OpenAI run if still in progress
    // openai.beta.threads.runs.cancel(thread.id, run.id).catch(cancelErr => console.error("Error cancelling run:", cancelErr));
  });
}

/**
 * Executes a query and returns a single, complete response without streaming.
 */
export async function getQueryResponse(
  silknotePatientUuid: string,
  query: string,
  silknoteUserUuid: string,
  options: {
    includeExactQuotes?: boolean;
    outputFormat?: string;
  } = {}
): Promise<{ content: string; citations: any[] }> {
  console.log(`[PATIENT SERVICE - getQueryResponse] Delegating query to vectorStore.queryAssistantWithCitations for patient ${silknotePatientUuid}`);
  
  // Validate input
  if (!silknotePatientUuid || !query) {
    throw new Error('Missing required parameters for getQueryResponse');
  }

  // Ensure patient and vector store exist before calling the vectorStore function
  const patient = await getPatientById(silknotePatientUuid, silknoteUserUuid);
  if (!patient?.vectorStore?.assistantId) {
    const errorMsg = !patient
      ? `Patient with ID ${silknotePatientUuid} not found.`
      : 'No vector store or assistant configured for this patient.';
    console.error(`[PATIENT SERVICE - getQueryResponse] Error: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  try {
    // Call the centralized vectorStore function
    const result = await vectorStore.queryAssistantWithCitations(
      silknotePatientUuid,
      query,
      options.outputFormat || 'text', // Pass output format hint
      silknoteUserUuid // Pass the required parameter
    );
    
    console.log(`[PATIENT SERVICE - getQueryResponse] Received result from vectorStore: Content length ${result.content.length}, Citations count ${result.citations.length}`);
    return result;

  } catch (error) {
    console.error(`[PATIENT SERVICE - getQueryResponse] Error calling vectorStore.queryAssistantWithCitations:`, error);
    // Re-throw the error to be handled by the route
    throw error;
  }
}

// --- Vector Store Management Logic ---
// ... (keep existing vector store management functions)
