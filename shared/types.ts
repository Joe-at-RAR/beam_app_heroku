import type { DocumentAnalysisResult } from './azure-types';
import { 
  AnalyzeResult 
} from '@azure/ai-form-recognizer';
import { PatientVectorStore } from './vectorStore';
import { CaseSummaryType } from './case-summary-types';


export interface UserDetails {
  silknoteUserUuid: string;
  name: string;
  role: string;
} 

export interface BaseDocIntelResult {
  content: string;
  confidence: number;
  metadata: MedicalDocument;
  pages?: any[]; // Define proper page structure
}

export interface BaseLLMResult {
  text: string;
  confidence: number;
  enhancedContent?: string;
  entities?: any[]; // Define proper entity structure
}

// Add DocumentAlertType enum
export enum DocumentAlertType {
  ERROR = 'ERROR',
  ALERT = 'ALERT',
  DELAYED = 'DELAYED',
  INCORRECT_PATIENT = 'INCORRECT_PATIENT'
}

export interface DocumentAlert {
  type: DocumentAlertType | 'ERROR' | 'ALERT' // Support both enum and string for backward compatibility
  description: string
  source: 'SERVER_WS' | 'SERVER_API_CALL' | 'CLIENT'
  timestamp: string
  acknowledged?: boolean
}

export interface MedicalDocument {
  clientFileId: string;          // Unique ID for the client context
  silknoteDocumentUuid?: string; // Consistent DB UUID for the document
  silknotePatientUuid: string;             // Holds the silknotePatientUuid of the owning patient/fileset
  originalName: string
  storedPath: string
  status: string
  category: DocumentType
  uploadDate: string
  type: string
  size: number
  title: string
  format: {
    mimeType: string
    extension: string
  }
  fileSize: number
  hash?: string
  pageCount?: number
  documentDate?: string | null
  processedAt?: string
  author?: string
  sourceSystem?: string
  filename: string
  originalFilename?: string
  personIsAuthorOfDocument?: boolean
  authorTitle?: string
  authorFirstName?: string
  authorFamilyName?: string
  authorOrganization?: string
  content: {
    analysisResult: AnalyzeResult | null
    extractedSchemas: any[]
    enrichedSchemas: any[]
    pageImages: string[]
    data?: ArrayBuffer
  }
  alerts?: DocumentAlert[]
  confidence: number
  isIncorrectPatient?: boolean
  detectedPatientInfo?: {
    name?: string
    dateOfBirth?: string
  }
  insurerRequestForIME?: {
    referenceNumber?: string
    addressedTo?: string
    questions: {
      questionNumber: number
      questionText: string
      responseText?: string
    }[]
  }
  patientConsentForInsurerRelease?: {
    patientSigned: boolean
    patientSignedOnDate?: string
  }
  rawExtractionData?: any;
}

export interface AnalyzerInput {
  documentId: string;  // Keep as is for backward compatibility but this should be clientFileId
  buffer: Buffer;
  patientContext?: PatientDetails;
  options?: {
    confidenceThreshold?: number;
    enhancementRequired?: boolean;
  };
}


// Add this enum
export enum DocumentType {
  MEDICAL_REPORT = 'MEDICAL_REPORT',
  CLINICAL_NOTES = 'CLINICAL_NOTES',
  IMAGING_REPORT = 'IMAGING_REPORT',
  REHABILITATION_REPORT = 'REHABILITATION_REPORT',
  WORKCOVER_CERTIFICATE = 'WORKCOVER_CERTIFICATE',
  INSURANCE_FORM = 'INSURANCE_FORM',
  LEGAL_CORRESPONDENCE = 'LEGAL_CORRESPONDENCE',
  EMPLOYMENT_DOCUMENT = 'EMPLOYMENT_DOCUMENT',
  ALLIED_HEALTH_REPORT = 'ALLIED_HEALTH_REPORT',
  HOSPITAL_DOCUMENT = 'HOSPITAL_DOCUMENT',
  CONSENT_FORM = 'CONSENT_FORM',
  UNPROCESSED = 'UNPROCESSED',
  UNKNOWN = 'UNKNOWN',
  INSURER_IME_REQUEST = 'INSURER_IME_REQUEST',
  PATIENT_CONSENT = 'PATIENT_CONSENT'
}

// The rest of your existing types.ts content remains the same
export enum FacilityType {
  HOSPITAL = 'hospital',
  CLINIC = 'clinic',
  LABORATORY = 'laboratory',
  PHARMACY = 'pharmacy',
  OTHER = 'other'
}


// Processing Results
export interface ProcessingOptions {
  password?: string;
  globalPassword?: string;
  fileImages?: Buffer[];
  maxRetries?: number;
  timeout?: number;
}



// Patient Details - Represents the logical patient entity in the application
export interface PatientDetails { 
  silknotePatientUuid: string;  // Non-optional consistent UUID for this patient/fileset
  name: string;
  dateOfBirth: string;           
  gender: string;                
  silknoteUserUuid: string;      // Consistent UUID of the owning User
  fileSet: MedicalDocument[];    
  vectorStore: PatientVectorStore | null; 
  caseSummary: CaseSummaryApiResponse | null; 
  summaryGenerationCount?: number;
}

// File Handling
export interface FileWithPassword {
  file: File;
  password?: string;
  isEncrypted: boolean;
  decryptionStatus?: 'pending' | 'success' | 'failed';
  selected: boolean;
  size?: number
}

export interface DocumentContent {
  clientFileId?: string;  // Changed from id
  analysisResult?: AnalyzeResult | null
  extractedSchemas?: any[];
  enrichedSchemas?: EnrichedExtraction[];
  pageImages?: string[];
  loading?: boolean;
  summary?: string;
  password?: string;
  url?: string;
  data?: ArrayBuffer;
  fileSize?: number;
}

export interface AnalyzerOutput {
  success: boolean;
  document?: MedicalDocument;
  confidence: number;
  documentType: DocumentType;
  error?: string;

}

export interface DocumentValidation {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  missingFields: string[];
}

export interface DocumentRelationships {
  references: string[];
  relatedDocuments: {
    clientFileId: string;  // Changed from documentId
    relationship: string;
    strength: number;
  }[];
}

export interface SecurityMetadata {
  classification: string;
  accessLevel: string;
  encryptionStatus: 'decrypted' | 'encrypted' | 'not_encrypted';
  encryptionDetails?: {
    algorithm?: string;
    strength?: number;
  };
}

export interface DocumentMetrics {
  processingTime: number;
  confidenceScores: {
    overall: number;
    text: number;
    structure: number;
    classification: number;
  };
  qualityMetrics: {
    completeness: number;
  };
}

export interface DocumentAnalysis {
  keywords: string[];
  entities: {
    text: string;
    type: string;
    confidence: number;
  }[];
}

export interface ProcessingTimestamps {
  received: Date;
  started: Date;
  completed?: Date;
}

export interface ValidationError {
  code: string;
  message: string;
  severity: 'critical' | 'warning';
}

export interface ValidationWarning extends ValidationError {
  overrideAllowed: boolean;
}

// Query Types
export interface QueryRequest {
  query: string;
  clientFileIds: string[];  // Changed from documentIds
  context?: {
    maxResults?: number;
    minConfidence?: number;
  };
}

export interface QueryResponse {
  response: string;
  citations: Citation[];
  confidence: number;
  metadata: QueryMetadata;
}

export interface Citation {
  clientFileId: string;  // Changed from documentId
  pageNumber: number;
  text: string;
  confidence: number;
}

export interface QueryMetadata {
  timestamp: string;
}




// Request Processing Types
export type RequestProcessingStage = 'conversion' | 'analysis' | 'validation';

export interface RequestProcessingError {
  stage: RequestProcessingStage;
  reason: string;
}



export interface FileProcessingSuccess {
  success: true;
  data: MedicalDocument;
  filename: string;
}

export interface FileProcessingFailure {
  success: false;
  filename: string;
  error: string;
  details: RequestProcessingError;
}

export type FileProcessingResult = FileProcessingSuccess | FileProcessingFailure;

/**
 * Represents the location (bounding box) where a specific piece of text was found.
 */
export interface EnrichedExtractionPosition {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pageNumber: number;
  confidence: number;
}

/**
 * Represents a single enriched field.
 * The value holds the original extracted text, and positions (if present)
 * provide all the locations where that same text was found.
 */
export interface EnrichedField {
  value: string;
  positions?: EnrichedExtractionPosition[];
}

/**
 * A recursive type that allows the enriched extraction results to mirror the structure
 * of the LLM output while attaching positional data.
 *
 * Each property in an enriched extraction can be:
 * - A simple EnrichedField (if the value is a string)
 * - A nested object where every property similarly follows the enriched pattern
 * - An array of either EnrichedField or further nested EnrichedExtraction items
 */
export type EnrichedExtraction =
  | EnrichedField
  | { [key: string]: EnrichedExtraction }
  | EnrichedExtraction[]
  | null;

/**
 * The content structure for the final analyzed medical document.
 * This fully replaces any previous reliance on ExtractedSchema with our new enriched definition.
 *
 * - analysisResult: The original raw output from Azure Document Intelligence.
 * - extractedSchemas: The original extraction output (derived from your new LLM schema).  
 *   (Currently typed as any[] but can be refined later as needed.)
 * - enrichedSchemas: The enriched extraction where each textual element is augmented with coordinates.
 * - pageImages: An array containing page images (e.g. as URLs or base64 strings, as required by your UI).
 */
export interface AnalyzedDocumentContent {
  analysisResult: DocumentAnalysisResult;
  extractedSchemas: any[]; // Use a more concrete type in the future if you wish to refactor the raw LLM extraction.
  enrichedSchemas: EnrichedExtraction[];
  pageImages: string[]; // Change to Buffer[] if you're storing images as buffers.
}

// // Socket Event Types
// export interface MedicalDocument {
//   fileId: string;
//   silknotePatientUuid: string;
//   filename: string;
//   size: number;
//   type: string;
//   pageCount?: number;
//   documentDate?: string;
//   processedAt?: string;
//   author?: string;
//   sourceSystem?: string;
//   originalFilename?: string;
//   content: AnalyzedDocumentContent;
// }

export interface FileStatusUpdate {
  clientFileId: string  // Changed from fileId to clientFileId
  silknotePatientUuid: string
  status: string
  processingStage?: string  // Renamed from stage
  message?: string
  details?: unknown
}

export interface ProcessingComplete {
  clientFileId: string
  silknotePatientUuid: string
  status: string
  processingStage: string // Renamed from stage
  medicalDocument: MedicalDocument
}

/**
 * Defines the full structure returned by the case summary generation/retrieval API endpoints.
 */
export interface CaseSummaryApiResponse {
  summary: CaseSummaryType; // The core summary data
  citations: SummaryCitation[]; // Array of citation objects
  summaryGenerationCount: number; // Current count of summary generations
  maxCount: number; // Maximum allowed generations
}

// Document Upload Types
export interface DocumentUploadOptions {
  // ... existing code ...
}

// Copied from server/src/services/vectorStore.ts
export interface SummaryCitation {
  documentId: string;
  documentName: string;
  pageNumber: number;
  startIndex?: number;
  endIndex?: number;
  markerId?: string; // Added for embedding
  originalAnnotationText?: string; // Store the original marker text for replacement
}


