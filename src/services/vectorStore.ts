// server/src/services/vectorStore.ts

import { AzureOpenAI } from 'openai';
import * as patientService from './patientService';
import config from '../config';
import { MedicalDocument } from '../shared/types';
import { storageService } from '../utils/storage';
// import { createLogger } from '../utils/logger'; // Unused import


const openai = new AzureOpenAI({
  apiKey: config.azure.azureOpenAI.key,
  endpoint: config.azure.azureOpenAI.endpoint,
  apiVersion: '2024-05-01-preview',
});

// Enhance the existing PatientVectorStore type with fileIdMappings
declare module '../shared/vectorStore' {
  interface PatientVectorStore {
    fileIdMappings?: Array<{
      openaiFileId: string;
      clientFileId: string;
      fileName?: string;
    }>;
  }
}

export async function processDocumentsForVectorStore(
  files: File[],
  silknotePatientUuid: string,
  silknoteUserUuid: string,
  clientFileIds?: Record<string, string>
): Promise<{
  success: boolean
  assistantId: string
  vectorStoreId: string
  processedFiles: Array<{
    fileName: string
    fileId: string
    status: string
  }>
}> {
  console.log('[VECTOR STORE] Processing documents for vector store', {
    fileCount: files.length,
    patientId: silknotePatientUuid,
    userUuid: silknoteUserUuid
  })

  try {
    // Log important instructions about clientFileIds parameter
    console.log(`[VECTOR STORE] Processing documents for patient ${silknotePatientUuid}`);
    if (clientFileIds) {
      console.log(`[VECTOR STORE] Using provided clientFileIds mapping for ${Object.keys(clientFileIds).length} files`);
    } else {
      console.log(`[VECTOR STORE] No clientFileIds mapping provided - using filename as clientFileId`);
    }

    const patient = await patientService.getPatientById(silknotePatientUuid, silknoteUserUuid);
    if (!patient) throw new Error('Patient not found');

    // Get or initialize vector store
    let vectorStore = patient.vectorStore;
    if (!vectorStore) {
      // Create assistant
      const assistant = await openai.beta.assistants.create({
        name: `Assistant-${silknotePatientUuid}`,
        instructions: `You are a helpful assistant with access to a vector store containing important documents for medical, medicolegal and very high tier healthcare information for medical interpretation. Medicolegal doctors ask you questions to inform their clinical judgement about the case they have been asked to review. It is important your answers are succinct dot points but cover all pertinent information. The questions are not general in nature - they relate to the files in the vector store, so you MUST always use it.`,
        model: 'gpt-4o',
        tools: [
          {
            type: 'file_search',
            file_search: {
              max_num_results: 50,
              ranking_options: {
                score_threshold: 0.7,
                ranker: 'default_2024_08_21',
              },
            },
          },
        ],
      });

      // Create vector store
      const vectorStoreResponse = await openai.beta.vectorStores.create({
        name: `vs-${silknotePatientUuid}`,
      });

      vectorStore = {
        assistantId: assistant.id,
        vectorStoreIndex: vectorStoreResponse.id,
        assistantCreatedAt: new Date().toISOString(),
        assistantStatus: 'ready',
        processedFiles: [],
        fileIdMappings: [], // Initialize fileIdMappings array
        lastUpdated: new Date().toISOString()
      };
    } else if (!vectorStore.fileIdMappings) {
      // Ensure fileIdMappings exists even if vectorStore was already present
      vectorStore.fileIdMappings = [];
    }

    // Process files
    const processedFilesList = [];
    const fileIdMappings = [];
    
    for (const file of files) {

      // Use the file as-is with the name that was set in documentService.ts (should be clientFileId)
      // This replaces the previous comment about using the "ACTUAL filename"
      const uploadFile = file;

      const uploadedFile = await openai.files.create({
        file: uploadFile,
        purpose: 'assistants',
      });

      await openai.beta.vectorStores.files.create(vectorStore.vectorStoreIndex!, {
        file_id: uploadedFile.id,
      });

      // Get the clientFileId from the mapping if provided, otherwise use filename
      const clientFileId = file.name.split('.')[0];
      
      // Store the mapping between OpenAI's file_id and our client's file reference
      fileIdMappings.push({
        openaiFileId: uploadedFile.id,
        clientFileId: clientFileId,
        fileName: file.name
      });
      
      console.log(`[VECTOR STORE] Created file mapping: OpenAI ID ${uploadedFile.id} -> Client ID ${clientFileId} (Filename: ${file.name})`);

      processedFilesList.push({
        fileName: file.name,
        fileId: uploadedFile.id,
        status: 'processed',
      });
    }

    // Update assistant with vector store using vectorStoreId
    await openai.beta.assistants.update(vectorStore.assistantId!, {
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStore.vectorStoreIndex!],
        },
      },
    });

    // Create the updated vectorStore part first
    const updatedVectorStore = {
      ...vectorStore,
      // Store the full file objects, not just IDs, to match the expected type
      processedFiles: [...(vectorStore.processedFiles || []), ...processedFilesList], 
      fileIdMappings: [...(vectorStore.fileIdMappings || []), ...fileIdMappings],
      lastUpdated: new Date().toISOString(),
      // Ensure assistantId, vectorStoreId etc. are correctly passed from the existing/newly created vectorStore
      assistantId: vectorStore.assistantId, 
      vectorStoreId: vectorStore.vectorStoreIndex,
      assistantCreatedAt: vectorStore.assistantCreatedAt,
      assistantStatus: vectorStore.assistantStatus,
    };

    // Update patient data with the correctly typed vectorStore
    const updatedPatientData = {
      ...patient,
      vectorStore: updatedVectorStore,
    };

    // Pass the correctly structured object to updatePatient
    await patientService.updatePatient(updatedPatientData);

    // Return the full processed file info, but only store IDs
    return {
      success: true,
      assistantId: vectorStore.assistantId!, 
      vectorStoreId: vectorStore.vectorStoreIndex!, 
      processedFiles: processedFilesList,
    };
  } catch (error) {
    console.log('Error in vector store processing:', error);
    throw error;
  }
}

export async function queryVectorStore(
  silknotePatientUuid: string,
  query: string,
  silknoteUserUuid: string
): Promise<{ threadId: string; runId: string }> {
  console.log('[VECTOR STORE] Querying vector store for patient:', silknotePatientUuid)

  try {
    const patient = await patientService.getPatientById(silknotePatientUuid, silknoteUserUuid);
    if (!patient) throw new Error('Patient not found');
    if (!patient.vectorStore?.assistantId) {
      throw new Error('No vector store assistant configured for patient');
    }

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: query,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: patient.vectorStore.assistantId,
    });

    console.log(JSON.stringify(run, null, 2));

    return {
      threadId: thread.id,
      runId: run.id,
    };
  } catch (error) {
    console.error('Error in queryVectorStore:', error);
    throw error;
  }
}

// export async function refineSummaryWithVectorStore(
//   silknotePatientUuid: string,
//   initialSummary: CaseSummaryType
// ): Promise<CaseSummaryType> {
//   try {
//     //console.log(`[VECTOR STORE REFINEMENT] Starting refinement for patient ${silknotePatientUuid}`);
    
//     const patient = await patientService.getPatientById(silknotePatientUuid);
//     if (!patient) throw new Error('Patient not found');
//     if (!patient.vectorStore?.assistantId) {
//       throw new Error('No vector store assistant configured for patient for summary refinement');
//     }

//     // console.log(`[VECTOR STORE REFINEMENT] Creating new thread for patient ${silknotePatientUuid}`);
//     // console.log(`[VECTOR STORE REFINEMENT] Using assistant ID: ${patient.vectorStore.assistantId}`);
    
//     const thread = await openai.beta.threads.create();
//    // console.log(`[VECTOR STORE REFINEMENT] Created thread with ID: ${thread.id}`);

//     // Stringify the initial summary to send to the assistant
//     const initialSummaryJson = JSON.stringify(initialSummary, null, 2);
    
//     await openai.beta.threads.messages.create(thread.id, {
//       role: 'user',
//       content: `Here is a draft case summary JSON object generated from individual document analyses:

// \`\`\`json
// ${initialSummaryJson}
// \`\`\`

// Review this draft against ALL available documents in the vector store. Your tasks are:

// 1. **Completeness:** Add any significant diagnoses, treatments, or key events missed in the draft but present in the documents.

// 2. **Consolidation of Diagnoses:** Ensure diagnoses for the same condition with overlapping or contiguous dates are merged into a single entry. Use the earliest start date and latest end date. Update the \`status\` field appropriately ('Active' if ongoing, 'Resolved' if an end date is clear, 'Historical' if explicitly stated as past). Combine relevant notes. Standardize date formats to 'YYYY-MM-DD' or 'YYYY-MM-DD to YYYY-MM-DD'.

// 3. **Deduplication:** Remove redundant entries across diagnoses, treatments, and key events if they represent the same information.

// 4. **Rationalization:** Ensure the \`notes\` fields are concise and relevant. Correct any miscategorized treatments (ensure medications are marked with \`type: 'Medication'\`, etc.).

// 5. **Structure:** Return the *entire, refined* case summary object strictly adhering to the provided JSON schema. IF YOU DO NOT HAVE A CITATION FOR SOMETHING, STILL INCLUDE IT. DO NOT DELETE THE FORMAT OF THE ADDITIONAL CITATIONS WE USE, PLACE THEM PERFECTLY WITHIN THE 

// 6. **IDs:** Generate a unique ID (UUID format) for each diagnosis, treatment, and key event that doesn't already have one.

// 7. **Data Type Validation:** Ensure all fields conform to their expected types according to the schema.

// 8. **Search all documents:** Use the vector store to search through ALL available documents (up to 500 results if needed) to ensure completeness.

// DO NOT EVERY RETURN AN EMPTY ARRAY IF THERE WAS VALID INFORMATION GIVEN TO YOU - THIS IS JUST ABOUT RESTRUCTURING AND SHOULD BE A SENSIBLE RATIONALISATION - LARGELY YOU WILL BE RETURNING THE SAME INFORMATION, IT MAY JUST BE SMALL AMOUNTS OF RESTRUCTURING.

// Return ONLY the refined JSON object without any commentary or explanation.`,
//     });

//     const run = await openai.beta.threads.runs.create(thread.id, {
//       assistant_id: patient.vectorStore.assistantId,
//     });

//     // Poll for completion
//     let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
//    // console.log(`[VECTOR STORE REFINEMENT] Initial run status: ${runStatus.status}`);
    
//     let pollCount = 0;
//     const maxPolls = 60; // Prevent infinite loops, allow more time for refinement
    
//     while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
//       pollCount++;
//       if (pollCount > maxPolls) {
//         console.log(`[!VECTOR STORE REFINEMENT] Exceeded maximum poll attempts (${maxPolls}). Last status: ${runStatus.status}`);
//         break;
//       }
      
//       await new Promise(resolve => setTimeout(resolve, 2000)); // Longer polling interval
      
//       runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
//       // Only log when status changes to avoid excessive logging
//       // if (previousStatus !== runStatus.status) {
//       //   console.log(`[VECTOR STORE REFINEMENT] Run status changed: ${previousStatus} -> ${runStatus.status}`);
//       // }
      
//       // Log a heartbeat periodically
//       if (pollCount % 5 === 0) {
//         console.log(`[VECTOR STORE REFINEMENT] Still waiting... Current status: ${runStatus.status}, poll count: ${pollCount}`);
//       }
//     }

//     if (runStatus.status === 'completed') {
//       const messages = await openai.beta.threads.messages.list(thread.id);
//       const lastMessage = messages.data[0];
      
//       console.log('[VECTOR STORE REFINEMENT] Thread completed. Got response');
      
//       if (lastMessage.role === 'assistant' && lastMessage.content && lastMessage.content.length > 0) {
//         if (lastMessage.content[0].type === 'text') {
//           try {
//             console.log('[VECTOR STORE REFINEMENT] Raw response length:', lastMessage.content[0].text.value.length);
            
//             const responseValue = lastMessage.content[0].text.value;
//             if (!responseValue || responseValue.trim() === '') {
//               console.log('[VECTOR STORE REFINEMENT] Empty response received from refinement');
//               return initialSummary; // Return original if empty response
//             }
            
//             // Strip markdown code block markers before parsing
//             let cleanedResponse = responseValue;
//             // Check if the response starts with markdown code block
//             if (cleanedResponse.trim().startsWith('```')) {
//               // Extract content between markdown code block delimiters
//               const markdownRegex = /```(?:json|javascript|js)?\s*([\s\S]*?)```/;
//               const match = cleanedResponse.match(markdownRegex);
//               if (match && match[1]) {
//                 cleanedResponse = match[1].trim();
//               //  console.log('[VECTOR STORE REFINEMENT] Extracted content from markdown code block');
//               } else {
//                 // If we can't extract using regex, try a simpler approach
//                 cleanedResponse = cleanedResponse
//                   .replace(/^```(?:json|javascript|js)?/, '') // Remove opening block
//                   .replace(/```$/, '')                        // Remove closing block
//                   .trim();
//               //  console.log('[VECTOR STORE REFINEMENT] Removed markdown delimiters with fallback method');
//               }
//             }

//             // console.log('[VECTOR STORE REFINEMENT] Attempting to parse refined summary...');

//             const refinedSummary = JSON.parse(cleanedResponse);
            
//             // Basic validation of the refined summary structure
//             if (!refinedSummary || typeof refinedSummary !== 'object') {
//            //   console.log('[VECTOR STORE REFINEMENT] Invalid response format - not an object');
//               return initialSummary;
//             }
            
//             // Check key fields to ensure the response is a valid CaseSummaryType
//             const requiredFields = ['patientName', 'diagnoses', 'treatments', 'keyEvents'];
//             const missingFields = requiredFields.filter(field => !(field in refinedSummary));
            
//             if (missingFields.length > 0) {
//             //  console.log(`[VECTOR STORE REFINEMENT] Invalid response - missing required fields: ${missingFields.join(', ')}`);
//               return initialSummary;
//             }
            
//             console.log('[VECTOR STORE REFINEMENT] Successfully parsed refined summary - Changes in summary metrics:');
//             console.log(`- Diagnoses: ${initialSummary.diagnoses?.length || 0} → ${refinedSummary.diagnoses?.length || 0}`);
//             console.log(`- Treatments: ${initialSummary.treatments?.length || 0} → ${refinedSummary.treatments?.length || 0}`);
//             console.log(`- Key Events: ${initialSummary.keyEvents?.length || 0} → ${refinedSummary.keyEvents?.length || 0}`);
            
//             return refinedSummary as CaseSummaryType;
//           } catch (parseError) {
//             // console.log('[VECTOR STORE REFINEMENT] Error parsing response:', parseError);
//             // console.log('[VECTOR STORE REFINEMENT] Error name:', parseError instanceof Error ? parseError.name : 'Not an Error object');
//             // console.log('[VECTOR STORE REFINEMENT] Error message:', parseError instanceof Error ? parseError.message : String(parseError));
            
//             // Return the original summary on error
//             return initialSummary;
//           }
//         }
//       }
//     } else {
//       //console.log('[VECTOR STORE REFINEMENT] Run not completed. Status:', runStatus.status);
//       if (runStatus.status === 'failed') {
//         console.log('[VECTOR STORE REFINEMENT] Run failure reason:', runStatus.last_error || 'No error details available');
//       }
//     }

//     // Default to returning the original summary if refinement fails
//     return initialSummary;
//   } catch (error) {
//     console.log('[VECTOR STORE REFINEMENT] Error refining summary:', error);
//     throw error;
//   }
// }

// /**
//  * Maps citation information to the correct document using fileIdMappings
//  * 
//  * @param silknotePatientUuid - Patient ID
//  * @param citation - Citation object containing at minimum a documentName property
//  * @returns Mapped citation with proper document IDs
//  */
// export async function mapCitationToDocument(
//   silknotePatientUuid: string,
//   citation: {
//     documentName: string;
//     pageNumber?: number;
//     position?: number;
//     [key: string]: any;
//   }
// ): Promise<{
//   documentId: string;
//   documentName: string;
//   pageNumber: number;
//   position: number;
//   originalMarker?: string;
//   [key: string]: any;
// }> {
//   try {
//     console.log(`[VECTOR STORE - mapCitationToDocument] Processing citation with documentName "${citation.documentName}"`);
    
//     // Get patient with vectorStore information
//     const patient = await patientService.getPatientById(silknotePatientUuid);
//     if (!patient) {
//       throw new Error(`Patient not found: ${silknotePatientUuid}`);
//     }
    
//     // Extract document name without extension for better matching
//     const documentNameWithoutExt = citation.documentName.split('.')[0];
    
//     let documentId = null;
//     let matchedDocName = citation.documentName;
//     let matchType = 'none';

//     // APPROACH 1: Try direct matching against patient fileSet first
//     const directMatch = patient.fileSet.find((doc: any) => {
//       const docMatch = doc.clientFileId === documentNameWithoutExt || 
//                      doc.originalName === citation.documentName;
//       return docMatch;
//     });
    
//     if (directMatch) {
//       documentId = directMatch.clientFileId;
//       matchedDocName = directMatch.originalName || directMatch.title || citation.documentName;
//       matchType = 'direct';
//     } 
//     // APPROACH 2: If direct match fails, try using fileIdMappings
//     else if (patient.vectorStore?.fileIdMappings && patient.vectorStore.fileIdMappings.length > 0) {
//       // Try to find by filename match first (more reliable than ID matching)
//       const filenameMapping = patient.vectorStore.fileIdMappings.find(
//         (mapping: { fileName?: string; clientFileId: string }) => 
//           mapping.fileName?.toLowerCase() === citation.documentName.toLowerCase() ||
//           (mapping.fileName?.split('.')[0].toLowerCase() === documentNameWithoutExt.toLowerCase())
//       );
      
//       if (filenameMapping) {
//         documentId = filenameMapping.clientFileId;
//         matchType = 'filename-mapping';
//       } else {
//         // Last resort: try partial matching
//         const partialMatch = patient.vectorStore.fileIdMappings.find(
//           (mapping: { fileName?: string; clientFileId: string }) => 
//             (mapping.fileName && citation.documentName.toLowerCase().includes(mapping.fileName.toLowerCase())) ||
//             (mapping.fileName && mapping.fileName.toLowerCase().includes(citation.documentName.toLowerCase())) ||
//             (mapping.clientFileId && mapping.clientFileId.toLowerCase().includes(documentNameWithoutExt.toLowerCase())) ||
//             (mapping.clientFileId && documentNameWithoutExt.toLowerCase().includes(mapping.clientFileId.toLowerCase()))
//         );
        
//         if (partialMatch) {
//           documentId = partialMatch.clientFileId;
//           matchType = 'partial-match';
//         }
//       }
//     }
    
//     // Log the matching result
//     if (documentId) {
//       console.log(`[VECTOR STORE - mapCitationToDocument] ✅ Matched document (${matchType}):`, {
//         documentId,
//         originalDocName: citation.documentName
//       });
//     } else {
//       console.log(`[VECTOR STORE - mapCitationToDocument] ❌ NO DOCUMENT MATCH for "${citation.documentName}"`);
//       documentId = citation.documentName; // Use the document name as fallback ID
//     }
    
//     // Return the mapped citation
//     return {
//       ...citation,
//       documentId,
//       documentName: matchedDocName,
//       pageNumber: citation.pageNumber || 1,
//       position: citation.position || 0
//     };
//   } catch (error) {
//     console.error('[VECTOR STORE - mapCitationToDocument] Error:', error);
//     // Return original citation with defaults in case of error
//     return {
//       ...citation,
//       documentId: citation.documentName,
//       pageNumber: citation.pageNumber || 1,
//       position: citation.position || 0
//     };
//   }
// }

/**
 * Queries the assistant, waits for completion, and processes citations from annotations.
 * @param silknotePatientUuid - Patient ID
 * @param query - The user query string
 * @param outputFormat - Optional output format hint for system message
 * @returns Promise<{ content: string; citations: any[] }>
 */
export async function queryAssistantWithCitations(
  silknotePatientUuid: string,
  query: string,
  outputFormat: string = 'text', // Default to text
  silknoteUserUuid: string
): Promise<{ content: string; citations: any[] }> {
  console.log(`[VECTOR STORE - queryAssistantWithCitations] Query for patient ${silknotePatientUuid}: "${query}"`);
  
  if (!silknotePatientUuid || !query) {
    throw new Error('Missing required parameters for queryAssistantWithCitations');
  }

  // Get patient data
  const patient = await patientService.getPatientById(silknotePatientUuid, silknoteUserUuid);
  if (!patient) {
    throw new Error(`Patient with ID ${silknotePatientUuid} not found`);
  }
  if (!patient.vectorStore?.assistantId) {
    const errorMsg = !patient.vectorStore
      ? 'No vector store configured for this patient.'
      : 'No assistant configured for this patient vector store.';
    console.error(`[VECTOR STORE - queryAssistantWithCitations] Error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const openai = new AzureOpenAI({
    apiKey: config.azure.azureOpenAI.key,
    endpoint: config.azure.azureOpenAI.endpoint,
    apiVersion: '2024-05-01-preview',
  });

  // System message (less critical now as annotations drive citation details)
  let systemMessage = '';
  if (outputFormat === 'json') {
    systemMessage = `
      For each citation, include the reference inline using the format 【citation_index:position†filename】.
      Example: "The patient was diagnosed with hypertension【1:0†medical_report.pdf】."
    `;
  }

  const thread = await openai.beta.threads.create();
  if (systemMessage) {
    await openai.beta.threads.messages.create(thread.id, { role: 'user', content: systemMessage });
  }

  await openai.beta.threads.messages.create(thread.id, { role: 'user', content: query });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: patient.vectorStore.assistantId,
  });
  console.log(`[VECTOR STORE - queryAssistantWithCitations] Started run ${run.id} on thread ${thread.id}`);

  let attempts = 0;
  const maxAttempts = 60; // 60 seconds timeout
  const pollIntervalMs = 1000;

  // Wait for the run to complete
  while (attempts < maxAttempts) {
    const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    if (runStatus.status === 'completed') {
      console.log(`[VECTOR STORE - queryAssistantWithCitations] Run ${run.id} completed.`);
      
      const messages = await openai.beta.threads.messages.list(thread.id, { order: 'asc' });
      const lastAssistantMessage = messages.data.filter(m => m.role === 'assistant').pop();

      // *** NEW: Log the ENTIRE raw assistant message object ***
      console.log(`\n==== [VECTOR STORE] RAW ASSISTANT MESSAGE OBJECT (Thread: ${thread.id}, Run: ${run.id}) ====`);
      console.log(JSON.stringify(lastAssistantMessage, null, 2));
      console.log(`==== END RAW ASSISTANT MESSAGE OBJECT ====\n`);

      if (lastAssistantMessage) {
        const textContent = lastAssistantMessage.content.find((c): c is any => c.type === 'text'); // Use 'any' temporarily

        if (textContent?.text) {
          const originalText = textContent.text.value; // Keep the main text response
          const annotations = textContent.text.annotations || [];
          console.log(`[VECTOR STORE - queryAssistantWithCitations] Raw text (len: ${originalText.length}), Found ${annotations.length} annotations.`);
          // *** NEW: Log raw content object ***
          console.log("[VECTOR STORE - queryAssistantWithCitations] Assistant Message Content Object:", JSON.stringify(textContent, null, 2));
          
          const finalCitations: any[] = [];

          // Use Promise.all to process annotations potentially in parallel
          await Promise.all(annotations.map(async (annotation: any, i: number) => {
            // *** REMOVED: Raw annotation log for brevity ***
            // console.log(`\n[VECTOR STORE - CITATION ${i+1}] RAW ANNOTATION:`, JSON.stringify(annotation));

            if (annotation.type === 'file_citation') {
              const openaiFileId = annotation.file_citation?.file_id;
              const startIndex = annotation.start_index;
              const endIndex = annotation.end_index;
              const annotationText = annotation.text; // Still log this to see if it gets fixed later
              
              if (!openaiFileId || startIndex === undefined || endIndex === undefined) {
                console.warn(`[VECTOR STORE - CITATION ${i+1}] Annotation missing file_id or indices:`, annotation);
                return; // Skip this annotation
              }
              
              // *** REMOVED: Logging comparing annotation.text to assistant response slice ***
              console.log(`[VECTOR STORE - CITATION ${i+1}] Processing Annotation: OpenAI File ID=${openaiFileId}, Indices=[${startIndex}-${endIndex}], Annotation Text=\"${annotationText}\"`);

              let clientFileId: string | null = null;
              let matchedDocName: string | null = null;
              let medicalDocument: MedicalDocument | null = null;

              try {
                // 1. Retrieve filename from OpenAI (for mapping)
                const fileInfo = await openai.files.retrieve(openaiFileId);
                const openAIFilename = fileInfo.filename;
                // *** REMOVED: Call to openai.files.content() and related logging ***
                
                // 2. Map OpenAI filename/ID to our clientFileId
                const mapping = patient.vectorStore?.fileIdMappings?.find(
                  (m) => m.openaiFileId === openaiFileId || m.fileName === openAIFilename
                );

                if (mapping) {
                  clientFileId = mapping.clientFileId;
                  matchedDocName = mapping.fileName || openAIFilename;
                  console.log(`[VECTOR STORE - CITATION ${i+1}] Mapped OpenAI ID ${openaiFileId} to clientFileId: ${clientFileId} (Name: ${matchedDocName})`);
                } else {
                  clientFileId = openAIFilename.split('.')[0];
                  matchedDocName = openAIFilename;
                  console.warn(`[VECTOR STORE - CITATION ${i+1}] No mapping found for OpenAI ID ${openaiFileId}. Using filename-derived clientFileId: ${clientFileId}`);
                }
                
                // 3. Retrieve the MedicalDocument containing analysis results
                if (clientFileId) {
                  medicalDocument = await storageService.getDocument(silknoteUserUuid, silknotePatientUuid, clientFileId);
                  if (!medicalDocument) {
                    console.error(`[VECTOR STORE - CITATION ${i+1}] Failed to retrieve MedicalDocument for clientFileId: ${clientFileId}`);
                  }
                }
                
                // 4. Determine Page Number using indices and analysis results
                let pageNumber = 1; // Default
                const analysisResult = medicalDocument?.content?.analysisResult;

                if (medicalDocument && analysisResult?.pages && analysisResult.pages.length > 0) {
                   console.log(`[VECTOR STORE - CITATION ${i+1}] Found analysisResult for document ${clientFileId}. Trying to find page number.`);
                   let pageFound = false;
                   for (const page of analysisResult.pages) {
                     if (page.spans && page.spans.length > 0) {
                       const pageStart = page.spans[0].offset;
                       const pageEnd = pageStart + page.spans[0].length;
                       if (startIndex >= pageStart && startIndex < pageEnd) {
                         pageNumber = page.pageNumber;
                         pageFound = true;
                         console.log(`[VECTOR STORE - CITATION ${i+1}] Found page number ${pageNumber} for startIndex ${startIndex}`);
                         break;
                       }
                     }
                   }
                   if (!pageFound) {
                     console.warn(`[VECTOR STORE - CITATION ${i+1}] Could not determine page number for startIndex ${startIndex}. Defaulting to 1.`);
                   }
                 } else {
                    console.warn(`[VECTOR STORE - CITATION ${i+1}] Missing analysisResult or pages for document ${clientFileId}. Defaulting page to 1.`);
                 }
                
                // *** REMOVED: Logic to extract quote from analysisResult using indices ***
                // *** REMOVED: Comparison logging between annotation.text and extracted source text ***

                // 5. Construct the simplified final citation object
                const citationObj = {
                  documentId: clientFileId || openaiFileId, // Use mapped client ID or fallback
                  documentName: matchedDocName || `Unknown (ID: ${openaiFileId})`,
                  pageNumber: pageNumber,
                  // quote: field removed
                  // excerpt: field removed
                  // pageImage: field removed (was already null)
                  startIndex: startIndex, // Keep indices for potential client use
                  endIndex: endIndex,
                  citationIndex: i + 1 // Use original loop index for sequence
                };
                
                console.log(`[VECTOR STORE - CITATION ${i+1}] FINAL Constructed Citation Object (Simplified):`, JSON.stringify(citationObj));
                finalCitations.push(citationObj);

              } catch (error) {
                console.error(`[VECTOR STORE - CITATION ${i+1}] Error processing annotation for OpenAI File ID ${openaiFileId}:`, error);
                const fallbackCitation = {
                  documentId: clientFileId || openaiFileId,
                  documentName: `Error Processing (ID: ${openaiFileId})`,
                  pageNumber: 1,
                  // quote: field removed
                  // excerpt: field removed
                  startIndex: startIndex,
                  endIndex: endIndex,
                  citationIndex: i + 1,
                  error: `Failed processing citation: ${error instanceof Error ? error.message : 'Unknown error'}`
                };
                console.log(`[VECTOR STORE - CITATION ${i+1}] FALLBACK Constructed Citation Object (Simplified):`, JSON.stringify(fallbackCitation));
                finalCitations.push(fallbackCitation);
              }
            } else {
               // Skip non-file_citation annotations
            }
          })); // End Promise.all map
          
          // Sort citations based on their original index to maintain order
          finalCitations.sort((a, b) => a.citationIndex - b.citationIndex);
          
          console.log(`[VECTOR STORE - queryAssistantWithCitations] Returning response with ${finalCitations.length} processed annotation-based citations`);
          return { content: originalText, citations: finalCitations };

        } else {
          console.log(`[VECTOR STORE - queryAssistantWithCitations] Run ${run.id} completed, but no text content.`);
          return { content: '', citations: [] };
        }
      } else {
        console.log(`[VECTOR STORE - queryAssistantWithCitations] Run ${run.id} completed, but no assistant message.`);
        return { content: '', citations: [] };
      }
    } else if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
      const errorReason = runStatus.last_error?.message || `Assistant run ${runStatus.status}`;
      console.log(`[VECTOR STORE - queryAssistantWithCitations] Run ${run.id} ${runStatus.status}: ${errorReason}`);
      throw new Error(errorReason);
    }

    // Wait before polling again
    attempts++;
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // If loop finishes without completion, it timed out
  console.log(`[VECTOR STORE - queryAssistantWithCitations] Query timed out after ${maxAttempts} seconds for run ${run.id}.`);
  throw new Error(`Query timed out after ${maxAttempts} seconds`);
}


/**
 * Queries the assistant, waits for completion, and processes citations from annotations.
 * Returns both structured JSON data according to a provided schema and citation information.
 * 
 * @param silknotePatientUuid - Patient ID
 * @param query - The user query string
 * @param schema - JSON schema for structuring the response
 * @param outputFormat - Output format hint for system message (default: 'json')
 * @returns Promise<{ content: any; citations: any[] }>
 */
// Ensure SummaryCitation interface is defined at the top of the file
// interface SummaryCitation { ... markerId?: string; originalAnnotationText?: string; }

// /**
//  * Search function for vector store - used by llmService for case summary generation
//  */
// export async function search({
//   query,
//   silknotePatientUuid,
//   limit = 20
// }: {
//   query: string,
//   silknotePatientUuid: string,
//   limit?: number,
//   threshold?: number
// }) {
//   try {
//     const patient = await patientService.getPatientById(silknotePatientUuid);
//     if (!patient) throw new Error('Patient not found');
//     if (!patient.vectorStore?.assistantId) {
//       throw new Error('No vector store assistant configured for patient');
//     }

//     console.log(`[VECTOR STORE] Searching for query: "${query}" in vector store for patient ${silknotePatientUuid}`);
    
//     const thread = await openai.beta.threads.create();
//     await openai.beta.threads.messages.create(thread.id, {
//       role: 'user',
//       content: `Return relevant information for the following query WITHOUT ANALYSIS, ONLY THE RAW TEXT EXTRACTS:
      
//       ${query}
      
//       Return ONLY the exact document content, not your own analysis or summary. Focus on finding the most relevant 
//       passages that directly answer the query. For each result, include the source document name and page number.`,
//     });

//     const run = await openai.beta.threads.runs.create(thread.id, {
//       assistant_id: patient.vectorStore.assistantId,
//     });

//     // Poll for completion
//     let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
//     let pollCount = 0;
//     const maxPolls = 20;
    
//     while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
//       pollCount++;
//       if (pollCount > maxPolls) break;
      
//       await new Promise(resolve => setTimeout(resolve, 1000));
//       runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
//     }

//     if (runStatus.status === 'completed') {
//       const messages = await openai.beta.threads.messages.list(thread.id);
//       const lastMessage = messages.data[0];
      
//       if (lastMessage.role === 'assistant' && lastMessage.content && lastMessage.content.length > 0) {
//         if (lastMessage.content[0].type === 'text') {
//           // Extract the annotations from the message
//           const annotations = lastMessage.content[0].text.annotations || [];
//           const messageText = lastMessage.content[0].text.value;
          
//           // Process results from the message content
//           const results = [];
          
//           // Split into sections by line breaks and citations
//           const sections = messageText.split(/\n{2,}|(?=Document:|Source:|From document:)/i);
          
//           for (const section of sections) {
//             if (section.trim() === '') continue;
            
//             // Try to extract source and page information
//             let source = 'Unknown Document';
//             let pageNumber = 1;
//             let text = section;
            
//             // Enhanced regex for different source formats
//             const sourceMatch = section.match(/(?:\[Source:|Document:|From document:|Source:)\s*([^,\]]+)(?:,\s*Page:?\s*(\d+))?/i);
//             if (sourceMatch) {
//               source = sourceMatch[1].trim();
//               pageNumber = sourceMatch[2] ? parseInt(sourceMatch[2]) : 1;
              
//               // Remove the source text from the content
//               text = section.replace(/(?:\[Source:|Document:|From document:|Source:)[^]*?\]|\(Source:[^]*?\)/i, '').trim();
//             }
            
//             // Check citations from annotations
//             // This will be used to complement source information if available
//             const citationInfo = processAnnotationsForSection(annotations, section);
//             if (citationInfo) {
//               source = citationInfo.source || source;
//               pageNumber = citationInfo.pageNumber || pageNumber;
//             }
            
//             // Map the document name to a document ID if possible
//             let documentId = null;
//             if (patient.vectorStore.fileIdMappings) {
//               const mapping = patient.vectorStore.fileIdMappings.find(m => 
//                 m.fileName?.toLowerCase() === source.toLowerCase() ||
//                 source.toLowerCase().includes(m.fileName?.toLowerCase() || '')
//               );
              
//               if (mapping) {
//                 documentId = mapping.clientFileId;
//               }
//             }
            
//             // Add the result
//             results.push({
//               metadata: {
//                 source: source,
//                 pageNumber: pageNumber,
//                 text: text,
//                 documentId: documentId,
//                 searchType: 'general' // Default search type for backward compatibility
//               },
//               // Add a simple score based on position (earlier is better)
//               score: 1.0 - (results.length * 0.05)
//             });
//           }
          
//           console.log(`[VECTOR STORE] Found ${results.length} results for query "${query}"`);
//           return results.slice(0, limit);
//         }
//       }
//     }
    
//     console.log(`[VECTOR STORE] No results found for query "${query}"`);
//     return [];
    
//   } catch (error) {
//     console.error('[VECTOR STORE] Search error:', error);
//     throw error;
//   }
// }



// /**
//  * Generate a comprehensive timeline for a patient by querying the vector store with specific prompts
//  * designed to extract detailed event information with precise dates
//  */
// export async function generateComprehensiveTimeline(
//   silknotePatientUuid: string,
//   schema: any
// ): Promise<{ timeline: any; citations: any[] }> {
//   try {
//     const patient = await patientService.getPatientById(silknotePatientUuid);
//     if (!patient) throw new Error('Patient not found');
//     if (!patient.vectorStore?.assistantId) {
//       throw new Error('No vector store assistant configured for patient for timeline generation');
//     }

//     console.log(`[VECTOR STORE] Generating comprehensive timeline for patient ${silknotePatientUuid}`);
    
//     // Create a comprehensive timeline query
//     const timelineQuery = `You are a specialized medical timeline builder. Your task is to create a comprehensive, 
//     chronological timeline of ALL events in this patient's case, leaving NOTHING out.
    
//     EXTRACT EVERY SINGLE INSTANCE OF:
    
//     ********* SPECIAL FOCUS ON WORKCOVER CERTIFICATES *********
//     For EACH WorkCover certificate, you MUST extract and include ALL of the following:
//     - EXACT certificate issue date and expiry date (Start-End date range)
//     - COMPLETE functional capacity details (e.g., "4 hours/day, 3 days/week")
//     - FULL list of all restrictions noted on the certificate
//     - Issuing doctor's full name and credentials
//     - Certificate status (active, expired, superseded)
    
//     FORMAT EACH WORKCOVER CERTIFICATE AS A SEPARATE KEY EVENT:
//     - Set eventType to "WorkCover Certificate"
//     - Include ALL capacity details in the workCapacity object
//     - List ALL restrictions in the workCapacity.restrictions array
//     - Include the doctor in the providers array
//     - Document the exact source of this information
    
//     ********* OTHER REQUIRED TIMELINE ELEMENTS *********
//     - ALL insurer requests for independent medical assessments with EXACT dates
//     - ALL dates when the patient started/stopped work with EXACT details
//     - ALL specialist appointments with doctor names, facilities, and EXACT dates
//     - ALL legal proceedings with EXACT dates of initiation and developments
//     - ALL disputes between employer and employee with EXACT dates
//     - For motor vehicle accidents: ALL dates related to the accident, ICWA initiation, 
//       and insurer liability acceptance
    
//     For EACH event, include:
//     1. The exact date in YYYY-MM-DD format (use best estimate if only partial date)
//     2. Detailed event title and complete description
//     3. The exact source document and page for verification
//     4. The significance of each event to the overall case
    
//     Create the most comprehensive timeline possible, leaving out NO events or dates mentioned 
//     in ANY document. Focus on completeness, thoroughness, and including ALL details.`;

//     // Use the object-oriented query approach
//     const result = await queryAssistantWithCitationsObject(
//       silknotePatientUuid,
//       timelineQuery,
//       schema,
//       true // Embed citation markers
//     );

//     // Process and return the result
//     console.log(`[VECTOR STORE] Generated comprehensive timeline with ${result.citations.length} citations`);
//     return { 
//       timeline: result.content, 
//       citations: result.citations 
//     };
    
//   } catch (error) {
//     console.error('[VECTOR STORE] Error generating comprehensive timeline:', error);
//     throw error;
//   }
// }

export async function removeFileFromVectorStore(
  silknotePatientUuid: string,
  clientFileId: string,
  silknoteUserUuid: string
): Promise<boolean> {
  console.log(`[VECTOR STORE] Attempting to remove file ${clientFileId} from vector store for patient ${silknotePatientUuid}`);
  try {
    const patient = await patientService.getPatientById(silknotePatientUuid, silknoteUserUuid);
    if (!patient) {
      console.error(`[VECTOR STORE] Patient ${silknotePatientUuid} not found.`);
      return false;
    }
    if (!patient.vectorStore || !patient.vectorStore.vectorStoreIndex || !patient.vectorStore.fileIdMappings) {
      console.warn(`[VECTOR STORE] Patient ${silknotePatientUuid} does not have a fully configured vector store or file mappings. Skipping deletion from vector store.`);
      return true; // Return true as there's nothing to delete from vector store perspective
    }

    const vectorStoreId = patient.vectorStore.vectorStoreIndex;
    const mappingIndex = patient.vectorStore.fileIdMappings.findIndex(m => m.clientFileId === clientFileId);

    if (mappingIndex === -1) {
      console.warn(`[VECTOR STORE] No OpenAI file mapping found for clientFileId ${clientFileId} in patient ${silknotePatientUuid}. File might have been already removed or not added.`);
      // Also check processedFiles for consistency, though mapping is key
      if (patient.vectorStore.processedFiles) {
        patient.vectorStore.processedFiles = patient.vectorStore.processedFiles.filter(pf => pf.fileName !== clientFileId && (!pf.fileName.startsWith(clientFileId + '.')));
        // Persist this change even if no OpenAI mapping was found
        await patientService.updatePatient(patient);
      }
      return true; // Indicate success as the file isn't mapped in the vector store
    }

    const mapping = patient.vectorStore.fileIdMappings[mappingIndex];
    const openaiFileId = mapping.openaiFileId;

    console.log(`[VECTOR STORE] Found OpenAI fileId ${openaiFileId} for clientFileId ${clientFileId}. Proceeding with deletion from vector store ${vectorStoreId}.`);

    // 1. Delete file association from vector store
    try {
      await openai.beta.vectorStores.files.del(vectorStoreId, openaiFileId);
      console.log(`[VECTOR STORE] Successfully disassociated OpenAI file ${openaiFileId} from vector store ${vectorStoreId}.`);
    } catch (error: any) {
      // If the file is already disassociated or not found, it might throw an error. Log and continue.
      // OpenAI API might return 404 if file not found in VS, which is acceptable if we intend to delete.
      if (error.status === 404) {
        console.warn(`[VECTOR STORE] OpenAI file ${openaiFileId} not found in vector store ${vectorStoreId} (already disassociated or never added).`);
      } else {
        console.error(`[VECTOR STORE] Error disassociating OpenAI file ${openaiFileId} from vector store ${vectorStoreId}:`, error);
        // Depending on policy, you might want to re-throw or return false
        // For now, we'll log and attempt to delete the OpenAI file object itself if it exists.
      }
    }

    // 2. Delete the file object from OpenAI (if no longer needed by any other VS or assistant)
    try {
      await openai.files.del(openaiFileId);
      console.log(`[VECTOR STORE] Successfully deleted OpenAI file object ${openaiFileId}.`);
    } catch (error: any) {
      // If the file is already deleted, it might throw an error. Log and continue.
      if (error.status === 404) {
        console.warn(`[VECTOR STORE] OpenAI file object ${openaiFileId} not found (already deleted).`);
      } else {
        console.error(`[VECTOR STORE] Error deleting OpenAI file object ${openaiFileId}:`, error);
        // Log error but continue to update patient record
      }
    }

    // 3. Update patient's vectorStore metadata
    patient.vectorStore.fileIdMappings.splice(mappingIndex, 1);
    if (patient.vectorStore.processedFiles) {
      // Filter by openaiFileId from processedFiles as well if it exists there, or by fileName if that's what's stored
      patient.vectorStore.processedFiles = patient.vectorStore.processedFiles.filter(pf => pf.fileId !== openaiFileId && pf.fileName !== mapping.fileName);
    }
    patient.vectorStore.lastUpdated = new Date().toISOString();

    await patientService.updatePatient(patient);
    console.log(`[VECTOR STORE] Successfully updated patient ${silknotePatientUuid} record after removing file ${clientFileId}.`);

    return true;
  } catch (error) {
    console.error(`[VECTOR STORE] Failed to remove file ${clientFileId} for patient ${silknotePatientUuid}:`, error);
    return false;
  }
}


