import { MedicalDocument } from '@shared/types';
import { SocketErrorCode } from '../middleware/error-handler';
import { DisconnectReason } from 'socket.io';

/**
 * Server -> Client Events
 */
export interface ServerToClientEvents {
  // Connection events
  'connect': () => void;
  'disconnect': (reason: DisconnectReason) => void;
  'disconnect_info': (data: DisconnectInfo) => void;
  'processingStart': (data: ProcessingStartEvent) => void;

  // Error events
  'error': (error: ErrorEvent) => void;

  // File processing events
  'fileAdded': (data: MedicalDocument) => void;
  'fileStatus': (data: FileStatusEvent) => void;
  'processingComplete': (data: ProcessingCompleteEvent) => void;
  'fileDeleted': (data: FileDeletedEvent) => void;

  // Processing stage events
  'processingStage': (data: ProcessingStageEvent) => void;
  'analysisProgress': (data: AnalysisProgressEvent) => void;
}

/**
 * Client -> Server Events
 */
export interface ClientToServerEvents {
  // Room events
  'joinPatientRoom': (silknotePatientUuid: string) => void;
  'leavePatientRoom': (silknotePatientUuid: string) => void;

  // File events
  'addFile': (data: AddFileRequest) => void;
  'deleteFile': (data: DeleteFileRequest) => void;
  'requestFileStatus': (fileId: string) => void;
}

/**
 * Socket data interface
 */
export interface SocketData {
  user?: {
    id: string;
    role: string;
  };
}

/**
 * Event payloads
 */

export interface DisconnectInfo {
  code: SocketErrorCode;
  message: string;
  reason: DisconnectReason;
}

export interface ErrorEvent {
  code: SocketErrorCode;
  message: string;
  data?: unknown;
}

export interface ProcessingStartEvent {
  fileId?: string;
  fileIds?: string[];
  silknotePatientUuid?: string;
  timestamp?: string;
}


export interface FileStatusEvent {
  fileId: string;
  silknotePatientUuid?: string;
  status: FileProcessingStatus | string;
  progress?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessingCompleteEvent {
  fileId?: string;
  silknotePatientUuid?: string;
  result?: ProcessingResult;
  duration?: number;
  processedCount?: number;
  failedCount?: number;
}

export interface FileDeletedEvent {
  fileId: string;
  silknotePatientUuid?: string;
  deletedAt?: string;
}

export interface ProcessingStageEvent {
  fileId: string;
  silknotePatientUuid?: string;
  stage: ProcessingStage | string;
  progress: number | string;
  details?: string;
  timestamp?: string;
}

export interface AnalysisProgressEvent {
  fileId?: string;
  silknotePatientUuid?: string;
  analysisType?: AnalysisType;
  progress?: number | string;
  step?: string;
  details?: string;
  timestamp?: string;
  results?: unknown;
}

export interface AddFileRequest {
  silknotePatientUuid: string;
  file: {
    name: string;
    size: number;
    type: string;
  };
}

export interface DeleteFileRequest {
  fileId: string;
  silknotePatientUuid?: string;
}

/**
 * Enums
 */

export enum FileProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ERROR = 'error'
}

export enum ProcessingStage {
  UPLOAD = 'upload',
  VALIDATION = 'validation',
  CONVERSION = 'conversion',
  PROCESSING = 'processing',
  ANALYSIS = 'analysis',
  CATEGORIZATION = 'categorization',
  STORAGE = 'storage'
}

export enum AnalysisType {
  TEXT_EXTRACTION = 'text-extraction',
  SCHEMA_MAPPING = 'schema-mapping',
  METADATA_EXTRACTION = 'metadata-extraction'
}

export interface ProcessingResult {
  success: boolean;
  data?: {
    text?: string;
    metadata?: Record<string, unknown>;
    schema?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Type guards
 */

export function isFileAddedEvent(data: unknown): data is MedicalDocument {
  return (
    typeof data === 'object' &&
    data !== null &&
    (
      'fileId' in data ||
      'id' in data ||
      'metadata' in data
    )
  );
}

export function isFileStatusEvent(data: unknown): data is FileStatusEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'fileId' in data &&
    'status' in data
  );
}

export function isProcessingCompleteEvent(data: unknown): data is ProcessingCompleteEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    (
      'fileId' in data ||
      'silknotePatientUuid' in data ||
      'processedCount' in data
    )
  );
}

export function isProcessingStageEvent(data: unknown): data is ProcessingStageEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'fileId' in data &&
    'stage' in data &&
    'progress' in data
  );
}

export function isAnalysisProgressEvent(data: unknown): data is AnalysisProgressEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'fileId' in data &&
    (
      'analysisType' in data ||
      'step' in data
    ) &&
    'progress' in data
  );
}

// Re-export Socket.IO's DisconnectReason type
export type { DisconnectReason as SocketDisconnectReason };

// Export SocketError type
export interface SocketError extends Error {
  code?: string;
  data?: unknown;
}
