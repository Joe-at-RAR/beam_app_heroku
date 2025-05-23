import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentAlert, DocumentAlertType } from '../../shared/types'; // DocumentType already commented, Added DocumentAlert, DocumentAlertType
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../logger';
import { v4 as uuidv4 } from 'uuid';
import config from '../../config';

const logger = createLogger('LOCAL_DB_ADAPTER');

interface LocalDBStructure {
    users: {
        [userUuid: string]: {
            patients: {
                [patientUuid: string]: PatientDetails;
            }
        }
    };
}

const DB_FILE_NAME = 'localUserPatientDb.json'; // More descriptive name
let dbFilePath: string;
let localDb: LocalDBStructure = { users: {} };
let isInitialized = false;

async function loadDatabase(): Promise<void> {
    try {
        const data = await fs.readFile(dbFilePath, 'utf-8');
        const jsonData = JSON.parse(data);
        if (jsonData && typeof jsonData.users === 'object' && jsonData.users !== null) {
            localDb = jsonData as LocalDBStructure;
            // Ensure nested structures exist for all loaded users/patients
            for (const userId in localDb.users) {
                if (typeof localDb.users[userId]?.patients !== 'object' || localDb.users[userId].patients === null) {
                    localDb.users[userId].patients = {};
                }
                for (const patientId in localDb.users[userId].patients) {
                    const patient = localDb.users[userId].patients[patientId];
                    if (!Array.isArray(patient.fileSet)) {
                        patient.fileSet = [];
                    }
                    patient.silknoteUserUuid = userId; // Ensure consistency
                }
            }
        } else {
            logger.warn('Local database file has incorrect structure, initializing empty.');
            localDb = { users: {} };
        }
        logger.info('Local database loaded successfully.');
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            logger.warn('Local database file not found, initializing empty & creating file.');
            localDb = { users: {} };
            await saveDatabase(); 
        } else {
            logger.error('Failed to load local database:', error);
            localDb = { users: {} }; 
        }
    }
}

async function saveDatabase(): Promise<void> {
    if (!dbFilePath) {
        logger.error('DB_FILE_PATH_NOT_SET: Cannot save local database.');
        return;
    }
    try {
        const data = JSON.stringify(localDb, null, 2);
        await fs.writeFile(dbFilePath, data, 'utf-8');
        logger.info('Local database saved successfully.');
    } catch (error) {
        logger.error('Failed to save local database:', error);
    }
}

// --- File Path Configuration ---
const dataDir = path.resolve(__dirname, '..', '..', 'data'); 
const patientsFilePath = path.join(dataDir, 'patients.json');

// --- In-memory Cache ---
let patientsCache: { [key: string]: PatientDetails } = {};

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
  logger.info('Local DB Adapter created.');

  // Helper to safely get or create the nested structure for a user's patients
  const getUserPatientsCollection = (silknoteUserUuid: string): { [patientUuid: string]: PatientDetails } => {
    if (!localDb.users[silknoteUserUuid]) {
      localDb.users[silknoteUserUuid] = { patients: {} };
    } else if (!localDb.users[silknoteUserUuid].patients) {
      localDb.users[silknoteUserUuid].patients = {};
    }
    return localDb.users[silknoteUserUuid].patients;
  };

  return {
    async initialize(): Promise<{ success: boolean; errors: StorageError[] }> {
      if (isInitialized) return { success: true, errors: [] };
      logger.info('Initializing Local DB Adapter...');
      dbFilePath = path.join(config.processing.outputDir, DB_FILE_NAME);
      try {
        await fs.mkdir(path.dirname(dbFilePath), { recursive: true });
        await loadDatabase();
        isInitialized = true;
        logger.info('Local DB Adapter initialized successfully.', { dbFilePath });
        return { success: true, errors: [] };
      } catch (error: any) {
        isInitialized = false;
        logger.error('Local Database Adapter initialization failed:', error);
        return { success: false, errors: [{ code: 'LOCAL_DB_INIT_FAIL', message: error.message }] };
      }
    },

    async saveDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] saveDocument for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, clientFileId: ${document.clientFileId}`);
      
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      if (!userPatients[silknotePatientUuid]) {
        logger.warn(`[LOCAL_DB] saveDocument: Patient ${silknotePatientUuid} for user ${silknoteUserUuid} not found.`);
        return false;
      }
      const patient = userPatients[silknotePatientUuid];
      if (!patient.fileSet) patient.fileSet = [];

      const docDbUuid = document.silknoteDocumentUuid || uuidv4();
      // MedicalDocument should not store silknoteUserUuid directly.
      // Its association with user is via silknotePatientUuid.
      const docToSave: MedicalDocument = { ...document, silknoteDocumentUuid: docDbUuid, silknotePatientUuid }; 

      const existingIndex = patient.fileSet.findIndex(d => d.silknoteDocumentUuid === docDbUuid);
      if (existingIndex > -1) {
        patient.fileSet[existingIndex] = docToSave;
      } else {
        patient.fileSet.push(docToSave);
      }
      // No need to re-assign patient to userPatients[silknotePatientUuid] as it's a reference modification
      await saveDatabase();
      return true;
    },

    async getDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<MedicalDocument | null> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] getDocument for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, clientFileId: ${clientFileId}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient || !patient.fileSet) return null;
      return patient.fileSet.find(doc => doc.clientFileId === clientFileId) || null;
    },

    async updateDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
      logger.info(`[LOCAL_DB] updateDocument for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, clientFileId: ${document.clientFileId}`);
      if (!document.silknoteDocumentUuid) {
        logger.error('[LOCAL_DB] updateDocument requires document.silknoteDocumentUuid for matching existing doc.');
        return false;
      }
      return this.saveDocument(silknoteUserUuid, silknotePatientUuid, document);
    },

    async deleteDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] deleteDocument for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, clientFileId: ${clientFileId}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient || !patient.fileSet) return false;
      
      const initialLength = patient.fileSet.length;
      patient.fileSet = patient.fileSet.filter(doc => doc.clientFileId !== clientFileId);
      if (patient.fileSet.length < initialLength) {
        await saveDatabase();
        return true;
      }
      return false;
    },

    async getDocumentsForPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<MedicalDocument[]> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] getDocumentsForPatient for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      return userPatients[silknotePatientUuid]?.fileSet || [];
    },

    async addDocumentToPatient(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
      logger.info(`[LOCAL_DB] addDocumentToPatient for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, clientFileId: ${document.clientFileId}`);
      if (!document.silknoteDocumentUuid) document.silknoteDocumentUuid = uuidv4();
      return this.saveDocument(silknoteUserUuid, silknotePatientUuid, document);
    },

    async savePatient(silknoteUserUuid: string, patientDetails: PatientDetails): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] savePatient for user ${silknoteUserUuid}, patientId: ${patientDetails.silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patientToSave: PatientDetails = { ...patientDetails, silknoteUserUuid }; 
      userPatients[patientDetails.silknotePatientUuid] = patientToSave;
      await saveDatabase();
      return true;
    },

    async getPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<PatientDetails | null> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] getPatient for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      return userPatients[silknotePatientUuid] || null;
    },

    async getAllPatients(silknoteUserUuid: string): Promise<PatientDetails[]> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] getAllPatients for user ${silknoteUserUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      return Object.values(userPatients);
    },

    async updatePatient(silknoteUserUuid: string, silknotePatientUuid: string, patientUpdates: Partial<PatientDetails>): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] updatePatient for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const existingPatient = userPatients[silknotePatientUuid];
      if (!existingPatient) {
         logger.warn(`[LOCAL_DB] updatePatient: Patient ${silknotePatientUuid} for user ${silknoteUserUuid} not found.`);
        return false;
      }
      userPatients[silknotePatientUuid] = { 
        ...existingPatient, 
        ...patientUpdates,
        silknotePatientUuid: silknotePatientUuid, 
        silknoteUserUuid: silknoteUserUuid,     
      };
      await saveDatabase();
      return true;
    },

    async deletePatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] deletePatient for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      if (userPatients[silknotePatientUuid]) {
        delete userPatients[silknotePatientUuid];
        await saveDatabase();
        return true;
      }
      return false;
    },

    async clearPatientCaseSummary(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] clearPatientCaseSummary for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient) return false;
      patient.caseSummary = null;
      patient.summaryGenerationCount = 0;
      await saveDatabase();
      return true;
    },

    async acknowledgeDocumentAlert(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] acknowledgeDocumentAlert for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, docUuid ${silknoteDocumentUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient || !patient.fileSet) return false;
      const docIndex = patient.fileSet.findIndex(d => d.silknoteDocumentUuid === silknoteDocumentUuid);
      if (docIndex === -1) return false;
      const doc = patient.fileSet[docIndex];
      let alertFoundAndUpdated = false;
      doc.alerts = (doc.alerts || []).map(alert => {
        if (alert.type === alertType && !alert.acknowledged) {
          alertFoundAndUpdated = true;
          return { ...alert, acknowledged: true, acknowledgedAt: new Date().toISOString() };
        }
        return alert;
      });
      if (alertFoundAndUpdated) {
        // No need to reassign patient.fileSet[docIndex] = doc; as doc is a reference to the object in the array
        await saveDatabase();
        return true;
      }
      return false;
    },

    async getQueuedDocuments(silknoteUserUuid: string, silknotePatientUuid: string, limit: number = 10): Promise<string[]> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] getQueuedDocuments for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient || !patient.fileSet) return [];
      return patient.fileSet
        .filter(doc => doc.status === 'queued')
        .sort((a, b) => new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime())
        .slice(0, limit)
        .map(doc => doc.clientFileId);
    },

    async setDocumentStatus(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, status: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] setDocumentStatus for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, docUuid ${silknoteDocumentUuid} to ${status}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient || !patient.fileSet) return false;
      const docIndex = patient.fileSet.findIndex(d => d.silknoteDocumentUuid === silknoteDocumentUuid);
      if (docIndex === -1) return false;
      patient.fileSet[docIndex].status = status;
      await saveDatabase();
      return true;
    },

    async resetProcessingDocuments(): Promise<number> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info('[LOCAL_DB] resetProcessingDocuments (global)');
      let count = 0;
      Object.values(localDb.users).forEach(userCollection => {
        Object.values(userCollection.patients).forEach(patient => {
          if (patient.fileSet) {
            patient.fileSet.forEach(doc => {
              if (doc.status === 'processing') {
                doc.status = 'queued';
                count++;
              }
            });
          }
        });
      });
      if (count > 0) await saveDatabase();
      return count;
    },

    async forceReprocessPatientDocuments(silknoteUserUuid: string, silknotePatientUuid: string): Promise<number> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] forceReprocessPatientDocuments for user ${silknoteUserUuid}, patient ${silknotePatientUuid}`);
      const userPatients = getUserPatientsCollection(silknoteUserUuid);
      const patient = userPatients[silknotePatientUuid];
      if (!patient || !patient.fileSet) return 0;
      let count = 0;
      patient.fileSet.forEach(doc => {
        doc.status = 'queued';
        count++;
      });
      if (count > 0) await saveDatabase(); // No need to reassign patient as its fileset was mutated directly
      return count;
    },

    async forceReprocessDocument(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string): Promise<boolean> {
      if (!isInitialized) throw new Error('Adapter not initialized');
      logger.info(`[LOCAL_DB] forceReprocessDocument for user ${silknoteUserUuid}, patient ${silknotePatientUuid}, docUuid ${silknoteDocumentUuid}`);
      return this.setDocumentStatus(silknoteUserUuid, silknotePatientUuid, silknoteDocumentUuid, 'queued');
    }
  };
}

function getUserPatients(silknoteUserUuid: string): { [patientUuid: string]: PatientDetails } {
    if (!localDb.users[silknoteUserUuid]) {
        localDb.users[silknoteUserUuid] = { patients: {} };
    }
    return localDb.users[silknoteUserUuid].patients;
} 