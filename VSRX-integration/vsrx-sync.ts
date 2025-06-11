import * as mysql from 'mysql2/promise';
import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
const libre = require('libreoffice-convert');
const mammoth = require('mammoth');
const pdf = require('html-pdf');
const MsgReader = require('@kenjiuno/msgreader').default;
import { promisify } from 'util';

const libreConvert = promisify(libre.convert);

// Load environment variables
dotenv.config();

// ============= Configuration =============
interface Config {
  // MySQL connection
  MYSQL_HOST: string;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
  MYSQL_DATABASE: string;
  MYSQL_PORT?: number;
  
  // File system
  VSRX_FILE_BASE_PATH: string; // e.g., '/home/1226418.cloudwaysapps.com/qpsjtdagpd/public_html/login/'
  
  // SilknoteDocAnalysis server
  SilknoteDocAnalysis_SERVER_PATH: string; // e.g., 'https://silknotedocanalyse.azurewebsites.net'
  
  // Sync settings
  SYNC_BATCH_SIZE?: number;
  SYNC_DRY_RUN?: boolean;
  SYNC_LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug';
}

// ============= Type Definitions =============
interface VSRXFile {
  id: string;
  assessment_id: number;
  user_id: number;
  datestamp: Date;
  file: string; // Path like 'notes/samplefilename.pdf'
  description: string | null;
  file_uuid: string | null;
  deleted?: boolean;
}

interface SilknotePatientFileset {
  silknotePatientUuid: string;
  silknoteUserUuid: string;
  activatedUse: boolean;
  activatedUseTime: Date | null;
  patientName: string | null;
  patientDob: string | null;
  gender: string | null;
  vectorStoreJson: string | null;
  caseSummaryJson: string | null;
  summaryGenerationCount: number;
  createdAt: Date;
  updatedAt: Date;
  errors: any;
}

interface SilknoteDocument {
  silknoteDocumentUuid: string;
  patientUuid: string;
  originalName: string;
  clientFileId: string | null;
  storedPath: string | null;
  status: string;
  category: string;
  mimeType: string;
  sizeBytes: number | null;
  pageCount: number | null;
  documentDate: string | null;
  uploadDate: Date;
  processedAt: Date | null;
  title: string | null;
  author: string | null;
  sourceSystem: string | null;
  contentJson: string | null;
  alertsJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  VSRXReference: string | null; // This stores the VSRX file_uuid
}

interface SyncResult {
  patientUuid: string;
  filesAdded: number;
  filesDeleted: number;
  errors: Array<{
    timestamp: string;
    operation: 'add' | 'delete';
    fileId: string;
    fileName?: string;
    error: string;
    retryCount: number;
    resolved: boolean;
  }>;
  status: 'success' | 'partial' | 'failed';
}

// ============= Main Sync Class =============
class VSRXSync {
  private connection: mysql.Connection | null = null;
  private config: Config;
  private logger: Logger;

  constructor(config: Config) {
    this.config = {
      MYSQL_PORT: 3306,
      SYNC_BATCH_SIZE: 50,
      SYNC_DRY_RUN: false,
      SYNC_LOG_LEVEL: 'info',
      ...config
    };
    this.logger = new Logger(this.config.SYNC_LOG_LEVEL!);
  }

  async connect(): Promise<void> {
    try {
      this.connection = await mysql.createConnection({
        host: this.config.MYSQL_HOST,
        user: this.config.MYSQL_USER,
        password: this.config.MYSQL_PASSWORD,
        database: this.config.MYSQL_DATABASE,
        port: this.config.MYSQL_PORT
      });
      this.logger.info('Connected to MySQL database');
    } catch (error) {
      this.logger.error('Failed to connect to MySQL:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.logger.info('Disconnected from MySQL database');
    }
  }

  async sync(): Promise<{ success: boolean; results: SyncResult[]; summary: any }> {
    const startTime = new Date();
    const results: SyncResult[] = [];
    
    try {
      // Get all active patient filesets
      const activeFilesets = await this.getActivePatientFilesets();
      this.logger.info(`Found ${activeFilesets.length} active patient filesets`);
      
      for (const fileset of activeFilesets) {
        const result = await this.syncPatientFileset(fileset);
        results.push(result);
      }
      
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      return {
        success: true,
        results,
        summary: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration,
          totalFilesets: activeFilesets.length,
          totalFilesAdded: results.reduce((sum, r) => sum + r.filesAdded, 0),
          totalFilesDeleted: results.reduce((sum, r) => sum + r.filesDeleted, 0),
          totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
          successfulSyncs: results.filter(r => r.status === 'success').length,
          partialSyncs: results.filter(r => r.status === 'partial').length,
          failedSyncs: results.filter(r => r.status === 'failed').length
        }
      };
    } catch (error) {
      this.logger.error('Sync failed:', error);
      throw error;
    }
  }

  private async getActivePatientFilesets(): Promise<SilknotePatientFileset[]> {
    if (!this.connection) throw new Error('Not connected to database');
    
    const [rows] = await this.connection.execute(
      'SELECT * FROM silknote_patient_filesets WHERE silknote_patient_filesets.activatedUse = 1'
    );
    
    return rows as SilknotePatientFileset[];
  }

  private async syncPatientFileset(fileset: SilknotePatientFileset): Promise<SyncResult> {
    const result: SyncResult = {
      patientUuid: fileset.silknotePatientUuid,
      filesAdded: 0,
      filesDeleted: 0,
      errors: [],
      status: 'success'
    };
    
    try {
      // Get all files from VSRX for this patient
      // Note: This assumes the patient UUID is linked to candidates table
      const vsrxFiles = await this.getVSRXFilesForPatient(fileset.silknotePatientUuid);
      
      // Get all Silknote documents for this patient
      const silknoteDocuments = await this.getSilknoteDocuments(fileset.silknotePatientUuid);
      
      // Create maps for efficient lookup
      // Use file_uuid if available, otherwise fall back to id
      const vsrxFileMap = new Map(vsrxFiles.map(f => [f.file_uuid || f.id, f]));
      const silknoteDocMap = new Map(
        silknoteDocuments
          .filter(d => d.VSRXReference)
          .map(d => [d.VSRXReference!, d])
      );
      
      // Find files to add (in VSRX but not in Silknote)
      const filesToAdd = vsrxFiles.filter(
        f => !f.deleted && !silknoteDocMap.has(f.file_uuid || f.id)
      );
      
      // Find files to delete (in Silknote but deleted/missing in VSRX)
      const filesToDelete: SilknoteDocument[] = [];
      for (const [vsrxId, silknoteDoc] of silknoteDocMap) {
        const vsrxFile = vsrxFileMap.get(vsrxId);
        if (!vsrxFile || vsrxFile.deleted) {
          filesToDelete.push(silknoteDoc);
        }
      }
      
      // Process additions
      if (filesToAdd.length > 0 && !this.config.SYNC_DRY_RUN) {
        this.logger.info(`Adding ${filesToAdd.length} files for patient ${fileset.silknotePatientUuid}`);
        
        for (const vsrxFile of filesToAdd) {
          try {
            await this.addFile(fileset, vsrxFile);
            result.filesAdded++;
          } catch (error) {
            result.errors.push({
              timestamp: new Date().toISOString(),
              operation: 'add',
              fileId: vsrxFile.id,
              fileName: vsrxFile.file,
              error: error instanceof Error ? error.message : 'Unknown error',
              retryCount: 0,
              resolved: false
            });
            result.status = 'partial';
          }
        }
      }
      
      // Process deletions
      if (filesToDelete.length > 0 && !this.config.SYNC_DRY_RUN) {
        this.logger.info(`Deleting ${filesToDelete.length} files for patient ${fileset.silknotePatientUuid}`);
        
        for (const document of filesToDelete) {
          try {
            await this.deleteFile(document);
            result.filesDeleted++;
          } catch (error) {
            result.errors.push({
              timestamp: new Date().toISOString(),
              operation: 'delete',
              fileId: document.silknoteDocumentUuid,
              error: error instanceof Error ? error.message : 'Unknown error',
              retryCount: 0,
              resolved: false
            });
            result.status = 'partial';
          }
        }
      }
      
      // Update error log if there were errors
      if (result.errors.length > 0) {
        await this.updatePatientFilesetErrors(fileset.silknotePatientUuid, result.errors);
      }
      
    } catch (error) {
      result.status = 'failed';
      result.errors.push({
        timestamp: new Date().toISOString(),
        operation: 'add',
        fileId: 'sync-process',
        error: error instanceof Error ? error.message : 'Unknown error',
        retryCount: 0,
        resolved: false
      });
    }
    
    return result;
  }

  private async getVSRXFilesForPatient(patientUuid: string): Promise<VSRXFile[]> {
    if (!this.connection) throw new Error('Not connected to database');
    
    // This query assumes there's a link between silknotePatientUuid and candidates
    // You may need to adjust based on actual relationship
    const [rows] = await this.connection.execute(`
      SELECT f.* 
      FROM ax_notes_attachments f
      JOIN assessments a ON f.assessment_id = a.assessment_id
      JOIN candidates c ON a.candidate_id = c.candidate_id
      WHERE c.silknotePatientUuid = ?
      ORDER BY f.datestamp DESC
    `, [patientUuid]);
    
    // Filter to only supported file types
    const files = (rows as VSRXFile[]).filter(file => this.isSupported(file.file));
    
    if ((rows as VSRXFile[]).length > files.length) {
      this.logger.info(`Filtered out ${(rows as VSRXFile[]).length - files.length} unsupported file types for patient ${patientUuid}`);
    }
    
    return files;
  }

  private async getSilknoteDocuments(patientUuid: string): Promise<SilknoteDocument[]> {
    if (!this.connection) throw new Error('Not connected to database');
    
    const [rows] = await this.connection.execute(
      'SELECT * FROM silknote_documents WHERE patientUuid = ?',
      [patientUuid]
    );
    
    return rows as SilknoteDocument[];
  }

  private async addFile(fileset: SilknotePatientFileset, vsrxFile: VSRXFile): Promise<void> {
    // Validate file type is supported
    if (!this.isSupported(vsrxFile.file)) {
      throw new Error(`Unsupported file type: ${vsrxFile.file}`);
    }
    
    // Read file from disk
    const fullPath = path.join(this.config.VSRX_FILE_BASE_PATH, vsrxFile.file);
    
    // Validate path to prevent directory traversal
    if (!this.isPathSafe(fullPath)) {
      throw new Error(`Invalid file path: ${vsrxFile.file}`);
    }
    
    let fileBuffer = await fs.readFile(fullPath);
    let fileName = path.basename(vsrxFile.file);
    let mimeType = this.getMimeType(fileName);
    
    // Convert non-PDF documents to PDF
    if (this.needsConversion(fileName)) {
      this.logger.info(`Converting ${fileName} to PDF`);
      try {
        fileBuffer = await this.convertToPDF(fileBuffer, fileName);
        fileName = fileName.replace(/\.(doc|docx|rtf|msg)$/i, '.pdf');
        mimeType = 'application/pdf';
      } catch (error) {
        this.logger.error(`Failed to convert ${fileName} to PDF:`, error);
        throw new Error(`Document conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Prepare form data for VitalSign process endpoint
    const formData = new FormData();
    formData.append('patientUuid', fileset.silknotePatientUuid);
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: mimeType
    });
    formData.append('metadata', JSON.stringify({
      vsrxReference: vsrxFile.file_uuid || vsrxFile.id,
      originalPath: vsrxFile.file,
      uploadDate: vsrxFile.datestamp,
      description: vsrxFile.description,
      sourceSystem: 'VSRX_SYNC',
      originalFormat: path.extname(vsrxFile.file).toLowerCase()
    }));
    
    // Send to VitalSign process endpoint with required headers
    const response = await fetch(`${this.config.SilknoteDocAnalysis_SERVER_PATH}/api/process`, {
      method: 'POST',
      headers: {
        'x-silknote-user-uuid': fileset.silknoteUserUuid,
        'x-silknote-patient-uuid': fileset.silknotePatientUuid,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`Process endpoint returned ${response.status}: ${await response.text()}`);
    }
    
    // Update the VSRXReference in the newly created document
    // This assumes the process endpoint returns the created document UUID
    const result = await response.json() as { documentUuid?: string };
    if (result.documentUuid) {
      await this.updateDocumentVSRXReference(result.documentUuid, vsrxFile.file_uuid || vsrxFile.id);
    }
  }

  private async deleteFile(document: SilknoteDocument): Promise<void> {
    // Get patient fileset to retrieve user UUID
    const fileset = await this.getPatientFileset(document.patientUuid);
    
    const response = await fetch(`${this.config.SilknoteDocAnalysis_SERVER_PATH}/api/documents/delete`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-silknote-user-uuid': fileset.silknoteUserUuid,
        'x-silknote-patient-uuid': document.patientUuid
      },
      body: JSON.stringify({
        documentUuid: document.silknoteDocumentUuid,
        patientUuid: document.patientUuid,
        verifyVectorStore: true
      })
    });
    
    if (!response.ok) {
      throw new Error(`Delete endpoint returned ${response.status}: ${await response.text()}`);
    }
  }

  private async getPatientFileset(patientUuid: string): Promise<SilknotePatientFileset> {
    if (!this.connection) throw new Error('Not connected to database');
    
    const [rows] = await this.connection.execute(
      'SELECT * FROM silknote_patient_filesets WHERE silknotePatientUuid = ?',
      [patientUuid]
    );
    
    const filesets = rows as SilknotePatientFileset[];
    if (filesets.length === 0) {
      throw new Error(`Patient fileset not found for UUID: ${patientUuid}`);
    }
    
    return filesets[0];
  }

  private isSupported(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.pdf', '.doc', '.docx', '.rtf', '.msg'].includes(ext);
  }

  private needsConversion(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.doc', '.docx', '.rtf', '.msg'].includes(ext);
  }

  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.rtf': 'application/rtf',
      '.msg': 'application/vnd.ms-outlook'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private async convertToPDF(fileBuffer: Buffer, fileName: string): Promise<Buffer> {
    const ext = path.extname(fileName).toLowerCase();
    
    // For .msg files, extract email content and convert to PDF
    if (ext === '.msg') {
      try {
        const msgReader = new MsgReader(fileBuffer);
        const msgContent = msgReader.getFileData();
        
        // Build HTML representation of the email
        let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .header { background-color: #f0f0f0; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
    .header-item { margin: 5px 0; }
    .header-label { font-weight: bold; display: inline-block; width: 80px; }
    .body { margin-top: 20px; white-space: pre-wrap; word-wrap: break-word; }
    .attachments { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 5px; }
    .attachment-item { margin: 5px 0; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-item"><span class="header-label">From:</span> ${this.escapeHtml(msgContent.senderName || '')} &lt;${this.escapeHtml(msgContent.senderEmail || '')}&gt;</div>
    <div class="header-item"><span class="header-label">To:</span> ${this.escapeHtml(this.formatRecipients(msgContent.recipients))}</div>
    <div class="header-item"><span class="header-label">Subject:</span> ${this.escapeHtml(msgContent.subject || '(No Subject)')}</div>
    <div class="header-item"><span class="header-label">Date:</span> ${msgContent.messageDeliveryTime ? new Date(msgContent.messageDeliveryTime).toLocaleString() : 'Unknown'}</div>
  </div>
  <div class="body">${this.escapeHtml(msgContent.body || '')}</div>
`;

        // Add attachments list if present
        if (msgContent.attachments && msgContent.attachments.length > 0) {
          htmlContent += `
  <div class="attachments">
    <h3>Attachments (${msgContent.attachments.length}):</h3>`;
          for (const attachment of msgContent.attachments) {
            htmlContent += `<div class="attachment-item">📎 ${this.escapeHtml(attachment.fileName || 'Unnamed')} (${this.formatFileSize(attachment.fileSize || 0)})</div>`;
          }
          htmlContent += '</div>';
        }

        htmlContent += `
</body>
</html>`;

        // Convert HTML to PDF
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
          pdf.create(htmlContent, {
            format: 'A4',
            border: {
              top: "15mm",
              right: "10mm",
              bottom: "15mm",
              left: "10mm"
            }
          }).toBuffer((err: any, buffer: Buffer) => {
            if (err) reject(err);
            else resolve(buffer);
          });
        });
        
        return pdfBuffer;
      } catch (error) {
        throw new Error(`MSG conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // For .docx files, try mammoth first (better for simple documents)
    if (ext === '.docx') {
      try {
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
          pdf.create(result.value, {
            format: 'A4',
            border: {
              top: "20mm",
              right: "15mm",
              bottom: "20mm",
              left: "15mm"
            }
          }).toBuffer((err: any, buffer: Buffer) => {
            if (err) reject(err);
            else resolve(buffer);
          });
        });
        return pdfBuffer;
      } catch (error) {
        this.logger.warn('Mammoth conversion failed, falling back to LibreOffice:', error);
      }
    }
    

    
    // Use LibreOffice for .doc, .rtf, or if mammoth fails
    try {
      const pdfBuffer = await libreConvert(fileBuffer, 'pdf', undefined);
      return pdfBuffer;
    } catch (error) {
      throw new Error(`LibreOffice conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async updateDocumentVSRXReference(documentUuid: string, vsrxFileUuid: string): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');
    
    await this.connection.execute(
      'UPDATE silknote_documents SET VSRXReference = ? WHERE silknoteDocumentUuid = ?',
      [vsrxFileUuid, documentUuid]
    );
  }

  private async updatePatientFilesetErrors(patientUuid: string, newErrors: any[]): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');
    
    // Get existing errors
    const [rows] = await this.connection.execute(
      'SELECT errors FROM silknote_patient_filesets WHERE silknotePatientUuid = ?',
      [patientUuid]
    );
    
    const fileset = (rows as any[])[0];
    if (!fileset) return;
    
    const existingErrors = fileset.errors ? JSON.parse(fileset.errors) : {};
    const syncErrors = existingErrors.syncErrors || [];
    
    // Add new errors and keep only last 1000
    const updatedErrors = [...syncErrors, ...newErrors].slice(-1000);
    
    const errorData = {
      ...existingErrors,
      syncErrors: updatedErrors,
      lastSyncAttempt: new Date().toISOString(),
      lastSuccessfulSync: newErrors.length === 0 ? new Date().toISOString() : existingErrors.lastSuccessfulSync,
      consecutiveFailures: newErrors.length > 0 
        ? (existingErrors.consecutiveFailures || 0) + 1 
        : 0
    };
    
    await this.connection.execute(
      'UPDATE silknote_patient_filesets SET errors = ? WHERE silknotePatientUuid = ?',
      [JSON.stringify(errorData), patientUuid]
    );
  }

  private isPathSafe(filePath: string): boolean {
    const normalizedPath = path.normalize(filePath);
    const resolvedPath = path.resolve(filePath);
    const basePathResolved = path.resolve(this.config.VSRX_FILE_BASE_PATH);
    
    // Must be within base path
    return resolvedPath.startsWith(basePathResolved);
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  private formatRecipients(recipients: any[]): string {
    if (!recipients || recipients.length === 0) return '';
    return recipients.map(r => `${r.name || ''} &lt;${r.email || ''}&gt;`).join('; ');
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }


}

// ============= Logger Class =============
class Logger {
  private level: string;
  private levels = ['error', 'warn', 'info', 'debug'];
  
  constructor(level: string = 'info') {
    this.level = level;
  }
  
  private shouldLog(msgLevel: string): boolean {
    return this.levels.indexOf(msgLevel) <= this.levels.indexOf(this.level);
  }
  
  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
  
  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
  
  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
  
  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
}

// ============= Main Execution =============
async function runSync() {
  // Load configuration from environment variables
  const config: Config = {
    MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
    MYSQL_USER: process.env.MYSQL_USER || '',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE || '',
    MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '3306'),
    VSRX_FILE_BASE_PATH: process.env.VSRX_FILE_BASE_PATH || '',
    SilknoteDocAnalysis_SERVER_PATH: process.env.SilknoteDocAnalysis_SERVER_PATH || '',
    SYNC_BATCH_SIZE: parseInt(process.env.SYNC_BATCH_SIZE || '50'),
    SYNC_DRY_RUN: process.env.SYNC_DRY_RUN === 'true',
    SYNC_LOG_LEVEL: (process.env.SYNC_LOG_LEVEL || 'info') as any
  };
  
  // Validate required configuration
  const required = [
    'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 
    'VSRX_FILE_BASE_PATH', 'SilknoteDocAnalysis_SERVER_PATH'
  ];
  
  for (const key of required) {
    if (!config[key as keyof Config]) {
      console.error(`Missing required configuration: ${key}`);
      process.exit(1);
    }
  }
  
  const sync = new VSRXSync(config);
  
  try {
    await sync.connect();
    const results = await sync.sync();
    console.log('Sync completed:', JSON.stringify(results.summary, null, 2));
    
    if (results.summary.totalErrors > 0) {
      process.exit(1); // Exit with error code if there were sync errors
    }
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await sync.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  runSync();
}

export { VSRXSync, Config, SyncResult }; 