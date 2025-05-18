import { io } from '../socket'
import { MedicalDocument, DocumentType, PatientDetails, DocumentAlert, DocumentAlertType } from '@shared/types'
import { analyzeDocument } from './documentAnalyzer'
import { centralRateLimiter } from './centralRateLimiter'
import * as patientService from './patientService'
import { fromBuffer } from 'pdf2pic'
import { processDocumentsForVectorStore } from './vectorStore'
import { storageService } from '../utils/storage'
import { createLogger } from '../utils/logger'

// DOCUMENT_QUEUE process logging via centralized logger
const logger = createLogger('DOCUMENT_QUEUE')

// Export centralized rate limiter for use in all services
// Note: This is now imported from centralRateLimiter.ts

interface QueuedDocument {
  partialDoc: Partial<MedicalDocument>
  patientContext: PatientDetails
  filePath: string // Path to the file that should be retrieved from storage
}

// Processing queue to manage document processing
class SequentialProcessingQueue {
  private queue: QueuedDocument[] = []
  private isProcessing = false
  private documentMap = new Map<string, QueuedDocument>()
  private batchSize = 3
  private totalTokensAvailable = 0
  private processingStats = {
    totalProcessed: 0,
    successfulProcessed: 0,
    failedProcessed: 0,
    lastBatchStartTime: 0,
    averageProcessingTime: 0,
    lastMemoryUsage: 0
  }
  private paused = false;

  constructor() {
    this.updateTokenAvailability()
    setInterval(() => {
      this.updateTokenAvailability()
      this.logQueueStats()
    }, 60000)
  }

  private logQueueStats() {
    logger.info('[QUEUE STATS]', {
      queueSize: this.queue.length,
      documentsInProcess: this.documentMap.size,
      batchSize: this.batchSize,
      tokensAvailable: this.totalTokensAvailable,
      processingStats: this.processingStats
    })
  }

  private async updateTokenAvailability() {
    try {
      const tokenStats = await centralRateLimiter.getStatusInfo()
      this.totalTokensAvailable = tokenStats.tokenLimit - tokenStats.tokensUsed
      //     logger.appDebug(`[QUEUE] Updated token availability: ${this.totalTokensAvailable} tokens available`)
    } catch (error) {
      logger.error('[QUEUE] Error updating token availability:', error)
    }
  }

  async add(input: QueuedDocument): Promise<void> {
    const documentId = input.partialDoc.clientFileId!;
    logger.info(`[QUEUE] Adding document to queue: ${documentId}. Current queue size: ${this.queue.length}. In-progress: ${this.isProcessing}`)
    // Skip if document is already queued or processing
    if (this.documentMap.has(documentId)) {
      logger.appDebug(`Document ${documentId} already queued for processing`);
      return;
    }

    // Store document in the queue and map
    this.queue.push(input);
    this.documentMap.set(documentId, input);
    logger.info(`[QUEUE] Document ${documentId} queued. New queue size: ${this.queue.length}`)

    // Start processing if not already in progress
    if (!this.isProcessing) {
      logger.appDebug('[QUEUE] Not currently processing, invoking processNext()')
      void this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    logger.appDebug(`[QUEUE] processNext invoked. Queue length: ${this.queue.length}. Processing flag: ${this.isProcessing}`)
    if (this.isProcessing || this.queue.length === 0 || this.paused) return;

    this.isProcessing = true;
    this.processingStats.lastBatchStartTime = Date.now();
    
    try {
      logger.info('[QUEUE] Starting batch processing')
      await this.updateTokenAvailability();
      
      const currentBatchSize = Math.min(this.batchSize, this.queue.length);
      logger.info(`[QUEUE] Processing batch of size ${currentBatchSize}`)
      const batch = this.queue.slice(0, currentBatchSize);
      
      // Remove processed items from queue
      this.queue = this.queue.slice(currentBatchSize);
      logger.info(`[QUEUE] Removed batch from queue. Remaining queue size: ${this.queue.length}`)
      
      const processingPromises = batch.map(async (input) => {
        const documentId = input.partialDoc.clientFileId!;
        const startTime = Date.now();
        logger.info(`[PROCESS] Beginning processing for document ${documentId}`)
        
        try {
          // Process the document using the stored file path
          await processDocument(input);
          this.processingStats.successfulProcessed++;
          logger.info(`[PROCESS] Document ${documentId} processed successfully`)
          
          // Remove from documentMap if complete
          if (input.partialDoc.status === 'complete') {
            this.documentMap.delete(documentId);
            logger.info(`[QUEUE] Document ${documentId} removed from map after completion`)
          }
          
          return { id: documentId, success: true, processingTime: Date.now() - startTime };
        } catch (error) {
          logger.error('[DOCUMENT] Processing failed:', {
            documentId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          this.processingStats.failedProcessed++;
          this.documentMap.delete(documentId);
          logger.info(`[QUEUE] Document ${documentId} removed from map after failure`)
          
          return { id: documentId, success: false, error };
        }
      });

      await Promise.all(processingPromises);
      logger.info('[QUEUE] Batch processing complete')
      
    } finally {
      this.isProcessing = false;
      logger.appDebug('[QUEUE] processNext batch finished, isProcessing set to false')
      if (this.queue.length > 0) {
        logger.appDebug('[QUEUE] Queue not empty, scheduling next batch')
        setImmediate(() => this.processNext());
      }
    }
  }

  // private updateAverageProcessingTime(newTime: number) {
  //   this.processingStats.averageProcessingTime = 
  //     (this.processingStats.averageProcessingTime * (this.processingStats.totalProcessed - 1) + newTime) 
  //     / this.processingStats.totalProcessed;
  // }

  /**
   * Gets the number of documents currently in the queue
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Checks if a document is currently in the queue
   * @param documentId ID of the document to check
   */
  has(documentId: string): boolean {
    return this.documentMap.has(documentId);
  }
  
  /**
   * Sets the batch size for document processing
   * @param size New batch size
   */
  setBatchSize(size: number): void {
    if (size < 1) {
      logger.error(`[QUEUE] Invalid batch size: ${size}. Setting to 1.`);
      this.batchSize = 1;
    } else {
      this.batchSize = size;
      logger.info(`[QUEUE] Batch size set to ${this.batchSize}`);
    }
  }

  public pause(): void {
    this.paused = true;
    logger.info('[QUEUE] Processing paused');
  }

  public resume(): void {
    this.paused = false;
    logger.info('[QUEUE] Processing resumed');
    setImmediate(() => this.processNext());
  }
}

// Initialize sequential processing queue
const processingQueue = new SequentialProcessingQueue();

// Helper to extract PDF page images using pdf2pic and the provided pageCount
async function extractPdfImages(buffer: Buffer, pageCount: number): Promise<string[]> {
  const MAX_PAGES_PER_BATCH = 5
  const PROCESSING_DELAY_MS = 100

  // Process all pages without limit
  const pagesToProcess = pageCount
  
  const options = {
    density: 150,
    format: "png",
    width: 800,
    height: 600,
    quality: 100,
    saveFilename: "page",
    savePath: "",         // empty string prevents file saving
    outputType: "base64"  // returns a base64 encoded image
  }
  
  // Reduce density for very large documents to save memory
  if (pageCount > 20) {
    options.density = 120
    options.width = 600
    options.height = 450
  }
  
  const converter = fromBuffer(buffer, options)
  const imageResults: string[] = []
  
  // Process pages in batches to reduce memory pressure
  for (let batchStart = 1; batchStart <= pagesToProcess; batchStart += MAX_PAGES_PER_BATCH) {
    const batchEnd = Math.min(batchStart + MAX_PAGES_PER_BATCH - 1, pagesToProcess)
    // console.log(`[PDF EXTRACTION] Processing batch of pages ${batchStart}-${batchEnd} of ${pageCount}`)
    
    const batchPromises: Promise<string>[] = []
    for (let i = batchStart; i <= batchEnd; i++) {
      batchPromises.push(converter(i).then((res: any) => res.base64))
    }
    
    // Process batch
    const batchResults = await Promise.all(batchPromises)
    imageResults.push(...batchResults)
    
    // Add a small delay between batches to allow for GC
    if (batchEnd < pagesToProcess) {
      await delay(PROCESSING_DELAY_MS)
    }
  }
  
  return imageResults
}

// Add a helper function for logging socket events
function logSocketEmit(room: string, event: string, data: any) {
  logger.appDebug(`[SOCKET EMIT] Room: ${room}, Event: ${event}`, {
    timestamp: new Date().toISOString(),
    room,
    event,
    data: {
      id: data.clientFileId || data.fileId,
      status: data.status,
      category: data.category,
      type: typeof data
    }
  });

  // Add direct emit logging
  logger.appDebug(`[SOCKET EMIT] Calling io.to(${room}).emit('${event}')`, {
    timestamp: new Date().toISOString(),
    payload: data
  });
}

export async function queueDocument(input: { 
  filePath: string, 
  partialDoc: Partial<MedicalDocument>, 
  patientContext: PatientDetails 
}): Promise<void> {
  logger.info('[DOCUMENT QUEUE] Queueing document for processing:', {
    documentId: input.partialDoc.clientFileId,
    filePath: input.filePath,
    patientId: input.patientContext.silknotePatientUuid
  });
  
  // Validate input
  if (!input.filePath) {
    throw new Error('File path is required');
  }
  
  if (!input.partialDoc.clientFileId) {
    throw new Error('Document clientFileId is required');
  }
  
  if (!input.patientContext || !input.patientContext.silknotePatientUuid) {
    throw new Error('Patient context with ID is required');
  }
  
  // Ensure storedPath is set correctly in the partialDoc
  input.partialDoc.storedPath = input.filePath;
  
  // Add to processing queue
  await processingQueue.add({
    partialDoc: input.partialDoc,
    patientContext: input.patientContext,
    filePath: input.filePath
  });

  const statusEvent = {
    clientFileId: input.partialDoc.clientFileId,
    silknotePatientUuid: input.patientContext.silknotePatientUuid,
    status: 'queued',
    processingStage: 'queued'
  };
  logger.appDebug(`[PROCESS] Emitting status: ${JSON.stringify(statusEvent)}`);
  const roomName = `patient-${input.patientContext.silknotePatientUuid}`;
  io.to(roomName).emit('fileStatus', statusEvent);
}

async function processDocument(input: QueuedDocument): Promise<void> {
  // Ensure we have a filePath
  if (!input.filePath) {
    throw new Error('File path is required for document processing');
  }
  
  const { partialDoc, patientContext, filePath } = input;
  
  // Ensure clientFileId exists on the document
  if (!partialDoc.clientFileId) {
    throw new Error('Document must have a clientFileId');
  }
  
  const documentId = partialDoc.clientFileId!;
  const room = `patient-${patientContext.silknotePatientUuid}`;
  const processingStages = ['initializing', 'analyzing', 'extracting', 'categorizing'];
  
  // Add validation error logging helper
  const logValidationError = (stage: string, error: any) => {
    if (error && error.name === 'ZodError' && error.issues) {
      logger.error(`[PROCESSING] Validation error in stage '${stage}' for document ${documentId}:`, {
        errorType: 'ValidationError',
        errorName: error.name,
        errorIssues: error.issues,
        documentId,
        silknotePatientUuid: patientContext.silknotePatientUuid,
        timestamp: new Date().toISOString()
      });
    }
  };
  
  // Ensure required fields are present
  if (!partialDoc.originalName || !partialDoc.type) {
    throw new Error('Missing required document fields');
  }
  
  // console.log('[PROCESSING] Document processing started:', {
  //   documentId,
  //   clientProvidedId: true, // Mark that we're using the client-provided ID
  //   silknotePatientUuid: patientContext.silknotePatientUuid,
  //   timestamp: new Date().toISOString(),
  //   stages: processingStages
  // });
  
  // Track the complete document to emit at the end
  let completeDoc: MedicalDocument | null = null;
  
  // Process through stages sequentially
  for (const stage of processingStages) {
    // const stageStartTime = Date.now();
    
    // Emit status update at the start of each processing stage
    io.to(room).emit('fileStatus', {
      clientFileId: documentId,
      silknotePatientUuid: patientContext.silknotePatientUuid,
      status: 'processing',
      processingStage: stage
    });
    
    try {
      switch (stage) {
        case 'initializing':
          // Initial setup and validation
          await delay(100); // Small delay to ensure status updates are sent
          break;
          
        case 'analyzing':
          try {
            // Extract page images before analysis if needed
            if (!partialDoc.content?.pageImages || partialDoc.content.pageImages.length === 0) {
              //console.log(`[PROCESSING] Extracting page images for document ${documentId}`);
              
              // Only load buffer when needed for image extraction
              let imageExtractionBuffer = null;
              try {
                // Get page count if available, otherwise use 1
                const pageCount = partialDoc.pageCount || 1;
                
                // Load buffer only for image extraction
                //console.log(`[PROCESSING] Loading buffer for image extraction: ${documentId}`);
                imageExtractionBuffer = await storageService.getFileContent(filePath);
                
                // Extract images using the existing function
                const pageImages = await extractPdfImages(imageExtractionBuffer, pageCount);
                
                // Ensure partialDoc.content is defined as expected
                if (!partialDoc.content) {
                  partialDoc.content = {
                    analysisResult: null,
                    extractedSchemas: [],
                    enrichedSchemas: [],
                    pageImages: []
                  };
                }
                
                // Assign extracted images to the document
                partialDoc.content.pageImages = pageImages;
                
              //  console.log(`[PROCESSING] Successfully extracted ${pageImages.length} page images for document ${documentId}`);
              } catch (extractError) {
                logger.error(`[PROCESSING] Failed to extract page images for document ${documentId}:`, extractError);
                // Continue with empty page images array rather than failing
                if (!partialDoc.content) {
                  partialDoc.content = {
                    analysisResult: null,
                    extractedSchemas: [],
                    enrichedSchemas: [],
                    pageImages: []
                  };
                }
              } finally {
                // Clear buffer reference to allow garbage collection
                imageExtractionBuffer = null;
              }
            }
            
            // Now load buffer separately for document analysis
            let analysisBuffer = null;
            try {
           //   console.log(`[PROCESSING] Loading buffer for document analysis: ${documentId}`);
              analysisBuffer = await storageService.getFileContent(filePath);
              
              const medicalDocument = await analyzeDocument({ 
                documentId, 
                buffer: analysisBuffer, 
                partialDoc 
              });
              
              // Ensure we have a complete document after analysis
              if (!medicalDocument.clientFileId || !medicalDocument.category) {
              //  console.log(`[PROCESSING] Analysis returned incomplete document - applying defaults.`);
                // Apply defaults instead of throwing error
                medicalDocument.clientFileId = medicalDocument.clientFileId || documentId;
                medicalDocument.category = medicalDocument.category || DocumentType.UNKNOWN;
              }
              
              // Update partialDoc with the results of analysis
              const updatedPartialDoc = { 
                ...partialDoc, 
                ...medicalDocument,
                // Keep the same status to prevent premature completion
                status: partialDoc.status
              };
              
              // Update our copy
              Object.assign(partialDoc, updatedPartialDoc);
            } finally {
              // Clear analysis buffer
              analysisBuffer = null;
            }
            
            // Check for incorrect patient data and add alert if needed
            const detectedPatientName = extractPatientNameFromDocument(partialDoc);
            const detectedPatientDOB = extractPatientDOBFromDocument(partialDoc);
            
            // If we detected patient info, compare with actual patient
            if (detectedPatientName || detectedPatientDOB) {
              const patient = await patientService.getPatientById(patientContext.silknotePatientUuid);
              
              // Check if patient matches detected info
              const nameMatches = !detectedPatientName || 
                !patient?.name || 
                patient.name.toLowerCase().includes(detectedPatientName.toLowerCase()) ||
                detectedPatientName.toLowerCase().includes(patient.name.toLowerCase());
                
              const dobMatches = !detectedPatientDOB || 
                !patient?.dateOfBirth || 
                patient.dateOfBirth.includes(detectedPatientDOB) ||
                detectedPatientDOB.includes(patient.dateOfBirth);
              
              if (!nameMatches || !dobMatches) {
                // console.log(`[PROCESSING] Detected possible incorrect patient assignment.`);
                // console.log(`Patient name: ${patient?.name}, Detected: ${detectedPatientName}`);
                // console.log(`Patient DOB: ${patient?.dateOfBirth}, Detected: ${detectedPatientDOB}`);
                
                // Mark document as potentially having incorrect patient
                partialDoc.isIncorrectPatient = true;
                
                // Add detected info
                partialDoc.detectedPatientInfo = {
                  name: detectedPatientName || undefined,
                  dateOfBirth: detectedPatientDOB || undefined
                };
                
                // Add alert
                if (!partialDoc.alerts) partialDoc.alerts = [];
                
                const incorrectPatientAlert: DocumentAlert = {
                  type: DocumentAlertType.INCORRECT_PATIENT,
                  description: `Document may belong to a different patient. Detected name: ${detectedPatientName || 'Unknown'}, DOB: ${detectedPatientDOB || 'Unknown'}`,
                  source: 'SERVER_API_CALL',
                  timestamp: new Date().toISOString(),
                  acknowledged: false
                };
                
                partialDoc.alerts.push(incorrectPatientAlert);
              }
            }
          } catch (error) {
            // Handle analysis errors more gracefully
            const analyzeError = error as Error;
            // console.log(`[PROCESSING] Analysis error for ${documentId}:`, analyzeError);
            
            // Check for validation errors specifically
            if (analyzeError && analyzeError.name === 'ZodError') {
              logValidationError('analyzing', analyzeError);
            }
            
            // Apply defaults for critical fields instead of failing completely
            if (!partialDoc.category) {
              partialDoc.category = DocumentType.UNKNOWN;
            //    console.log(`[PROCESSING] Applied default category ${DocumentType.UNKNOWN} after analysis error`);
            } else {
              // console.log(`[PROCESSING] Keeping existing category ${partialDoc.category} despite analysis error`);
            }
            
            // Fix for the alert error in error handling
            if (!partialDoc.alerts) partialDoc.alerts = [];
            
            // Safely extract error message
            const errorMessage = analyzeError && typeof analyzeError === 'object' && 'message' in analyzeError 
              ? String(analyzeError.message) 
              : 'Unknown error';
              
            const analysisErrorAlert: DocumentAlert = {
              type: DocumentAlertType.ERROR,
              description: `Analysis error: ${errorMessage}`,
              source: 'SERVER_API_CALL',
              timestamp: new Date().toISOString(),
              acknowledged: false
            };
            
            partialDoc.alerts.push(analysisErrorAlert);
            
            // Don't rethrow - continue processing with default values
          }
          break;
          
        case 'extracting':
          // Process for vector store
          try {
            // Load buffer separately just for vector store processing
            let vectorBuffer = null;
            try {
              // console.log(`[PROCESSING] Loading buffer for vector store processing: ${documentId}`);
              vectorBuffer = await storageService.getFileContent(filePath);
            
                
              // Use ONLY clientFileId with file extension - this is critical for citation matching
              const filename = `${partialDoc.clientFileId}.pdf`;
              console.log(`[VECTOR STORE] Setting filename for vector store upload: ${filename}`);
              
              const vectorStoreFile = new File([vectorBuffer], filename, {
                type: partialDoc.type || 'application/pdf',
                lastModified: Date.now()
              });
              
              console.log(`[VECTOR STORE] Using explicit clientFileId as filename: ${filename}`);
              
              // Call vectorStore processing - no mapping parameter needed as filename is already set
              await processDocumentsForVectorStore(
                [vectorStoreFile], 
                patientContext.silknotePatientUuid
              );
            } finally {
              // Clear vector buffer
              vectorBuffer = null;
            }
          } catch (error) {
            logger.error(`[PROCESSING] Error processing document for vector store:`, error);
            // Continue processing even if vector store fails
          }
          break;
          
        case 'categorizing':
          // Ensure we have a complete document before updating
          if (!partialDoc.originalName) {
            throw new Error('Missing required field: originalName');
          }
          
          // Log the state before creating complete doc
          // console.log(`[PROCESSING] Pre-completion document state for ${documentId}:`, {
          //   partialCategory: partialDoc.category,
          //   partialStatus: partialDoc.status,
          //   stage: 'categorizing',
          //   timestamp: new Date().toISOString()
          // });
          
          completeDoc = {
            ...partialDoc as MedicalDocument, // Cast to MedicalDocument since we've validated required fields
            clientFileId: documentId, // Use clientFileId as the primary identifier
            silknotePatientUuid: patientContext.silknotePatientUuid,
            originalName: partialDoc.originalName,
            status: 'complete',
            category: partialDoc.category || DocumentType.UNPROCESSED,
            type: partialDoc.type,
            size: partialDoc.size || 0,
            title: partialDoc.title || partialDoc.originalName,
            format: partialDoc.format || {
              mimeType: partialDoc.type,
              extension: partialDoc.originalName.split('.').pop() || ''
            },
            fileSize: partialDoc.size || 0,
            pageCount: partialDoc.pageCount || 0,
            documentDate: partialDoc.documentDate || new Date().toISOString(),
            uploadDate: partialDoc.uploadDate || new Date().toISOString(),
            processedAt: new Date().toISOString(),
            author: partialDoc.author || '',
            sourceSystem: partialDoc.sourceSystem || 'upload',
            confidence: partialDoc.confidence || 0,
            content: partialDoc.content || {
              analysisResult: null,
              extractedSchemas: [],
              enrichedSchemas: [],
              pageImages: []
            }
          };
          await patientService.updateFileForPatient(patientContext.silknotePatientUuid, completeDoc);
          Object.assign(partialDoc, completeDoc);
          break;
      }
      
    //  const stageDuration = Date.now() - stageStartTime;
      // console.log('[PROCESSING] Stage completed:', {
      //   documentId,
      //   stage,
      //   duration: stageDuration,
      //   timestamp: new Date().toISOString()
      // });
      
    } catch (error) {
      logger.error('[PROCESSING] Stage failed:', {
        documentId,
        stage,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      
      // Log extraction validation errors in a more structured way
      if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
        logValidationError(stage, error);
      }
      
      // Log detailed error information 
      // console.log(`[PROCESSING] Critical error in stage '${stage}' for document ${documentId}:`, {
      //   errorMessage: error instanceof Error ? error.message : 'Unknown error',
      //   errorType: error instanceof Error ? error.constructor.name : typeof error,
      //   documentId,
      //   silknotePatientUuid: patientContext.silknotePatientUuid,
      //   category: partialDoc.category,
      //   stage,
      //   timestamp: new Date().toISOString()
      // });
      
      // Attempt to salvage the document by marking it as error but still completing it
      // with whatever data we have so far
      try {
        // Fix for the error in error handling inside try/catch
        // Create an error document to return to the client
        const errorDocument: MedicalDocument = {
          ...partialDoc as MedicalDocument,
          clientFileId: documentId,
          silknotePatientUuid: patientContext.silknotePatientUuid,
          originalName: partialDoc.originalName || '',
          status: 'error',
          category: 'ERROR' as DocumentType,
          title: partialDoc.title || partialDoc.originalName || `Document-${documentId}`,
          alerts: [
            ...(partialDoc.alerts || []), 
            {
              type: DocumentAlertType.ERROR,
              description: `Processing error in stage '${stage}': ${error instanceof Error ? error.message : 'Unknown error'}`,
              source: 'SERVER_API_CALL',
              timestamp: new Date().toISOString(),
              acknowledged: false
            }
          ]
        };
        
        // Persist the error document
        await patientService.updateFileForPatient(patientContext.silknotePatientUuid, errorDocument);
        
        // Emit the error status
        const errorUpdate = {
          clientFileId: documentId,
          status: 'error',
          processingStage: stage,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        logSocketEmit(room, 'fileStatus', errorUpdate);
        io.to(room).emit('fileStatus', errorUpdate);
        
        // Also emit a processingComplete with the error document to ensure it appears in the UI
        const errorCompletion = {
          clientFileId: documentId,
          silknotePatientUuid: patientContext.silknotePatientUuid,
          status: 'error',
          processingStage: 'error',
          medicalDocument: {
            ...errorDocument,
            // Ensure clientFileId matches the document ID
            clientFileId: documentId
          }
        };
        
        // console.log(`[PROCESSING] Emitting errorCompletion for failed document ${documentId}`, {
        //   status: 'error',
        //   processingStage: 'error',
        //   category: errorDocument.category,
        //   timestamp: new Date().toISOString()
        // });
        
        logSocketEmit(room, 'fileStatus', errorCompletion);
        io.to(room).emit('fileStatus', errorCompletion);
        
      } catch (secondaryError) {
        // If even our error handling fails, log it but still rethrow the original error
        logger.error(`[PROCESSING] Failed to emit error document for ${documentId}:`, secondaryError);
      }
      
      // Rethrow the original error to abort processing for this document
      throw error;
    }
  }
  
  // Emit completion event with complete document immediately 
  // after all processing is done for this individual document
  if (completeDoc) {
    const completionEventId = `pc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const completionEvent = {
      clientFileId: documentId,
      silknotePatientUuid: patientContext.silknotePatientUuid,
      status: 'complete',
      processingStage: 'complete',
      medicalDocument: {
        ...completeDoc,
        // Ensure clientFileId matches the document ID
        clientFileId: documentId
      }
    };
    
    // console.log(`***** DOCUMENT PROCESSING COMPLETE: WEBSOCKET EVENT EMISSION [${completionEventId}] *****`);
    // console.log(`[DOCUMENT SERVICE] Document ${documentId} (${completeDoc.originalName}) is complete and ready for emission`);
    // console.log(`[DOCUMENT SERVICE] Emitting to room: ${room}`);
    // Debug the event structure in detail
    logger.appDebug(`[DOCUMENT SERVICE] Completion event structure [${completionEventId}]:`, {
      eventType: 'fileStatus',
      clientFileId: completionEvent.clientFileId,
      silknotePatientUuid: completionEvent.silknotePatientUuid,
      status: completionEvent.status,
      processingStage: completionEvent.processingStage,
      documentName: completionEvent.medicalDocument.originalName,
      documentCategory: completionEvent.medicalDocument.category
    });
    
    // Check for room clients before emitting
    const roomClients = io.sockets.adapter.rooms.get(room) || new Set();
  //  console.log(`[DOCUMENT SERVICE] Room ${room} has ${roomClients.size} connected clients for processingComplete [${completionEventId}]`);
    
    // Log active socket connections
   // const connectedSockets = Array.from(io.sockets.sockets.values());
    // console.log(`[DOCUMENT SERVICE] Currently connected sockets: ${connectedSockets.length} for event [${completionEventId}]`);
    
    logSocketEmit(room, 'fileStatus', completionEvent);
  //  console.log(`[SOCKET] About to emit processingComplete [${completionEventId}] to room ${room}`);
    io.to(room).emit('fileStatus', completionEvent);
  //  console.log(`[SOCKET] Completed emit processingComplete [${completionEventId}] to room ${room}`);
    
    // Log client details after emission
    if (roomClients.size > 0) {
      // const clientDetails = Array.from(roomClients).map(clientId => { // Unused variable
      //   const socket = io.sockets.sockets.get(clientId);
      //   return {
      //     id: clientId,
      //     rooms: socket ? Array.from(socket.rooms) : [],
      //     handshake: socket ? {
      //       address: socket.handshake.address,
      //       time: socket.handshake.time
      //     } : null
      //   };
      // });
    }
    
    // console.log(`***** END DOCUMENT PROCESSING COMPLETE EVENT [${completionEventId}] *****`);
  }
  
  // console.log('[PROCESSING] Document processing completed:', {
  //   documentId,
  //   silknotePatientUuid: patientContext.silknotePatientUuid,
  //   timestamp: new Date().toISOString()
  // });
}

// Helper function to extract patient name from a document
function extractPatientNameFromDocument(document: Partial<MedicalDocument>): string | null {
  // Early return if no analysis result
  if (!document.content?.analysisResult) return null;
  
  try {
    // Check extracted schemas first if available (most reliable)
    if (document.content.extractedSchemas && document.content.extractedSchemas.length > 0) {
      for (const schema of document.content.extractedSchemas) {
        // Look for patient fields in the schema
        if (schema.patientName) return schema.patientName;
        if (schema.patient?.name) return schema.patient.name;
        if (schema.patient?.fullName) return schema.patient.fullName;
        if (schema.subject?.name) return schema.subject.name;
      }
    }
    
    // If we have extracted page content, try to find patient name patterns
    if (document.content.pageImages && document.content.pageImages.length > 0) {
      // First page typically contains patient info
      // This is just a simple heuristic approach using a basic regex pattern
      
      // Get extracted text content if available 
      let textContent = '';
      
      // Check if we have any page text content we can use
      if (document.content.analysisResult.pages) {
        for (const page of document.content.analysisResult.pages) {
          if (page.lines) {
            for (const line of page.lines) {
              textContent += (line.content || '') + ' ';
            }
          }
        }
      }
      
      // Simple pattern matching for "Patient: Name" or "Patient Name: John Smith" formats
      const namePatterns = [
        /patient\s*(?:name|:)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
        /name\s*(?:of patient|:)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
        /(?:^|:|\n)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*(?:DOB|Date of Birth)/i  // Name before DOB
      ];
      
      for (const pattern of namePatterns) {
        const match = textContent.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    }
    
    return null;
  } catch (error) {
   // console.log('[DOCUMENT SERVICE] Error extracting patient name:', error);
    return null;
  }
}

// Helper function to extract patient date of birth from a document
function extractPatientDOBFromDocument(document: Partial<MedicalDocument>): string | null {
  // Early return if no analysis result
  if (!document.content?.analysisResult) return null;
  
  try {
    // Check extracted schemas first if available (most reliable)
    if (document.content.extractedSchemas && document.content.extractedSchemas.length > 0) {
      for (const schema of document.content.extractedSchemas) {
        // Look for DOB fields in the schema
        if (schema.patientDOB) return schema.patientDOB;
        if (schema.patient?.dateOfBirth) return schema.patient.dateOfBirth;
        if (schema.patient?.dob) return schema.patient.dob;
        if (schema.subject?.dateOfBirth) return schema.subject.dateOfBirth;
      }
    }
    
    // Try to find date patterns in the text content
    // Get extracted text content if available 
    let textContent = '';
    
    // Check if we have any page text content we can use
    if (document.content.analysisResult.pages) {
      for (const page of document.content.analysisResult.pages) {
        if (page.lines) {
          for (const line of page.lines) {
            textContent += (line.content || '') + ' ';
          }
        }
      }
    }
    
    // Common date of birth patterns
    const dobPatterns = [
      /(?:DOB|Date of Birth|Birth Date)\s*(?::|is|:)?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /Born\s*(?:on|:)?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\s*\(DOB\)/i
    ];
    
    for (const pattern of dobPatterns) {
      const match = textContent.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return null;
  } catch (error) {
    //console.log('[DOCUMENT SERVICE] Error extracting patient DOB:', error);
    return null;
  }
}

// Helper delay function
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// NO LONGER EXPORTING A SINGLE OBJECT - functions are exported individually
// // Removed deprecated helper functions previously using patientService

// Export documentService functions
export const documentService = {
  queueDocument,
  
  // Get a document by ID
  async getDocumentById(documentId: string): Promise<MedicalDocument | null> {
    const patients = await patientService.getPatients()
    for (const patient of patients) {
      const foundDocument = patient.fileSet.find(file => file.clientFileId === documentId)
      
      // Only log the critical info, not the entire document and patient
      if (foundDocument) {
        // console.log(`[DOCUMENT SERVICE] Found document ${documentId}:`, {
        //   clientFileId: foundDocument.clientFileId,
        //   status: foundDocument.status,
        //   category: foundDocument.category,
        //   silknotePatientUuid: patient.silknotePatientUuid
        // });
        
        return foundDocument;
      }
    }
    
   // console.log(`[DOCUMENT SERVICE] Document not found: ${documentId}`);
    return null;
  },
  
  // Get complete document content
  async getDocumentContent(documentId: string): Promise<any> {
    try {
      // console.log(`[DOCUMENT SERVICE] Getting content for document: ${documentId}`);
      
      // Get from storage service instead of directly reading file
      const document = await storageService.getDocument(documentId);
      if (document && document.content) {
        return document.content;
      }
      
      // console.log(`[DOCUMENT SERVICE] No content found for document: ${documentId}`);
      return null;
    } catch (error) {
      // console.log(`[DOCUMENT SERVICE] Error reading document content:`, error);
      return null;
    }
  },
  
  // Update an existing document
  async updateDocument(document: MedicalDocument): Promise<boolean> {
    try {
      await storageService.updateDocument(document);
      return true;
    } catch (error) {
      logger.error(`Error updating document ${document.clientFileId}:`, error);
      return false;
    }
  }
};

export { processingQueue };
