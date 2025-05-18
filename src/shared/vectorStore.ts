// server/src/types/vectorStore.ts

import type { MedicalDocument } from '../shared/types';


// @shared/types.ts
export interface PatientVectorStore {
  assistantId: string
  vectorStoreIndex: string
  assistantCreatedAt: string
  assistantStatus: 'ready' | 'error'
  processedFiles: Array<{
    fileName: string
    fileId: string
    status: string
  }>
  lastUpdated: string
}

/**
 * Core vector store types for managing document embeddings and search
 */

export interface VectorMetadata {
  documentId: string;
  silknotePatientUuid: string;
  pageNumber: number;
  text: string;
  source: string;
  timestamp: string;
  confidence: number;
}

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: VectorMetadata;
}

export interface SearchResult {
  score: number;
  metadata: VectorMetadata;
  document: MedicalDocument;
}

export interface VectorSearchParams {
  query: string;
  silknotePatientUuid: string;
  limit?: number;
  threshold?: number;
}

export interface VectorSearchResponse {
  results: SearchResult[];
  timing: {
    vectorization: number;
    search: number;
    total: number;
  };
}

export interface VectorStoreError {
  code: VectorStoreErrorCode;
  message: string;
  details?: unknown;
}

export type VectorStoreErrorCode = 
  | 'INITIALIZATION_ERROR' 
  | 'STORAGE_ERROR' 
  | 'SEARCH_ERROR' 
  | 'EMBEDDING_ERROR'
  | 'INVALID_INPUT'
  | 'NOT_FOUND';

export interface VectorStoreConfig {
  dimensions: number;
  similarity: 'cosine' | 'euclidean' | 'dot';
  modelName: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Function signatures for vector store operations
 */

export interface VectorStoreOperations {
  initialize: (config: VectorStoreConfig) => Promise<void>;
  addDocument: (document: MedicalDocument) => Promise<void>;
  search: (params: VectorSearchParams) => Promise<VectorSearchResponse>;
  delete: (documentId: string) => Promise<void>;
  clear: (silknotePatientUuid: string) => Promise<void>;
}

/**
 * Storage interface for vector persistence
 */

export interface VectorStorePersistence {
  saveVectors: (silknotePatientUuid: string, vectors: VectorEntry[]) => Promise<void>;
  loadVectors: (silknotePatientUuid: string) => Promise<VectorEntry[]>;
  deleteVectors: (silknotePatientUuid: string) => Promise<void>;
}