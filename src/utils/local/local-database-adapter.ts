import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails /*, DocumentType*/ } from '@shared/types'; // DocumentType already commented
import fs from 'fs/promises';
import path from 'path';

// --- File Path Configuration ---
const dataDir = path.resolve(__dirname, '..', '..', 'data'); 
const patientsFilePath = path.join(dataDir, 'patients.json');

// --- In-memory Cache ---
let patientsCache: { [key: string]: PatientDetails } = {};
let isInitialized = false;

// --- Logging Helpers (Simplified as they are unused) ---
function logInfo(_message: string, _data?: any): void { // message and data already renamed
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
  const adapterFunctions: Partial<DatabaseAdapter> = {};

  adapterFunctions.getDocument = async (documentId: string): Promise<MedicalDocument | null> => {
    if (!isInitialized) throw new Error('Adapter not initialized');
    logInfo(`Getting document ${documentId}`);
    for (const patient of Object.values(patientsCache)) {
      const doc = (patient.fileSet || []).find((f: MedicalDocument) => f.clientFileId === documentId || f.silknoteDocumentUuid === documentId);
      if (doc) return doc as MedicalDocument;
    }
    return null;
  };

  adapterFunctions.saveDocument = async (document: MedicalDocument): Promise<boolean> => {
    if (!isInitialized) throw new Error('Adapter not initialized');
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
    const existingIndex = patient.fileSet.findIndex((f: MedicalDocument) => f.clientFileId === clientFileId);
    if (existingIndex > -1) {
      document.silknotePatientUuid = silknotePatientUuid;
      patient.fileSet[existingIndex] = document;
    } else {
      document.silknotePatientUuid = silknotePatientUuid;
      patient.fileSet.push(document);
    }
    return persistPatientsToFile();
  };

  adapterFunctions.updateDocument = async (document: MedicalDocument): Promise<boolean> => {
    if (!document.silknotePatientUuid) {
      logError('Cannot update document: missing silknotePatientUuid');
      return false;
    }
    if (!adapterFunctions.saveDocument) throw new Error('saveDocument is not defined on adapterFunctions');
    return adapterFunctions.saveDocument(document);
  };

  adapterFunctions.setDocumentStatus = async (documentId: string, status: string): Promise<boolean> => {
    logInfo(`setDocumentStatus (Local Adapter) for ${documentId} to ${status}`);
    if (!adapterFunctions.getDocument || !adapterFunctions.updateDocument) throw new Error('getDocument or updateDocument is not defined on adapterFunctions');
    const doc = await adapterFunctions.getDocument(documentId);
    if(doc) {
        doc.status = status;
        return adapterFunctions.updateDocument(doc);
    }
    return false;
  };

  const adapter: DatabaseAdapter = {
    initialize: async (): Promise<{ success: boolean; errors: StorageError[] }> => {
      if (isInitialized) {
        logInfo('Local DB Adapter already initialized.');
        return { success: true, errors: [] };
      }
      logInfo('Initializing Local DB Adapter...');
      try {
        await fs.mkdir(dataDir, { recursive: true });
        try {
          const data = await fs.readFile(patientsFilePath, 'utf-8');
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
    savePatient: async (patient: PatientDetails): Promise<boolean> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      const silknotePatientUuid = patient.silknotePatientUuid;
      if (!silknotePatientUuid) {
         logError('Cannot save patient: missing silknotePatientUuid');
         return false;
      }
      logInfo(`Saving patient ${silknotePatientUuid}`);
      let vectorStoreForCache: PatientDetails['vectorStore'] = null; 
      if (patient.vectorStore) {
        const inputVectorStore = patient.vectorStore as any;
        vectorStoreForCache = {
            assistantId: inputVectorStore.assistantId || null,
            vectorStoreIndex: inputVectorStore.vectorStoreIndex || null, 
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
          gender: patient.gender || 'unknown', 
          silknoteUserUuid: patient.silknoteUserUuid || 'Unknown User', 
          fileSet: patient.fileSet || [],
          vectorStore: vectorStoreForCache,
          caseSummary: patient.caseSummary || null,
          summaryGenerationCount: patient.summaryGenerationCount || 0, 
      };
      patientsCache[silknotePatientUuid] = patientToSave;
      return persistPatientsToFile();
    },
    getPatient: async (silknotePatientUuid: string): Promise<PatientDetails | null> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Getting patient ${silknotePatientUuid}`);
      const patient = patientsCache[silknotePatientUuid] || null;
      if (patient && !Array.isArray(patient.fileSet)) {
         logInfo(`Patient ${silknotePatientUuid} fileSet is invalid, resetting to empty array.`);
         patient.fileSet = [];
      }
      if (patient && patient.fileSet) {
          patient.fileSet = patient.fileSet.map((doc: any) => doc as MedicalDocument);
      }
      return patient;
    },
    getAllPatients: async (): Promise<PatientDetails[]> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo('Getting all patients');
      return Object.values(patientsCache).map((p: PatientDetails) => ({
          ...p,
          fileSet: Array.isArray(p.fileSet) ? p.fileSet.map((doc: any) => doc as MedicalDocument) : []
      }));
    },
    updatePatient: async (patientUpdate: Partial<PatientDetails>): Promise<boolean> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      const silknotePatientUuid = patientUpdate.silknotePatientUuid;
      if (!silknotePatientUuid) {
        logError('Cannot update patient: missing silknotePatientUuid');
        return false;
      }
      if (!patientsCache[silknotePatientUuid]) {
        logError(`Cannot update patient: patient ${silknotePatientUuid} not found`);
        return false; 
      }
      logInfo(`Updating patient ${silknotePatientUuid}`);
      const existingPatient = patientsCache[silknotePatientUuid];
      let updatedVectorStore: PatientDetails['vectorStore'] = existingPatient.vectorStore; 
      if ('vectorStore' in patientUpdate) { 
          if (patientUpdate.vectorStore === null) { 
             updatedVectorStore = null; 
          } else if (patientUpdate.vectorStore !== undefined) { 
              const inputVectorStore = patientUpdate.vectorStore as any;
              updatedVectorStore = {
                ...(existingPatient.vectorStore || {}),
                ...patientUpdate.vectorStore,
                assistantId: inputVectorStore.assistantId ?? existingPatient.vectorStore?.assistantId ?? null,
                vectorStoreIndex: inputVectorStore.vectorStoreIndex ?? existingPatient.vectorStore?.vectorStoreIndex ?? null, 
                assistantCreatedAt: inputVectorStore.assistantCreatedAt ?? existingPatient.vectorStore?.assistantCreatedAt ?? new Date().toISOString(),
                assistantStatus: inputVectorStore.assistantStatus ?? existingPatient.vectorStore?.assistantStatus ?? 'unknown',
                processedFiles: inputVectorStore.processedFiles ?? existingPatient.vectorStore?.processedFiles ?? [],
                lastUpdated: inputVectorStore.lastUpdated ?? new Date().toISOString(),
                fileIdMappings: inputVectorStore.fileIdMappings ?? existingPatient.vectorStore?.fileIdMappings ?? []
              };
          } 
      }
      patientsCache[silknotePatientUuid] = {
        ...existingPatient,
        ...patientUpdate,
        silknotePatientUuid: silknotePatientUuid,
        fileSet: Array.isArray(patientUpdate.fileSet) ? patientUpdate.fileSet : existingPatient.fileSet || [],
        vectorStore: updatedVectorStore, 
        silknoteUserUuid: patientUpdate.silknoteUserUuid ?? existingPatient.silknoteUserUuid,
      };
      return persistPatientsToFile();
    },
    deletePatient: async (silknotePatientUuid: string): Promise<boolean> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      if (!patientsCache[silknotePatientUuid]) {
        logInfo(`Patient ${silknotePatientUuid} not found for deletion.`);
        return true; 
      }
      logInfo(`Deleting patient ${silknotePatientUuid}`);
      delete patientsCache[silknotePatientUuid];
      return persistPatientsToFile();
    },
    saveDocument: adapterFunctions.saveDocument!,
    getDocument: adapterFunctions.getDocument!,
    updateDocument: adapterFunctions.updateDocument!,
    setDocumentStatus: adapterFunctions.setDocumentStatus!,
    deleteDocument: async (documentId: string): Promise<boolean> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Deleting document ${documentId}`);
      let modified = false;
      for (const silknotePatientUuid in patientsCache) {
        const patient = patientsCache[silknotePatientUuid];
        const initialLength = patient.fileSet?.length || 0;
        if (patient.fileSet) {
          patient.fileSet = patient.fileSet.filter((f: MedicalDocument) => f.clientFileId !== documentId && f.silknoteDocumentUuid !== documentId);
          if (patient.fileSet.length < initialLength) {
            modified = true;
          }
        }
      }
      return modified ? persistPatientsToFile() : true;
    },
    addDocumentToPatient: async (silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      const patient = patientsCache[silknotePatientUuid];
      if (!patient) {
        logError(`Cannot add document: patient ${silknotePatientUuid} not found`);
        return false;
      }
      document.silknotePatientUuid = silknotePatientUuid;
      if (!adapterFunctions.saveDocument) throw new Error('saveDocument is not defined on adapterFunctions for addDocumentToPatient');
      return adapterFunctions.saveDocument(document);
    },
    getDocumentsForPatient: async (silknotePatientUuid: string): Promise<MedicalDocument[]> => {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logInfo(`Getting documents for patient ${silknotePatientUuid}`);
      const patient = patientsCache[silknotePatientUuid];
      return patient?.fileSet?.map((doc: any) => doc as MedicalDocument) || [];
    },
    getQueuedDocuments: async (limit: number = 10): Promise<string[]> => {
      logInfo('getQueuedDocuments (Local Adapter) - checking cache');
        const queuedIds: string[] = [];
        for (const patient of Object.values(patientsCache)) {
            for (const doc of (patient.fileSet || []).map(d => d as MedicalDocument)) {
                if (doc.status === 'queued') {
                    queuedIds.push(doc.clientFileId); 
                    if (queuedIds.length >= limit) break;
                }
            }
            if (queuedIds.length >= limit) break;
        }
        return queuedIds;
    },
    resetProcessingDocuments: async (): Promise<number> => {
      logInfo('resetProcessingDocuments (Local Adapter)');
        let count = 0;
        for (const patient of Object.values(patientsCache)) {
             (patient.fileSet || []).forEach((doc: MedicalDocument | any) => {
                if(doc && doc.status === 'processing') { 
                    doc.status = 'queued';
                    count++;
                }
             });
        }
        return count > 0 ? (await persistPatientsToFile() ? count : 0) : 0;
    },
    forceReprocessPatientDocuments: async (silknotePatientUuid: string): Promise<number> => {
      logInfo(`forceReprocessPatientDocuments (Local Adapter) for ${silknotePatientUuid}`);
        let count = 0;
        const patient = patientsCache[silknotePatientUuid];
        if (patient && Array.isArray(patient.fileSet)) {
             for (const doc of patient.fileSet.map(d => d as MedicalDocument)) {
                 if (doc && doc.status !== 'queued') { 
                    doc.status = 'queued';
                    count++;
                 }
             }
        }
        return count > 0 ? (await persistPatientsToFile() ? count : 0) : 0;
    },
    forceReprocessDocument: async (documentId: string): Promise<boolean> => {
      if (!adapterFunctions.setDocumentStatus) throw new Error('setDocumentStatus is not defined on adapterFunctions for forceReprocessDocument');
      return adapterFunctions.setDocumentStatus(documentId, 'queued');
    },
    clearPatientCaseSummary: async (silknotePatientUuid: string): Promise<boolean> => {
        logInfo(`clearPatientCaseSummary called for ${silknotePatientUuid}, not fully implemented in local adapter yet.`);
        const patient = await adapter.getPatient!(silknotePatientUuid);
        if (patient) {
            patient.caseSummary = null;
            patient.summaryGenerationCount = 0;
            return adapter.savePatient!(patient);
        }
        return false;
    },
    acknowledgeDocumentAlert: async (silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: any): Promise<boolean> => {
        logInfo(`acknowledgeDocumentAlert called for patient ${silknotePatientUuid}, doc ${silknoteDocumentUuid}, type ${alertType}. Not fully implemented.`);
        const patient = await adapter.getPatient!(silknotePatientUuid);
        if (patient) {
            const doc = patient.fileSet.find(d => d.silknoteDocumentUuid === silknoteDocumentUuid || d.clientFileId === silknoteDocumentUuid);
            if (doc && doc.alerts) {
                let changed = false;
                doc.alerts = doc.alerts.map(alert => {
                    if (alert.type === alertType && !alert.acknowledged) {
                        changed = true;
                        return { ...alert, acknowledged: true };
                    }
                    return alert;
                });
                if (changed) {
                    return adapter.saveDocument!(doc);
                }
                return true; 
            }
        }
        return false;
    }
  };
  // Ensure all methods from DatabaseAdapter are implemented on adapter by this point
  return adapter as DatabaseAdapter;
} 