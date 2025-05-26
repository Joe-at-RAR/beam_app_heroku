import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as patientService from './patientService';
import { io } from '../socket';
import { MedicalDocument, DocumentType, PatientDetails } from '../shared/types';
import { SupportedMimeType } from '../utils/handler-types';

interface ProcessingFile extends MedicalDocument {
  mimetype?: string;
  mimeType?: string;
  error?: string;
  metadata?: any;
}

// Generic interface for uploaded files that works with both Formidable and other uploaders
interface UploadedFile {
  // Formidable uses originalFilename, filepath
  // We'll handle both naming conventions
  originalFilename?: string;
  originalname?: string;
  filepath?: string;
  path?: string;
  mimetype?: string;
  type?: string;
  size: number;
  [key: string]: any; // Allow other properties
}

// Add FormidableFile interface
interface FormidableFile {
  newFilename: string;
  originalFilename: string;
  filepath: string;
  type: string;
  size: number;
}

// Interface for queued files with user context
interface QueuedFile {
  fileId: string;
  silknoteUserUuid: string;
  silknotePatientUuid: string;
}

export class FileProcessor {
  private static instance: FileProcessor;
  private processingQueue: QueuedFile[] = [];
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  // Map to track queued files by fileId for quick lookup
  private queuedFilesMap: Map<string, QueuedFile> = new Map();

  private constructor() {}

  public static getInstance(): FileProcessor {
    if (!FileProcessor.instance) {
      FileProcessor.instance = new FileProcessor();
    }
    return FileProcessor.instance;
  }

  // Process files in queue
  startProcessing = () => {
    this.processingInterval = setInterval(this.processQueuedFile, 5000);
  }

  processQueuedFiles = async (patient: PatientDetails, silknoteUserUuid: string) => {
    const timestamp = new Date().toISOString();
    const unprocessedFiles = patient.fileSet.filter((file: MedicalDocument) => 
      file.status === 'unprocessed' && file.category === DocumentType.UNPROCESSED);
    
    console.log(`[${timestamp}] [FILE PROCESSOR] Found ${unprocessedFiles.length} unprocessed files for patient ${patient.silknotePatientUuid}`);
    
    // Queue each unprocessed file with user context
    for (const file of unprocessedFiles) {
      this.addToQueue(file.clientFileId, silknoteUserUuid, patient.silknotePatientUuid);
    }
  }

  // Handle local processing queue  
  processQueuedFile = async () => {
    if (this.isProcessing || this.processingQueue.length === 0) return;
      
    // Get the first queued file with its context
    const queuedFile = this.processingQueue[0];
    
    try {
      this.isProcessing = true;
      console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] Starting to process file: ${queuedFile.fileId} for user: ${queuedFile.silknoteUserUuid}`);

      // Get the patient directly using the stored context
      const patient = await patientService.getPatientById(queuedFile.silknotePatientUuid, queuedFile.silknoteUserUuid);
      if (!patient) {
        throw new Error(`Patient ${queuedFile.silknotePatientUuid} not found for user ${queuedFile.silknoteUserUuid}`);
      }

      // Find the file in the patient's fileSet
      const file = patient.fileSet.find((f: MedicalDocument) => f.clientFileId === queuedFile.fileId);
      if (!file) {
        throw new Error(`File ${queuedFile.fileId} not found in patient ${queuedFile.silknotePatientUuid}`);
      }

      // Update status to queued
      console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] Updating file ${queuedFile.fileId} status to queued`);
      file.status = 'queued';
      await patientService.updatePatient(patient);

      // Process the file with user context
      await processUnprocessedFiles(queuedFile.silknotePatientUuid, queuedFile.silknoteUserUuid);

    } catch (error) {
      console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] Error processing file ${queuedFile.fileId}:`, error);
    } finally {
      // Remove from queue and map
      this.processingQueue.shift();
      this.queuedFilesMap.delete(queuedFile.fileId);
      this.isProcessing = false;
      console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] Completed processing file: ${queuedFile.fileId}`);
      
      // Check if there are more files to process
      if (this.processingQueue.length > 0) {
        console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] ${this.processingQueue.length} files remaining in queue`);
        await this.processQueuedFile();
      }
    }
  }

  public addToQueue(fileId: string, silknoteUserUuid: string, silknotePatientUuid: string) {
    // Check if file is already queued
    if (this.queuedFilesMap.has(fileId)) {
      console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] File ${fileId} already in queue`);
      return;
    }
    
    const queuedFile: QueuedFile = {
      fileId,
      silknoteUserUuid,
      silknotePatientUuid
    };
    
    this.processingQueue.push(queuedFile);
    this.queuedFilesMap.set(fileId, queuedFile);
    console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] Added file ${fileId} to processing queue for user ${silknoteUserUuid}`);
  }

  public stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      console.log(`[${new Date().toISOString()}] [FILE PROCESSOR] Stopped monitoring for unprocessed files`);
    }
  }
}

// Initialize the singleton
const fileProcessor = FileProcessor.getInstance();

// In-memory file store for demonstration purposes
const fileDB: Map<string, any> = new Map();

export function createFileMetadata(silknotePatientUuid: string, file: UploadedFile, silknoteUserUuid: string): ProcessingFile {
  const fileId = crypto.randomUUID();
  
  // Handle different property naming conventions between Formidable and Multer
  const filename = (file as any)['filename'] || (file as FormidableFile).newFilename || 'unknown';
  const originalName = (file as any)['originalname'] || (file as FormidableFile).originalFilename || filename;
  const filePath = (file as any)['path'] || (file as FormidableFile).filepath || '';
  const mimeType = (file as any)['mimetype'] || (file as FormidableFile).type || 'application/pdf';
  
  const metadata: ProcessingFile = {
    clientFileId: fileId,
    silknotePatientUuid,
    filename,
    originalName,
    storedPath: filePath,
    hash: '',
    status: 'unprocessed',
    category: DocumentType.UNPROCESSED,
    uploadDate: new Date().toISOString(),
    type: mimeType as SupportedMimeType,
    size: file.size,
    title: filename,
    format: {
      mimeType: mimeType,
      extension: filename.split('.').pop() || ''
    },
    fileSize: file.size,
    pageCount: 0,
    documentDate: '',
    processedAt: '',
    author: '',
    sourceSystem: '',
    originalFilename: originalName,
    personIsAuthorOfDocument: false,
    authorTitle: '',
    authorFirstName: '',
    authorFamilyName: '',
    authorOrganization: '',
    content: {
      analysisResult: null,
      extractedSchemas: [],
      enrichedSchemas: [],
      pageImages: []
    },
    confidence: 0,
    mimetype: mimeType
  };

  fileDB.set(fileId, metadata);
  console.log(`[${new Date().toISOString()}] [FILE SERVICE] Created file metadata for ${fileId}`);
  // Add to queue with user context
  fileProcessor.addToQueue(fileId, silknoteUserUuid, silknotePatientUuid);
  console.log(`[${new Date().toISOString()}] [FILE SERVICE] Added file ${fileId} to processing queue`);
  return metadata;
}

export async function processUnprocessedFiles(silknotePatientUuid: string, silknoteUserUuid: string) {
  try {
    // Use the provided user context
    const patient = await patientService.getPatientById(silknotePatientUuid, silknoteUserUuid);
    if (!patient) {
      console.log(`No patient found with ID ${silknotePatientUuid} for user ${silknoteUserUuid}`);
      return;
    }

    // Find all unprocessed files
    const unprocessedFiles = patient.fileSet.filter((file: MedicalDocument) => file.status === 'unprocessed');
    
    if (unprocessedFiles.length === 0) {
      console.log(`No unprocessed files found for patient ${silknotePatientUuid}`);
      return;
    }
    
    console.log(`Found ${unprocessedFiles.length} unprocessed files for patient ${silknotePatientUuid}`);
    emitProcessingStart(silknotePatientUuid, unprocessedFiles.map(f => f.clientFileId));
    
    // Add files to the queue for processing with user context
    for (const file of unprocessedFiles) {
      FileProcessor.getInstance().addToQueue(file.clientFileId, silknoteUserUuid, silknotePatientUuid);
    }
  } catch (error) {
    console.log(`Error processing files for patient ${silknotePatientUuid}:`, error);
  }
}

export async function getFileById(fileId: string): Promise<any> {
  return fileDB.get(fileId);
}

export async function deleteFile(fileId: string): Promise<void> {
  const file = await getFileById(fileId);
  if (!file) {
    throw new Error('File not found');
  }
  // Delete the main file
  fs.unlinkSync(path.resolve(file.storedPath));
  // Delete associated thumbnails if any
  if (file.thumbnailPaths && Array.isArray(file.thumbnailPaths)) {
    file.thumbnailPaths.forEach((thumbPath: string) => {
      fs.unlinkSync(path.resolve(thumbPath));
    });
  }
  fileDB.delete(fileId);
  
  // Emit fileDeleted event after deletion
  emitFileDeleted(file.silknotePatientUuid, fileId);
}

// For demonstration, a method to add/create file entry in fileDB
export function addFile(file: any): void {
  fileDB.set(file.clientFileId, file);
}

// Helper function to emit to the correct patient room
function emitToPatientRoom(silknotePatientUuid: string, event: string, data: any) {
  if (!io) {
    console.log(`[FILE SERVICE] Socket.io not available, can't emit ${event}`);
    return;
  }
  
  const roomName = `patient-${silknotePatientUuid}`;
  console.log(`[FILE SERVICE] Emitting ${event} to room ${roomName}:`, data);
  io.to(roomName).emit(event, data);
}

export function emitFileStatus(silknotePatientUuid: string, fileId: string, status: string, additionalData: object = {}) {
  emitToPatientRoom(silknotePatientUuid, "fileStatus", { clientFileId: fileId, status, ...additionalData });
}

export function emitProcessingStart(silknotePatientUuid: string, fileIds: string[]) {
  emitToPatientRoom(silknotePatientUuid, "processingStart", { silknotePatientUuid, fileIds });
}

export function emitProcessingComplete(silknotePatientUuid: string, processedCount: number) {
  emitToPatientRoom(silknotePatientUuid, "processingComplete", { silknotePatientUuid, processedCount });
}

export function emitFileDeleted(silknotePatientUuid: string, fileId: string) {
  emitToPatientRoom(silknotePatientUuid, "fileDeleted", { fileId });
}

// This function is intended for direct, ad-hoc processing outside the queue system.
export async function processFileDirectly(_patientId: string, _fileId: string): Promise<void> {
  // Placeholder for direct processing logic
  // Example: const document = await storageService.getDocument(fileId);
  // ... existing code ...
}
