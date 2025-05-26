import { Router, NextFunction } from "express";
import { getPatientById, updatePatient } from "../services/patientService";
import { AzureOpenAI } from 'openai';
import * as patientService from '../services/patientService';
import {  CaseSummaryType, parseCaseSummary } from "../shared/case-summary-types";
import { asyncHandler } from "../utils/errorHandlers";
import { Request, Response } from "express";
import { CaseSummaryApiResponse, SummaryCitation } from '../shared/types'; // Corrected: Was SharedCaseSummaryApiResponse, now CaseSummaryApiResponse
import { createLogger } from '../utils/logger'
import config from '../config';
import { randomUUID } from "crypto";
import { storageService } from "../utils/storage";
import { io } from '../utils/io'; // Import the global io instance
// Ensure ServerToClientEvents and SharedCaseSummaryApiResponse are correctly typed/imported
// For instance, if SharedCaseSummaryApiResponse is in ../shared/types:
// import { SharedCaseSummaryApiResponse } from '../shared/types';

const logger = createLogger('CASE_SUMMARY')
const router: Router = Router();

// // Apply diagnostics middleware to all case summary routes
// router.use(errorDiagnostics('case-summary'));

// GET existing case summary for a patient (retrieve only, without generating)
router.get('/retrieve/:silknotePatientUuid', asyncHandler(async (req: Request, res: Response) => {
  const { silknotePatientUuid } = req.params;
  
  console.log(`[CASE SUMMARY] Retrieving existing case summary for patient: ${silknotePatientUuid}`);
  
  try {
    // Get patient record
    const patient = await getPatientById(silknotePatientUuid);
    
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    // Check if the patient has a case summary
    if (!patient.caseSummary) {
      return res.status(404).json({ 
        error: 'No case summary exists for this patient',
        message: 'No case summary has been generated yet.'
      });
    }
    
    console.log(`[CASE SUMMARY] Successfully retrieved existing case summary for patient: ${silknotePatientUuid}`);
    
    // Type safety: Ensure patient.caseSummary matches expected structure (though DB/fetch should handle this)
    const fullCaseSummary = patient.caseSummary as CaseSummaryApiResponse | null;
    if (!fullCaseSummary || !fullCaseSummary.summary) {
      // This case should ideally be caught by the check above, but added for robustness
      console.error(`[CASE SUMMARY] Retrieved patient.caseSummary is missing the 'summary' field for ${silknotePatientUuid}`);
      return res.status(500).json({ error: 'Invalid case summary data stored for patient' });
    }

    // Parse the nested summary object if needed (optional, depending on storage format)
    let parsedSummary = parseCaseSummary(fullCaseSummary.summary);
    if (!parsedSummary) {
        console.warn(`[CASE SUMMARY] Zod parsing failed for retrieved summary object for ${silknotePatientUuid}. Using raw data.`);
        parsedSummary = fullCaseSummary.summary; // Fallback to raw if parsing fails
    }

    // Construct the final response using the full structure
    const response: CaseSummaryApiResponse = {
      summary: parsedSummary, // Use the potentially parsed summary object
      citations: fullCaseSummary.citations || [], // Use stored citations, default to empty array
      summaryGenerationCount: patient.summaryGenerationCount || 0,
      maxCount: 5 // Hardcoded based on previous observation
    };

    return res.status(200).json(response);
  } catch (error) {
    console.log(`[CASE SUMMARY] Error retrieving case summary: ${error}`);
    return res.status(500).json({ error: 'Failed to retrieve case summary' });
  }
}));

// Add this helper function at the top of the file, below imports
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Extracts valid JSON from a string that may contain markdown, comments, or other non-JSON content.
 * Designed to be robust against various input formats including code blocks and surrounding text.
 * 
 * @param input - Any string that might contain JSON
 * @returns Clean JSON string ready for parsing
 */
function extractCleanJsonFromText(input: string): string {
  if (!input || typeof input !== 'string') return '{}';
  
  try {
    // Step 1: Handle markdown code blocks by removing ```json and ``` markers
    let cleanedText = input.replace(/```(json|javascript|js)?\s*/g, '').replace(/```\s*$/g, '');
    
    // Step 2: Find the first { and last } to extract the JSON object
    const firstBrace = cleanedText.indexOf('{');
    const lastBrace = cleanedText.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      // No valid JSON object found
      return '{}';
    }
    
    // Extract the JSON object
    let jsonString = cleanedText.substring(firstBrace, lastBrace + 1);
    
    // Step 3: Remove JavaScript-style comments
    jsonString = jsonString
      // Remove single-line comments
      .replace(/\/\/.*?$/gm, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Trim whitespace
      .trim();
    
    // Step 4: Fix invalid JSON that might have trailing commas
    jsonString = jsonString
      // Remove trailing commas in objects
      .replace(/,\s*}/g, '}')
      // Remove trailing commas in arrays
      .replace(/,\s*]/g, ']');
    
    // Verify the result is valid JSON by parsing it
    JSON.parse(jsonString);
    
    return jsonString;
  } catch (error) {
    // If any error occurs, return a fallback empty object
    return '{}';
  }
}

export async function queryAssistantWithCitationsObject(
  silknotePatientUuid: string,
  query: string,
  schema: any,
  embedCitationMarkers: boolean = false, // Flag to control marker embedding
  silknoteUserUuid?: string // Add optional parameter for backwards compatibility
): Promise<{ content: any; citations: SummaryCitation[] }> {
  logger.info(`[VECTOR STORE - QAC_OBJ] START Patient: ${silknotePatientUuid}, Query: ${query.substring(0, 50)}..., EmbedMarkers: ${embedCitationMarkers}`);

  // Use a default user if not provided (for backwards compatibility)
  const userUuid = silknoteUserUuid || 'default-user';
  
  const patient = await patientService.getPatientById(silknotePatientUuid, userUuid);
  if (!patient?.vectorStore?.assistantId) {
      const errorMsg = !patient ? `Patient with ID ${silknotePatientUuid} not found.` : 'No vector store or assistant configured for this patient.';
      logger.error(`[VECTOR STORE - QAC_OBJ] Error: ${errorMsg}`);
      throw new Error(errorMsg);
  }

  const openai = new AzureOpenAI({
      apiKey: config.azure.azureOpenAI.key,
      endpoint: config.azure.azureOpenAI.endpoint,
      apiVersion: '2024-05-01-preview',
  });

  // System message
  let systemMessage = `You are Medico-Legal Assistant Structure and Vector Store Document Retrieval Expert who specialises in highly effective annotation insertion within JSON string properties, while providing answers based on doing the most effective yet simultaneously vastest search of all documents returning as many results as you can.
    ** HIGHEST LEVEL OVERRIDING CRITICAL INSTRUCTIONS **:
    - YOU SHOULD ALWAYS CITE THE DOCUMENT YOU DERIVED THE INFORMATION FROM IF POSSIBLE.  
    - WHEN ADDING YOUR ANNOTATIONS THAT REFER TO DOCUMENTS IN THE VECTOR STORE THAT YOU MUST DO A VAST SEARCH UPON TO RETRIEVE MAXIMUM INFORMATION: 
    - WHEN CREATING YOUR RESPONSE - YOU MUST NEVER PLACE CITATIONS OUTSIDE OF THE STRING PROPERTIES - THIS IS ABSOLUTELY CRUCIAL.
    - EVERYTHING THAT IS A STRING MUST HAVE AN ANNOTATION THAT REFERENCES THE DOCUMENT IT CAME FROM. 
    - ANY PROPERTY THAT IS NOT A STRING  MUST BE DERIVED FROM THE DOCUMENTS BUT MUST NOT HAVE AN ANNOTATION ASSOCIATED.`;

  const thread = await openai.beta.threads.create();
  logger.info(`[VECTOR STORE - QAC_OBJ] Created thread ${thread.id}`);

  // Send Schema Message
  const schemaContent = `${systemMessage}\\n\\nResponse format schema: ${JSON.stringify(schema, null, 2)}`;
  logger.info(`[VECTOR STORE - QAC_OBJ] Sending Schema Message (len: ${schemaContent.length}) to thread ${thread.id}`);
  await openai.beta.threads.messages.create(thread.id, { role: 'user', content: schemaContent });

  // Send Query Message
  logger.info(`[VECTOR STORE - QAC_OBJ] Sending Query Message (len: ${query.length}) to thread ${thread.id}`);
  await openai.beta.threads.messages.create(thread.id, { role: 'user', content: query });

  // Start Run
  const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: patient.vectorStore.assistantId });
  logger.info(`[VECTOR STORE - QAC_OBJ] Started run ${run.id} on thread ${thread.id}`);

  let attempts = 0;
  const maxAttempts = 60;
  const pollIntervalMs = 1000;

  // Poll for Run Completion
  while (attempts < maxAttempts) {
      const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

      if (runStatus.status === 'completed') {
          logger.info(`[VECTOR STORE - QAC_OBJ] Run ${run.id} completed.`);
          const messages = await openai.beta.threads.messages.list(thread.id, { order: 'asc' });
          const lastAssistantMessage = messages.data.filter(m => m.role === 'assistant').pop();

          if (lastAssistantMessage?.content) {
              const textContent = lastAssistantMessage.content.find((c): c is any => c.type === 'text');

              if (textContent?.text) {
                  const originalText = textContent.text.value;
                  const annotations = textContent.text.annotations || [];
                  logger.info(`[VECTOR STORE - QAC_OBJ] Raw text received (len: ${originalText.length}), Annotations: ${annotations.length}`);
                  logger.info(`[VECTOR STORE - QAC_OBJ] Raw text preview: ${originalText.substring(0, 500)}...`);
                  // --- DEBUG LOG: Raw Text ---
                  console.log('[DEBUG QAC_OBJ] ===== START PROCESSING =====');
                  console.log('[DEBUG QAC_OBJ] 1. Raw Text from Assistant (length:', originalText.length, '):\n', originalText.substring(0, 1000) + (originalText.length > 1000 ? '...' : ''));
                  // --- END DEBUG LOG ---

                  const finalCitations: SummaryCitation[] = [];

                  // STEP 1: Process annotations -> structured citations
                  await Promise.all(annotations.map(async (annotation: any, i: number) => {
                      if (annotation.type === 'file_citation') {
                          const openaiFileId = annotation.file_citation?.file_id;
                          const startIndex = annotation.start_index;
                          const endIndex = annotation.end_index;
                          const annotationText = annotation.text; // The original 【...†source】 marker

                          if (!openaiFileId || startIndex === undefined || endIndex === undefined || !annotationText) {
                              logger.info(`[VECTOR STORE - CITATION ${i+1}] Annotation missing required fields:`, annotation);
                              return;
                          }

                          try {
                              // --- Map OpenAI ID to client ID and get page number ---
                              const fileInfo = await openai.files.retrieve(openaiFileId);
                              const openAIFilename = fileInfo.filename;
                              const mapping = patient.vectorStore?.fileIdMappings?.find(
                                (m) => m.openaiFileId === openaiFileId || m.fileName === openAIFilename
                              );
                              const clientFileId = mapping?.clientFileId || openAIFilename.split('.')[0];
                              const matchedDocName = mapping?.fileName || openAIFilename;
                              let pageNumber = 1;
                              const medicalDocument = await storageService.getDocument(userUuid, silknotePatientUuid, clientFileId);
                              if (medicalDocument?.content?.analysisResult?.pages?.length) {
                                  for (const page of medicalDocument.content.analysisResult.pages) {
                                      if (page.spans?.length) {
                                          const pageStart = page.spans[0].offset;
                                          const pageEnd = pageStart + page.spans[0].length;
                                          if (startIndex >= pageStart && startIndex < pageEnd) {
                                              pageNumber = page.pageNumber;
                                              break;
                                          }
                                      }
                                  }
                              }
                              // --- End Mapping Logic ---

                              const citationObj: SummaryCitation = {
                                  documentId: clientFileId || openaiFileId,
                                  documentName: matchedDocName || `Unknown (ID: ${openaiFileId})`,
                                  pageNumber: pageNumber,
                                  startIndex: startIndex,
                                  endIndex: endIndex,
                                  originalAnnotationText: annotationText // Store for replacement
                              };
                              finalCitations.push(citationObj);

                          } catch (error) {
                              logger.error(`[VECTOR STORE - CITATION ${i+1}] Error processing annotation:`, error);
                              // Create fallback citation
                              finalCitations.push({
                                documentId: openaiFileId,
                                documentName: `Error Processing (ID: ${openaiFileId})`,
                                pageNumber: 1,
                                startIndex: startIndex,
                                endIndex: endIndex,
                                originalAnnotationText: annotationText
                              });
                          }
                      }
                  }));

                  // Sort citations by start index to process replacements correctly
                  finalCitations.sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0));

                  let textToParse = originalText;
                  // STEP 2: Replace markers if requested
                  if (embedCitationMarkers) {
                      logger.info(`[VECTOR STORE - QAC_OBJ] Embedding citation markers...`);
                      let mutableText = originalText;
                      finalCitations.forEach((citation) => {
                          // Assign marker ID here
                          const markerId = `cite-${randomUUID().substring(0, 6)}`;
                          citation.markerId = markerId;
                          const newMarkerText = `【${markerId}】`; // Use Japanese brackets

                          if (citation.originalAnnotationText) {
                              // Use global regex replacement instead of simple string replacement
                              // This ensures ALL occurrences of the citation text are replaced
                              try {
                                  const escapedText = escapeRegExp(citation.originalAnnotationText);
                                  const regex = new RegExp(escapedText, 'g');
                                  mutableText = mutableText.replace(regex, newMarkerText);
                                  logger.info(`[VECTOR STORE - QAC_OBJ] Replaced citation marker for ${citation.documentId || 'unknown'} with ${markerId}`);
                              } catch (error) {
                                  logger.warn(`[VECTOR STORE - QAC_OBJ] Error replacing citation marker: ${error instanceof Error ? error.message : String(error)}`);
                                  // Fallback to simple replacement if regex fails
                                  mutableText = mutableText.replace(citation.originalAnnotationText, newMarkerText);
                              }
                          } else {
                              logger.info(`[VECTOR STORE - QAC_OBJ] Citation object missing originalAnnotationText, cannot replace marker.`);
                          }
                      });
                      textToParse = mutableText;
                      logger.info(`[VECTOR STORE - QAC_OBJ] Text with markers preview: ${textToParse.substring(0, 500)}...`);
                      // --- DEBUG LOG: Text After Marker Replacement ---
                      console.log('[DEBUG QAC_OBJ] 2. Text After Marker Replacement (length:', textToParse.length, '):\n', textToParse.substring(0, 1000) + (textToParse.length > 1000 ? '...' : ''));
                      // --- END DEBUG LOG ---
                  } else {
                      // --- DEBUG LOG: Text if Markers Not Embedded ---
                      console.log('[DEBUG QAC_OBJ] 2. Markers not embedded, textToParse is originalText.');
                      // --- END DEBUG LOG ---
                  }

                  // STEP 3: Parse JSON
                  try {
                      // Use the robust clean JSON extraction function instead of manually finding braces and cleaning
                      const cleanJsonString = extractCleanJsonFromText(textToParse);
                      logger.info(`[VECTOR STORE - QAC_OBJ] Extracted clean JSON (len: ${cleanJsonString.length})`);
                      // --- DEBUG LOG: Cleaned JSON String ---
                      console.log('[DEBUG QAC_OBJ] 3. Cleaned JSON String from extractCleanJsonFromText (length:', cleanJsonString.length, '):\n', cleanJsonString.substring(0, 1000) + (cleanJsonString.length > 1000 ? '...' : ''));
                      // --- END DEBUG LOG ---
                      
                      // First add enhanced logging at the beginning of the JSON processing
                      logger.info(`[VECTOR STORE - QAC_OBJ] Inspecting cleaned JSON string for citation markers...`);
                      const markerMatches = cleanJsonString.match(/【cite-[a-z0-9]+】/g) || [];
                      logger.info(`[VECTOR STORE - QAC_OBJ] Found ${markerMatches.length} citation markers in text`);
                      if (markerMatches.length > 0) {
                        logger.info(`[VECTOR STORE - QAC_OBJ] Marker samples: ${markerMatches.slice(0, 5).join(', ')}`);
                      }
                      // --- DEBUG LOG: Marker Inspection Result ---
                      console.log('[DEBUG QAC_OBJ] 4. Result of inspecting cleanJsonString for markers: Found', markerMatches.length, 'markers.');
                      // --- END DEBUG LOG ---

                      // Process citations in string properties if needed
                      let finalJsonString = cleanJsonString;
                      
                      // If we have citation markers that need processing, enhance the regex to handle nested objects
                      // --- REMOVED MARKER MOVING LOGIC (Simplification) ---
                      // The following block attempting to move markers within the JSON string has been removed.
                      // Markers will now remain where they are after extractCleanJsonFromText.
                      /*
                      if (embedCitationMarkers && cleanJsonString.includes('【cite-')) {
                        logger.info(`[VECTOR STORE - QAC_OBJ] Processing citation markers in JSON properties...`);
                        // --- DEBUG LOG: Starting Marker Movement ---
                        console.log('[DEBUG QAC_OBJ] 5. Starting marker movement within JSON string.');
                        // --- END DEBUG LOG ---
                        
                        // First check for simple string properties (the existing approach)
                        finalJsonString = cleanJsonString.replace(
                          /"([^"]+)"\s*:\s*"([^"]*?)(\s*【cite-[a-z0-9]+】[^"]*?)"/g,
                          (match: string, propName: string, valueStart: string, valueWithCitations: string) => {
                            // Extract all citation markers
                            const markers = valueWithCitations.match(/【cite-[a-z0-9]+】/g) || [];
                            
                            if (markers.length > 0) {
                              logger.info(`[VECTOR STORE - QAC_OBJ] Moving ${markers.length} markers to end of property "${propName}"`);
                            }
                            
                            // Remove all citation markers from the middle of the string
                            let cleanValue = valueWithCitations.replace(/【cite-[a-z0-9]+】/g, '');
                            
                            // Add all markers to the end
                            return `"${propName}":"${valueStart}${cleanValue.trim()}${markers.join('')}"`;
                          }
                        );
                        
                        // Now add explicit handling for nested array objects (diagnoses, treatments, etc.)
                        try {
                          // Parse the JSON to work with the object structure directly
                          const jsonObj = JSON.parse(finalJsonString);
                          
                          // Process all array properties that might contain objects with string fields
                          const arrayProps = Object.entries(jsonObj).filter(([_, value]) => Array.isArray(value));
                          
                          if (arrayProps.length > 0) {
                            logger.info(`[VECTOR STORE - QAC_OBJ] Processing citation markers in ${arrayProps.length} array properties: ${arrayProps.map(([key]) => key).join(', ')}`);
                            
                            let markersMovedCount = 0;
                            
                            // For each array property (diagnoses, treatments, etc.)
                            arrayProps.forEach(([arrayProp, items]) => {
                              if (!Array.isArray(items)) return;
                              
                              // For each item in the array
                              (items as any[]).forEach((item, itemIndex) => {
                                if (!item || typeof item !== 'object') return;
                                
                                // For each string property in the item
                                Object.entries(item).forEach(([propKey, propValue]) => {
                                  if (typeof propValue === 'string' && propValue.includes('【cite-')) {
                                    // Extract markers
                                    const markers = propValue.match(/【cite-[a-z0-9]+】/g) || [];
                                    if (markers.length > 0) {
                                      // Remove markers from text and append at end
                                      const cleanValue = propValue.replace(/【cite-[a-z0-9]+】/g, '');
                                      item[propKey] = `${cleanValue}${markers.join('')}`;
                                      markersMovedCount += markers.length;
                                      
                                      logger.info(`[VECTOR STORE - QAC_OBJ] Processed markers in ${arrayProp}[${itemIndex}].${propKey}`);
                                      // --- DEBUG LOG: Nested Marker Processed ---
                                      console.log(`[DEBUG QAC_OBJ]   Processed markers in ${arrayProp}[${itemIndex}].${propKey}`);
                                      // --- END DEBUG LOG ---
                                    }
                                  }
                                });
                              });
                            });
                            
                            logger.info(`[VECTOR STORE - QAC_OBJ] Processed ${markersMovedCount} markers in array properties`);
                            
                            // Convert back to JSON string
                            finalJsonString = JSON.stringify(jsonObj);
                             // --- DEBUG LOG: JSON String After Nested Marker Movement ---
                             console.log('[DEBUG QAC_OBJ] 5b. JSON String After Nested Object Marker Movement (length:', finalJsonString.length, '):\n', finalJsonString.substring(0, 1000) + (finalJsonString.length > 1000 ? '...' : ''));
                             // --- END DEBUG LOG ---
                          }
                        } catch (error) {
                          logger.warn(`[VECTOR STORE - QAC_OBJ] Error processing nested objects for citation markers: ${error instanceof Error ? error.message : String(error)}`);
                           // --- DEBUG LOG: Error during Nested Marker Processing ---
                           console.error('[DEBUG QAC_OBJ] Error during nested object marker processing:', error);
                           // --- END DEBUG LOG ---
                          // Continue with the string-replaced version as fallback
                        }
                      } else {
                          // --- DEBUG LOG: Marker Movement Skipped ---
                          console.log('[DEBUG QAC_OBJ] 5. Marker movement skipped (no markers found in cleanJsonString or embedMarkers=false).');
                          // --- END DEBUG LOG ---
                      }
                      */
                      // --- END REMOVED BLOCK ---
                      
                      logger.info(`[VECTOR STORE - QAC_OBJ] Final JSON prepared for parsing (len: ${finalJsonString.length})`);
                      // --- DEBUG LOG: Final JSON String Before Parse ---
                      console.log('[DEBUG QAC_OBJ] 6. Final JSON String Before Parse (length:', finalJsonString.length, '):\n', finalJsonString.substring(0, 1000) + (finalJsonString.length > 1000 ? '...' : ''));
                      // --- END DEBUG LOG ---
                      const parsedContent = JSON.parse(finalJsonString);
                      logger.info(`[VECTOR STORE - QAC_OBJ] Successfully parsed JSON response.`);
                      logger.info(`[VECTOR STORE - QAC_OBJ] END Returning parsed content & ${finalCitations.length} citations (Markers Embedded: ${embedCitationMarkers})`);
                       // --- DEBUG LOG: Final Parsed Content Object ---
                       console.log('[DEBUG QAC_OBJ] 7. Final Parsed Content Object (structure preview):', JSON.stringify(parsedContent, null, 2).substring(0, 1000) + (JSON.stringify(parsedContent).length > 1000 ? '...' : ''));
                       console.log('[DEBUG QAC_OBJ] ===== END PROCESSING =====');
                       // --- END DEBUG LOG ---

                      // At the end of queryAssistantWithCitationsObject, before the return, add more logging
                      // to show what's actually being returned
                      if (embedCitationMarkers) {
                        const finalMarkerMatches = JSON.stringify(parsedContent).match(/【cite-[a-z0-9]+】/g) || [];
                        logger.info(`[VECTOR STORE - QAC_OBJ] Final output has ${finalMarkerMatches.length} citation markers`);
                        if (finalMarkerMatches.length > 0) {
                          logger.info(`[VECTOR STORE - QAC_OBJ] Final marker samples: ${finalMarkerMatches.slice(0, 5).join(', ')}`);
                        }
                        
                        if (markerMatches.length !== finalMarkerMatches.length) {
                          logger.warn(`[VECTOR STORE - QAC_OBJ] ⚠️ Marker count mismatch! Original: ${markerMatches.length}, Final: ${finalMarkerMatches.length}`);
                        }
                      }

                      return { content: parsedContent, citations: finalCitations };
                  } catch (error) {
                      logger.error(`[VECTOR STORE - QAC_OBJ] JSON parsing failed after cleaning: ${error instanceof Error ? error.message : String(error)}`);
                      logger.error(`[VECTOR STORE - QAC_OBJ] Original text preview: ${textToParse.substring(0, 500)}...`);
                      // --- DEBUG LOG: JSON Parse Failed ---
                      console.error('[DEBUG QAC_OBJ] 6a. JSON Parsing Failed. Error:', error);
                      console.log('[DEBUG QAC_OBJ]   Text that was input to extractCleanJsonFromText:', textToParse.substring(0,1000) + (textToParse.length > 1000 ? '...' : ''));
                      // Since marker moving is removed, finalJsonString should be the same as cleanJsonString
                      // We need to declare cleanJsonString here scope-wise
                      let cleanJsonStringForCatch: string | undefined;
                      try {
                        // Re-run extraction just for logging context in case it failed earlier
                        cleanJsonStringForCatch = extractCleanJsonFromText(textToParse);
                      } catch {}
                      console.log('[DEBUG QAC_OBJ]   Cleaned JSON string (if available) that failed parsing:', cleanJsonStringForCatch ? cleanJsonStringForCatch.substring(0,1000) + '...' : 'Could not extract/clean JSON string');
                      console.log('[DEBUG QAC_OBJ] ===== END PROCESSING (Error) =====');
                      // --- END DEBUG LOG ---

                      // Return error structure and the citations we *did* process
                      return {
                          content: {
                              text: originalText, // Original text before replacement
                              textWithMarkers: embedCitationMarkers ? textToParse : undefined, // Text that failed parsing
                              parsingError: true,
                              errorMessage: error instanceof Error ? error.message : String(error)
                          },
                          citations: finalCitations
                      };
                  }
              } else {
                  logger.info(`[VECTOR STORE - QAC_OBJ] Run ${run.id} completed, but no text content found in assistant message.`);
                  return { content: {}, citations: [] };
              }
          } else {
              logger.info(`[VECTOR STORE - QAC_OBJ] Run ${run.id} completed, but no assistant message found.`);
              return { content: {}, citations: [] };
          }
        } else if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
          // Handle failed, cancelled, or expired runs
          const errorReason = runStatus.last_error?.message || `Assistant run ${runStatus.status}`;
          logger.error(`[VECTOR STORE - QAC_OBJ] Run ${run.id} ${runStatus.status}: ${errorReason}`);
          // Throw an error to indicate failure to the caller
          throw new Error(`Assistant run failed or expired: ${errorReason}`);
      }

      // Wait before polling again
      attempts++;
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // If loop finishes without completion, it timed out
  logger.error(`[VECTOR STORE - QAC_OBJ] Query timed out after ${maxAttempts} seconds for run ${run.id}.`);
  throw new Error(`Query timed out after ${maxAttempts} seconds`);
}


router.get('/generate/:silknotePatientUuid', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { silknotePatientUuid } = req.params;
  const requesterId = (req as any).user?.id || 'unknown_requester'; 
  
  logger.info(`[CASE SUMMARY] Received request to generate summary for patient: ${silknotePatientUuid} by ${requesterId}`);
  
  try {
    // Extract silknoteUserUuid from request (should be from auth headers in production)
    const silknoteUserUuid = req.headers['x-user-id'] as string || 'default-user';
    
    const patient = await getPatientById(silknotePatientUuid, silknoteUserUuid);
    if (!patient) {
      logger.warn(`[CASE SUMMARY] Patient not found for generation: ${silknotePatientUuid}`);
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    const patientDocuments = patient.fileSet || [];
    if (patientDocuments.length === 0) {
      logger.warn(`[CASE SUMMARY] No documents found for patient: ${silknotePatientUuid}`);
      return res.status(400).json({ error: 'No documents found for patient, cannot generate summary.' });
    }

    const jobTicket = {
      patientId: silknotePatientUuid,
      status: 'pending',
      message: 'Case summary generation has started.',
      timestamp: new Date().toISOString(),
      jobId: randomUUID()
    };
    res.status(202).json(jobTicket);

    generateAndNotify(silknotePatientUuid, requesterId, jobTicket.jobId, silknoteUserUuid);

  } catch (error) {
    logger.error(`[CASE SUMMARY] Error initiating summary generation for patient ${silknotePatientUuid}:`, error);
    // If an error occurs here, it should be passed to the Express error handler by asyncHandler
    // So, we call next(error) if we want to explicitly pass it, 
    // or let asyncHandler handle it if it's a promise rejection.
    // Since this is a try/catch block within the async function, 
    // if we don't send a response, we should call next(error).
    // However, if headersSent is true, we can't send another response.
    if (!res.headersSent) {
      // Let asyncHandler propagate the error
      return next(error); 
    } else {
      // If headers already sent (e.g. the 202), just log. 
      // The background task will handle its own error notifications via WebSocket.
      console.error("[CASE SUMMARY] Headers already sent, cannot propagate error to Express for /generate endpoint initial phase.");
    }
  }
}));

async function generateAndNotify(silknotePatientUuid: string, requesterId: string, jobId: string, silknoteUserUuid?: string) {
  const patientRoom = `patient-${silknotePatientUuid}`;
  try {
    logger.info(`[CASE SUMMARY ASYNC JOB: ${jobId}] Starting generation for patient: ${silknotePatientUuid}, room: ${patientRoom}, requester: ${requesterId}`);

    io.to(patientRoom).emit('caseSummaryStatus', {
      patientId: silknotePatientUuid,
      jobId,
      status: 'processing',
      message: 'Processing documents and generating summary...'
    });

    const userUuid = silknoteUserUuid || 'default-user';
    const patient = await getPatientById(silknotePatientUuid, userUuid);
    if (!patient) {
        logger.error(`[CASE SUMMARY ASYNC JOB: ${jobId}] Patient ${silknotePatientUuid} not found during async processing.`);
        io.to(patientRoom).emit('caseSummaryError', {
            patientId: silknotePatientUuid,
            jobId,
            error: 'Patient not found during processing.'
        });
        return;
    }
    
    const { summary, citations } = await generateComprehensiveCaseSummary(silknotePatientUuid, userUuid);
    
    const newCount = (patient.summaryGenerationCount || 0) + 1;
    // Corrected type to CaseSummaryApiResponse
    const summaryToStore: CaseSummaryApiResponse = {
      summary,
      citations: citations || [],
      summaryGenerationCount: newCount,
      maxCount: 5 // Use hardcoded 5 for now
    };
    
    const patientToUpdate = { ...patient, caseSummary: summaryToStore, summaryGenerationCount: newCount };
    await updatePatient(patientToUpdate);

    logger.info(`[CASE SUMMARY ASYNC JOB: ${jobId}] Generation complete for patient: ${silknotePatientUuid}. Notifying room: ${patientRoom}`);

    io.to(patientRoom).emit('caseSummaryComplete', {
      patientId: silknotePatientUuid,
      jobId,
      status: 'complete',
      data: summaryToStore
    });

  } catch (error) {
    logger.error(`[CASE SUMMARY ASYNC JOB: ${jobId}] Error during async summary generation for ${silknotePatientUuid}:`, error);
    io.to(patientRoom).emit('caseSummaryError', {
      patientId: silknotePatientUuid,
      jobId,
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to generate case summary'
    });
  }
}

/**
 * Generates a comprehensive case summary using multiple targeted vector store queries
 * to maximize information extraction while preserving existing citation formats.
 * 
 * @param silknotePatientUuid - Patient ID to generate summary for
 * @param silknoteUserUuid - User ID (optional, defaults to 'default-user')
 * @returns Promise with complete, properly typed case summary including inconsistencies
 */
export async function generateComprehensiveCaseSummary(
  silknotePatientUuid: string,
  silknoteUserUuid?: string
): Promise<{ summary: CaseSummaryType; citations: SummaryCitation[] }> {
  const internalGenerate = async (): Promise<{ summary: CaseSummaryType; citations: SummaryCitation[] }> => {
    logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] START Patient: ${silknotePatientUuid}`);
    try {
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Starting concurrent extractions...`);
      
      // Initialize array to collect all citations
      let allCitations: SummaryCitation[] = [];
      
      const userUuid = silknoteUserUuid || 'default-user';

      // 1. Run all extraction steps concurrently
      const [
        patientInfoResult,
        diagnosesAndTreatmentsResult,
        keyEventsTimelineResult,
        inconsistenciesResult
      ] = await Promise.all([
        extractPatientInfo(silknotePatientUuid, true, userUuid), // Pass userUuid
        extractDiagnosesAndTreatments(silknotePatientUuid, true, userUuid), // Pass userUuid
        extractComprehensiveTimeline(silknotePatientUuid, true, userUuid), // Pass userUuid
        generateInconsistenciesWithObject(silknotePatientUuid, userUuid) // Pass userUuid
      ]);

      console.log(`[!!!!!!!!!!!!!!!VECTOR STORE - GEN_COMP_SUMMARY] Inconsistencies Result:`);
      console.log( inconsistenciesResult);
      // Collect citations from each result
      if (patientInfoResult?.citations) allCitations.push(...patientInfoResult.citations);
      if (diagnosesAndTreatmentsResult?.citations) allCitations.push(...diagnosesAndTreatmentsResult.citations);
      if (keyEventsTimelineResult?.citations) allCitations.push(...keyEventsTimelineResult.citations);
      if (inconsistenciesResult?.citations) allCitations.push(...inconsistenciesResult.citations);

      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Concurrent extractions finished.`);
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Result - Patient Info: ${patientInfoResult ? 'OK' : 'FAIL'}, Citations: ${patientInfoResult?.citations?.length || 0}`);
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Result - Diagnoses/Treatments: ${diagnosesAndTreatmentsResult ? 'OK' : 'FAIL'}, Citations: ${diagnosesAndTreatmentsResult?.citations?.length || 0}`);
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Result - Timeline: ${keyEventsTimelineResult ? 'OK' : 'FAIL'}, Citations: ${keyEventsTimelineResult?.citations?.length || 0}`);
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Result - Inconsistencies: ${inconsistenciesResult ? 'OK' : 'FAIL'}, Citations: ${inconsistenciesResult?.citations?.length || 0}`);

      // Add detailed timeline/events logging
      logger.info(`[GEN_COMP_SUMMARY] Timeline content structure: ${JSON.stringify(Object.keys(keyEventsTimelineResult?.content || {}))}`);
      if (keyEventsTimelineResult?.content) {
        // Check for events array
        if (keyEventsTimelineResult.content.events) {
          logger.info(`[GEN_COMP_SUMMARY] Events array found with ${keyEventsTimelineResult.content.events.length} items`);
        } else {
          logger.warn(`[GEN_COMP_SUMMARY] ⚠️ No events array in timeline result!`);
        }
        
        // Check for keyEvents array
        if (keyEventsTimelineResult.content.keyEvents) {
          logger.info(`[GEN_COMP_SUMMARY] keyEvents array found with ${keyEventsTimelineResult.content.keyEvents.length} items`);
        } else {
          logger.warn(`[GEN_COMP_SUMMARY] ⚠️ No keyEvents array in timeline result!`);
        }
      } else {
        logger.error(`[GEN_COMP_SUMMARY] 🔴 Timeline result has no content property!`);
      }
      
      logger.info(`[GEN_COMP_SUMMARY] Result - Inconsistencies: ${inconsistenciesResult?.content ? 'OK' : 'FAIL'}`);

      // Add specific logging for the patientInfo result content
      logger.appDebug(`[GEN_COMP_SUMMARY] Raw content from extractPatientInfo:`, JSON.stringify(patientInfoResult?.content, null, 2));

      // 2. Generate narrative overview from extracted data
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Generating narrative...`);
      const narrativeResult = await generateNarrativeFromExtractedData(
        silknotePatientUuid,
        patientInfoResult,
        diagnosesAndTreatmentsResult,
        true, // Pass true
        userUuid // Pass userUuid
      ).catch(error => {
        logger.error(`[VECTOR STORE - GEN_COMP_SUMMARY] Narrative generation failed: ${error instanceof Error ? error.message : String(error)}`);
        return { 
          content: `Patient case summary generated on ${new Date().toISOString().split('T')[0]}. Summary includes diagnoses, treatments and medical events compiled from available documents.`, 
          citations: [] 
        };
      });
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Narrative generated.`);
      // Collect narrative citations
      if (narrativeResult?.citations) allCitations.push(...narrativeResult.citations);

      // 3. Assemble the full case summary object - Initial Assembly
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Assembling combined summary with spread operator for patient info...`);
      const combinedSummary: CaseSummaryType = {
        // --- Revert to spreading Patient Info fields --- 
        ...(patientInfoResult?.content || {}), // Spread operator, provide empty object default
        // --- End Patient Info ---

        // Narrative
        narrativeOverview: narrativeResult?.content || "", 

        // Medical history
        medicalHistory: diagnosesAndTreatmentsResult?.content?.medicalHistory || [],
        medicalTimeline: keyEventsTimelineResult?.content?.medicalTimeline || [],

        // Diagnoses / treatments - *** CORRECTED ACCESS PATH ***
        diagnoses: diagnosesAndTreatmentsResult?.content.diagnoses || [],
        treatments: diagnosesAndTreatmentsResult?.content.treatments || [],
        testResults: diagnosesAndTreatmentsResult?.content.testResults || [],

        // Key events timeline
        keyEvents: ensureValidKeyEvents(keyEventsTimelineResult?.content?.keyEvents || []),

        // Inconsistencies - Start with the ones generated previously
        medicalInconsistencies: inconsistenciesResult?.content || {
          hasInconsistencies: false,
          inconsistencies: []
        },

        // Note: We are NOT explicitly adding caseID or briefOverview here, 
        // relying on the spread operator *not* providing them (as they are removed from 
        // the schema used by extractPatientInfo) and the final type validation.
      };
      // Log the object immediately after initial assembly
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Assembled initial combinedSummary object:`, JSON.stringify(combinedSummary, null, 2));

      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Final combinedSummary object:`, JSON.stringify(combinedSummary, null, 2));

      // Deduplicate citations based on markerId or originalAnnotationText
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Starting citation deduplication with ${allCitations.length} total citations`);

      // --- REMOVE DEDUPLICATION ---
      /*
      // Document ID based deduplication (primary)
      const uniqueDocumentMap = new Map<string, SummaryCitation>();
      // First pass: deduplicate by documentId (preferred method)
      allCitations.forEach(citation => {
        if (citation.documentId && !uniqueDocumentMap.has(citation.documentId)) {
          uniqueDocumentMap.set(citation.documentId, citation);
        }
      });

      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] After documentId deduplication: ${uniqueDocumentMap.size} citations`);

      // Second pass: add citations that don't have documentId but have markerId
      allCitations.forEach(citation => {
        if (!citation.documentId && citation.markerId && !uniqueDocumentMap.has(`marker-${citation.markerId}`)) {
          uniqueDocumentMap.set(`marker-${citation.markerId}`, citation);
        }
      });

      // Final pass: add any remaining citations with originalAnnotationText
      allCitations.forEach(citation => {
        if (!citation.documentId && !citation.markerId && citation.originalAnnotationText) {
          const textKey = `text-${citation.originalAnnotationText.substring(0, 20)}`;
          if (!uniqueDocumentMap.has(textKey)) {
            uniqueDocumentMap.set(textKey, citation);
          }
        }
      });

      const uniqueCitations = Array.from(uniqueDocumentMap.values());
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Collected ${allCitations.length} citations, deduplicated to ${uniqueCitations.length}.`);
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Citation reduction: ${allCitations.length - uniqueCitations.length} duplicates removed (${((allCitations.length - uniqueCitations.length) / allCitations.length * 100).toFixed(1)}%)`);

      // Optional: Add detailed logging of which citations were kept
      if (uniqueCitations.length > 0) {
        logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Kept citations documentIds: ${uniqueCitations.map(c => c.documentId || 'unknown').join(', ')}`);
      }
      */
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Skipping citation deduplication. Total citations: ${allCitations.length}.`);
      // --- END REMOVE DEDUPLICATION ---

      // 4. Generate the final summary object
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Validating final summary format...`);
      const processedSummary = ensureValidCaseSummaryFormat(combinedSummary);
      logger.info(`[VECTOR STORE - GEN_COMP_SUMMARY] Validation complete. Final summary ready.`);

      // Return the summary and the combined, unique citations
      // --- RETURN ALL CITATIONS --- 
      return { summary: processedSummary, citations: allCitations }; // Return all citations, not unique ones
    } catch (error) {
      logger.error(`[VECTOR STORE - GEN_COMP_SUMMARY] Error generating comprehensive case summary: ${error instanceof Error ? error.message : String(error)}`);
      // Ensure we return the expected structure even on error
      return { 
          summary: ensureValidCaseSummaryFormat({}), // Return empty but valid summary 
          citations: [] 
      };
    }
  };

  return await internalGenerate();
}
/**
 * Ensure the entire case summary has valid structure with all required fields
 * and convert any enum values to strings
 */
function ensureValidCaseSummaryFormat(summary: any): CaseSummaryType {
  // Define a fully populated blank summary that conforms to CaseSummaryZodSchema.
  const blankSummary: CaseSummaryType = {
    narrativeOverview: "",
    reportTitle: "",
    patientName: "",
    reportDate: "",
    patientDateOfBirth: "",
    patientGender: "",
    patientOccupation: "",
    insurerName: "",
    insuranceScheme: "",
    claimNumber: "",
    policyType: "",
    socialHistory: "",
    diagnoses: [],
    keyEvents: [],
    treatments: [],
    testResults: [],
    medicalHistory: [],
    medicalTimeline: [],
    employerName: "",
    employmentStatus: "",
    workRelatedInjury: false,
    employmentNotes: "",
    legalNotes: "",
    medicalInconsistencies: {
      hasInconsistencies: false, 
      inconsistencies: [] 
    }
  } as unknown as CaseSummaryType;
  
  // Helper to validate an array – returns [] if not a valid array
  const safeArray = (value: any) => (Array.isArray(value) ? value : []);

  // Deep-sanitise array items so that required primitive fields always exist
  const sanitiseDiagnoses = (arr: any[]): any[] => safeArray(arr).map((d) => ({
    id: String(d && d.id ? d.id : randomUUID()),
    condition: d?.condition ?? null,
    status: String(d?.status ?? ''),
    diagnosisDate: d?.diagnosisDate ?? null,
    notes: d?.notes ?? null,
  }));

  const sanitiseTreatments = (arr: any[]): any[] => safeArray(arr).map((t) => ({
    id: String(t && t.id ? t.id : randomUUID()),
    treatment: t?.treatment ?? null,
    date: t?.date ?? null,
    provider: t?.provider ?? null,
    type: String(t?.type ?? ''),
    notes: t?.notes ?? null,
  }));

  const sanitiseTestResults = (arr: any[]): any[] => safeArray(arr).map((tr) => ({
    id: String(tr && tr.id ? tr.id : randomUUID()),
    testName: tr?.testName ?? null,
    date: tr?.date ?? null,
    result: tr?.result ?? null,
    range: tr?.range ?? null,
  }));

  const sanitiseKeyEvents = (arr: any[]): any[] => safeArray(arr).map((e) => ({
    id: String(e && e.id ? e.id : randomUUID()),
    eventType: e?.eventType ?? null,
    eventDate: e?.eventDate ?? null,
    eventTitle: e?.eventTitle ?? null,
    eventDescription: e?.eventDescription ?? null,
    providers: safeArray(e?.providers),
    workCapacity: e?.workCapacity ?? null,
    documents: safeArray(e?.documents),
    significance: e?.significance ?? null,
    notes: e?.notes ?? null,
  }));

  // Merge the provided summary with the blank defaults, then re-validate array fields
  const merged = {
    ...blankSummary,
    ...(summary || {})
  };

  return {
    ...merged,

    // Ensure primitive string fields are at least an empty string when falsy
    narrativeOverview: merged.narrativeOverview || "",
    reportTitle: merged.reportTitle || "",
    patientName: merged.patientName || "",
    reportDate: merged.reportDate || "",
    patientDateOfBirth: merged.patientDateOfBirth || "",
    patientGender: merged.patientGender || "",
    patientOccupation: merged.patientOccupation || "",
    insurerName: merged.insurerName || "",
    insuranceScheme: merged.insuranceScheme || "",
    claimNumber: merged.claimNumber || "",
    policyType: merged.policyType || "",
    socialHistory: merged.socialHistory || "",
    employerName: merged.employerName || "",
    employmentStatus: merged.employmentStatus || "",
    employmentNotes: merged.employmentNotes || "",
    legalNotes: merged.legalNotes || "",

    // Boolean with sane default
    workRelatedInjury: typeof merged.workRelatedInjury === "boolean" ? merged.workRelatedInjury : false,

    // Arrays – guaranteed to be arrays
    diagnoses: sanitiseDiagnoses(merged.diagnoses),
    keyEvents: sanitiseKeyEvents(merged.keyEvents),
    treatments: sanitiseTreatments(merged.treatments),
    testResults: sanitiseTestResults(merged.testResults),
    medicalHistory: safeArray(merged.medicalHistory),
    medicalTimeline: safeArray(merged.medicalTimeline),

    // medicalInconsistencies – ensure object and inner array
    medicalInconsistencies: {
      hasInconsistencies: !!(merged.medicalInconsistencies && typeof merged.medicalInconsistencies.hasInconsistencies === "boolean")
        ? merged.medicalInconsistencies.hasInconsistencies
        : false,
      inconsistencies: safeArray(merged.medicalInconsistencies?.inconsistencies)
    }
  } as CaseSummaryType;
}


/**
 * Ensure key events have valid structure with required fields
 */
function ensureValidKeyEvents(keyEvents: any[]): any[] {
  logger.info(`[EVENTS_VALIDATION] START processing ${keyEvents?.length || 0} events`);
  
  if (!keyEvents || !Array.isArray(keyEvents)) {
    logger.warn(`[EVENTS_VALIDATION] ⚠️ Input is not an array! Type: ${typeof keyEvents}`);
    return [];
  }
  
  if (keyEvents.length === 0) {
    logger.warn(`[EVENTS_VALIDATION] ⚠️ Empty events array received!`);
    return [];
  }
  
  // Check for required properties in the first event to detect potential issues
  const firstEvent = keyEvents[0];
  if (firstEvent) {
    const requiredProps = ['eventType', 'eventDate', 'eventTitle'];
    const missingProps = requiredProps.filter(prop => !firstEvent[prop]);
    
    if (missingProps.length > 0) {
      logger.warn(`[EVENTS_VALIDATION] First event missing required properties: ${missingProps.join(', ')}`);
    }
    
    logger.info(`[EVENTS_VALIDATION] First event properties: ${Object.keys(firstEvent).join(', ')}`);
  }
  
  // Map each event to its validated form
  const validatedEvents = keyEvents.map((event, index) => {
    if (!event || typeof event !== 'object') {
      logger.warn(`[EVENTS_VALIDATION] Event at index ${index} is not an object!`);
      return {
        id: randomUUID(),
        eventType: "Other",
        eventDate: "",
        eventTitle: "Unknown Event",
        eventDescription: "",
        providers: [],
        workCapacity: {},
        documents: [],
        significance: "",
        notes: "Auto-generated due to invalid event data"
      };
    }
    
    return {
      id: event.id || randomUUID(),
      eventType: String(event.eventType || "Other"),
      eventDate: event.eventDate || "",
      eventTitle: event.eventTitle || "",
      eventDescription: event.eventDescription || "",
      providers: Array.isArray(event.providers) ? event.providers : [],
      workCapacity: event.workCapacity || {}, // Ensure object exists
      documents: Array.isArray(event.documents) ? event.documents : [],
      significance: event.significance || "",
      notes: event.notes || ""
    };
  });
  
  // Log event types distribution for debugging
  if (validatedEvents.length > 0) {
    const eventTypes = validatedEvents.map(e => e.eventType);
    const typeDistribution = eventTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    logger.info(`[EVENTS_VALIDATION] Event types distribution: ${JSON.stringify(typeDistribution)}`);
  }
  
  logger.info(`[EVENTS_VALIDATION] END Returning ${validatedEvents.length} validated events`);
  return validatedEvents;
}

/**
 * Extract comprehensive timeline with all key events using vector store,
 * with special emphasis on WorkCover certificates and their details
 */
async function extractComprehensiveTimeline(
  silknotePatientUuid: string,
  embedMarkers: boolean,
  silknoteUserUuid?: string // Add optional userUuid parameter
): Promise<{ content: any; citations: SummaryCitation[] }> {
  const logTag = 'TIMELINE';
  logger.info(`[${logTag}] START extraction for patient: ${silknotePatientUuid}`);
  
  try {
    // Define the timeline schema with proper structure
    const timelineSchema = {
      events: [{
        id: "String Unique identifier for this event",
        eventType: "String Type of event (e.g. 'Medical', 'Employment', 'Legal', 'Insurance', 'WorkCover Certificate')",
        eventDate: "String Date of the event (STRICTLY IN DD/MM/YYYY)",
        eventTitle: "String Short title describing the event",
        eventDescription: "String Detailed description of the event",
        providers: [{
          name: "String Name of the provider",
          role: "String Role of the provider",
          organization: "String Organization the provider belongs to"
        }],
        workCapacity: {
          status: "String Work capacity status (e.g., 'Full Capacity', 'Partial Capacity', 'No Capacity')",
          hours: "String Work hours (e.g., '4 hours/day, 3 days/week')",
          restrictions: ["String List of work restrictions"]
        },
        significance: "String Significance of this event to the case",
        notes: "String Additional notes about the event",
        citations: "String Citations to the documents you searched fror the response."
      }]
    };
    
    
    logger.info(`[${logTag}] Prepared schema with events array and sourceMarkers`);
    
    // Create comprehensive timeline prompt
    const timelinePrompt = `
      You are a specialized medical timeline builder. Your task is to create a comprehensive, 
      chronological timeline of ALL events in this patient's case, leaving NOTHING out.

      
      **PRIORITY:** Ensure you include:
      1. The initial injury event.
      2. The first medical contact documented after the injury.
      3. ALL WorkCover Certificates mentioned in the documents.
      Include these priority events even if some minor details are unavailable, as long as date, title, and type are present.
      4. ALL insurer requests for independent medical assessments with EXACT dates
      5. ALL dates when the patient started/stopped work with EXACT details
      6. ALL specialist appointments with doctor names, facilities, and EXACT dates
      7. ALL legal proceedings with EXACT dates
      8. ALL disputes between employer and employee with EXACT dates
      9. For motor vehicle accidents: ALL dates related to the accident, ICWA initiation, 
        and insurer liability acceptance
      
      For EACH event, include:
      1. The exact date in YYYY-MM-DD format (use best estimate if only partial date)
      2. Detailed event title and complete description
      3. The significance of each event to the overall case

      IMPORTANT: You MUST include ALL events in the "events" array in your response!
      Each event should have eventType, eventDate, eventTitle, and eventDescription.
      
      Create the most comprehensive timeline possible, leaving out NO events or dates mentioned 
      in ANY document. Return all events in a SINGLE "events" array in your response.
      Focus on completeness, thoroughness, and including ALL details.
      
      The response MUST contain an "events" array, even if empty. DO NOT return events under a different field name.

        
    Return EVERYTHING you find in the required JSON structure. Focus on thoroughness and comprehensive extraction.
    Nothing at all is acceptable as the first or last character that you respond except { and }. Do not include any comments or other text that are not part of the JSON object.
    ** HIGHEST CRITICAL INSTRUCTION **: GIVE REFERENCES TO THE VECTOR STORE FILE THAT YOU ARE CITING IN RELATION TO THE DOCUMENT USING YOUR STANDARD FORMAT FOR ALL INFORMATION.
    `;

    logger.info(`[${logTag}] Generated timeline prompt with length ${timelinePrompt.length}`);
    logger.appDebug(`[${logTag}] Prompt preview: ${timelinePrompt.substring(0, 200)}...`);

    // Call the query function with the schema and prompt
    logger.info(`[${logTag}] Querying assistant with embedMarkers=${embedMarkers}`);
    
    const result = await queryAssistantWithCitationsObject(
      silknotePatientUuid,
      timelinePrompt,
      timelineSchema,
      embedMarkers,
      silknoteUserUuid // Add optional userUuid parameter
    );
    
    // Log the raw response for debugging
    logger.info(`[${logTag}] Response received with ${result.citations?.length || 0} citations`);
    logger.info(`[${logTag}] Response content type: ${typeof result.content}`);
    
    if (!result.content) {
      logger.warn(`[${logTag}] ⚠️ Empty content received from assistant!`);
      return { content: { events: [], keyEvents: [] }, citations: result.citations || [] };
    }
    
    // Check if events array exists and log details
    if (result.content.events && Array.isArray(result.content.events)) {
      logger.info(`[${logTag}] ✅ Events array found with ${result.content.events.length} events`);
      
      if (result.content.events.length > 0) {
        logger.info(`[${logTag}] Event types present: ${Array.from(new Set(result.content.events.map((e: any) => e.eventType))).join(', ')}`);
        logger.appDebug(`[${logTag}] First event sample: ${JSON.stringify(result.content.events[0])}`);
      } else {
        logger.warn(`[${logTag}] ⚠️ Events array is empty!`);
      }
    } else {
      logger.warn(`[${logTag}] ⚠️ No events array in response! Full content structure: ${JSON.stringify(Object.keys(result.content))}`);
      
      // Try to recover if events might be under a different property
      const possibleEventArrays = Object.entries(result.content)
        .filter(([key, value]) => Array.isArray(value) && key !== 'sourceMarkers')
        .map(([key, value]) => ({ key, length: (value as any[]).length }));
      
      if (possibleEventArrays.length > 0) {
        logger.info(`[${logTag}] Found possible alternative event arrays: ${JSON.stringify(possibleEventArrays)}`);
        
        // Try to use the first array with elements as events
        for (const { key, length } of possibleEventArrays) {
          if (length > 0) {
            logger.info(`[${logTag}] Using '${key}' (${length} items) as events array`);
            result.content.events = result.content[key];
            break;
          }
        }
      }
      
      // If still no events array, create an empty one
      if (!result.content.events) {
        logger.warn(`[${logTag}] Creating empty events array as none found in response`);
        result.content.events = [];
      }
    }

    // Enhanced conversion with backward compatibility
    if (result.content) {
      // If we have events in the new format, make them accessible in the old format too
      if (result.content.events && Array.isArray(result.content.events)) {
        logger.info(`[${logTag}] Copying events array to keyEvents for backward compatibility (${result.content.events.length} events)`);
        result.content.keyEvents = result.content.events;
      }
      
      // If we don't have the new format but have the old format, copy it to the new format
      if (!result.content.events && result.content.keyEvents && Array.isArray(result.content.keyEvents)) {
        logger.info(`[${logTag}] Found keyEvents but no events array - copying to events array (${result.content.keyEvents.length} events)`);
        result.content.events = result.content.keyEvents;
      }
      
      // Create empty arrays for missing sections to prevent downstream errors
      if (!result.content.sourceMarkers) {
        logger.info(`[${logTag}] Creating empty sourceMarkers array`);
        result.content.sourceMarkers = [];
      }
      
      // Log summary of key events
      if (result.content.keyEvents && result.content.keyEvents.length > 0) {
        logger.info(`[${logTag}] Final keyEvents count: ${result.content.keyEvents.length}`);
      } else {
        logger.warn(`[${logTag}] ⚠️ Final keyEvents array is empty or missing!`);
      }
    }

    logger.info(`[${logTag}] END Returning timeline with ${result.citations?.length || 0} citations and ${result.content?.events?.length || 0} events`);
    
    // Return the structured result
    return result;
  } catch (error) {
    // Log any errors in detail
    logger.error(`[${logTag}] 🔴 ERROR during timeline extraction: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.error(`[${logTag}] Error stack: ${error.stack}`);
    }
    
    // Rethrow the error for the caller to handle
    throw error;
  }
}

/**
 * Generate narrative overview based on extracted case data using standard citation embedding
 */
async function generateNarrativeFromExtractedData(
  silknotePatientUuid: string,
  patientInfo: any,
  diagnosisInfo: any,
  embedMarkers: boolean, // Pass flag
  silknoteUserUuid?: string // Add optional userUuid parameter
): Promise<{ content: string; citations: SummaryCitation[] }> { // Return structure matches QAC_OBJ
  // Implement retries with exponential backoff
  let attempts = 0;
  const maxAttempts = 5;
  const initialBackoffMs = 1000; // Start with 1 second
  
  while (attempts < maxAttempts) {
    try {
      attempts++;
      if (attempts > 1) {
        logger.info(`[VECTOR STORE - NARRATIVE] Attempt ${attempts}/${maxAttempts} for narrative generation`);
      }
      
      // Define schema for simple narrative string response
      const narrativeSchema = {
          narrative: " a string ofThe narrative overview text with embedded citation markers referncing the vector store." 
          
      };
      
      // Create narrative generation prompt - Now asks for direct marker embedding
      const narrativePrompt = `
        You are a medical professional tasked with generating a narrative overview of a patient case.
        
        Generate a concise, comprehensive narrative overview of this patient's medical case.
        Focus on their medical journey, key diagnoses, treatments, and significant events.
        The narrative should be factual, objective, and based only on the information provided.
        
        Write in third person, professional medical style, approximately 3-4 paragraphs.
        Start with patient background, followed by key diagnoses and treatments, then current status.

        **IMPORTANT:** EVERY PIECE OF INFORMATION MUST INCLUDE CITATION BACK TO THE  derived from the provided context (diagnoses, treatments, events), you.
        
        INFORMATION EXTRACTED FROM PATIENT DOCUMENTS:

        Return ONLY the narrative string within the specified JSON schema.
        
      `;
      
      // Call QAC_OBJ which handles marker embedding and citation collection
      logger.info(`[VECTOR STORE - NARRATIVE] Calling QAC_OBJ for narrative generation. EmbedMarkers: ${embedMarkers}`);
      const result = await queryAssistantWithCitationsObject(
        silknotePatientUuid,
        narrativePrompt,
        narrativeSchema,
        embedMarkers, // Pass flag - QAC_OBJ will handle embedding
        silknoteUserUuid // Pass userUuid
      );
      
      // Process the result - Extract narrative and citations directly
      let narrative = "";
      let citations: SummaryCitation[] = [];
      
      if (result.content && typeof result.content === 'object' && result.content.narrative) {
        narrative = result.content.narrative;
        logger.info(`[VECTOR STORE - NARRATIVE] Successfully extracted narrative text.`);
      } else {
        logger.info(`[VECTOR STORE - NARRATIVE] Narrative text missing or invalid format in response content:`, result.content); // Changed warn to info
        // Attempt to find narrative in potential error structure if parsing failed in QAC_OBJ
        if (result.content?.parsingError && result.content?.textWithMarkers) {
          narrative = result.content.textWithMarkers; // Use the text that failed parsing
          logger.info(`[VECTOR STORE - NARRATIVE] Using textWithMarkers as narrative due to parsing error.`); // Changed warn to info
        } else if (result.content?.parsingError && result.content?.text) {
          narrative = result.content.text; // Use original text if marker embedding failed
          logger.info(`[VECTOR STORE - NARRATIVE] Using original text as narrative due to parsing error.`); // Changed warn to info
        }
      }

      if (Array.isArray(result.citations)) {
          citations = result.citations;
          logger.info(`[VECTOR STORE - NARRATIVE] Received ${citations.length} citations alongside narrative.`);
      }
      
      // Return the narrative string and the citations collected by QAC_OBJ
      return { content: narrative, citations }; // Correct return structure

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[VECTOR STORE - NARRATIVE] Error on attempt ${attempts}/${maxAttempts}: ${errorMessage}`);
      
      // Check if it's a rate limit error
      if (
        errorMessage.includes("Rate limit") || 
        errorMessage.includes("rateLimitExceeded") ||
        error.status === 429 || 
        (error.data?.error?.code === 'rate_limit_exceeded')
      ) {
        if (attempts < maxAttempts) {
          // Calculate backoff time with exponential increase and jitter
          const backoffMs = Math.min(
            initialBackoffMs * Math.pow(2, attempts-1) * (0.8 + Math.random() * 0.4),
            60000 // Cap at 1 minute max
          );
          
          logger.info(`[VECTOR STORE - NARRATIVE] Rate limit encountered. Retrying in ${Math.round(backoffMs/1000)} seconds (attempt ${attempts}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue; // Try again
        }
      }
      
      // If we've reached max attempts or it's not a rate limit error
      if (attempts >= maxAttempts) {
        logger.info(`[VECTOR STORE - NARRATIVE] All ${maxAttempts} attempts failed. Returning fallback narrative.`);
      } else {
        logger.error(`[VECTOR STORE - NARRATIVE] Non-retryable error: ${errorMessage}`);
      }
      
      // Generate a basic narrative with the available information
      let fallbackNarrative = `Patient medical case summary generated on ${new Date().toISOString().split('T')[0]}.`;
      
      // Add basic patient info if available
      if (patientInfo?.content) {
        const name = patientInfo.content.patientName || "The patient";
        const gender = patientInfo.content.patientGender || "";
        const occupation = patientInfo.content.patientOccupation || "";
        
        if (gender || occupation) {
          fallbackNarrative += ` ${name}, a ${gender ? gender.toLowerCase() + " " : ""}${occupation ? occupation : "person"}, `;
        } else {
          fallbackNarrative += ` ${name} `;
        }
        
        fallbackNarrative += `has a documented medical history. `;
      }
      
      // Add diagnosis info if available
      if (diagnosisInfo?.content?.diagnoses && diagnosisInfo.content.diagnoses.length > 0) {
        const diagnosesCount = diagnosisInfo.content.diagnoses.length;
        fallbackNarrative += `The summary includes ${diagnosesCount} ${diagnosesCount === 1 ? 'diagnosis' : 'diagnoses'} `;
        
        if (diagnosisInfo?.content?.treatments && diagnosisInfo.content.treatments.length > 0) {
          fallbackNarrative += `and ${diagnosisInfo.content.treatments.length} medical ${diagnosisInfo.content.treatments.length === 1 ? 'treatment' : 'treatments'}. `;
        } else {
          fallbackNarrative += `. `;
        }
      }
      
      fallbackNarrative += `This summary was compiled from available medical documentation.`;
      
      return { content: fallbackNarrative, citations: [] };
    }
  }
  
  // This code should never be reached due to the loop exit conditions, but TypeScript needs it
  return { 
    content: `Patient case summary generated on ${new Date().toISOString().split('T')[0]}. Summary includes medical information compiled from available documents.`, 
    citations: [] 
  };
}

/**
 * Extract patient information using vector store
 */
async function extractPatientInfo(
  silknotePatientUuid: string,
  embedMarkers: boolean, // Add flag
  silknoteUserUuid?: string // Add optional userUuid parameter
): Promise<{ content: any; citations: SummaryCitation[] }> {
  const patientInfoSchema = {
    patientName:        "String Patient's full name and citation",
    patientDateOfBirth: "String Patient's date of birth (YYYY-MM-DD) and citation",
    patientGender:      "String Patient's gender and citation",
    patientOccupation:  "String Patient's occupation or job title and citation",
    insurerName:        "String Name of the insurance company and citation",
    insuranceScheme:    "String Type of insurance scheme and citation",
    claimNumber:        "String Insurance claim/case reference number and citation",
    policyType:         "String Type of insurance policy and citation",
    reportDate:         "String Date of the report (YYYY-MM-DD) and citation",
    reportTitle:        "String Title of the case report and citation",
    socialHistory:      "String Patient's social history information and citation",
    employerName:       "String Name of the patient's employer and citation",
    employmentStatus:   "String Current employment status and citation",
    workRelatedInjury:  "Boolean Whether the injury is work-related and citation",
    employmentNotes:    "String Additional notes about employment and citation",
    legalNotes:         "String Notes about legal aspects of the case and citation"
  };
  
  
  const patientInfoPrompt = `
    You are a specialized medical information extractor. Your task is to extract comprehensive 
    patient information from all available documents.

    ** YOU MUST SEARCH THE VECTOR DATABASE AND RETURN MAX RESULTS YOU CAN FOR EVERY FIELD **
    ** WITHIN THAT STRING VALUE, PUT YOUR ANNOTATION THAT LINKS TO A CITATION FOR THAT FIELD ** 
    
    Extract EVERY piece of information about:
    - Patient's full name, date of birth, gender, and occupation
    - ALL insurer details: company name, scheme type, claim number, policy type
    - COMPLETE employer information and work status details
    - ALL case identification information (if available)
    
    Return EVERYTHING you find in the required JSON structure. Focus on thoroughness and comprehensive extraction.
    Nothing at all is acceptable as the first or last character that you respond except { and }. Do not include any comments or other text that are not part of the JSON object.
    ** HIGHEST CRITICAL INSTRUCTION **: GIVE REFERENCES TO THE VECTOR STORE FILE THAT YOU ARE CITING IN RELATION TO THE DOCUMENT USING YOUR STANDARD FORMAT FOR ALL INFORMATION.
  `; // Removed instructions about populating specific ...Source fields
  
  return await queryAssistantWithCitationsObject(
    silknotePatientUuid,
    patientInfoPrompt,
    patientInfoSchema,
    embedMarkers, // Pass flag
    silknoteUserUuid // Pass userUuid
  );
}

/**
 * Extract all diagnoses and treatments using vector store,
 * ensuring dates and sources are properly captured
 */
async function extractDiagnosesAndTreatments(
  silknotePatientUuid: string,
  embedMarkers: boolean, // Add flag
  silknoteUserUuid?: string // Add optional userUuid parameter
): Promise<{ content: any; citations: SummaryCitation[] }> {
  const diagnosisSchema = {
      diagnoses: [{
            condition: "String of Name of the diagnosed condition relevant to the case and citation" ,
            status:  "String of Current status of the condition (e.g. 'Related to Claim', 'Ongoing', 'Resolved', 'Historical'). Blank string if unknown. Include citation if known." ,
            diagnosisDate: "String of Date of diagnosis STRICTLY IN DD/MM/YYYY. Blank string if unknown and citation" ,
            occurrenceCount: "String of Number of times this diagnosis appears across documents and citation",
            notes: "String of short comment relating to management, status, severity or progress if known. No more than 8 words. Blank string if unknown. Incldue citation if known.",

          }],
      treatments: [{
            id:  "String of Unique identifier for this treatment and citation" ,
            treatment: "String of Description of the treatment. Blank string if unknown. Include citation if known." ,
            type:  "String of Type of treatment (e.g. 'Medication', 'Surgery', 'Therapy', 'Other'). Blank string if unknown. Include citation if known." ,
            date: "String of Date of treatment (STRICTLY IN DD/MM/YYYY. Blank string if unknown and citation)" ,
            provider: "String of Provider who administered the treatment. Blank string if unknown. Include citation if known." ,
            notes:  "String of Additional notes about the treatment. No more than 8 words. Blank string if unknown. Include citation if known." 
          }],
      testResults: [{
        id:  "String of Unique identifier for this test result include citation in string" ,
        testName: "String of Name of the test. Blank string if unknown. Include citation if known." ,
        date:  "String of Date of the test STRICTLY IN DD/MM/YYYY. Blank string if unknown. Include citation if known." ,
        result: "String of Result of the test. Blank string if unknown. Include citation if known." ,
        range:  "String of Normal range for the test result. Blank string if unknown. Include citation if known." ,
      }],
    }
  
  
  const diagnosisPrompt = `
    You are a specialized medical diagnosis and treatment extractor. Your task is to extract 
    EVERY diagnosis, treatment, and test result mentioned in ANY document, leaving NOTHING out.
    
    EXTRACT EVERY INSTANCE OF:
    - ALL diagnoses relating to this specific case/claim with exact condition names, dates, and status - 
    - ALL treatments provided with complete details and dates
    - ALL medications prescribed with dosages and frequency
    - ALL test results with values and normal ranges
    - ALL procedures performed with dates and providers
    - ALL past medical history

    
    Return EVERYTHING you find in the required JSON structure. Focus on thoroughness and comprehensive extraction.
    Nothing at all is acceptable as the first or last character that you respond except { and }. Do not include any comments or other text that are not part of the JSON object.
    ** HIGHEST CRITICAL INSTRUCTION **: GIVE REFERENCES TO THE VECTOR STORE FILE THAT YOU ARE CITING IN RELATION TO THE DOCUMENT USING YOUR STANDARD FORMAT FOR ALL INFORMATION.
  `; // Removed instructions about populating specific .source fields
  
  return await queryAssistantWithCitationsObject(
    silknotePatientUuid,
    diagnosisPrompt,
    diagnosisSchema,
    embedMarkers, // Pass flag
    silknoteUserUuid // Pass userUuid
  );
}


/**
 * Generates inconsistencies using the structured output approach with enhanced prompt for comprehensive analysis.
 * Always returns string values instead of enums for better compatibility.
 * 
 * @param silknotePatientUuid - Patient ID to analyze for inconsistencies
 * @returns Promise with inconsistencies data using only string values
 */
export async function generateInconsistenciesWithObject(
  silknotePatientUuid: string,
  silknoteUserUuid?: string // Add optional userUuid parameter
): Promise<{
  content: {
    hasInconsistencies: boolean;
    inconsistencies: Array<{
      type: string;
      description: string;
      severity: string;
      relatedDocuments: Array<{
        id: string | null;
        citationToVectorStoreFile: string | null;
        documentTitle: string; // Add a dedicated title field
        contradictingValues: string[];
      }>;
    }>;
  };
  citations: SummaryCitation[];
}> {
  const logTag = 'INCONSISTENCIES';
  logger.info(`[VECTOR STORE - ${logTag}] Starting inconsistency analysis for patient ${silknotePatientUuid}`);
  
  const inconsistencyPrompt = `You are an expert medical inconsistency detector. Your task is to carefully analyze ALL medical documents in the vector store to identify any contradictions, discrepancies, or inconsistencies in the patient's medical record.

Look for inconsistencies in:
1. **Dates and Timeline**: Conflicting dates for the same events, impossible timelines
2. **Diagnoses**: Contradictory diagnoses or conflicting medical opinions
3. **Medications**: Drug interactions, conflicting prescriptions, dosage discrepancies
4. **Treatment Plans**: Contradictory treatment recommendations
5. **Test Results**: Conflicting lab values, imaging results, or clinical findings
6. **Patient Information**: Inconsistent personal details, allergies, medical history
7. **Clinical Notes**: Contradictory statements across different healthcare providers

For EACH inconsistency found:
- Clearly describe what the inconsistency is
- Identify which specific documents contain the conflicting information  
- Explain why this represents a potential problem
- Assess the severity (Critical, High, Medium, Low)

Return a JSON object that identifies whether inconsistencies exist and provides detailed analysis of each one found.

IMPORTANT: Use the file search tool extensively to ensure you review ALL available documents. Leave no stone unturned in your analysis.`;

  const inconsistencySchema = {
    type: 'object',
    properties: {
      hasInconsistencies: {
        type: 'boolean',
        description: 'Whether any inconsistencies were found in the patient records'
      },
      inconsistencies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Category of inconsistency (e.g., Date/Timeline, Diagnosis, Medication, etc.)'
            },
            description: {
              type: 'string', 
              description: 'Detailed description of the inconsistency found'
            },
            severity: {
              type: 'string',
              enum: ['Critical', 'High', 'Medium', 'Low'],
              description: 'Severity level of the inconsistency'
            },
            relatedDocuments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: ['string', 'null'],
                    description: 'Document identifier if available'
                  },
                  citationToVectorStoreFile: {
                    type: ['string', 'null'], 
                    description: 'Reference to the vector store file containing this information'
                  },
                  documentTitle: {
                    type: 'string',
                    description: 'Title or name of the document'
                  },
                  contradictingValues: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Specific contradicting values or statements from this document'
                  }
                },
                required: ['documentTitle', 'contradictingValues']
              }
            }
          },
          required: ['type', 'description', 'severity', 'relatedDocuments']
        }
      }
    },
    required: ['hasInconsistencies', 'inconsistencies']
  };

  try {
    const result = await queryAssistantWithCitationsObject(
      silknotePatientUuid,
      inconsistencyPrompt,
      inconsistencySchema,
      false, // Don't embed markers for inconsistencies
      silknoteUserUuid // Pass userUuid
    );
    
    logger.info(`[VECTOR STORE - ${logTag}] Inconsistency analysis completed for patient ${silknotePatientUuid}`);
    return result;
    
  } catch (error) {
    logger.error(`[VECTOR STORE - ${logTag}] Error during inconsistency analysis for patient ${silknotePatientUuid}:`, error);
    
    // Return a fallback structure if the analysis fails
    return {
      content: {
        hasInconsistencies: false,
        inconsistencies: []
      },
      citations: []
    };
  }
}



// Keep the original route for backward compatibility but have it redirect to /retrieve
router.get('/:silknotePatientUuid', asyncHandler(async (req: Request, res: Response) => {
  const { silknotePatientUuid } = req.params;
  console.log(`[CASE SUMMARY] Deprecated route - redirecting to retrieve for patient: ${silknotePatientUuid}`);
  
  // Redirect to the retrieve endpoint
  res.redirect(`/api/case-summary/retrieve/${silknotePatientUuid}`);
}));

// POST a case summary to save it for a patient
router.post('/:silknotePatientUuid', asyncHandler(async (req: Request, res: Response) => {
  const { silknotePatientUuid } = req.params;
  // Assume req.body is the FULL CaseSummaryApiResponse structure
  const caseSummaryDataToSave: CaseSummaryApiResponse = req.body;

  // Basic validation on received data
  if (!caseSummaryDataToSave || typeof caseSummaryDataToSave !== 'object' || !caseSummaryDataToSave.summary) {
      return res.status(400).json({ error: 'Invalid case summary data provided in request body.' });
  }
  
  console.log(`[CASE SUMMARY] Saving case summary via POST for patient: ${silknotePatientUuid}`);
  
  try {
    // Get patient record
    const patient = await getPatientById(silknotePatientUuid);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    // Add the case summary to the patient record
    // Ensure counts from the *saved* data are preserved if they exist, otherwise use patient's current count
    const finalSummaryToSave: CaseSummaryApiResponse = {
        ...caseSummaryDataToSave,
        summaryGenerationCount: caseSummaryDataToSave.summaryGenerationCount ?? patient.summaryGenerationCount ?? 0,
        maxCount: caseSummaryDataToSave.maxCount ?? 5
    };
    patient.caseSummary = finalSummaryToSave;
    patient.summaryGenerationCount = finalSummaryToSave.summaryGenerationCount; // Also update the primary count field
    
    // Save updated patient record
    await updatePatient(patient);
    
    console.log(`[CASE SUMMARY] Saved case summary for patient: ${silknotePatientUuid}`);
    
    // Return success along with the counts from the *saved* data
    return res.status(200).json({ 
      success: true,
      summaryGenerationCount: finalSummaryToSave.summaryGenerationCount,
      maxCount: finalSummaryToSave.maxCount 
    });
  } catch (error) {
    console.log(`[CASE SUMMARY] Error saving case summary: ${error}`);
    return res.status(500).json({ error: 'Failed to save case summary' });
  }
}));

// GET existing case summary for a patient (without generating a new one)
router.get('/patients/:silknotePatientUuid/case-summary', asyncHandler(async (req: Request, res: Response) => {
  const { silknotePatientUuid } = req.params;
  
  console.log(`[CASE SUMMARY] Retrieving existing case summary for patient: ${silknotePatientUuid}`);
  
  try {
    // Get patient record
    const patient = await getPatientById(silknotePatientUuid);
    
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    // Check if the patient has a case summary
    if (!patient.caseSummary) {
      return res.status(404).json({ error: 'No case summary found for patient' });
    }
    
    console.log(`[CASE SUMMARY] Retrieved existing case summary for patient: ${silknotePatientUuid}`);
    
    // Initialize the counter if it doesn't exist
    if (patient.summaryGenerationCount === undefined) {
      patient.summaryGenerationCount = 0;
    }
    
    // *** TEMPORARY FIX: Align response with CaseSummaryApiResponse *** 
    const fullCaseSummary = patient.caseSummary as CaseSummaryApiResponse | null;
    if (!fullCaseSummary || !fullCaseSummary.summary) {
      return res.status(500).json({ error: 'Invalid case summary data stored for patient' });
    }
    let parsedSummary = parseCaseSummary(fullCaseSummary.summary) || fullCaseSummary.summary;
    const response: CaseSummaryApiResponse = {
      summary: parsedSummary,
      citations: fullCaseSummary.citations || [],
      summaryGenerationCount: patient.summaryGenerationCount || 0,
      maxCount: 5
    };
    return res.status(200).json(response);
  } catch (error) {
    console.log(`[CASE SUMMARY] Error retrieving case summary: ${error}`);
    return res.status(500).json({ error: 'Failed to retrieve case summary' });
  }
}));

export default router; 