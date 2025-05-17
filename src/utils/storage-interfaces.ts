import { MedicalDocument, PatientDetails, DocumentAlertType } from '@shared/types';
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
 * Defines operations needed for database storage
 */
export interface DatabaseAdapter {
  initialize(): Promise<{ success: boolean; errors: StorageError[] }>;
  
  // Document operations
  saveDocument(document: MedicalDocument): Promise<boolean>;
  getDocument(documentId: string): Promise<MedicalDocument | null>;
  updateDocument(document: MedicalDocument): Promise<boolean>;
  deleteDocument(documentId: string): Promise<boolean>;
  
  // Patient operations - Use PatientDetails consistently
  savePatient(patient: PatientDetails): Promise<boolean>;
  getPatient(silknotePatientUuid: string): Promise<PatientDetails | null>;
  getAllPatients(): Promise<PatientDetails[]>;
  updatePatient(patient: Partial<PatientDetails>): Promise<boolean>;
  deletePatient(silknotePatientUuid: string): Promise<boolean>;
  clearPatientCaseSummary(silknotePatientUuid: string): Promise<boolean>;
  
  // Relationship operations
  addDocumentToPatient(silknotePatientUuid: string, document: MedicalDocument): Promise<boolean>;
  getDocumentsForPatient(silknotePatientUuid: string): Promise<MedicalDocument[]>;
  
  // Alert Method
  acknowledgeDocumentAlert(silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean>;

  // Queue/VSRX methods (if applicable)
  getQueuedDocuments?(limit?: number): Promise<string[]>;
  setDocumentStatus?(silknoteDocumentUuid: string, status: string): Promise<boolean>;
  resetProcessingDocuments?(): Promise<number>;
  forceReprocessPatientDocuments?(silknotePatientUuid: string): Promise<number>;
  forceReprocessDocument?(silknoteDocumentUuid: string): Promise<boolean>;
} 