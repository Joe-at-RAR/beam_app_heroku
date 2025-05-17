/**
 * Document Handler System
 * 
 * Purpose:
 * Converts various document types into PDF format for further processing.
 * 
 * Input:
 * - Buffer or Readable Stream containing document data
 * - Strictly typed MIME type identifying the document type
 * - Optional configuration (password for encrypted PDFs, etc.)
 * 
 * Supported Input Types:
 * - PDFs (including encrypted)
 * - Images (JPEG, PNG, TIFF, WebP)
 * - Office Documents (DOC, DOCX, RTF)
 * 
 * Output:
 * Always returns a HandlerResult containing:
 * {
 *   success: boolean,
 *   data?: Buffer,    // PDF format if successful
 *   error?: string    // Error message if failed
 * }
 * 
 * Consistency:
 * - All successful outputs are PDF format in a Buffer
 * - All errors follow the same format
 * - No exceptions are thrown; all errors are returned in the result
 */

import { Readable } from 'stream';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { convert } from 'libreoffice-convert';
import { promisify } from 'util';
import { info, decrypt } from 'node-qpdf2';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { 
  HandlerResult, 
  HandlerOptions, 
  HandlerInput,
  PDFMimeType,
  ImageMimeType,
  OfficeMimeType,
  SupportedMimeType,
  PDF_MIME_TYPES,
  IMAGE_MIME_TYPES,
  OFFICE_MIME_TYPES
} from './handler-types';

const convertAsync = promisify(convert);

async function createTempFile(buffer: Buffer): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-'));
  const filePath = path.join(tempDir, 'temp');
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    await fs.rmdir(path.dirname(filePath));
  } catch (error) {
    console.log('Cleanup error:', error);
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function handlePDF(input: HandlerInput, options?: HandlerOptions): Promise<HandlerResult> {
  try {
    const buffer = Buffer.isBuffer(input) ? input : await streamToBuffer(input);
    
    const tempPath = await createTempFile(buffer);
    const encryptionInfo = await info({ input: tempPath });
    
    if (encryptionInfo !== "File is not encrypted") {
      if (!options?.password) {
        return { success: false, error: 'Password required for encrypted PDF' };
      }
      
      const decryptedPath = `${tempPath}_decrypted`;
      await decrypt({
        input: tempPath,
        output: decryptedPath,
        password: options.password
      });
      
      const decryptedBuffer = await fs.readFile(decryptedPath);
      await cleanupTempFile(decryptedPath);
      await cleanupTempFile(tempPath);
      return { success: true, data: decryptedBuffer };
    }
    
    await cleanupTempFile(tempPath);
    return { success: true, data: buffer };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'PDF processing failed' };
  }
}

async function handleImage(input: HandlerInput): Promise<HandlerResult> {
  try {
    const buffer = Buffer.isBuffer(input) ? input : await streamToBuffer(input);
    
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      return { success: false, error: 'Invalid image dimensions' };
    }
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([metadata.width, metadata.height]);
    
    const pngBuffer = await image.png().toBuffer();
    const pngImage = await pdfDoc.embedPng(pngBuffer);
    
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: metadata.width,
      height: metadata.height
    });
    
    const pdfBuffer = Buffer.from(await pdfDoc.save());
    return { success: true, data: pdfBuffer };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Image processing failed' };
  }
}

async function handleOffice(input: HandlerInput): Promise<HandlerResult> {
  try {
    const buffer = Buffer.isBuffer(input) ? input : await streamToBuffer(input);
    const pdfBuffer = Buffer.from(await convertAsync(buffer, '.pdf', undefined));
    return { success: true, data: pdfBuffer };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Office conversion failed' };
  }
}

export async function handleDocument(
  input: HandlerInput,
  mimeType: SupportedMimeType,
  options?: HandlerOptions
): Promise<HandlerResult> {
  if (!input) {
    return { success: false, error: 'No input provided' };
  }

  if (PDF_MIME_TYPES.includes(mimeType as PDFMimeType)) {
    return handlePDF(input, options);
  }
  
  if (IMAGE_MIME_TYPES.includes(mimeType as ImageMimeType)) {
    return handleImage(input);
  }
  
  if (OFFICE_MIME_TYPES.includes(mimeType as OfficeMimeType)) {
    return handleOffice(input);
  }
  
  return { 
    success: false, 
    error: `Unsupported mime type: ${mimeType}` 
  };
}