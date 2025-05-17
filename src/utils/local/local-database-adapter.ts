import fs from 'fs/promises';
import path from 'path';
import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentType } from '@shared/types';

// --- File Path Configuration ---
const dataDir = path.resolve(__dirname, '..', '..', 'data'); 
const patientsFilePath = path.join(dataDir, 'patients.json');

// --- In-memory Cache ---
let patientsCache: { [key: string]: PatientDetails } = {};
let isInitialized = false;

// --- Logging Helpers ---
function logInfo(message: string, data?: any): void {
 // console.log(`[LOCAL DB ADAPTER] INFO ${new Date().toISOString()} - ${message}`, data ?? '');
}
function logError(message: string, error?: Error | any, context?: any): void {
  const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  console.error(`[LOCAL DB ADAPTER] ERROR ${new Date().toISOString()} - ${message}`, { error: errorDetails, context: context ?? {} });
}

// --- Persistence Helper ---
async function persistPatientsToFile(): Promise<boolean> {
  if (!isInitialized) {
    logError('Attempted to persist before initialization');
    return false;
  }
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const data = JSON.stringify(patientsCache, null, 2);
    await fs.writeFile(patientsFilePath, data, { encoding: 'utf-8', mode: 0o644 });
    logInfo(`Persisted ${Object.keys(patientsCache).length} patients to ${patientsFilePath}`);
    return true;
  } catch (error) {
    logError('Error persisting patients to file', error);
    return false;
  }
}

// --- Adapter Implementation ---
export function createLocalDatabaseAdapter(): DatabaseAdapter {
  return {
    async initialize(): Promise<{ success: boolean; errors: StorageError[] }> {
      if (isInitialized) {
        logInfo('Local DB Adapter already initialized.');
        return { success: true, errors: [] };
      }
      logInfo('Initializing Local DB Adapter...');
      try {
        await fs.mkdir(dataDir, { recursive: true });
        try {
          const data = await fs.readFile(patientsFilePath, 'utf-8');
          // Parse into the cache which now expects PatientDetails
          patientsCache = JSON.parse(data) as { [key: string]: PatientDetails }; 
          logInfo(`Loaded ${Object.keys(patientsCache).length} patients from ${patientsFilePath}`);
        } catch (readError: any) {
          if (readError.code === 'ENOENT') {
            logInfo(`Patients file not found (${patientsFilePath}). Initializing empty cache.`);
            patientsCache = {};
            await persistPatientsToFile();
          } else {
            logError(`Error reading patients file ${patientsFilePath}`, readError);
            try {
                const backupPath = `${patientsFilePath}.backup.${Date.now()}`;
                await fs.rename(patientsFilePath, backupPath);
                logInfo(`Backed up potentially corrupt file to ${backupPath}`);
                patientsCache = {};
                await persistPatientsToFile();
            } catch (backupError) {
                 logError('Failed to backup corrupt file or create new one', backupError);
                 return { success: false, errors: [{ code: 'INIT_READ_ERROR', message: `Failed to initialize: ${readError.message}` }] };
            }
          }
        }
        isInitialized = true;
        return { success: true, errors: [] };
      } catch (error) {
        logError('Failed to initialize local database adapter', error);
        isInitialized = false;
        return { success: false, errors: [{ code: 'INIT_FAILED', message: error instanceof Error ? error.message : 'Unknown init error' }] };
      }
    },

    // --- Patient Operations ---
    async savePatient(patient: PatientDetails): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      // Use silknotePatientUuid exclusively as the primary key for the cache
      const silknotePatientUuid = patient.silknotePatientUuid;
      if (!silknotePatientUuid) {
         logError('Cannot save patient: missing silknotePatientUuid');
         return false;
      }
      logInfo(`Saving patient ${silknotePatientUuid}`);
      // Safely handle vectorStore structure mismatch
      let vectorStoreForCache: PatientDetails['vectorStore'] = null; // Use null instead of undefined
      if (patient.vectorStore) {
        // Assume input might have vectorStoreIndex and map it
        const inputVectorStore = patient.vectorStore as any;
        vectorStoreForCache = {
            assistantId: inputVectorStore.assistantId || null,
            vectorStoreIndex: inputVectorStore.vectorStoreIndex || null, // Use vectorStoreIndex
            assistantCreatedAt: inputVectorStore.assistantCreatedAt || new Date().toISOString(),
            assistantStatus: inputVectorStore.assistantStatus || 'unknown',
            processedFiles: inputVectorStore.processedFiles || [],
            lastUpdated: inputVectorStore.lastUpdated || new Date().toISOString(),
            fileIdMappings: inputVectorStore.fileIdMappings || []
        };
      }

      const patientToSave: PatientDetails = {
          silknotePatientUuid: silknotePatientUuid,
          name: patient.name || 'Unknown Name',
          dateOfBirth: patient.dateOfBirth || 'Unknown DOB',
          gender: patient.gender || 'unknown', // Updated default
          silknoteUserUuid: patient.silknoteUserUuid || 'Unknown User', // Added missing required field
          fileSet: patient.fileSet || [],
          vectorStore: vectorStoreForCache,
          caseSummary: patient.caseSummary || null,
          summaryGenerationCount: patient.summaryGenerationCount || 0, // Ensure this is included
      };
      patientsCache[silknotePatientUuid] = patientToSave;
      return persistPatientsToFile();
    },

    async getPatient(silknotePatientUuid: string): Promise<PatientDetails | null> { // Parameter name updated
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Getting patient ${silknotePatientUuid}`);
      const patient = patientsCache[silknotePatientUuid] || null;
      // Ensure fileSet is always an array
      if (patient && !Array.isArray(patient.fileSet)) {
         logInfo(`Patient ${silknotePatientUuid} fileSet is invalid, resetting to empty array.`);
         patient.fileSet = [];
      }
      // Explicitly type the fileSet elements before returning
      if (patient && patient.fileSet) {
          patient.fileSet = patient.fileSet.map((doc: any) => doc as MedicalDocument);
      }
      return patient; // Return the PatientDetails object directly
    },

    async getAllPatients(): Promise<PatientDetails[]> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Getting all patients');
      // Ensure fileSet is valid and typed for all patients returned
      return Object.values(patientsCache).map((p: PatientDetails) => ({
          ...p,
          fileSet: Array.isArray(p.fileSet) ? p.fileSet.map((doc: any) => doc as MedicalDocument) : []
      }));
    },

    async updatePatient(patientUpdate: Partial<PatientDetails>): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      // Use only silknotePatientUuid
      const silknotePatientUuid = patientUpdate.silknotePatientUuid;
      if (!silknotePatientUuid) {
        logError('Cannot update patient: missing silknotePatientUuid');
        return false;
      }
      if (!patientsCache[silknotePatientUuid]) {
        logError(`Cannot update patient: patient ${silknotePatientUuid} not found`);
        return false; // Return false if patient not found
      }
      logInfo(`Updating patient ${silknotePatientUuid}`);
      const existingPatient = patientsCache[silknotePatientUuid];
      
      // Safely handle vectorStore update
      let updatedVectorStore: PatientDetails['vectorStore'] = existingPatient.vectorStore; // Initialize with existing
      if ('vectorStore' in patientUpdate) { // Check if vectorStore is part of the update
          if (patientUpdate.vectorStore === null) { // Check for explicit null
             updatedVectorStore = null; // Set to null if update clears it
          } else if (patientUpdate.vectorStore !== undefined) { // Process if it's not undefined
              const inputVectorStore = patientUpdate.vectorStore as any;
              updatedVectorStore = {
                 // Merge with existing or provide defaults
                ...(existingPatient.vectorStore || {}),
                ...patientUpdate.vectorStore,
                // Ensure correct properties exist, use vectorStoreIndex
                assistantId: inputVectorStore.assistantId ?? existingPatient.vectorStore?.assistantId ?? null,
                vectorStoreIndex: inputVectorStore.vectorStoreIndex ?? existingPatient.vectorStore?.vectorStoreIndex ?? null, // Use vectorStoreIndex
                assistantCreatedAt: inputVectorStore.assistantCreatedAt ?? existingPatient.vectorStore?.assistantCreatedAt ?? new Date().toISOString(),
                assistantStatus: inputVectorStore.assistantStatus ?? existingPatient.vectorStore?.assistantStatus ?? 'unknown',
                processedFiles: inputVectorStore.processedFiles ?? existingPatient.vectorStore?.processedFiles ?? [],
                lastUpdated: inputVectorStore.lastUpdated ?? new Date().toISOString(),
                fileIdMappings: inputVectorStore.fileIdMappings ?? existingPatient.vectorStore?.fileIdMappings ?? []
              };
          } // If patientUpdate.vectorStore is undefined, keep existing value
      }
      
      patientsCache[silknotePatientUuid] = {
        ...existingPatient,
        ...patientUpdate,
        // Remove id field
        silknotePatientUuid: silknotePatientUuid,
        fileSet: Array.isArray(patientUpdate.fileSet) ? patientUpdate.fileSet : existingPatient.fileSet || [],
        vectorStore: updatedVectorStore, // Use the safely merged vector store
        silknoteUserUuid: patientUpdate.silknoteUserUuid ?? existingPatient.silknoteUserUuid,
      };
      return persistPatientsToFile();
    },

    async deletePatient(silknotePatientUuid: string): Promise<boolean> { // Parameter name updated
      if (!isInitialized) throw new Error('Adapter not initialized');
      if (!patientsCache[silknotePatientUuid]) {
        logInfo(`Patient ${silknotePatientUuid} not found for deletion.`);
        return true; // Consider not found as success
      }
      logInfo(`Deleting patient ${silknotePatientUuid}`);
      delete patientsCache[silknotePatientUuid];
      return persistPatientsToFile();
    },

    // --- Document Operations ---
    async saveDocument(document: MedicalDocument): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      // Use silknotePatientUuid from the document for lookup
      const silknotePatientUuid = document.silknotePatientUuid;
      const clientFileId = document.clientFileId;
      if (!silknotePatientUuid || !clientFileId) {
        logError('Cannot save document: missing silknotePatientUuid or clientFileId on the document object');
        return false;
      }
      const patient = patientsCache[silknotePatientUuid];
      if (!patient) {
        logError(`Cannot save document: patient ${silknotePatientUuid} not found`);
        return false;
      }
      logInfo(`Saving document ${clientFileId} for patient ${silknotePatientUuid}`);
      patient.fileSet = patient.fileSet || [];
      // Explicitly type 'f' in findIndex
      const existingIndex = patient.fileSet.findIndex((f: MedicalDocument) => f.clientFileId === clientFileId);
      if (existingIndex > -1) {
        // Ensure the document being saved has the correct silknotePatientUuid
        document.silknotePatientUuid = silknotePatientUuid;
        patient.fileSet[existingIndex] = document;
      } else {
         // Ensure the document being saved has the correct silknotePatientUuid
        document.silknotePatientUuid = silknotePatientUuid;
        patient.fileSet.push(document);
      }
      return persistPatientsToFile();
    },

    async getDocument(documentId: string): Promise<MedicalDocument | null> { // documentId is clientFileId or silknoteDocumentUuid
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Getting document ${documentId}`);
      for (const patient of Object.values(patientsCache)) {
        // Explicitly type 'f' in find
        const doc = (patient.fileSet || []).find((f: MedicalDocument) => f.clientFileId === documentId || f.silknoteDocumentUuid === documentId);
        if (doc) return doc as MedicalDocument;
      }
      return null;
    },

    async updateDocument(document: MedicalDocument): Promise<boolean> {
      // Ensure silknotePatientUuid exists before attempting save
       if (!document.silknotePatientUuid) {
           logError('Cannot update document: missing silknotePatientUuid');
           return false;
       }
      return this.saveDocument(document);
    },

    async deleteDocument(documentId: string): Promise<boolean> { // documentId is clientFileId or silknoteDocumentUuid
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Deleting document ${documentId}`);
      let modified = false;
      for (const silknotePatientUuid in patientsCache) {
        const patient = patientsCache[silknotePatientUuid];
        const initialLength = patient.fileSet?.length || 0;
        if (patient.fileSet) {
          // Explicitly type 'f' in filter
          patient.fileSet = patient.fileSet.filter((f: MedicalDocument) => f.clientFileId !== documentId && f.silknoteDocumentUuid !== documentId);
          if (patient.fileSet.length < initialLength) {
            modified = true;
            // No need to break, might be associated with multiple (though unlikely in this model)
          }
        }
      }
      return modified ? persistPatientsToFile() : true; // Return true even if not found
    },

    // --- Relationship Operations ---
    async addDocumentToPatient(silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> { // Parameter name updated
      if (!isInitialized) throw new Error('Adapter not initialized');
      const patient = patientsCache[silknotePatientUuid];
      if (!patient) {
        logError(`Cannot add document: patient ${silknotePatientUuid} not found`);
        return false;
      }
      // Set the silknotePatientUuid field on the document to establish the link
      document.silknotePatientUuid = silknotePatientUuid;
      // Remove the deprecated patientId field if it exists
      // delete (document as any).patientId;
      return this.saveDocument(document);
    },

    async getDocumentsForPatient(silknotePatientUuid: string): Promise<MedicalDocument[]> { // Parameter name updated
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Getting documents for patient ${silknotePatientUuid}`);
      const patient = patientsCache[silknotePatientUuid];
      // Ensure the returned documents are correctly typed
      return patient?.fileSet?.map((doc: any) => doc as MedicalDocument) || [];
    },

    // --- Optional VSRX/Queue Methods ---
    async getQueuedDocuments(limit: number = 10): Promise<string[]> {
        logInfo('getQueuedDocuments (Local Adapter) - checking cache');
        const queuedIds: string[] = [];
        for (const patient of Object.values(patientsCache)) {
            // Explicitly type doc
            for (const doc of (patient.fileSet || []).map(d => d as MedicalDocument)) {
                if (doc.status === 'queued') {
                    queuedIds.push(doc.clientFileId); // Use clientFileId
                    if (queuedIds.length >= limit) break;
                }
            }
            if (queuedIds.length >= limit) break;
        }
        return queuedIds;
    },
    async setDocumentStatus(documentId: string, status: string): Promise<boolean> {
        logInfo(`setDocumentStatus (Local Adapter) for ${documentId} to ${status}`);
        const doc = await this.getDocument(documentId);
        if(doc) {
            doc.status = status;
            return this.updateDocument(doc);
        }
        return false;
    },
    async resetProcessingDocuments(): Promise<number> {
        logInfo('resetProcessingDocuments (Local Adapter)');
        let count = 0;
        for (const patient of Object.values(patientsCache)) {
             // Explicitly type doc
             (patient.fileSet || []).forEach((doc: MedicalDocument | any) => {
                if(doc && doc.status === 'processing') { // Add null check for doc
                    doc.status = 'queued';
                    count++;
                }
             });
        }
        return count > 0 ? (await persistPatientsToFile() ? count : 0) : 0;
    },
    async forceReprocessPatientDocuments(silknotePatientUuid: string): Promise<number> { // Parameter name updated
        logInfo(`forceReprocessPatientDocuments (Local Adapter) for ${silknotePatientUuid}`);
        let count = 0;
        const patient = patientsCache[silknotePatientUuid];
        if (patient && Array.isArray(patient.fileSet)) {
             // Explicitly type doc
             for (const doc of patient.fileSet.map(d => d as MedicalDocument)) {
                 if (doc && doc.status !== 'queued') { // Add null check for doc
                    doc.status = 'queued';
                    count++;
                 }
             }
        }
        return count > 0 ? (await persistPatientsToFile() ? count : 0) : 0;
    },
    async forceReprocessDocument(documentId: string): Promise<boolean> {
        return this.setDocumentStatus(documentId, 'queued');
    }
  };
} 