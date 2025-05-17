/**
 * Document Analyzer
 * 
 * Purpose:
 * Analyzes PDF documents using Azure Document Intelligence and Azure OpenAI,
 * mapping the results to strongly-typed medical document schemas using structured outputs.
 * Includes precise spatial information (coordinates) from the original document with
 * validation of extracted fields against medical/legal requirements.
 * 
 * Flow:
 * 1. Analyze document structure with Azure Document Intelligence
 * 2. Extract coordinates and spatial information from Azure results
 * 3. Determine document type using pattern matching
 * 4. Extract structured data using a centralized llmService with Azure OpenAI
 * 5. Aggregate extracted data into a final medical document
 * 
 * Key Features:
 * - Uses a centralized LLM service to ensure consistent API usage and error handling
 * - 4-part parallel schema extraction to avoid token limits
 * - Comprehensive token usage tracking and rate limiting
 * 
 * Coordinate Handling:
 * - Extracts x, y, width, height from Azure's polygon coordinates
 * - Normalizes coordinates relative to page dimensions
 * - Maps extracted text to original document locations
 * - Validates spatial relationships between related fields
 * 
 * Input: AnalyzerInput {
 *   buffer: Buffer - PDF document
 *   patientContext?: PatientDetails - Optional patient context
 *   options?: { confidenceThreshold?: number, extractionRequired?: boolean }
 * }
 * 
 * Output: AnalyzerOutput {
 *   success: boolean
 *   document?: MedicalDocument
 *   confidence: number
 *   documentType: DocumentType
 *   analysis: {
 *     needsEnhancement: boolean
 *     enhancementApplied: boolean
 *     originalConfidence: number
 *     enhancedConfidence?: number
 *   }
 *   error?: string
 * }
 */

import { 
  DocumentAnalysisClient, 
  AzureKeyCredential,
  AnalyzeResult, 
  DocumentPage} from '@azure/ai-form-recognizer';
import config from '../config';
import { MedicalDocument, AnalyzerInput, DocumentType, EnrichedExtraction } from '@shared/types';
import { 
  PageExtractionSchema, 
  PageExtractionSchemaPart1, 
  PageExtractionSchemaPart2, 
  PageExtractionSchemaPart3,
  PageExtractionSchemaPart4,
  combineExtractionParts 
} from '@shared/extraction-schema';
import { processExtraction, aggregateExtractions } from './analyzer/enrich-extraction';
import { ZodObject, ZodType } from 'zod';
import { centralRateLimiter } from './centralRateLimiter';
import zodToJsonSchema from 'zod-to-json-schema';
import { generateStructuredOutput } from './llmService';
import { prepareJsonSchema } from '../utils/schemaUtils';

const documentClient = new DocumentAnalysisClient(
  config.azure.documentIntelligence.endpoint,
  new AzureKeyCredential(config.azure.documentIntelligence.key)
);

// Use the centralized rate limiter directly
const rateLimiter = centralRateLimiter;

// Convert Zod schemas to JSON schemas
const jsonSchemaPart1 = zodToJsonSchema(PageExtractionSchemaPart1, {
  $refStrategy: 'none',
  target: 'jsonSchema7'
});

const jsonSchemaPart2 = zodToJsonSchema(PageExtractionSchemaPart2, {
  $refStrategy: 'none',
  target: 'jsonSchema7'
});

const jsonSchemaPart3 = zodToJsonSchema(PageExtractionSchemaPart3, {
  $refStrategy: 'none',
  target: 'jsonSchema7'
});

const jsonSchemaPart4 = zodToJsonSchema(PageExtractionSchemaPart4, {
  $refStrategy: 'none',
  target: 'jsonSchema7'
});

// Prepare schemas with proper required fields and additionalProperties settings
const preparedJsonSchemaPart1 = prepareJsonSchema(jsonSchemaPart1);
const preparedJsonSchemaPart2 = prepareJsonSchema(jsonSchemaPart2);
const preparedJsonSchemaPart3 = prepareJsonSchema(jsonSchemaPart3);
const preparedJsonSchemaPart4 = prepareJsonSchema(jsonSchemaPart4);

const baseSystemMessage = `You are an expert medical document analyzer specializing in workers compensation and insurance documentation. Your role is to carefully extract information while maintaining accuracy and avoiding fabrication.


KEY PRINCIPLES:
1. ACCURACY
- Use direct quotes rather than paraphrasing
- Never fabricate or guess at information

2. DOCUMENT CLASSIFICATION
- Carefully identify document type based on:
  * Letterhead and headers
  * Document structure and formatting
  * Content patterns and terminology
  * Standard medical document categories
- Default to more specific categories and only use more general ones if another does not fit.
- Never use MEDICAL_RECORD unless no other category fits

4. CLINICAL INFORMATION HANDLING
- Preserve medical terminology as written
- Maintain laterality (left/right/bilateral) in descriptions
- Keep medication details with their complete instructions
- Preserve test results with their units and reference ranges
- Document temporal relationships (dates/durations) precisely
- Capture qualifiers and severity indicators
- The 'author' field MUST be a SINGLE OBJECT, never an array
- If multiple authors exist, select the primary/most significant author only

4. STRUCTURED DATA EXTRACTION
Dates: Only use DD/MM/YYYY format for date fields
Names: Extract full names exactly as written
Numbers: Preserve original formatting and units
Addresses: Maintain original formatting
Clinical Terms: Use exact terminology from document

5. CONTEXTUAL AWARENESS
- Recognize related information across different sections
- Link treatments to specific conditions
- Connect work capacity details to specific injuries
- Match recommendations to diagnoses
- Identify relationships between different providers

6. INFERENCE RULES
ALLOWED:
- Standardizing common medication names
- Recognizing standard medical abbreviations
- Classifying clear document types

NOT ALLOWED:
- Inferring diagnoses not stated
- Assuming relationships between conditions
- Adding details not present in document
- Creating medical conclusions

7. DO NOT MISS
Work Capacity:
- Exact restrictions and modifications
- Specific timeframes and review dates
- Hours and duties limitations
- Return to work plans

Clinical Content:
- Primary vs secondary diagnoses
- Treatment progression and outcomes
- Medication changes and reasons
- Specific functional impacts

Insurance Details:
- Claim numbers exactly as written
- Insurer names from approved list only
- Policy details with original formatting
- Case manager details when provided
`;

// System messages for each part
const systemMessagePart1 = `${baseSystemMessage}

FOCUS AREAS FOR THIS EXTRACTION:
- Document metadata (category, title, date)
- Patient identification and demographics
- Author information including credentials and contact details
- Validation of patient identity against provided context`;

const systemMessagePart2 = `${baseSystemMessage}

FOCUS AREAS FOR THIS EXTRACTION:
- Clinical content including diagnoses, treatments, medications, and allergies
- Ensure preservation of medical terminology exactly as written
- Capture all medication details with complete dosing instructions
- Document allergies and adverse reactions with severity indicators`;

const systemMessagePart3 = `${baseSystemMessage}

FOCUS AREAS FOR THIS EXTRACTION:
- Work capacity details including restrictions and modifications
- Employment information including employer details and duties
- Injury information including mechanism, location, and initial treatment
- Insurance details including claim numbers and policy information`;

const systemMessagePart4 = `${baseSystemMessage}

FOCUS AREAS FOR THIS EXTRACTION:
- Procedure details and timing
- Imaging results and findings
- Provider recommendations and follow-up plans 
- Contact information for all mentioned parties
- Conclusions and professional opinions
- Key events that should be highlighted in the patient timeline`;

// Interface for Azure OpenAI response with usage information
interface AzureOpenAIResult {
  result: any;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export async function analyzeDocument(
  input: AnalyzerInput & { partialDoc?: Partial<MedicalDocument> }
): Promise<MedicalDocument> {
  try {
   // console.log('\n=== Starting Document Analysis ===')
    const poller = await documentClient.beginAnalyzeDocument('prebuilt-document', input.buffer)
    const analysisResult: AnalyzeResult = await poller.pollUntilDone()

    const extractedPages = await Promise.all(
      (analysisResult.pages || []).map(async (page: DocumentPage) => {
        const azureAnalysis = {
          pageNumber: page.pageNumber,
          angle: page.angle,
          dimensions: { width: page.width, height: page.height, unit: page.unit },
          spans: page.spans,
          words: page.words?.map(word => ({
            content: word.content,
            confidence: word.confidence,
            polygon: word.polygon,
            span: word.span,
          })),
          lines: page.lines?.map(line => ({
            content: line.content,
            polygon: line.polygon,
            spans: line.spans,
          })),
          selectionMarks: page.selectionMarks?.map(mark => ({
            state: mark.state,
            confidence: mark.confidence,
            polygon: mark.polygon,
            span: mark.span,
          })),
          tables: analysisResult.tables?.filter(table =>
            table.boundingRegions?.some(region => region.pageNumber === page.pageNumber)
          ),
          paragraphs: analysisResult.paragraphs?.filter(para =>
            para.boundingRegions?.some(region => region.pageNumber === page.pageNumber)
          ),
        }

        const basePrompt = `
=== DOCUMENT ANALYSIS REQUEST ===
Analyze this page (${page.pageNumber} of ${analysisResult.pages?.length}):
Page Details:
- Orientation: ${page.angle ? `${page.angle}°` : 'normal'}
- Size: ${page.width}x${page.height} ${page.unit}
- Words detected: ${page.words?.length}
- Lines detected: ${page.lines?.length}
${input.patientContext ? `
Patient Context:
- Name: ${input.patientContext.name || 'Not provided'}
- Date of Birth: ${input.patientContext.dateOfBirth || 'Not provided'}
- Gender: ${input.patientContext.gender || 'Not provided'}
` : ''}
Content:
${page.lines?.map(line => line.content).join('\n')}
        `
        
        // Define token estimation variables
        const systemTokensPart1 = rateLimiter.estimateTokenCount(systemMessagePart1);
        const systemTokensPart2 = rateLimiter.estimateTokenCount(systemMessagePart2);
        const systemTokensPart3 = rateLimiter.estimateTokenCount(systemMessagePart3);
        const systemTokensPart4 = rateLimiter.estimateTokenCount(systemMessagePart4);
        const promptTokens = rateLimiter.estimateTokenCount(basePrompt);
        
        // Customize prompts for each part
        const promptPart1 = `${basePrompt}
        
Focus on extracting: document metadata, patient information, author details, and patient identity validation.`;

        const promptPart2 = `${basePrompt}
        
Focus on extracting: clinical content including diagnoses, treatments, medications, and allergies.`;

        const promptPart3 = `${basePrompt}
        
Focus on extracting: work capacity, employment details, injury information, and insurance details.`;

        const promptPart4 = `${basePrompt}
        
Focus on extracting: procedures, imaging, recommendations, contact information, conclusions, and key events.`;
        
        try {
          // Wait if needed to respect rate limits for all four calls
          const totalEstimatedTokens = systemTokensPart1 + systemTokensPart2 + systemTokensPart3 + systemTokensPart4 + (promptTokens * 4);
         // console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Waiting for token availability (est. ${totalEstimatedTokens} tokens)`);
          await rateLimiter.trackTokenUsage(totalEstimatedTokens, `Document Analyzer Page ${page.pageNumber} - All Four Parts`);
          
          //console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Starting parallel extractions (4 parts)`);
          
          // Function to create chat completion with structured output for a specific schema part
          async function createStructuredCompletion(
            system: string, 
            prompt: string, 
            schema: any, 
            schemaName: string
          ): Promise<AzureOpenAIResult> {
            return rateLimiter.executeWithRetry(
              async () => {
                //console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Executing taskname`);
                
                // Use the centralized service for structured outputs
                const response = await generateStructuredOutput(
                  system,
                  prompt,
                  schema
                );
                
                return {
                  result: response.result,
                  usage: response.usage
                };
              },
              `Page ${page.pageNumber} Extraction - taskName`,
              3
            );
          }
          
          // Execute all four extraction parts in parallel
          const [part1Response, part2Response, part3Response, part4Response] = await Promise.all([
            createStructuredCompletion(
              systemMessagePart1, 
              promptPart1, 
              preparedJsonSchemaPart1, 
              'PageExtractionSchemaPart1'
            ),
            
            createStructuredCompletion(
              systemMessagePart2, 
              promptPart2, 
              preparedJsonSchemaPart2, 
              'PageExtractionSchemaPart2'
            ),
            
            createStructuredCompletion(
              systemMessagePart3, 
              promptPart3, 
              preparedJsonSchemaPart3, 
              'PageExtractionSchemaPart3'
            ),
            
            createStructuredCompletion(
              systemMessagePart4, 
              promptPart4, 
              preparedJsonSchemaPart4, 
              'PageExtractionSchemaPart4'
            )
          ]);
          
         // console.log(`[DOC ANALYZER] Page ${page.pageNumber}: All four extraction parts completed successfully`);
          
          // Extract the results
          const part1 = part1Response.result || {};
          const part2 = part2Response.result || {};
          const part3 = part3Response.result || {};
          const part4 = part4Response.result || {};
          
         // console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Combining extraction results from 4 parts`);
          const extraction = combineExtractionParts(part1, part2, part3, part4);
          
          // Track token usage for better accuracy
          let actualTokensUsed = 0;
          
          if (part1Response.usage && part1Response.usage.total_tokens) {
            const actualTokens1 = part1Response.usage.total_tokens;
          //  console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Part 1 used ${actualTokens1} tokens`);
            actualTokensUsed += actualTokens1;
          }
          
          if (part2Response.usage && part2Response.usage.total_tokens) {
            const actualTokens2 = part2Response.usage.total_tokens;
           // console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Part 2 used ${actualTokens2} tokens`);
            actualTokensUsed += actualTokens2;
          }
          
          if (part3Response.usage && part3Response.usage.total_tokens) {
            const actualTokens3 = part3Response.usage.total_tokens;
          //  console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Part 3 used ${actualTokens3} tokens`);
            actualTokensUsed += actualTokens3;
          }
          
          if (part4Response.usage && part4Response.usage.total_tokens) {
            const actualTokens4 = part4Response.usage.total_tokens;
          //  console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Part 4 used ${actualTokens4} tokens`);
            actualTokensUsed += actualTokens4;
          }
          
          // Adjust token tracking if our estimate was off
          const tokenDiff = actualTokensUsed - totalEstimatedTokens;
          if (tokenDiff > 0) {
          //  console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Adjusting token tracking (+${tokenDiff} tokens)`);
            await rateLimiter.trackTokenUsage(tokenDiff, `Token adjustment for Page ${page.pageNumber}`);
          }
          
          // Calculate page confidence
          const pageConfidence =
            page.words && page.words.length > 0
              ? page.words.reduce((sum, word) => sum + (word.confidence || 0), 0) / page.words.length
              : 0.5;

          // Process extraction as before
          //console.log(`[DOC ANALYZER] Page ${page.pageNumber}: Enriching extraction`);
          const enrichedExtraction = processExtraction(extraction, analysisResult, page);
          
          // Return the complete page data
          return {
            ...extraction,
            pageNumber: page.pageNumber,
            pageWidth: page.width,
            pageHeight: page.height,
            azureAnalysis,
            confidence: pageConfidence,
            enrichedExtraction,
          };
        } catch (error: any) {
          // Enhanced error logging - ensure we capture all important information
          const errorObj = {
            message: error.message || 'Unknown error',
            status: error.statusCode || error.status || (error.data?.error?.code),
            type: error.type || error.code || 'UnknownErrorType',
            page: page.pageNumber,
            request: error.request ? { 
              model: config.azure.azureOpenAI.deployment, 
              prompt_length: basePrompt.length 
            } : undefined
          };
          
          // Extract a concise error message from data property if available
          if (error.data?.error?.message) {
            errorObj.message = error.data.error.message;
          }
          
          // Log the error in a structured format
      //    console.log(`[DOC ANALYZER] Error on page ${page.pageNumber}: ${JSON.stringify(errorObj, null, 2)}`);
          
          // If it's a schema validation error, provide more specific information
          if (errorObj.message.includes('schema') || errorObj.message.includes('validation')) {
            // Extract the specific validation error if present
            const validationDetails = errorObj.message.includes('Validation error:') 
              ? errorObj.message.split('Validation error:')[1].trim() 
              : (errorObj.message.includes('Error:') 
                ? errorObj.message.split('Error:')[1].trim() 
                : 'Unknown schema validation issue');
            
            //console.log(`[DOC ANALYZER] Schema validation failed: ${validationDetails}`);
            
            // Log which part of the extraction failed
            if (error.config?.data) {
              try {
                const data = JSON.parse(error.config.data);
                if (data.function_call?.arguments) {
                  //console.log(`[DOC ANALYZER] Failed extraction part details:`, data.function_call.name || 'unknown part');
                }
              } catch (parseError) {
                // Unable to parse the error data, continue with normal error handling
              }
            }
          }
          
          // Let the error propagate, the outer code will handle retries
          throw error;
        }
      })
    )

    const documentConfidence =
      extractedPages.reduce((sum, page) => sum + (page.confidence || 0), 0) / extractedPages.length

    const aggregatedExtraction: EnrichedExtraction = aggregateExtractions(
      extractedPages.map(page => page.enrichedExtraction)
    )

    // Merge the partial document with the extraction outcomes
    const partialDoc = input.partialDoc || {}
    const medicalDocument: MedicalDocument = {
      clientFileId: partialDoc.clientFileId ?? input.documentId ?? `doc_${Date.now()}`,
      ...partialDoc,
      storedPath: partialDoc.storedPath ?? `stored/${input.documentId}`,
      status: partialDoc.status ?? 'processed',
      uploadDate: partialDoc.uploadDate ?? new Date().toISOString(),
      type: partialDoc.type ?? 'application/pdf',
      size: partialDoc.size ?? input.buffer.length,
      fileSize: partialDoc.fileSize ?? input.buffer.length,
      pageCount: partialDoc.pageCount ?? extractedPages.length,
      format: partialDoc.format ?? { mimeType: 'application/pdf', extension: 'pdf' },
      filename: partialDoc.filename ?? input.documentId ?? `doc_${Date.now()}`,
      originalName: partialDoc.originalName ?? 'Unknown',
      title: extractedPages[0]?.documentTitle || partialDoc.title || input.documentId || 'Untitled Document',
      category: (extractedPages[0]?.category as DocumentType) || partialDoc.category || DocumentType.UNKNOWN,
      documentDate: extractedPages[0]?.documentDate || partialDoc.documentDate,
      content: {
        ...partialDoc.content,
        analysisResult,
        extractedSchemas: extractedPages,
        enrichedSchemas: [{ ...aggregatedExtraction }],
        pageImages: partialDoc.content?.pageImages ?? []
      },
      confidence: documentConfidence,
      processedAt: new Date().toISOString(),
      silknotePatientUuid: partialDoc.silknotePatientUuid!, // enforced from the partial document
    }

  //  console.log(`[DOC ANALYZER] Document analysis complete: ${medicalDocument.title}`);
    return medicalDocument
  } catch (error) {
    console.log('\n=== Document Analysis Failed ===', error)
    throw new Error(error instanceof Error ? error.message : 'Unknown error occurred')
  }
}