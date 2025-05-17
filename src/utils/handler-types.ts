// handler-types.ts
import { Readable } from 'stream';

export interface HandlerResult {
  success: boolean;
  data?: Buffer;
  error?: string;
}

export interface HandlerOptions {
  maxFileSize?: number;
  tempDir?: string;
  password?: string;
}

export interface HandlerMetrics {
  startTime: Date;
  endTime: Date;
  duration: number;
}

export const PDF_MIME_TYPES = ['application/pdf'] as const;
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp'
] as const;
export const OFFICE_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf'
] as const;

export type PDFMimeType = typeof PDF_MIME_TYPES[number];
export type ImageMimeType = typeof IMAGE_MIME_TYPES[number];
export type OfficeMimeType = typeof OFFICE_MIME_TYPES[number];
export type SupportedMimeType = PDFMimeType | ImageMimeType | OfficeMimeType;

export type HandlerInput = Buffer | Readable;