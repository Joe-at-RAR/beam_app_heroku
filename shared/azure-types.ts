import type { DocumentType, FacilityType } from './types';

// Azure Document Intelligence Types
export interface DocumentSpan {
  offset?: number;
  length?: number;
}

export interface DocumentPage {
  pageNumber?: number;
  width?: number;
  height?: number;
  unit?: string;
  words?: DocumentWord[];
  lines?: DocumentLine[];
  spans?: DocumentSpan[];
}

export interface DocumentWord {
  content?: string;
  confidence?: number;
  span?: DocumentSpan;
}

export interface DocumentLine {
  content?: string;
  spans?: DocumentSpan[];
}

export interface DocumentTable {
  rowCount?: number;
  columnCount?: number;
  cells?: DocumentTableCell[];
  spans?: DocumentSpan[];
}

export interface DocumentTableCell {
  kind?: string;
  rowIndex?: number;
  columnIndex?: number;
  rowSpan?: number;
  columnSpan?: number;
  content?: string;
  spans?: DocumentSpan[];
}

export interface DocumentKeyValuePair {
  key?: {
    content?: string;
    spans?: DocumentSpan[];
  };
  value?: {
    content?: string;
    spans?: DocumentSpan[];
  };
  confidence?: number;
}

export interface DocumentAnalysisResult {
  apiVersion?: string;
  modelId?: string;
  content?: string;
  pages?: DocumentPage[];
  tables?: DocumentTable[];
  keyValuePairs?: DocumentKeyValuePair[];
  languages?: string[];
}

// Azure OpenAI Types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: string;
}

export interface ChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Document Analysis Response Types
export interface DocumentAnalysisResponse {
  title?: string;
  type: DocumentType;
  confidence: number;
  author?: {
    name: string;
    role?: string;
  };
  facility?: {
    type: FacilityType;
    name?: string;
  };
  metadata: {
    date?: string;
    reference?: string;
    department?: string;
  };
  citationToVectorStoreFile?: Array<{
    id: string;
    type: string;
    confidence: number;
  }>;
  keywords: string[];
  entities: Array<{
    text: string;
    type: string;
    confidence: number;
  }>;
}
