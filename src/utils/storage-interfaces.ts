import { MedicalDocument, PatientDetails, DocumentAlertType } from '../shared/types';
import { RequestHandler } from 'express';

/**
 * Error interface for storage operations
 */
export interface StorageError {
  code: string;
  message: string;
  path?: string;
}

/**
 * File Storage Adapter Interface
 * Defines operations needed for file storage (local, S3, etc.)
 */
export interface FileStorageAdapter {
  initialize(basePath?: string): Promise<{ success: boolean; errors: StorageError[] }>;
  storeFile(fileBuffer: Buffer, filename: string): Promise<string>;
  getFileContent(fileRef: string): Promise<Buffer>;
  deleteFile(fileRef: string): Promise<boolean>;
  finalizeUploadedFile(tempPath: string, finalName: string): Promise<string>;
  createPdfUploadMiddleware(tempDir: string): RequestHandler;
  getPdfPageCount?(fileRefOrPath: string): Promise<number>;
}

/**
 * Database Adapter Interface
 * Defines operations needed for database storage.
 * All methods that access or modify patient-specific data or user-specific data
 * must include silknoteUserUuid and silknotePatientUuid for scoped access.
 * Document-specific operations also require a document identifier (clientFileId or silknoteDocumentUuid).
 */
export interface DatabaseAdapter {
  initialize(): Promise<{ success: boolean; errors: StorageError[] }>;
  
  // Document operations scoped by user and patient
  // 'documentId' here typically refers to clientFileId for fetch/delete, 
  // or is part of the MedicalDocument object for save/update.
  saveDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean>;
  getDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<MedicalDocument | null>;
  updateDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean>;
  deleteDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<boolean>;
  getDocumentsForPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<MedicalDocument[]>;
  addDocumentToPatient(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean>;
  
  // Patient operations scoped by user (owner/accessor)
  // 'patientDetails' includes the silknotePatientUuid for save/update.
  savePatient(silknoteUserUuid: string, patientDetails: PatientDetails): Promise<boolean>; // userUuid is the owner
  getPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<PatientDetails | null>;
  updatePatient(silknoteUserUuid: string, silknotePatientUuid: string, patientUpdates: Partial<PatientDetails>): Promise<boolean>;
  deletePatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean>;
  clearPatientCaseSummary(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean>;

  // Alert Method - scoped by user, patient, and specific document (using its DB UUID)
  acknowledgeDocumentAlert(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean>;

  // Vector Store validation and error handling methods
  getPatientVectorStore?(silknoteUserUuid: string, silknotePatientUuid: string): Promise<any | null>;
  updatePatientVectorStoreErrors?(silknoteUserUuid: string, silknotePatientUuid: string, errors: any[]): Promise<boolean>;
  validateVectorStoreSync?(silknoteUserUuid: string, silknotePatientUuid: string): Promise<{ isValid: boolean; missingFiles: string[]; errors: any[] }>;

  // Queue/VSRX methods - scoping to be determined by their exact function.
  // If they list or modify documents, they need scoping.
  // If truly global admin functions, they might not. For now, let's assume scoping if data is not global.
  getQueuedDocuments?(silknoteUserUuid: string, silknotePatientUuid: string, limit?: number): Promise<string[]>; // Example: get queued docs for a specific patient
  setDocumentStatus?(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, status: string): Promise<boolean>;
  resetProcessingDocuments?(): Promise<number>; // Potentially global admin task, may not need scoping here unless resetting for a specific user/patient.
  forceReprocessPatientDocuments?(silknoteUserUuid: string, silknotePatientUuid: string): Promise<number>;
  forceReprocessDocument?(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string): Promise<boolean>;
} 