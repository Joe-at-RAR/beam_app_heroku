import { PrismaClient, Prisma, SilknoteDocument } from '@prisma/client';
import { DatabaseAdapter, StorageError } from '../storage-interfaces';
import { MedicalDocument, PatientDetails, DocumentType, DocumentAlert, DocumentAlertType, CaseSummaryApiResponse, VectorStoreError } from '../../shared/types';
import { createLogger } from '../logger';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('PRISMA_DB_ADAPTER');
const prisma = new PrismaClient();

const defaultMedicalDocumentContent = (): MedicalDocument['content'] => ({
    analysisResult: null,
    extractedSchemas: [],
    enrichedSchemas: [],
    pageImages: [],
    // data: undefined, // if part of the type and optional
});

// Type for a patient with all their (scalar) documents.
const patientWithFullDocumentsArgs = {
    include: { documents: true } // true here includes all scalar fields of SilknoteDocument
} satisfies Prisma.SilknotePatientFilesetArgs;
type PrismaPatientWithFullDocs = Prisma.SilknotePatientFilesetGetPayload<typeof patientWithFullDocumentsArgs>;

function mapPrismaDocumentToMedicalDocument(
    // This function can be called with a document that has its patientFileset context, or just a plain document.
    prismaDoc: (SilknoteDocument & { patientFileset?: { silknoteUserUuid: string, patientName: string | null, patientDob: string | null } }) | null
): MedicalDocument | null {
    if (!prismaDoc) {
        return null;
    }

    let content: MedicalDocument['content'] = defaultMedicalDocumentContent(); 
    try {
        if (prismaDoc.contentJson) {
            const parsedContent = JSON.parse(prismaDoc.contentJson);
            if (typeof parsedContent === 'object' && parsedContent !== null) {
                // Assuming parsedContent might not fully match defaultMedicalDocumentContent structure initially
                content = { 
                    analysisResult: parsedContent.analysisResult !== undefined ? parsedContent.analysisResult : null,
                    extractedSchemas: Array.isArray(parsedContent.extractedSchemas) ? parsedContent.extractedSchemas : [],
                    enrichedSchemas: Array.isArray(parsedContent.enrichedSchemas) ? parsedContent.enrichedSchemas : [],
                    pageImages: Array.isArray(parsedContent.pageImages) ? parsedContent.pageImages : [],
                    data: parsedContent.data, // if 'data' (ArrayBuffer) can be in JSON
                } as MedicalDocument['content'];
                 if (parsedContent.error) (content as any).error = parsedContent.error;
                 if (parsedContent.details) (content as any).details = parsedContent.details;
            } else {
                (content as any).error = "Parsed contentJson was not an object.";
            }
        }
    } catch (e) {
        logger.error(`[PRISMA MAPPER] Error parsing contentJson for doc ${prismaDoc.silknoteDocumentUuid}:`, e);
        (content as any).error = "Failed to parse content";
        (content as any).details = (e as Error).message;
    }
     
     let alerts: DocumentAlert[] = [];
     try {
        if (prismaDoc.alertsJson) {
            alerts = JSON.parse(prismaDoc.alertsJson);
            if (!Array.isArray(alerts)) alerts = [];
        }
    } catch (e) {
        logger.error(`[PRISMA MAPPER] Error parsing alertsJson for doc ${prismaDoc.silknoteDocumentUuid}:`, e);
    }
    
    let detectedPatientInfo: { name?: string; dateOfBirth?: string } | undefined = undefined;
    let isIncorrectPatient = false;

    const patientFilesetFromDoc = prismaDoc.patientFileset;
    const detectedNameFromDb = (prismaDoc as any).detectedPatientName; 
    const detectedDobFromDb = (prismaDoc as any).detectedPatientDob;  

    if (detectedNameFromDb || detectedDobFromDb) {
        detectedPatientInfo = {
            name: detectedNameFromDb ?? undefined,
            dateOfBirth: detectedDobFromDb ?? undefined,
        };
        if (patientFilesetFromDoc && detectedPatientInfo && patientFilesetFromDoc.patientName && patientFilesetFromDoc.patientDob) {
            isIncorrectPatient = 
                (!!detectedPatientInfo.name && detectedPatientInfo.name.toLowerCase() !== patientFilesetFromDoc.patientName.toLowerCase()) ||
                (!!detectedPatientInfo.dateOfBirth && detectedPatientInfo.dateOfBirth !== patientFilesetFromDoc.patientDob);
        }
    }
    
    const toISOStringOptional = (date: Date | string | null | undefined): string | undefined => {
        if (!date) return undefined;
        if (date instanceof Date) return date.toISOString();
        if (typeof date === 'string') {
            try {
                // Validate if it's a parseable date string before calling toISOString
                return new Date(date).toISOString();
            } catch {
                // If parsing fails, and it was a string, return it as is or handle as error
                // For now, returning undefined for safety if it's not a valid date string for new Date()
                return undefined; 
            }
        }
        return undefined;
    };

     const medicalDoc: MedicalDocument = {
        silknoteDocumentUuid: prismaDoc.silknoteDocumentUuid,
        clientFileId: prismaDoc.clientFileId || '', // Provide default empty string if null
        silknotePatientUuid: prismaDoc.patientUuid,
        originalName: prismaDoc.originalName,
        storedPath: prismaDoc.storedPath || '',
        status: prismaDoc.status,
        category: prismaDoc.category as DocumentType,
        type: prismaDoc.mimeType, 
        size: prismaDoc.sizeBytes ?? 0,
        title: prismaDoc.title ?? prismaDoc.originalName,
        format: {
            mimeType: prismaDoc.mimeType, 
            extension: path.extname(prismaDoc.originalName).replace(/^\./, '') || 'pdf'
        },
        fileSize: prismaDoc.sizeBytes ?? 0,
        pageCount: prismaDoc.pageCount ?? 0,
        documentDate: toISOStringOptional(prismaDoc.documentDate),
        uploadDate: toISOStringOptional(prismaDoc.uploadDate)!, 
        processedAt: toISOStringOptional(prismaDoc.processedAt),
        author: prismaDoc.author ?? '',
        sourceSystem: prismaDoc.sourceSystem ?? 'upload',
        filename: prismaDoc.originalName,
        confidence: (prismaDoc as any).confidence ?? 0,
        content: content,
        alerts: alerts,
        isIncorrectPatient: isIncorrectPatient,
        detectedPatientInfo: detectedPatientInfo,
     };
     return medicalDoc;
}

function mapPrismaPatientToPatientDetails(
    prismaPatientFileset: PrismaPatientWithFullDocs | null
): PatientDetails | null {
    if (!prismaPatientFileset) {
        return null;
    }

    const mappedDocs = prismaPatientFileset.documents?.map(doc => 
        mapPrismaDocumentToMedicalDocument(doc as SilknoteDocument & { patientFileset?: any }) 
    ).filter((d): d is MedicalDocument => d !== null) ?? [];

    let vectorStore: any = null;
    try {
        if (prismaPatientFileset.vectorStoreJson) {
            vectorStore = JSON.parse(prismaPatientFileset.vectorStoreJson);
        }
    } catch (e) {
        logger.error(`[PRISMA MAPPER] Error parsing vectorStoreJson for patient ${prismaPatientFileset.silknotePatientUuid}:`, e);
    }

    let caseSummary: CaseSummaryApiResponse | null = null;
    try {
        if (prismaPatientFileset.caseSummaryJson) {
            const parsed = JSON.parse(prismaPatientFileset.caseSummaryJson);
            if (parsed && typeof parsed.summary === 'object' && Array.isArray(parsed.citations)) {
                caseSummary = parsed as CaseSummaryApiResponse;
            } else {
                 logger.warn(`[PRISMA MAPPER] Parsed caseSummaryJson for patient ${prismaPatientFileset.silknotePatientUuid} lacks CaseSummaryApiResponse structure.`);
            }
        }
    } catch (e) {
        logger.error(`[PRISMA MAPPER] Error parsing caseSummaryJson for patient ${prismaPatientFileset.silknotePatientUuid}:`, e);
    }

    const patientDetails: PatientDetails = {
        silknoteUserUuid: prismaPatientFileset.silknoteUserUuid,
        silknotePatientUuid: prismaPatientFileset.silknotePatientUuid,
        name: prismaPatientFileset.patientName ?? '',
        dateOfBirth: prismaPatientFileset.patientDob ?? '',
        gender: prismaPatientFileset.gender ?? 'unknown',
        fileSet: mappedDocs,
        vectorStore: vectorStore,
        caseSummary: caseSummary, 
        summaryGenerationCount: prismaPatientFileset.summaryGenerationCount ?? 0,
        activatedUse: prismaPatientFileset.activatedUse ?? false,
        activatedUseTime: prismaPatientFileset.activatedUseTime ? prismaPatientFileset.activatedUseTime.toISOString() : null,
    };
    return patientDetails;
}

export function createPrismaAdapter(): DatabaseAdapter {
    logger.info('Prisma DB Adapter created.');

    // Helper to convert MedicalDocument date strings (ISO) to what Prisma data input expects (ISO string or null)
    const medicalDateToPrismaInput = (dateString: string | undefined | null): string | null => {
        if (!dateString) return null;
        // Assuming dateString is already a valid ISO string or can be parsed by new Date()
        // Prisma typically accepts valid ISO strings directly for DateTime fields.
        try {
            new Date(dateString).toISOString(); // Validate it's a parseable date string
            return dateString;
        } catch (e) {
            logger.warn(`[PRISMA_ADAPTER] Invalid date string for Prisma input: ${dateString}`);
            return null;
        }
    };

    // Remove the duplicate adapterMethods variable declaration
    const methods = {
        async initialize(): Promise<{ success: boolean; errors: StorageError[] }> {
            try {
                await prisma.$connect();
                logger.info('Prisma client connected successfully.');
                return { success: true, errors: [] };
            } catch (error: any) {
                logger.error('Prisma client connection failed:', error);
                return { success: false, errors: [{ code: 'DB_CONN_ERROR', message: error.message }] };
            }
        },

        async saveDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
            logger.info(`[PRISMA] saveDocument for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, clientFileId: ${document.clientFileId}`);
            try {
                const patientFileSet = await prisma.silknotePatientFileset.findFirst({
                    where: { 
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid 
                    },
                });
                if (!patientFileSet) {
                    logger.warn(`[PRISMA] saveDocument: Patient ${silknotePatientUuid} not found for user ${silknoteUserUuid}.`);
                return false;
            }

                const documentData = {
                    patientUuid: silknotePatientUuid,
                    clientFileId: document.clientFileId,
                originalName: document.originalName,
                storedPath: document.storedPath,
                status: document.status,
                category: document.category,
                mimeType: document.type,
                sizeBytes: document.size,
                    pageCount: document.pageCount ?? 0,
                    documentDate: medicalDateToPrismaInput(document.documentDate),
                    uploadDate: medicalDateToPrismaInput(document.uploadDate) || new Date().toISOString(), 
                    processedAt: medicalDateToPrismaInput(document.processedAt),
                    title: document.title ?? document.originalName,
                    author: document.author ?? '',
                    sourceSystem: document.sourceSystem ?? 'upload',
                    contentJson: JSON.stringify(document.content ?? defaultMedicalDocumentContent()),
                    alertsJson: JSON.stringify(document.alerts ?? []),
            };

                const docUuid = document.silknoteDocumentUuid || uuidv4();

                // For create, we need to use the relation instead of the foreign key
                const { patientUuid, ...documentDataWithoutPatientUuid } = documentData;

                await prisma.silknoteDocument.upsert({
                    where: { silknoteDocumentUuid: docUuid }, 
                    update: documentData as Prisma.SilknoteDocumentUpdateInput, 
                    create: {
                        ...documentDataWithoutPatientUuid, 
                        silknoteDocumentUuid: docUuid,
                        patientFileset: { connect: { silknotePatientUuid } }
                    },
                });
                return true;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in saveDocument for clientFileId ${document.clientFileId}:`, error);
                return false;
            }
        },

        async getDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<MedicalDocument | null> {
            console.log(`[PERF] Prisma getDocument START - ${new Date().toISOString()} - clientFileId: ${clientFileId}`);
            const startTime = Date.now();
            
            logger.info(`[PRISMA] getDocument for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, clientFileId: ${clientFileId}`);
            
            console.log(`[PERF] About to execute Prisma query - ${new Date().toISOString()}`);
            const queryStart = Date.now();
            
            try {
                // Try to use unique lookup first if clientFileId is actually the document UUID
                let prismaDoc: SilknoteDocument | null = null;
                
                // First attempt: check if clientFileId is actually a document UUID (faster unique lookup)
                if (clientFileId && clientFileId.length > 20) { // UUID-like format
                    try {
                        prismaDoc = await prisma.silknoteDocument.findUnique({
                            where: { silknoteDocumentUuid: clientFileId }
                        });
                        // Verify it belongs to the correct patient
                        if (prismaDoc && prismaDoc.patientUuid !== silknotePatientUuid) {
                            prismaDoc = null; // Wrong patient
                        }
                    } catch (e) {
                        // Not a valid UUID, continue with regular query
                    }
                }
                
                // Fallback: use the regular query with indexes
                if (!prismaDoc) {
                    prismaDoc = await prisma.silknoteDocument.findFirst({
                        where: {
                            clientFileId: clientFileId,
                            patientUuid: silknotePatientUuid,
                        }
                    });
                }
                 
                const queryDuration = Date.now() - queryStart;
                const totalDuration = Date.now() - startTime;
                const result = mapPrismaDocumentToMedicalDocument(prismaDoc);
                
                console.log(`[PERF] Prisma query completed - ${new Date().toISOString()} - Query Duration: ${queryDuration}ms, Total Duration: ${totalDuration}ms, Found: ${result ? 'YES' : 'NO'}`);
                
                return result;
            } catch (error: any) {
                const errorDuration = Date.now() - startTime;
                logger.error(`[PRISMA] Error in getDocument for clientFileId '${clientFileId}':`, error);
                console.log(`[PERF] Prisma query FAILED - ${new Date().toISOString()} - Duration: ${errorDuration}ms - Error: ${error.message}`);
                 return null;
             }
        },

        async updateDocument(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
            logger.info(`[PRISMA] updateDocument for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, clientFileId: ${document.clientFileId}`);
            const docUuid = document.silknoteDocumentUuid;
            if (!docUuid) {
                logger.error("[PRISMA] updateDocument: silknoteDocumentUuid is required.");
                return false;
            }
            try {
                const existingDoc = await prisma.silknoteDocument.findFirst({
                    where: {
                        silknoteDocumentUuid: docUuid,
                        patientUuid: silknotePatientUuid,
                        patientFileset: { silknoteUserUuid: silknoteUserUuid }
                    },
                    select: { silknoteDocumentUuid: true } 
                });

                if (!existingDoc) {
                    logger.warn(`[PRISMA] updateDocument: Doc ${docUuid} (client: ${document.clientFileId}) not found or not owned.`);
                    return false;
                }
                
                const documentDataToUpdate: Omit<Prisma.SilknoteDocumentUpdateInput, 'patientFileset' | 'patientUuid'> = {
                    clientFileId: document.clientFileId,
                    originalName: document.originalName,
                    storedPath: document.storedPath,
                    status: document.status,
                    category: document.category,
                    mimeType: document.type,
                    sizeBytes: document.size,
                    pageCount: document.pageCount ?? 0,
                    documentDate: medicalDateToPrismaInput(document.documentDate),
                    processedAt: medicalDateToPrismaInput(document.processedAt),
                    title: document.title ?? document.originalName,
                    author: document.author ?? '',
                    sourceSystem: document.sourceSystem ?? 'upload',
                    contentJson: JSON.stringify(document.content ?? defaultMedicalDocumentContent()),
                    alertsJson: JSON.stringify(document.alerts ?? []),
                };

                await prisma.silknoteDocument.update({
                    where: { silknoteDocumentUuid: docUuid },
                    data: documentDataToUpdate,
                });
                return true;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in updateDocument for ${document.clientFileId}:`, error);
                return false;
            }
        },

        async deleteDocument(silknoteUserUuid: string, silknotePatientUuid: string, clientFileId: string): Promise<boolean> {
            logger.info(`[PRISMA] deleteDocument for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, clientFileId: ${clientFileId}`);
            try {
                const deleteResult = await prisma.silknoteDocument.deleteMany({
                    where: {
                        clientFileId: clientFileId,
                        patientUuid: silknotePatientUuid,
                        patientFileset: { silknoteUserUuid: silknoteUserUuid }
                    }
                });
                return deleteResult.count > 0;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in deleteDocument for clientFileId '${clientFileId}':`, error);
                return false;
            }
        },

        async getDocumentsForPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<MedicalDocument[]> {
            logger.info(`[PRISMA] getDocumentsForPatient for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                const patientFileset = await prisma.silknotePatientFileset.findFirst({
                    where: { 
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid 
                    },
                    include: { documents: true } // Fetch full document objects
                });

                if (!patientFileset) {
                    logger.warn(`[PRISMA] getDocsForPatient: Patient ${silknotePatientUuid} for user ${silknoteUserUuid} not found.`);
                    return [];
                }
                return patientFileset.documents.map(doc => mapPrismaDocumentToMedicalDocument(doc as SilknoteDocument & { patientFileset?: any })).filter(d => d !== null) as MedicalDocument[];
            } catch (error: any) {
                logger.error(`[PRISMA] Error in getDocumentsForPatient for patient '${silknotePatientUuid}':`, error);
                return [];
            }
        },
        
        async addDocumentToPatient(silknoteUserUuid: string, silknotePatientUuid: string, document: MedicalDocument): Promise<boolean> {
            logger.info(`[PRISMA] addDocumentToPatient for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, clientFileId: ${document.clientFileId}`);
             if (!document.silknoteDocumentUuid) {
                document.silknoteDocumentUuid = uuidv4();
                logger.info(`[PRISMA] addDocumentToPatient: Generated new silknoteDocumentUuid ${document.silknoteDocumentUuid}`);
            }
            return methods.saveDocument(silknoteUserUuid, silknotePatientUuid, document);
        },

        async savePatient(silknoteUserUuid: string, patientDetails: PatientDetails): Promise<boolean> {
            logger.info(`[PRISMA] savePatient for user: ${silknoteUserUuid}, patientId: ${patientDetails.silknotePatientUuid}`);
            try {
                const patientDataForUpdate: Prisma.SilknotePatientFilesetUpdateInput = {
                    patientName: patientDetails.name,
                    patientDob: patientDetails.dateOfBirth, 
                    gender: patientDetails.gender,
                    vectorStoreJson: patientDetails.vectorStore ? JSON.stringify(patientDetails.vectorStore) : null,
                    caseSummaryJson: patientDetails.caseSummary ? JSON.stringify(patientDetails.caseSummary) : null,
                    summaryGenerationCount: patientDetails.summaryGenerationCount ?? 0,
                    user: { connect: { id: silknoteUserUuid } } // Ensure user connection on update too
                };
                const patientDataForCreate: Prisma.SilknotePatientFilesetCreateInput = {
                    silknotePatientUuid: patientDetails.silknotePatientUuid,
                    user: { connect: { id: silknoteUserUuid } },
                    patientName: patientDetails.name,
                    patientDob: patientDetails.dateOfBirth,
                    gender: patientDetails.gender,
                    vectorStoreJson: patientDetails.vectorStore ? JSON.stringify(patientDetails.vectorStore) : null,
                    caseSummaryJson: patientDetails.caseSummary ? JSON.stringify(patientDetails.caseSummary) : null,
                    summaryGenerationCount: patientDetails.summaryGenerationCount ?? 0,
                };

                await prisma.silknotePatientFileset.upsert({
                    where: { silknotePatientUuid: patientDetails.silknotePatientUuid },
                    update: patientDataForUpdate, 
                    create: patientDataForCreate,
                });
                return true;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in savePatient for patient '${patientDetails.silknotePatientUuid}':`, error);
                return false;
            }
        },

        async getPatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<PatientDetails | null> {
            console.log(`[PRISMA-DEBUG] ========== getPatient START ==========`);
            console.log(`[PRISMA-DEBUG] Input parameters:`, {
                silknoteUserUuid,
                silknotePatientUuid,
                silknoteUserUuidType: typeof silknoteUserUuid,
                silknotePatientUuidType: typeof silknotePatientUuid,
                silknoteUserUuidLength: silknoteUserUuid?.length,
                silknotePatientUuidLength: silknotePatientUuid?.length
            });
            
            logger.info(`[PRISMA] getPatient for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                console.log(`[PRISMA-DEBUG] About to execute Prisma findFirst query...`);
                console.log(`[PRISMA-DEBUG] Query parameters:`, {
                    where: {
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid
                    }
                });
                console.log(`[PRISMA-DEBUG] Include args:`, JSON.stringify(patientWithFullDocumentsArgs, null, 2));
                
                const queryStartTime = Date.now();
                const patientFileset = await prisma.silknotePatientFileset.findFirst({
                    where: { 
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid 
                    },
                    ...patientWithFullDocumentsArgs // Use predefined args for include
                });
                const queryDuration = Date.now() - queryStartTime;
                
                console.log(`[PRISMA-DEBUG] Query completed in ${queryDuration}ms`);
                console.log(`[PRISMA-DEBUG] Raw query result:`, {
                    found: !!patientFileset,
                    resultType: typeof patientFileset,
                    resultKeys: patientFileset ? Object.keys(patientFileset) : 'null',
                    silknotePatientUuid: patientFileset?.silknotePatientUuid,
                    silknoteUserUuid: patientFileset?.silknoteUserUuid,
                    patientName: patientFileset?.patientName,
                    documentsCount: patientFileset?.documents?.length || 0
                });
                
                if (!patientFileset) {
                    console.log(`[PRISMA-DEBUG] ❌ NO PATIENT FOUND - Query returned null`);
                    console.log(`[PRISMA-DEBUG] This means either:`);
                    console.log(`[PRISMA-DEBUG] 1. No record exists with silknotePatientUuid = '${silknotePatientUuid}'`);
                    console.log(`[PRISMA-DEBUG] 2. No record exists with silknoteUserUuid = '${silknoteUserUuid}'`);
                    console.log(`[PRISMA-DEBUG] 3. No record exists with BOTH conditions`);
                    console.log(`[PRISMA-DEBUG] ========== getPatient END (NOT FOUND) ==========`);
                    return null;
                }
                
                console.log(`[PRISMA-DEBUG] ✅ PATIENT FOUND - Converting to PatientDetails...`);
                const result = mapPrismaPatientToPatientDetails(patientFileset);
                console.log(`[PRISMA-DEBUG] Mapped result:`, {
                    silknotePatientUuid: result?.silknotePatientUuid,
                    silknoteUserUuid: result?.silknoteUserUuid,
                    name: result?.name,
                    fileSetCount: result?.fileSet?.length || 0
                });
                console.log(`[PRISMA-DEBUG] ========== getPatient END (SUCCESS) ==========`);
                return result;
            } catch (error: any) {
                console.error(`[PRISMA-DEBUG] ❌ QUERY ERROR:`, {
                    errorMessage: error.message,
                    errorName: error.name,
                    errorCode: error.code,
                    errorStack: error.stack
                });
                logger.error(`[PRISMA] getPatient error for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`, error);
                console.log(`[PRISMA-DEBUG] ========== getPatient END (ERROR) ==========`);
                return null;
            }
        },

        async getAllPatients(silknoteUserUuid: string): Promise<PatientDetails[]> {
            logger.info(`[PRISMA] getAllPatients for user: ${silknoteUserUuid}`);
             try {
                const patientFilesets = await prisma.silknotePatientFileset.findMany({
                    where: { silknoteUserUuid: silknoteUserUuid },
                    ...patientWithFullDocumentsArgs // Use predefined args for include
                });
                return patientFilesets.map(pf => mapPrismaPatientToPatientDetails(pf)).filter(p => p !== null) as PatientDetails[];
            } catch (error: any) {
                logger.error(`[PRISMA] Error in getAllPatients for user '${silknoteUserUuid}':`, error);
                 return [];
             }
        },

        async updatePatient(silknoteUserUuid: string, silknotePatientUuid: string, patientUpdates: Partial<PatientDetails>): Promise<boolean> {
            logger.info(`[PRISMA] updatePatient for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                const dataToUpdate: Partial<Prisma.SilknotePatientFilesetUpdateInput> = {};
                if (patientUpdates.name !== undefined) dataToUpdate.patientName = patientUpdates.name;
                if (patientUpdates.dateOfBirth !== undefined) dataToUpdate.patientDob = patientUpdates.dateOfBirth;
                if (patientUpdates.gender !== undefined) dataToUpdate.gender = patientUpdates.gender;
                if (patientUpdates.vectorStore !== undefined) dataToUpdate.vectorStoreJson = JSON.stringify(patientUpdates.vectorStore);
                if (patientUpdates.caseSummary !== undefined) dataToUpdate.caseSummaryJson = JSON.stringify(patientUpdates.caseSummary);
                if (patientUpdates.summaryGenerationCount !== undefined) dataToUpdate.summaryGenerationCount = patientUpdates.summaryGenerationCount;
                if (patientUpdates.activatedUse !== undefined) dataToUpdate.activatedUse = patientUpdates.activatedUse;
                if (patientUpdates.activatedUseTime !== undefined) {
                    dataToUpdate.activatedUseTime = patientUpdates.activatedUseTime ? new Date(patientUpdates.activatedUseTime) : null;
                }

                if (Object.keys(dataToUpdate).length === 0) {
                    logger.info(`[PRISMA] updatePatient: No valid fields to update for patient ${silknotePatientUuid}.`);
                    return true; 
                }

                const updateResult = await prisma.silknotePatientFileset.updateMany({
                    where: { silknotePatientUuid, silknoteUserUuid },
                    data: dataToUpdate,
                });
                return updateResult.count > 0;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in updatePatient for patient '${silknotePatientUuid}':`, error);
                 return false;
            }
        },

        async deletePatient(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
            logger.info(`[PRISMA] deletePatient for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
             try {
                const deleteResult = await prisma.silknotePatientFileset.deleteMany({
                    where: { silknotePatientUuid, silknoteUserUuid },
                });
                return deleteResult.count > 0;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in deletePatient for patient '${silknotePatientUuid}':`, error);
                return false;
            }
        },

        async clearPatientCaseSummary(silknoteUserUuid: string, silknotePatientUuid: string): Promise<boolean> {
            logger.info(`[PRISMA] clearPatientCaseSummary for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                const updateResult = await prisma.silknotePatientFileset.updateMany({
                    where: { silknotePatientUuid, silknoteUserUuid },
                    data: { caseSummaryJson: null, summaryGenerationCount: 0 },
                });
                return updateResult.count > 0;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in clearPatientCaseSummary for patient '${silknotePatientUuid}':`, error);
                return false;
            }
        },

        async acknowledgeDocumentAlert(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, alertType: DocumentAlertType): Promise<boolean> {
            logger.info(`[PRISMA] acknowledgeDocumentAlert for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, docUuid: ${silknoteDocumentUuid}, alertType: ${alertType}`);
             try {
                const document = await prisma.silknoteDocument.findFirst({
                    where: { silknoteDocumentUuid, patientUuid: silknotePatientUuid, patientFileset: { silknoteUserUuid } },
                    select: { alertsJson: true, clientFileId: true } 
                });

                if (!document || !document.alertsJson ) {
                    logger.warn(`[PRISMA] ack Alert: Doc ${silknoteDocumentUuid} (client: ${document?.clientFileId}) not found, no alerts JSON, or not owned.`);
                    return false;
                }

                const alerts: DocumentAlert[] = JSON.parse(document.alertsJson);
                let alertFoundAndUpdated = false;
                const updatedAlerts = alerts.map(alert => {
                    if (alert.type === alertType && !alert.acknowledged) {
                        alertFoundAndUpdated = true;
                        return { ...alert, acknowledged: true, acknowledgedAt: new Date().toISOString() };
                    }
                    return alert;
                });

                if (!alertFoundAndUpdated) {
                    logger.info(`[PRISMA] ack Alert: Type ${alertType} not found or already ack for doc ${silknoteDocumentUuid}.`);
                  return false;
             }

                await prisma.silknoteDocument.update({
                    where: { silknoteDocumentUuid: silknoteDocumentUuid },
                    data: { alertsJson: JSON.stringify(updatedAlerts) }
                 });
                return true;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in acknowledgeDocumentAlert for docUuid '${silknoteDocumentUuid}':`, error);
                return false;
             }
        },
        
        async getQueuedDocuments(silknoteUserUuid: string, silknotePatientUuid: string, limit: number = 10): Promise<string[]> {
            logger.info(`[PRISMA] getQueuedDocuments for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, limit: ${limit}`);
             try {
                const documents = await prisma.silknoteDocument.findMany({
                    where: { patientUuid: silknotePatientUuid, patientFileset: { silknoteUserUuid }, status: 'queued' },
                    take: limit,
                    orderBy: { uploadDate: 'asc' },
                    select: { clientFileId: true } 
                });
                return documents.map(doc => doc.clientFileId).filter(id => !!id) as string[];
             } catch (error) {
                logger.error(`[PRISMA] Error fetching queued documents for patient ${silknotePatientUuid}, user ${silknoteUserUuid}`, error);
                return [];
             }
        },

        async setDocumentStatus(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string, status: string): Promise<boolean> {
            logger.info(`[PRISMA] setDocumentStatus for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, docUuid: ${silknoteDocumentUuid}, status: ${status}`);
              try {
                const updateResult = await prisma.silknoteDocument.updateMany({
                    where: { silknoteDocumentUuid, patientUuid: silknotePatientUuid, patientFileset: { silknoteUserUuid } },
                      data: { status: status }
                  });
                return updateResult.count > 0;
              } catch (error: any) {
                logger.error(`[PRISMA] Error setting document status for docUuid ${silknoteDocumentUuid}`, error);
                 return false;
              }
        },

        async resetProcessingDocuments(): Promise<number> {
            logger.info(`[PRISMA] resetProcessingDocuments (global)`);
             try {
                const updateResult = await prisma.silknoteDocument.updateMany({
                    where: { status: 'processing' },
                    data: { status: 'queued' }
                });
                return updateResult.count;
            } catch (error: any) {
                logger.error(`[PRISMA] Error resetting processing documents`, error);
                 return 0;
             }
        },

        async forceReprocessPatientDocuments(silknoteUserUuid: string, silknotePatientUuid: string): Promise<number> {
            logger.info(`[PRISMA] forceReprocessPatientDocuments for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                const updateResult = await prisma.silknoteDocument.updateMany({
                    where: { patientUuid: silknotePatientUuid, patientFileset: { silknoteUserUuid } },
                    data: { status: 'queued' }
                });
                return updateResult.count;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in forceReprocessPatientDocuments for patient ${silknotePatientUuid}`, error);
                 return 0;
             }
        },

        async forceReprocessDocument(silknoteUserUuid: string, silknotePatientUuid: string, silknoteDocumentUuid: string): Promise<boolean> {
            logger.info(`[PRISMA] forceReprocessDocument for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}, document: ${silknoteDocumentUuid}`);
            return methods.setDocumentStatus(silknoteUserUuid, silknotePatientUuid, silknoteDocumentUuid, 'queued');
        },

        // New vector store validation methods
        async getPatientVectorStore(silknoteUserUuid: string, silknotePatientUuid: string): Promise<any | null> {
            logger.info(`[PRISMA] getPatientVectorStore for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                const patientFileset = await prisma.silknotePatientFileset.findFirst({
                    where: { 
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid 
                    },
                    select: { vectorStoreJson: true }
                });
                
                if (!patientFileset || !patientFileset.vectorStoreJson) {
                    return null;
                }
                
                return JSON.parse(patientFileset.vectorStoreJson);
            } catch (error: any) {
                logger.error(`[PRISMA] Error in getPatientVectorStore:`, error);
                return null;
            }
        },

        async updatePatientVectorStoreErrors(silknoteUserUuid: string, silknotePatientUuid: string, errors: VectorStoreError[]): Promise<boolean> {
            logger.info(`[PRISMA] updatePatientVectorStoreErrors for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                await prisma.silknotePatientFileset.updateMany({
                    where: {
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid 
                    },
                    data: { errors: errors as any } // Prisma will handle JSON serialization
                });
                return true;
            } catch (error: any) {
                logger.error(`[PRISMA] Error in updatePatientVectorStoreErrors:`, error);
                return false;
            }
        },

        async validateVectorStoreSync(silknoteUserUuid: string, silknotePatientUuid: string): Promise<{ isValid: boolean; missingFiles: string[]; errors: VectorStoreError[] }> {
            logger.info(`[PRISMA] validateVectorStoreSync for user: ${silknoteUserUuid}, patient: ${silknotePatientUuid}`);
            try {
                // Get patient with documents and vector store info
                const patientFileset = await prisma.silknotePatientFileset.findFirst({
                    where: {
                        silknotePatientUuid: silknotePatientUuid,
                        silknoteUserUuid: silknoteUserUuid 
                    },
                    include: { documents: true } 
                });

                if (!patientFileset) {
                    return { isValid: false, missingFiles: [], errors: [{
                        timestamp: new Date().toISOString(),
                        errorType: 'VALIDATION_FAILED',
                        message: 'Patient not found'
                    }] };
                }

                // Parse vector store data
                let vectorStore: any = null;
                if (patientFileset.vectorStoreJson) {
                    try {
                        vectorStore = JSON.parse(patientFileset.vectorStoreJson);
                    } catch (e) {
                        return { isValid: false, missingFiles: [], errors: [{
                            timestamp: new Date().toISOString(),
                            errorType: 'VALIDATION_FAILED',
                            message: 'Failed to parse vector store data',
                            details: { syncErrors: [(e as Error).message] }
                        }] };
                    }
                }

                if (!vectorStore || !vectorStore.fileIdMappings) {
                    return { isValid: false, missingFiles: [], errors: [{
                        timestamp: new Date().toISOString(),
                        errorType: 'VALIDATION_FAILED',
                        message: 'No vector store configured for patient'
                    }] };
                }

                // Get all document IDs from the database
                const dbDocumentIds = patientFileset.documents.map(doc => doc.clientFileId).filter(id => id !== null) as string[];
                
                // Get all document IDs from the vector store mappings
                const vsDocumentIds = vectorStore.fileIdMappings.map((mapping: any) => mapping.clientFileId);
                
                // Find missing files (in DB but not in vector store)
                const missingFiles = dbDocumentIds.filter(id => !vsDocumentIds.includes(id));
                
                if (missingFiles.length > 0) {
                    const missingFileDetails = patientFileset.documents
                        .filter(doc => doc.clientFileId && missingFiles.includes(doc.clientFileId))
                        .map(doc => ({
                            clientFileId: doc.clientFileId!,
                            fileName: doc.originalName,
                            documentUuid: doc.silknoteDocumentUuid
                        }));

                    const error: VectorStoreError = {
                        timestamp: new Date().toISOString(),
                        errorType: 'MISSING_FILE',
                        message: `${missingFiles.length} file(s) in database but not in vector store`,
                        details: {
                            missingFiles: missingFileDetails
                        }
                    };

                    return { isValid: false, missingFiles, errors: [error] };
                }

                return { isValid: true, missingFiles: [], errors: [] };
            } catch (error: any) {
                logger.error(`[PRISMA] Error in validateVectorStoreSync:`, error);
                return { 
                    isValid: false, 
                    missingFiles: [], 
                    errors: [{
                        timestamp: new Date().toISOString(),
                        errorType: 'VALIDATION_FAILED',
                        message: 'Validation failed with unexpected error',
                        details: { syncErrors: [error.message] }
                    }] 
                };
            }
        }
    };

    return methods;
}
