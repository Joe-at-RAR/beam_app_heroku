import {
    MedicalDocument,
    BaseDocIntelResult,
    BaseLLMResult,
    DocumentType
} from '@shared/types';
import { Readable } from 'stream';
import { z } from 'zod'
import { documentSchemas } from '../types/schemas';
import type { DocumentPage } from '@shared/azure-types';
import type { PatientDetails } from '@shared/types';

export interface DocumentHandler {
    canHandle(mimeType: string): boolean;
    convertToPDF(input: Buffer | Readable): Promise<Buffer>;
}

export interface ProcessedAnalysisResult {
    content: {
        text: string;
        pages?: any[];
    };
    metadata: {
        id: string;
        format: {
            mimeType: string;
            extension: string;
        };
    };
    confidence: number;
    metrics: StageMetrics;
}

// These extend the base types with processing-specific info
export interface DocumentIntelligenceResult extends BaseDocIntelResult {
    stage?: ProcessingStage.DOCUMENT_INTELLIGENCE;
    stageMetrics?: StageMetrics;
}

export interface LLMProcessingResult extends BaseLLMResult {
    stage?: ProcessingStage.LLM_PROCESSING;
    stageMetrics?: StageMetrics;
}

export enum ProcessingStage {
    PREPROCESSING = "PREPROCESSING",
    DOCUMENT_INTELLIGENCE = "DOCUMENT_INTELLIGENCE",
    LLM_PROCESSING = "LLM_PROCESSING",
    RESULT_GENERATION = "RESULT_GENERATION"
}

export interface StageMetrics {
    startTime: Date;
    endTime: Date;
    duration: number;
    confidence: number;
    errors: string[];
    warnings: string[];
    metrics: Record<string, any>;
}

export interface ProcessingStageResult<T> {
    success: boolean;
    data: T | null;
    metrics: StageMetrics;
    subStages?: Record<string, StageMetrics>;
}



export interface ProcessingContext {
    startTime: Date;
    metrics: Record<string, unknown>;
    errors: string[];
    warnings: string[];
}

export interface ProcessingOptions {
    confidenceThreshold?: number;
    enhancementMode?: 'selective' | 'full';
    maxRetries?: number;
    retryAttempts?: number;
    maxParallelProcessing?: number;
    password?: string;
    globalPassword?: string;
    fileImages?: Buffer[];
}

export interface ProcessingResult {
    success: boolean;
    data?: MedicalDocument;
    error?: string;
    metrics?: {
        stages: Record<ProcessingStage, StageMetrics>;
        totalDuration: number;
        overallConfidence: number;
    };
}

// Helper type for stage initialization
export const createStageMetrics = (): StageMetrics => ({
    startTime: new Date(),
    endTime: new Date(),
    duration: 0,
    confidence: 0,
    errors: [],
    warnings: [],
    metrics: {}
});

// Helper type for stage result creation
export const createStageResult = <T>(
    success: boolean,
    data: T | null,
    metrics: StageMetrics
): ProcessingStageResult<T> => ({
    success,
    data,
    metrics
});


////////////////////////////////////////
// Document Type Mappings
////////////////////////////////////////
// documentTypeMapping.ts



/* // Commented out as unused
interface DocumentTypeMapping {
    pattern: RegExp | string;
    type: DocumentType;
    confidence: number;
}
*/

export interface TypeMatchResult {
    type: DocumentType;
    confidence: number;
    matchedPattern?: string;
    matchedTerms?: string[];
}

// Comprehensive mapping dictionary



// Aggregated Document Schema – a union of all specialized schemas with all fields optional.
export type AggregatedDocumentSchema =
  Partial<z.infer<typeof documentSchemas.MEDICAL_REPORT>> &
  Partial<z.infer<typeof documentSchemas.CLINICAL_NOTES>> &
  Partial<z.infer<typeof documentSchemas.IMAGING_REPORT>> &
  Partial<z.infer<typeof documentSchemas.REHABILITATION_REPORT>> &
  Partial<z.infer<typeof documentSchemas.WORKCOVER_CERTIFICATE>> &
  Partial<z.infer<typeof documentSchemas.INSURANCE_FORM>> &
  Partial<z.infer<typeof documentSchemas.LEGAL_CORRESPONDENCE>> &
  Partial<z.infer<typeof documentSchemas.EMPLOYMENT_DOCUMENT>> &
  Partial<z.infer<typeof documentSchemas.ALLIED_HEALTH_REPORT>> &
  Partial<z.infer<typeof documentSchemas.HOSPITAL_DOCUMENT>> &
  Partial<z.infer<typeof documentSchemas.UNKNOWN>>;

// Extended Document Page – extends Azure's DocumentPage type by adding a thumbnail and an optional schemaData property
export interface ExtendedDocumentPage extends DocumentPage {
  thumbnail: Buffer;
  schemaData?: AggregatedDocumentSchema;
}

// ProcessedFile – the complete result for a processed file
export interface ProcessedFile {
  originalFile: Buffer;
  patientDetails: PatientDetails;
  analyzedDocument: any; // Replace with your precise Azure AnalyzedDocument type, if available
  pages: ExtendedDocumentPage[];
  aggregatedSchema: AggregatedDocumentSchema;
  processingMetrics: StageMetrics;
}



// Define our processing result types
