import { PrismaClient, Prisma } from '@prisma/client';
import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentType, DocumentAlert, DocumentAlertType, CaseSummaryApiResponse } from '@shared/types';
import { parseCaseSummary } from '@shared/case-summary-types';
import { v4 as uuidv4 } from 'uuid'; // Needed for generating UUIDs if not provided by DB

// --- Logging Helpers ---
function logInfo(message: string, data?: any): void {
  console.log(`[PRISMA DB ADAPTER] INFO ${new Date().toISOString()} - ${message}`, data ?? '');
}
function logError(message: string, error?: Error | any, context?: any): void {
  const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  console.error(`[PRISMA DB ADAPTER] ERROR ${new Date().toISOString()} - ${message}`, { error: errorDetails, context: context ?? {} });
}
function logWarn(message: string, data?: any): void {
  console.warn(`[PRISMA DB ADAPTER] WARN ${new Date().toISOString()} - ${message}`, data ?? '');
}

// --- Prisma Client Initialization ---
let prisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
    if (!prisma) {
        logInfo('Initializing new Prisma Client instance');
        prisma = new PrismaClient();
    }
    return prisma;
}

// --- Type Mapping Helper (Prisma SilknoteDocument -> MedicalDocument) ---
function mapPrismaDocToMedicalDoc(prismaDoc: Prisma.SilknoteDocumentGetPayload<{}>): MedicalDocument {
     // Safely parse JSON content, providing defaults
     let content = { analysisResult: null, extractedSchemas: [], enrichedSchemas: [], pageImages: [] };
     try {
         if (prismaDoc.contentJson) content = { ...content, ...JSON.parse(prismaDoc.contentJson) };
     } catch (e) { logError('Failed to parse contentJson', e, { contentJson: prismaDoc.contentJson?.substring(0,100) }); }
     
     let alerts: DocumentAlert[] = [];
     try {
         if (prismaDoc.alertsJson) alerts = JSON.parse(prismaDoc.alertsJson);
         if (!Array.isArray(alerts)) alerts = []; // Ensure it's an array post-parse
     } catch (e) { logError('Failed to parse alertsJson', e, { alertsJson: prismaDoc.alertsJson?.substring(0,100) }); alerts = []; }

     const medicalDoc: MedicalDocument = {
        silknoteDocumentUuid: prismaDoc.silknoteDocumentUuid,
        clientFileId: prismaDoc.silknoteDocumentUuid,
        silknotePatientUuid: prismaDoc.patientUuid,
        originalName: prismaDoc.originalName,
        storedPath: prismaDoc.storedPath || '',
        status: prismaDoc.status,
        category: prismaDoc.category as DocumentType || DocumentType.UNKNOWN,
        uploadDate: prismaDoc.uploadDate.toISOString(),
        type: prismaDoc.mimeType || 'application/octet-stream',
        size: prismaDoc.sizeBytes || 0,
        title: prismaDoc.title || prismaDoc.originalName,
        format: {
          mimeType: prismaDoc.mimeType || '',
          extension: prismaDoc.originalName.includes('.') ? prismaDoc.originalName.split('.').pop() || '' : '',
        },
        fileSize: prismaDoc.sizeBytes || 0,
        pageCount: prismaDoc.pageCount || 0, // Default pageCount to 0 if null
        documentDate: prismaDoc.documentDate || '', // Default documentDate to empty string if null
        processedAt: prismaDoc.processedAt?.toISOString() || undefined,
        author: prismaDoc.author || undefined,
        sourceSystem: prismaDoc.sourceSystem || undefined,
        filename: prismaDoc.originalName,
        confidence: 0,
        isIncorrectPatient: false,
        content: content,
        alerts: alerts,
        detectedPatientInfo: undefined
     };
     return medicalDoc;
}

// --- Adapter Implementation ---
export function createPrismaAdapter(): DatabaseAdapter {
    let isInitialized = false;

    return {
        async initialize(): Promise<{ success: boolean; errors: StorageError[] }> {
            if (isInitialized) {
                logInfo('Prisma Adapter already initialized.');
                return { success: true, errors: [] };
            }
            logInfo('Initializing Prisma Adapter...');
            try {
                const client = getPrismaClient();
                await client.$connect();
                logInfo('Prisma client connected successfully.');
                isInitialized = true;
                return { success: true, errors: [] };
            } catch (error: any) {
                logError('Prisma Adapter initialization failed', error);
                await prisma?.$disconnect();
                prisma = null;
                isInitialized = false;
                return { success: false, errors: [{ code: 'PRISMA_INIT_ERROR', message: error.message || 'Unknown Prisma Init Error' }] };
            }
        },

        // --- Document Operations (Using Prisma `silknoteDocument` model) ---
        async saveDocument(document: MedicalDocument): Promise<boolean> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            const silknoteDocumentUuid = document.silknoteDocumentUuid || uuidv4();
            const patientUuid = document.silknotePatientUuid;
            
            if (!patientUuid) {
                logError('Cannot save document: missing silknotePatientUuid');
                return false;
            }
            logInfo('Saving document (upsert)', { silknoteDocumentUuid, patientUuid });

            // Prepare data for Prisma `silknoteDocument` model
            const prismaDocData = {
                patientUuid: patientUuid,
                originalName: document.originalName,
                storedPath: document.storedPath,
                status: document.status,
                category: document.category,
                mimeType: document.type,
                sizeBytes: document.size,
                pageCount: document.pageCount,
                documentDate: document.documentDate,
                uploadDate: new Date(document.uploadDate),
                processedAt: document.processedAt ? new Date(document.processedAt) : null,
                title: document.title,
                author: document.author,
                sourceSystem: document.sourceSystem,
                contentJson: document.content ? JSON.stringify(document.content) : null,
                alertsJson: document.alerts && Array.isArray(document.alerts) ? JSON.stringify(document.alerts) : null,
            };

            try {
                // Use `client.silknoteDocument`
                await client.silknoteDocument.upsert({
                    where: { silknoteDocumentUuid: silknoteDocumentUuid },
                    update: prismaDocData,
                    create: {
                        silknoteDocumentUuid: silknoteDocumentUuid,
                        ...prismaDocData,
                    },
                });
                return true;
            } catch (error) {
                logError(`Failed to save document ${silknoteDocumentUuid}`, error);
                return false;
            }
        },

        async getDocument(silknoteDocumentUuid: string): Promise<MedicalDocument | null> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Getting document', { silknoteDocumentUuid });
             try {
                 // Use `client.silknoteDocument`
                 const prismaDoc = await client.silknoteDocument.findUnique({
                     where: { silknoteDocumentUuid: silknoteDocumentUuid },
                 });
                 return prismaDoc ? mapPrismaDocToMedicalDoc(prismaDoc) : null;
             } catch (error) {
                 logError(`Failed to get document ${silknoteDocumentUuid}`, error);
                 return null;
             }
        },

        async updateDocument(document: MedicalDocument): Promise<boolean> {
            return this.saveDocument(document);
        },

        async deleteDocument(silknoteDocumentUuid: string): Promise<boolean> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Deleting document', { silknoteDocumentUuid });
            try {
                // Use `client.silknoteDocument`
                await client.silknoteDocument.delete({ 
                    where: { silknoteDocumentUuid: silknoteDocumentUuid } 
                });
                return true;
            } catch (error: any) {
                 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                     logInfo(`Document ${silknoteDocumentUuid} not found for deletion.`);
                     return true;
                 }
                logError(`Failed to delete document ${silknoteDocumentUuid}`, error);
                return false;
            }
        },

        // --- Patient Operations (Using Prisma `silknotePatientFileset` model) ---
        async savePatient(patient: PatientDetails): Promise<boolean> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            const silknotePatientUuid = patient.silknotePatientUuid || uuidv4();
            const silknoteUserUuid = patient.silknoteUserUuid;
            
            if (!silknoteUserUuid) {
                logError('Cannot save patient: missing silknoteUserUuid');
                return false;
            }
            logInfo('Saving patient fileset (upsert)', { silknotePatientUuid });

            const vectorStoreJson = patient.vectorStore ? JSON.stringify(patient.vectorStore) : null;
            const caseSummaryJson = patient.caseSummary ? JSON.stringify(patient.caseSummary) : null;

            // Prepare data for Prisma `silknotePatientFileset` model
            const patientDbData = {
                userId: silknoteUserUuid,
                patientName: patient.name,
                patientDob: patient.dateOfBirth,
                gender: patient.gender,
                vectorStoreJson: vectorStoreJson,
                caseSummaryJson: caseSummaryJson,
                summaryGenerationCount: patient.summaryGenerationCount || 0,
            };

            try {
                // Use `client.silknotePatientFileset`
                await client.silknotePatientFileset.upsert({
                    where: { silknotePatientUuid: silknotePatientUuid },
                    update: patientDbData,
                    create: {
                         silknotePatientUuid: silknotePatientUuid,
                         ...patientDbData,
                    },
                });
                return true;
            } catch (error) {
                logError(`Failed to save patient fileset ${silknotePatientUuid}`, error);
                return false;
            }
        },

        async getPatient(silknotePatientUuid: string): Promise<PatientDetails | null> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Getting patient fileset', { silknotePatientUuid });
            try {
                // Use `client.silknotePatientFileset`
                const fileset = await client.silknotePatientFileset.findUnique({
                    where: { silknotePatientUuid: silknotePatientUuid },
                });
                if (!fileset) return null;
                
                const documents = await this.getDocumentsForPatient(silknotePatientUuid);

                let vectorStore = null;
                try {
                    if (fileset.vectorStoreJson) {
                        vectorStore = JSON.parse(fileset.vectorStoreJson);
                    }
                } catch(e) { logError('Failed to parse vectorStoreJson for patient', e, { silknotePatientUuid }); }

                // --- Case Summary Validation Logic --- 
                let caseSummary: CaseSummaryApiResponse | null = null;
                let caseSummaryValid = false;
                if (fileset.caseSummaryJson) {
                    try {
                        const parsedJson = JSON.parse(fileset.caseSummaryJson);
                        // Check if the parsed object has the expected structure (summary + citations)
                        if (parsedJson && typeof parsedJson === 'object' && 'summary' in parsedJson) {
                             // Validate the nested summary object using the Zod schema
                             const validatedSummary = parseCaseSummary(parsedJson.summary);
                             if (validatedSummary) {
                                 // If summary is valid, reconstruct the full response structure
                                 caseSummary = {
                                     summary: validatedSummary,
                                     citations: Array.isArray(parsedJson.citations) ? parsedJson.citations : [],
                                     // Include counts if they exist, otherwise default
                                     summaryGenerationCount: parsedJson.summaryGenerationCount ?? fileset.summaryGenerationCount ?? 0,
                                     maxCount: parsedJson.maxCount ?? 5
                                 };
                                 caseSummaryValid = true;
                                 logInfo('Successfully parsed and validated existing case summary', { silknotePatientUuid });
                             } else {
                                 logError('Case summary structure validation failed (Zod parse failed)', null, { silknotePatientUuid });
                             }
                        } else {
                             logError('Parsed caseSummaryJson lacks expected structure (missing summary field?)', null, { silknotePatientUuid });
                        }
                    } catch(e) { 
                        logError('Failed to parse caseSummaryJson for patient', e, { silknotePatientUuid }); 
                        // Keep caseSummary as null if parsing fails
                    }
                } else {
                    logInfo('No caseSummaryJson found for patient', { silknotePatientUuid });
                    // No JSON stored, so technically valid (empty)
                    caseSummaryValid = true; 
                }
                
                // If validation failed, we treat it as if there's no summary
                // The calling service should handle potential clearing/regeneration
                if (!caseSummaryValid) {
                    logWarn('Treating stored case summary as invalid/null due to parsing or validation errors.', { silknotePatientUuid });
                    caseSummary = null;
                }
                // --- End Case Summary Validation Logic ---

                const result: PatientDetails = {
                    silknotePatientUuid: fileset.silknotePatientUuid,
                    silknoteUserUuid: fileset.userId,
                    name: fileset.patientName || 'N/A',
                    dateOfBirth: fileset.patientDob || '', 
                    gender: fileset.gender || 'unknown',
                    vectorStore: vectorStore,
                    caseSummary: caseSummary, // Use the potentially nullified caseSummary
                    summaryGenerationCount: caseSummary?.summaryGenerationCount ?? fileset.summaryGenerationCount ?? 0, // Use count from valid summary if available
                    fileSet: documents, 
                };
                return result;
            } catch (error) {
                logError(`Failed to get patient fileset ${silknotePatientUuid}`, error);
                return null;
            }
        },

        async getAllPatients(): Promise<PatientDetails[]> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Getting all patient filesets');
             try {
                 // Use `client.silknotePatientFileset`
                 const filesetIds = await client.silknotePatientFileset.findMany({ 
                     select: { silknotePatientUuid: true }
                 });
                 const results = await Promise.all(filesetIds.map((fs: { silknotePatientUuid: string }) => this.getPatient(fs.silknotePatientUuid)));
                 return results.filter((p: PatientDetails | null): p is PatientDetails => p !== null);
             } catch (error) {
                 logError('Failed to get all patient filesets', error);
                 return [];
             }
        },

        async updatePatient(patientUpdate: Partial<PatientDetails>): Promise<boolean> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const silknotePatientUuid = patientUpdate.silknotePatientUuid;
            if (!silknotePatientUuid) {
                 logError('Cannot update patient: silknotePatientUuid is missing in update data');
                 return false;
            }
            logInfo('Updating patient fileset', { silknotePatientUuid });
            const existingPatient = await this.getPatient(silknotePatientUuid);
            if (!existingPatient) {
                 logError(`Cannot update patient: Patient ${silknotePatientUuid} not found.`);
                 return false;
            }
            const mergedPatient: PatientDetails = {
                ...existingPatient,
                ...patientUpdate,
                fileSet: patientUpdate.fileSet ? patientUpdate.fileSet : existingPatient.fileSet,
            };
            return this.savePatient(mergedPatient);
        },

        async deletePatient(silknotePatientUuid: string): Promise<boolean> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Deleting patient fileset', { silknotePatientUuid });
             try {
                // Use `client.silknotePatientFileset`
                await client.silknotePatientFileset.delete({ 
                    where: { silknotePatientUuid: silknotePatientUuid } 
                });
                return true;
            } catch (error: any) {
                 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                     logInfo(`Patient fileset ${silknotePatientUuid} not found for deletion.`);
                     return true;
                 }
                logError(`Failed to delete patient fileset ${silknotePatientUuid}`, error);
                return false;
            }
        },

        async clearPatientCaseSummary(silknotePatientUuid: string): Promise<boolean> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Clearing patient case summary', { silknotePatientUuid });
            try {
                await client.silknotePatientFileset.update({
                    where: { silknotePatientUuid: silknotePatientUuid },
                    data: { 
                        caseSummaryJson: null, // Set the JSON field to null
                        summaryGenerationCount: 0 // Optionally reset the count
                    }
                });
                logInfo('Successfully cleared case summary for patient', { silknotePatientUuid });
                return true;
            } catch (error: any) {
                 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                     // Patient not found is not necessarily an error for clearing, could return true or false based on desired behavior
                     logInfo(`Patient fileset ${silknotePatientUuid} not found for clearing case summary.`);
                     return true; // Or false if you consider patient not found an error
                 }
                logError(`Failed to clear case summary for patient ${silknotePatientUuid}`, error);
                return false;
            }
        },

        // --- Relationship Operations ---
        async addDocumentToPatient(silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
             const client = getPrismaClient();
             try {
                 // Use `client.silknotePatientFileset`
                 await client.silknotePatientFileset.findUniqueOrThrow({ 
                     where: { silknotePatientUuid: silknotePatientUuid } 
                 });
                 document.silknotePatientUuid = silknotePatientUuid;
                 return this.saveDocument(document);
             } catch (error: any) {
                  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                       logError(`Cannot add document: Patient fileset ${silknotePatientUuid} not found.`);
                   } else {
                       logError(`Error ensuring patient fileset ${silknotePatientUuid} exists`, error);
                   }
                  return false;
             }
        },

        async getDocumentsForPatient(silknotePatientUuid: string): Promise<MedicalDocument[]> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
             const client = getPrismaClient();
             logInfo('Getting documents for patient', { silknotePatientUuid });
             try {
                 // Use `client.silknoteDocument` and correct FK name `patientUuid`
                 const prismaDocs = await client.silknoteDocument.findMany({
                     where: { patientUuid: silknotePatientUuid },
                     orderBy: { uploadDate: 'asc' }
                 });
                 // Use correct payload type
                 return prismaDocs.map((prismaDoc: Prisma.SilknoteDocumentGetPayload<{}>) => mapPrismaDocToMedicalDoc(prismaDoc));
             } catch (error) {
                 logError(`Failed to get documents for patient ${silknotePatientUuid}`, error);
                 return [];
             }
        },
        
        // --- Optional VSRX/Queue Methods (Adapted for Prisma `silknoteDocument` model) ---
        async getQueuedDocuments(limit: number = 10): Promise<string[]> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
             const client = getPrismaClient();
             logInfo('Getting queued documents (Prisma)', { limit });
             try {
                // Use `client.silknoteDocument`
                const docs = await client.silknoteDocument.findMany({
                    where: { status: 'queued' },
                    select: { silknoteDocumentUuid: true },
                    orderBy: { uploadDate: 'asc' },
                    take: limit,
                });
                return docs.map((d: { silknoteDocumentUuid: string }) => d.silknoteDocumentUuid);
             } catch (error) {
                logError('Failed to get queued documents', error);
                return [];
             }
        },
        async setDocumentStatus(silknoteDocumentUuid: string, status: string): Promise<boolean> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
             const client = getPrismaClient();
             logInfo('Setting document status (Prisma)', { silknoteDocumentUuid, status });
              try {
                  // Use `client.silknoteDocument`
                  await client.silknoteDocument.update({ 
                      where: { silknoteDocumentUuid: silknoteDocumentUuid }, 
                      data: { status: status }
                  });
                  return true;
              } catch (error: any) {
                 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                     logError(`Document ${silknoteDocumentUuid} not found for status update.`);
                 } else {
                    logError(`Failed to set status for document ${silknoteDocumentUuid}`, error);
                 }
                 return false;
              }
        },
        async resetProcessingDocuments(): Promise<number> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
             const client = getPrismaClient();
             logInfo('Resetting processing documents (Prisma)');
             try {
                // Use `client.silknoteDocument`
                const result = await client.silknoteDocument.updateMany({
                    where: { status: 'processing' },
                    data: { status: 'queued' }
                });
                logInfo(`Reset ${result.count} documents.`);
                return result.count;
             } catch (error) {
                 logError('Failed to reset processing documents', error);
                 return 0;
             }
        },
        async forceReprocessPatientDocuments(silknotePatientUuid: string): Promise<number> {
             if (!isInitialized) throw new Error('Prisma Adapter not initialized');
             const client = getPrismaClient();
             logInfo('Forcing reprocess for patient documents (Prisma)', { silknotePatientUuid });
              try {
                // Use `client.silknoteDocument` and correct FK name `patientUuid`
                const result = await client.silknoteDocument.updateMany({
                    where: { patientUuid: silknotePatientUuid, NOT: { status: 'queued' } }, 
                    data: { status: 'queued' }
                });
                logInfo(`Queued ${result.count} documents for reprocessing for patient ${silknotePatientUuid}.`);
                return result.count;
             } catch (error) {
                 logError(`Failed to force reprocess for patient ${silknotePatientUuid}`, error);
                 return 0;
             }
        },
        async forceReprocessDocument(silknoteDocumentUuid: string): Promise<boolean> {
            // Check if setDocumentStatus exists before calling it
            if (typeof this.setDocumentStatus === 'function') {
                return this.setDocumentStatus(silknoteDocumentUuid, 'queued');
            } else {
                logError('setDocumentStatus method is not available on this adapter instance.');
                return false;
            }
        },

        // --- NEW Alert Method --- 
        async acknowledgeDocumentAlert(silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean> {
            if (!isInitialized) throw new Error('Prisma Adapter not initialized');
            const client = getPrismaClient();
            logInfo('Acknowledging document alert', { silknotePatientUuid, silknoteDocumentUuid, alertType });

            try {
                // 1. Fetch the document ensuring it belongs to the patient
                const document = await client.silknoteDocument.findUnique({
                    where: { 
                        silknoteDocumentUuid: silknoteDocumentUuid,
                        patientUuid: silknotePatientUuid // Ensure doc belongs to patient
                    },
                    select: { alertsJson: true } // Only select the alerts field
                });

                if (!document) {
                    logError('Document not found or does not belong to patient', null, { silknoteDocumentUuid, silknotePatientUuid });
                    return false;
                }

                // 2. Parse alerts JSON
                let alerts: DocumentAlert[] = [];
                let requiresUpdate = false;
                try {
                    if (document.alertsJson) {
                        alerts = JSON.parse(document.alertsJson);
                    } else {
                        logInfo('No alertsJson found for document, nothing to acknowledge', { silknoteDocumentUuid });
                        return true; // No alerts present, technically successful
                    }
                    if (!Array.isArray(alerts)) {
                        logError('Parsed alertsJson is not an array', null, { silknoteDocumentUuid });
                        // Treat as corrupted data, maybe return false or clean up?
                        alerts = []; 
                        return false; // Indicate failure due to bad data
                    }
                } catch (e) {
                    logError('Failed to parse alertsJson', e, { silknoteDocumentUuid });
                    return false; // Indicate failure due to bad data
                }

                // 3. Modify alerts in memory
                const updatedAlerts = alerts.map(alert => {
                    if (alert.type === alertType && !alert.acknowledged) {
                        requiresUpdate = true;
                        logInfo(`Marking alert type ${alertType} as acknowledged`, { silknoteDocumentUuid });
                        return { ...alert, acknowledged: true };
                    }
                    return alert;
                });

                // 4. If modified, update the database
                if (requiresUpdate) {
                    const updatedAlertsJson = JSON.stringify(updatedAlerts);
                    await client.silknoteDocument.update({
                        where: { silknoteDocumentUuid: silknoteDocumentUuid },
                        data: { alertsJson: updatedAlertsJson }
                    });
                    logInfo('Successfully updated alertsJson in database', { silknoteDocumentUuid });
                    return true;
                } else {
                    logInfo('No unacknowledged alerts of the specified type found, no update needed', { silknoteDocumentUuid, alertType });
                    return true; // No action needed, but operation was successful
                }

            } catch (error) {
                logError('Error acknowledging document alert', error, { silknoteDocumentUuid, alertType });
                return false;
            }
        }

    };
}
